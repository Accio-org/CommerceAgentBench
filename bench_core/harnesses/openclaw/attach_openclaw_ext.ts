// @ts-nocheck — runs in-container via bun (node-compat); host has no @types/node.
//
// Attach the OpenClaw "Browser Relay" Chrome extension to the active tab in
// the upstream-image entrypoint Chrome (CDP on 9222), bypassing the toolbar
// click that the extension's official install instructions require.
//
// How it works:
//   1. Find the OpenClaw extension's service_worker target via /json/list and
//      verify by manifest.name == "OpenClaw Browser Relay".
//   2. Pre-set chrome.storage.local with relayPort + gatewayToken so the SW
//      can connect WS to OpenClaw's relay server (relayPort = controlPort+1
//      derived from gateway port, default 18792 for gateway 18789).
//   3. Open the mock URL in a new active tab so connectOrToggleForActiveTab
//      has something to attach to.
//   4. Call globalThis.__openclawConnect() — exposed by our Dockerfile patch
//      to background.js. It calls the module-scoped connectOrToggleForActiveTab
//      which fires chrome.debugger.attach({tabId}, '1.3') without needing a
//      synthetic toolbar click (Chrome only requires user-gesture for the
//      action button click event itself, not for chrome.debugger.attach).
//   5. Verify by polling globalThis.__openclawState() for relayWsState=OPEN
//      and tabsCount>0.
//
// Usage (from inside the container):
//   bun run /opt/openclaw_harness/attach_openclaw_ext.ts \
//       <gatewayToken> <relayPort> <activeTabUrl>

const [, , gatewayTokenArg, relayPortArg, mockUrlArg] = process.argv;
const gatewayToken = gatewayTokenArg || process.env.OPENCLAW_GATEWAY_TOKEN || "";
const relayPort = parseInt(relayPortArg || "18792", 10);
const targetUrl = mockUrlArg || "http://127.0.0.1:3000/";

if (!gatewayToken) {
  console.error("[attach] FATAL: gatewayToken empty; pass arg1 or set OPENCLAW_GATEWAY_TOKEN");
  process.exit(2);
}

const CDP_HTTP = process.env.CDP_HTTP || "http://127.0.0.1:9222/json";
const OPENCLAW_EXT_NAME = "OpenClaw Browser Relay";

let nextId = 0;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function sendCmd(wsUrl: string, method: string, params: any = {}, timeoutMs = 10000): Promise<any> {
  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const id = ++nextId;
    let settled = false;
    const t = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { ws.close(); } catch {}
        reject(new Error(`Timeout: ${method}`));
      }
    }, timeoutMs);
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ id, method, params }));
    });
    ws.addEventListener("message", (ev: MessageEvent) => {
      let msg: any;
      try { msg = JSON.parse(ev.data as string); } catch { return; }
      if (msg.id !== id) return;
      settled = true;
      clearTimeout(t);
      try { ws.close(); } catch {}
      if (msg.error) {
        reject(new Error(`CDP error: ${JSON.stringify(msg.error)}`));
      } else if (msg.result?.exceptionDetails) {
        const e = msg.result.exceptionDetails;
        reject(new Error(`JS exception: ${e.text || ""} ${e.exception?.description || ""}`));
      } else {
        resolve(msg.result?.result || msg.result);
      }
    });
    ws.addEventListener("error", (err: any) => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      reject(new Error(`WS error: ${err?.message || err}`));
    });
    ws.addEventListener("close", () => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      reject(new Error("WS closed before response"));
    });
  });
}

async function runtimeEvaluate(wsUrl: string, expression: string, awaitPromise = false): Promise<any> {
  return await sendCmd(wsUrl, "Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise,
  });
}

async function findOpenClawSw(): Promise<{ ws: string; extId: string }> {
  const deadline = Date.now() + 30000;
  let lastErr = "";
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(CDP_HTTP)).json();
      const sws = targets.filter(
        (t: any) =>
          t.type === "service_worker" &&
          typeof t.url === "string" &&
          t.url.startsWith("chrome-extension://"),
      );
      for (const t of sws) {
        const extId = t.url.replace(/^chrome-extension:\/\/([^/]+)\/.*$/, "$1");
        try {
          const r = await runtimeEvaluate(t.webSocketDebuggerUrl, "chrome.runtime.getManifest().name");
          if (r?.value === OPENCLAW_EXT_NAME) {
            return { ws: t.webSocketDebuggerUrl, extId };
          }
        } catch (err: any) {
          lastErr = err.message;
        }
      }
    } catch (err: any) {
      lastErr = err.message;
    }
    await sleep(500);
  }
  throw new Error(`OpenClaw SW target not found within 30s (last err: ${lastErr})`);
}

