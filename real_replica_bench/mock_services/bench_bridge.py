#!/usr/bin/env python3
"""Generic verifier-readout HTTP bridge for the CLI mock services
(box_cli / jira_cli / todoist_cli).

The HTTP mocks (gmail_mock, amazon_sp_api) already expose their state over a
TCP port, so the host-side verifier reaches them directly via the harness-
injected ``MOCK_SITE_URL``. The CLI mocks instead persist to an in-container
bun:sqlite DB and expose ground truth only through their paired ``*-bench``
control binary (``<svc>-bench state --token <MOCK_VERIFIER_TOKEN>``). This
bridge wraps that binary in a tiny HTTP server so a CLI-mock task behaves
exactly like an HTTP-mock task from the verifier's point of view:

    GET /health            -> 200 {"ok": true}            (no auth)
    GET /__bench/state     -> 200 <bench state JSON>      (verifier token)
    GET /__bench/audit     -> 200 <bench audit JSON>      (verifier token)

Verifier-token gated reads require header ``X-Mock-Verifier-Token`` equal to
``$MOCK_VERIFIER_TOKEN``. The bench binary inherits the per-service DB/home
env (BOX_MOCK_HOME / JIRA_MOCK_HOME / TODOIST_MOCK_HOME) from the process
environment, so the bridge reads exactly the same DB the agent's CLI writes.

Env:
    BENCH_BRIDGE_BIN   absolute path to the <svc>-bench binary (required)
    MOCK_VERIFIER_TOKEN  shared secret (required; minted by the harness)
    PORT               listen port (required; == task host_published_port)
"""
import json
import os
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BENCH_BIN = os.environ.get("BENCH_BRIDGE_BIN", "")
TOKEN = os.environ.get("MOCK_VERIFIER_TOKEN", "")
PORT = int(os.environ.get("PORT", "0"))


def _run_bench(subcommand: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [BENCH_BIN, subcommand, "--token", TOKEN],
        capture_output=True,
        text=True,
        timeout=30,
    )


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, body: str) -> None:
        payload = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _authed(self) -> bool:
        return bool(TOKEN) and self.headers.get("X-Mock-Verifier-Token") == TOKEN

    def do_GET(self) -> None:  # noqa: N802 (stdlib signature)
        path = self.path.split("?", 1)[0]
        if path == "/health":
            self._send(200, json.dumps({"ok": True, "bench": os.path.basename(BENCH_BIN)}))
            return
        if path in ("/__bench/state", "/__bench/audit"):
            if not self._authed():
                self._send(403, json.dumps({"error": "verifier token required"}))
                return
            sub = "state" if path.endswith("state") else "audit"
            try:
                proc = _run_bench(sub)
            except Exception as exc:  # noqa: BLE001
                self._send(500, json.dumps({"error": "bench invocation failed", "detail": str(exc)[:300]}))
                return
            if proc.returncode != 0:
                self._send(500, json.dumps({"error": "bench nonzero", "stderr": (proc.stderr or "")[:500]}))
                return
            # Pass the bench JSON straight through (it is already JSON).
            out = proc.stdout or "{}"
            payload = out.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        self._send(404, json.dumps({"error": "not found"}))

    def log_message(self, format, *args) -> None:  # noqa: A002 — silence access logging
        return


def main() -> int:
    if not BENCH_BIN or not os.path.exists(BENCH_BIN):
        print(f"bench_bridge: BENCH_BRIDGE_BIN not found: {BENCH_BIN!r}", file=sys.stderr)
        return 2
    if not TOKEN:
        print("bench_bridge: MOCK_VERIFIER_TOKEN not set", file=sys.stderr)
        return 2
    if PORT <= 0:
        print(f"bench_bridge: invalid PORT {PORT!r}", file=sys.stderr)
        return 2
    # Bind 0.0.0.0 so the host-side verifier can reach it via the published port
    # (a 127.0.0.1-bound listener inside the container is NOT reachable through
    # docker -p). In-container clients (127.0.0.1) still connect fine.
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"bench_bridge: serving {os.path.basename(BENCH_BIN)} state on 0.0.0.0:{PORT}", flush=True)
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
