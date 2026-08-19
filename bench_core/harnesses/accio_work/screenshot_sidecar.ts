// @ts-nocheck — runs in-container via bun (node compat); host has no @types/node
// CDP screenshot sidecar — runs inside the workstation container.
// Connects to Chrome DevTools (default ws://127.0.0.1:9223), auto-attaches to
// every page target, and writes screenshots on navigation events plus a
// fixed-interval fallback. Uses a separate CDP session, so the agent's
// BrowserRelay channel is untouched and the agent has no visibility into us.
//
// Output: $SCREENSHOT_DIR/{seq}_{ts}_{targetId8}_{trigger}.jpg
//         $SCREENSHOT_DIR/sidecar.log (when launched with redirection)
//         $SCREENSHOT_DIR/events.jsonl (one line per capture / lifecycle event)

import { mkdir, writeFile, appendFile } from "node:fs/promises";

const OUT_DIR = process.env.SCREENSHOT_DIR || "/data/screenshots";
const CDP_HTTP = process.env.CDP_HTTP || "http://127.0.0.1:9223/json/version";
const FALLBACK_MS = parseInt(process.env.SCREENSHOT_FALLBACK_MS || "2000", 10);
const MIN_GAP_MS = parseInt(process.env.SCREENSHOT_MIN_GAP_MS || "500", 10);
const POST_NAV_DELAY_MS = parseInt(process.env.SCREENSHOT_POST_NAV_MS || "800", 10);
const POST_LOAD_DELAY_MS = parseInt(process.env.SCREENSHOT_POST_LOAD_MS || "400", 10);
const POST_XHR_DELAY_MS = parseInt(process.env.SCREENSHOT_POST_XHR_MS || "300", 10);
const NETWORK_TRIGGER = (process.env.SCREENSHOT_NETWORK_TRIGGER ?? "1") !== "0";
const JPEG_QUALITY = parseInt(process.env.SCREENSHOT_QUALITY || "75", 10);
const READY_TIMEOUT_S = parseInt(process.env.CDP_READY_TIMEOUT_S || "120", 10);

let msgId = 0;
let seq = 0;
const pending = new Map<number, (v: any) => void>();
const sessionToTarget = new Map<string, string>();
const sessionToUrl = new Map<string, string>();
const lastShotAt = new Map<string, number>();
const eventsPath = `${OUT_DIR}/events.jsonl`;
const sidecarState = { connected: false, intervalTimer: null as any };

// Skip screenshots for URLs the browser is just sitting on between real
// pages — about:blank, the chrome:// new-tab UI, devtools/extension surfaces.
// Capturing those produces ~10KB blank frames that pollute the run gallery
// without showing anything the agent did. Release-only hardening.
const SKIP_SCREENSHOT_URL_PREFIXES = [
  "about:blank",
  "chrome://",
  "chrome-extension://",
  "devtools://",
];

function shouldCaptureUrl(url: string | undefined): boolean {
  if (!url) return false;
  return !SKIP_SCREENSHOT_URL_PREFIXES.some((prefix) => url.startsWith(prefix));
}