async function pollRelayReady(port: number, deadlineMs: number): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < deadlineMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/`, {
        method: "HEAD",
        signal: AbortSignal.timeout(1000),
      });
      if (r.status >= 200 && r.status < 500) return true;
    } catch {}
    await sleep(300);
  }
  return false;
}

(async () => {
  console.log(`[attach] waiting for OpenClaw relay server on port ${relayPort}…`);
  const ready = await pollRelayReady(relayPort, 30000);
  if (!ready) {
    console.error(`[attach] FATAL: relay server on ${relayPort} not reachable within 30s`);
    process.exit(5);
  }
  console.log(`[attach] relay ready. Hunting OpenClaw extension SW (CDP=${CDP_HTTP})…`);
  const { ws: swWs, extId } = await findOpenClawSw();
  console.log(`[attach] SW found extId=${extId}`);

  console.log(`[attach] setting chrome.storage.local relayPort=${relayPort} token(len=${gatewayToken.length})`);
  await runtimeEvaluate(
    swWs,
    `chrome.storage.local.set({ relayPort: ${relayPort}, gatewayToken: ${JSON.stringify(gatewayToken)} })`,
    true,
  );

  // Verify storage actually persisted (chrome.storage.local.set is async but
  // awaitPromise should already wait — belt-and-suspenders).
  const storageCheck = await runtimeEvaluate(
    swWs,
    `chrome.storage.local.get(['relayPort','gatewayToken']).then(s => ({ port: s.relayPort, hasToken: !!s.gatewayToken }))`,
    true,
  );
  console.log(`[attach] storage check: ${JSON.stringify(storageCheck?.value)}`);
  if (!storageCheck?.value?.hasToken) {
    console.error(`[attach] FATAL: chrome.storage.local.set did not persist gatewayToken`);
    process.exit(6);
  }

  console.log(`[attach] opening tab url=${targetUrl}`);
  const tabResult = await runtimeEvaluate(
    swWs,
    `(async () => { const t = await chrome.tabs.create({ url: ${JSON.stringify(targetUrl)}, active: true }); return t.id; })()`,
    true,
  );
  const tabId = tabResult?.value;
  console.log(`[attach] new tab id=${tabId}`);
  if (typeof tabId !== "number") {
    console.error(`[attach] FATAL: chrome.tabs.create did not return a numeric id`);
    process.exit(7);
  }

  // Tab needs a moment for Chrome to settle before chrome.debugger.attach.
  await sleep(2000);

  // Use __openclawConnectTab(tabId) instead of __openclawConnect() to bypass
  // chrome.tabs.query({active:true}) which can silently return no tab when
  // Chrome has no focused window (headless Xvfb).
  console.log(`[attach] calling globalThis.__openclawConnectTab(${tabId})`);
  const attachResult = await runtimeEvaluate(
    swWs,
    `(async () => {
       try {
         if (typeof globalThis.__openclawConnectTab !== 'function') {
           return 'patch-missing: __openclawConnectTab not on globalThis (extension not patched in this image?)';
         }
         const r = await globalThis.__openclawConnectTab(${tabId});
         return 'ok:' + r;
       } catch (e) {
         return 'err: ' + (e && e.message || String(e));
       }
     })()`,
    true,
  );
  console.log(`[attach] attach result: ${attachResult?.value}`);
  if (typeof attachResult?.value !== "string" || !attachResult.value.startsWith("ok")) {
    process.exit(4);
  }

  for (let i = 0; i < 20; i++) {
    await sleep(500);
    const verify = await runtimeEvaluate(
      swWs,
      `(typeof globalThis.__openclawState === 'function') ? globalThis.__openclawState() : null`,
    );
    console.log(`[attach] verify[${i}]: ${JSON.stringify(verify?.value)}`);
    if (verify?.value?.relayWsState === 1 && (verify?.value?.tabsCount ?? 0) > 0) {
      const connected = (verify.value.attachedTabIds || []).some(
        (t: any) => t.state === "connected",
      );
      if (connected) {
        console.log("[attach] DONE — extension attached, relayWs OPEN, tab connected.");
        // Close any chrome-extension://*/options.html tabs that the extension
        // auto-opened on install. options.js renders "Gateway token required"
        // from storage at page load and never re-reads — so even after we
        // populate the token via chrome.storage.local.set, the UI in noVNC
        // shows the stale empty form, which looks like the relay isn't set
        // up. Closing the page removes that visual confusion. The mock URL
        // tab opened earlier remains active for the agent to operate.
        try {
          const closeResult = await runtimeEvaluate(
            swWs,
            `(async () => {
               const tabs = await chrome.tabs.query({ url: 'chrome-extension://*/options.html' });
               const ids = tabs.map(t => t.id).filter(Boolean);
               if (ids.length) await chrome.tabs.remove(ids);
               return ids.length;
             })()`,
            true,
          );
          console.log(`[attach] closed ${closeResult?.value ?? 0} stale options.html tab(s)`);
        } catch (e: any) {
          console.error(`[attach] could not close options.html tab(s): ${e.message}`);
        }
        return;
      }
    }
  }
  console.error("[attach] WARNING — extension may not be fully attached after 10s.");
  process.exit(3);
})().catch((err) => {
  console.error(`[attach] FATAL: ${err?.message || err}`);
  process.exit(1);
});
