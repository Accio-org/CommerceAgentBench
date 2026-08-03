#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const PORT = Number(process.env.PORT || process.env.CCB_CLI_DAEMON_PORT || "0");
const MOCK_NAME = process.env.CCB_CLI_MOCK_NAME || "cli_mock";
const TARGET_BIN = process.env.CCB_CLI_TARGET_BIN || "";
const BENCH_BIN = process.env.CCB_CLI_BENCH_BIN || "";
const BENCH_TOKEN_MODE = process.env.CCB_CLI_BENCH_TOKEN_MODE || "argv";
const TOKEN = process.env.MOCK_VERIFIER_TOKEN || "";
const STATE_ENV = parseJsonEnv("CCB_CLI_STATE_ENV_JSON", {});
const BENCH_PATHS = parseJsonEnv("CCB_CLI_BENCH_PATHS_JSON", {
  "/__bench/state": "state",
  "/__bench/audit": "audit",
});
const PROXY_BASE_URL = process.env.CCB_CLI_HTTP_PROXY_BASE_URL || "";
const PROXY_PREFIXES = parseJsonEnv("CCB_CLI_HTTP_PROXY_PREFIXES_JSON", []);
const REQUEST_TIMEOUT_MS = Number(process.env.CCB_CLI_REQUEST_TIMEOUT_MS || "120000");

function parseJsonEnv(name, fallback) {
  try {
    return JSON.parse(process.env[name] || "");
  } catch {
    return fallback;
  }
}

async function readJson(req) {
  const body = await req.text();
  return body ? JSON.parse(body) : {};
}

function verifierAuthed(req) {
  return Boolean(TOKEN) && req.headers.get("x-mock-verifier-token") === TOKEN;
}

function materializeFiles(files, argv) {
  if (!files || typeof files !== "object" || Object.keys(files).length === 0) {
    return { argv, cleanup: null };
  }
  const tmp = mkdtempSync(join(tmpdir(), "ccb-cli-files-"));
  const replacements = new Map();
  let idx = 0;
  for (const [arg, item] of Object.entries(files)) {
    if (!item || typeof item.content_b64 !== "string") continue;
    const name = `file_${idx++}`;
    const path = join(tmp, name);
    writeFileSync(path, Buffer.from(item.content_b64, "base64"), { mode: 0o600 });
    replacements.set(arg, path);
  }
  return {
    argv: argv.map((arg) => replacements.get(arg) || arg),
    cleanup: () => rmSync(tmp, { recursive: true, force: true }),
  };
}

function safeCwd(cwd) {
  if (!cwd || typeof cwd !== "string") return "/";
  try {
    const abs = resolve(cwd);
    const st = statSync(abs);
    return st.isDirectory() ? abs : "/";
  } catch {
    return "/";
  }
}

function runCommand(args, options = {}) {
  return new Promise((resolvePromise) => {
    const timeoutMs = options.timeoutMs || REQUEST_TIMEOUT_MS;
    const env = {
      ...process.env,
      ...STATE_ENV,
      ...(options.env || {}),
    };
    const child = spawn(args[0], args.slice(1), {
      cwd: options.cwd || "/",
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2000).unref();
    }, timeoutMs);
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (err) => {
      clearTimeout(timer);
      resolvePromise({
        stdout: "",
        stderr: `Error: ${err.message}\n`,
        exit_code: 127,
      });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolvePromise({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        exit_code: timedOut ? 124 : (code ?? (signal ? 128 : 1)),
      });
    });
    if (options.stdin) child.stdin.write(options.stdin);
    child.stdin.end();
  });
}

async function handleCliExec(req) {
  const body = await readJson(req);
  const argv = Array.isArray(body.argv) ? body.argv.map(String) : [];
  const publicEnv = {};
  for (const key of ["NO_COLOR", "TERM", "COLUMNS", "LINES", "LANG", "LC_ALL"]) {
    if (body.env && typeof body.env[key] === "string") publicEnv[key] = body.env[key];
  }
  const materialized = materializeFiles(body.files, argv);
  try {
    return await runCommand(
      [TARGET_BIN, ...materialized.argv],
      {
        cwd: safeCwd(body.cwd),
        env: publicEnv,
        stdin: typeof body.stdin === "string" ? body.stdin : "",
      },
    );
  } finally {
    if (materialized.cleanup) materialized.cleanup();
  }
}

async function handleBench(subcommand) {
  if (!BENCH_BIN) {
    return { stdout: "", stderr: "bench binary not configured\n", exit_code: 2 };
  }
  const args = BENCH_TOKEN_MODE === "env"
    ? [BENCH_BIN, subcommand]
    : [BENCH_BIN, subcommand, "--token", TOKEN];
  const env = BENCH_TOKEN_MODE === "env"
    ? { CCB_INTERNAL_BENCH_TOKEN: TOKEN }
    : {};
  return await runCommand(args, {
    cwd: "/",
    env,
    timeoutMs: 30000,
  });
}

function proxyAllowed(pathname) {
  return PROXY_BASE_URL && PROXY_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

async function handleProxy(req, url) {
  if (!verifierAuthed(req)) {
    return sendJsonLike({ error: "verifier token required" }, 403);
  }
  const target = new URL(url.pathname + url.search, PROXY_BASE_URL).toString();
  const headers = {
    "Authorization": `Bearer ${TOKEN}`,
    "X-Mock-Verifier-Token": TOKEN,
  };
  const upstream = await fetch(target, { method: req.method, headers });
  const body = await upstream.arrayBuffer();
  return new Response(body, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("content-type") || "application/octet-stream",
    },
  });
}

if (!PORT || !TARGET_BIN) {
  console.error("CCB CLI daemon requires PORT and CCB_CLI_TARGET_BIN");
  process.exit(2);
}

Bun.serve({
  hostname: "0.0.0.0",
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true, mock: MOCK_NAME, mode: "daemon_cli" });
    }
    if (req.method === "POST" && url.pathname === "/__cli/exec") {
      try {
        const result = await handleCliExec(req);
        return Response.json(result);
      } catch (err) {
        return Response.json({
          stdout: "",
          stderr: `Error: ${err.message}\n`,
          exit_code: 1,
        });
      }
    }
    if (req.method === "GET" && Object.prototype.hasOwnProperty.call(BENCH_PATHS, url.pathname)) {
      if (!verifierAuthed(req)) {
        return sendJsonLike({ error: "verifier token required" }, 403);
      }
      const subcommand = String(BENCH_PATHS[url.pathname] || "");
      if (!subcommand) {
        return sendJsonLike({ error: "bench path misconfigured" }, 500);
      }
      const result = await handleBench(subcommand);
      if (result.exit_code !== 0) {
        return sendJsonLike({ error: "bench nonzero", stderr: result.stderr.slice(0, 500) }, 500);
      }
      return new Response(result.stdout || "{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (req.method === "GET" && proxyAllowed(url.pathname)) {
      return await handleProxy(req, url);
    }
    return sendJsonLike({ error: "not found" }, 404);
  },
});

function sendJsonLike(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

console.log(`ccb cli daemon ready: ${MOCK_NAME} on :${PORT}`);