function ts(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function log(line: string): void {
  console.log(`[sidecar] ${line}`);
}

async function logEvent(kind: string, extra: Record<string, any> = {}): Promise<void> {
  const rec = { ts: new Date().toISOString(), kind, ...extra };
  try {
    await appendFile(eventsPath, JSON.stringify(rec) + "\n");
  } catch (err: any) {
    log(`events.jsonl write failed: ${err.message}`);
  }
}

async function getBrowserWsUrl(): Promise<string> {
  const deadline = Date.now() + READY_TIMEOUT_S * 1000;
  let lastErr = "";
  while (Date.now() < deadline) {
    try {
      const r = await fetch(CDP_HTTP);
      if (r.ok) {
        const data: any = await r.json();
        if (data.webSocketDebuggerUrl) return data.webSocketDebuggerUrl;
      } else {
        lastErr = `HTTP ${r.status}`;
      }
    } catch (err: any) {
      lastErr = err.message;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Chrome CDP not ready after ${READY_TIMEOUT_S}s (last: ${lastErr})`);
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  await logEvent("sidecar.start", { pid: process.pid, outDir: OUT_DIR });
  const url = await getBrowserWsUrl();
  log(`connecting to ${url}`);
  await logEvent("cdp.connect", { url });

  const ws = new WebSocket(url);

  // Page.captureScreenshot can stall while the agent's playwright/CDP driver
  // is mid-action (we've seen 30s+ blocks under OpenClaw). Use a generous
  // timeout for screenshots specifically; non-screenshot calls keep the
  // shorter default so misconfigured handshakes still surface fast.
  const DEFAULT_SEND_TIMEOUT_MS = 30000;
  const SCREENSHOT_SEND_TIMEOUT_MS = 90000;

  function send(method: string, params: Record<string, any> = {}, sessionId?: string): Promise<any> {
    const id = ++msgId;
    const timeoutMs =
      method === "Page.captureScreenshot" ? SCREENSHOT_SEND_TIMEOUT_MS : DEFAULT_SEND_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
      pending.set(id, resolve);
      const payload: Record<string, any> = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      ws.send(JSON.stringify(payload));
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`Timeout: ${method}`));
        }
      }, timeoutMs);
    });
  }

  // In-flight capture dedup: if interval and an event trigger both fire while
  // a previous Page.captureScreenshot for the same target is still queued
  // (e.g. Chrome is busy with OpenClaw automation), don't pile up more
  // requests — they'd all serialize on the same WS and amplify timeouts.
  const captureInFlight = new Set<string>();

  async function capture(sessionId: string, trigger: string): Promise<void> {
    const targetId = sessionToTarget.get(sessionId);
    if (!targetId) return;
    if (!shouldCaptureUrl(sessionToUrl.get(sessionId))) return;
    const now = Date.now();
    if (now - (lastShotAt.get(targetId) || 0) < MIN_GAP_MS) return;
    if (captureInFlight.has(targetId)) {
      // Skip silently — current capture will satisfy the user-visible cadence.
      return;
    }
    lastShotAt.set(targetId, now);
    captureInFlight.add(targetId);
    try {
      const result = await send(
        "Page.captureScreenshot",
        { format: "jpeg", quality: JPEG_QUALITY },
        sessionId,
      );
      const buf = Buffer.from(result.data, "base64");
      const seqStr = String(++seq).padStart(5, "0");
      const tid8 = targetId.slice(0, 8);
      const file = `${OUT_DIR}/${seqStr}_${ts()}_${tid8}_${trigger}.jpg`;
      await writeFile(file, buf);
      log(`saved ${file} (${buf.length}B) trigger=${trigger}`);
      await logEvent("capture", {
        file: file.split("/").pop(),
        targetId,
        url: sessionToUrl.get(sessionId),
        trigger,
        bytes: buf.length,
      });
    } catch (err: any) {
      log(`capture failed (${trigger}): ${err.message}`);
      await logEvent("capture.error", { trigger, targetId, error: err.message });
    } finally {
      captureInFlight.delete(targetId);
    }
  }

  ws.addEventListener("open", async () => {
    log("ws connected");
    await send("Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
    });
    log("autoAttach enabled (flatten)");
    await logEvent("cdp.ready");
  });

  ws.addEventListener("message", async (ev: MessageEvent) => {
    let msg: any;
    try {
      msg = JSON.parse(ev.data as string);
    } catch {
      return;
    }

    if (typeof msg.id === "number" && pending.has(msg.id)) {
      pending.get(msg.id)!(msg.result);
      pending.delete(msg.id);
      return;
    }

    const method = msg.method as string | undefined;
    if (!method) return;

    if (method === "Target.attachedToTarget") {
      const { sessionId, targetInfo } = msg.params;
      if (targetInfo.type !== "page") return;
      sessionToTarget.set(sessionId, targetInfo.targetId);
      sessionToUrl.set(sessionId, targetInfo.url);
      try {
        await send("Page.enable", {}, sessionId);
      } catch (err: any) {
        log(`Page.enable failed: ${err.message}`);
      }
      if (NETWORK_TRIGGER) {
        try {
          await send("Network.enable", {}, sessionId);
        } catch (err: any) {
          log(`Network.enable failed: ${err.message}`);
        }
      }
      log(`attached page ${targetInfo.targetId.slice(0, 8)} url=${targetInfo.url}`);
      await logEvent("target.attached", {
        targetId: targetInfo.targetId,
        url: targetInfo.url,
      });
      setTimeout(() => capture(sessionId, "attach"), POST_LOAD_DELAY_MS);
      return;
    }

    if (method === "Target.detachedFromTarget") {
      const sid = msg.params.sessionId;
      const tid = sessionToTarget.get(sid);
      sessionToTarget.delete(sid);
      sessionToUrl.delete(sid);
      await logEvent("target.detached", { targetId: tid });
      return;
    }

    const sid = msg.sessionId as string | undefined;
    if (!sid || !sessionToTarget.has(sid)) return;

    if (method === "Page.frameNavigated") {
      const frame = msg.params.frame;
      if (frame && !frame.parentId) {
        sessionToUrl.set(sid, frame.url);
        await logEvent("page.navigated", {
          targetId: sessionToTarget.get(sid),
          url: frame.url,
        });
        setTimeout(() => capture(sid, "navigated"), POST_NAV_DELAY_MS);
      }
    } else if (method === "Page.loadEventFired") {
      setTimeout(() => capture(sid, "loaded"), POST_LOAD_DELAY_MS);
    } else if (NETWORK_TRIGGER && method === "Network.responseReceived") {
      const resp = msg.params.response;
      const rtype = msg.params.type;
      if (
        resp &&
        (rtype === "Document" || rtype === "XHR" || rtype === "Fetch") &&
        typeof resp.status === "number" &&
        resp.status >= 200 &&
        resp.status < 400
      ) {
        setTimeout(() => capture(sid, `xhr_${rtype.toLowerCase()}`), POST_XHR_DELAY_MS);
      }
    }
  });

  ws.addEventListener("close", async () => {
    // Don't exit on close: when the agent's harness restarts Chrome (e.g.
    // OpenClaw spawns its profile-Chrome shortly after the entrypoint
    // browser-control service binds), our WS to the early socket goes
    // away and we'd lose the rest of the run. Surface as a thrown error
    // so the outer reconnect loop in `runForever` re-attaches.
    log("ws closed");
    await logEvent("sidecar.disconnect", { reason: "ws.close" });
    pending.forEach((resolve) => resolve(undefined));
    pending.clear();
    sessionToTarget.clear();
    sessionToUrl.clear();
    sidecarState.connected = false;
  });

  ws.addEventListener("error", (err: any) => {
    log(`ws error: ${err?.message || err}`);
  });

  sidecarState.connected = true;
  if (FALLBACK_MS > 0 && !sidecarState.intervalTimer) {
    sidecarState.intervalTimer = setInterval(async () => {
      for (const sid of sessionToTarget.keys()) {
        await capture(sid, "interval");
      }
    }, FALLBACK_MS);
  } else if (FALLBACK_MS <= 0 && !sidecarState.intervalTimer) {
    log("periodic interval disabled (FALLBACK_MS=0)");
  }

  const onTerm = async (sig: string) => {
    log(`received ${sig}, exiting`);
    await logEvent("sidecar.exit", { reason: sig });
    process.exit(0);
  };
  process.on("SIGTERM", () => onTerm("SIGTERM"));
  process.on("SIGINT", () => onTerm("SIGINT"));

  // Block until disconnect (ws.close handler clears `connected`). The outer
  // runForever loop then re-attempts attach; this is needed because Chrome
  // can be torn down + re-spawned by the agent harness mid-run.
  while (sidecarState.connected) {
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function runForever(): Promise<void> {
  let attempt = 0;
  while (true) {
    try {
      await main();
    } catch (err: any) {
      log(`run error: ${err?.message || err}`);
      try {
        await logEvent("sidecar.error", { error: err?.message || String(err) });
      } catch {}
    }
    attempt += 1;
    const backoff = Math.min(15000, 2000 + attempt * 500);
    log(`reconnect in ${backoff}ms (attempt ${attempt})`);
    await new Promise((r) => setTimeout(r, backoff));
  }
}

runForever().catch(async (err: any) => {
  console.error(`[sidecar] fatal: ${err.message}`);
  try {
    await logEvent("sidecar.fatal", { error: err.message });
  } catch {}
  process.exit(1);
});
