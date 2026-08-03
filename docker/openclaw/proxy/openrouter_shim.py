"""OpenRouter shim sidecar for RealReplicaBench OpenClaw harness.

Listens on 127.0.0.1:$OPENCLAW_OR_SHIM_PORT (default 19501). Forwards every
incoming request to ``https://openrouter.ai/api/v1<path>`` preserving method,
headers (minus Host), query string, and body. Streaming SSE responses for
``/chat/completions`` are passed through chunk-by-chunk so OpenClaw sees the
same SSE flow as a direct OpenRouter connection.

Why this exists
---------------
OpenClaw versions and provider paths have differed in how they serialize
thinking effort. The May 2026 runtime can already emit
``reasoning.effort`` on its OpenRouter path; other paths may omit it.
OpenRouter-compatible endpoints also accept ``reasoning_effort`` (string:
minimal/low/medium/high) and ``reasoning.max_tokens`` (int). This shim
preserves an existing effort field and supplies one from
``OPENCLAW_OR_SHIM_THINKING_EFFORT`` only when the request omitted it.

Caller-wins: if the request body already specifies ``reasoning_effort`` or
``reasoning.effort``, we do not overwrite it. Non-JSON bodies and non-
``/chat/completions`` paths are forwarded as-is.

Env knobs
---------
  OPENCLAW_OR_SHIM_PORT             listen port (default 19501)
  OPENROUTER_BASE_URL               OpenRouter-compatible upstream base URL
                                    (default https://openrouter.ai/api/v1)
  OPENCLAW_OR_SHIM_THINKING_EFFORT  off / low / medium / high (case-insensitive)
                                    off → ``reasoning_effort: "minimal"``
                                    low/medium/high → tier passes through
  OPENCLAW_OR_SHIM_THINKING_BUDGET  optional int. When set, also injects
                                    ``reasoning.max_tokens: <int>``.
"""

from __future__ import annotations

import json
import logging
import os
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger("openclaw-or-shim")

PORT = int(os.environ.get("OPENCLAW_OR_SHIM_PORT", "19501"))
UPSTREAM_BASE = (
    os.environ.get("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1").strip().rstrip("/")
)
TIMEOUT_SEC = int(os.environ.get("OPENCLAW_OR_SHIM_TIMEOUT", "300"))

_upstream_parts = urlsplit(UPSTREAM_BASE)
if _upstream_parts.scheme not in {"http", "https"} or not _upstream_parts.netloc:
    raise ValueError(
        "OPENROUTER_BASE_URL must be an absolute http(s) URL, "
        f"got {UPSTREAM_BASE!r}"
    )
UPSTREAM_HOST = _upstream_parts.netloc

THINKING_EFFORT = (os.environ.get("OPENCLAW_OR_SHIM_THINKING_EFFORT", "") or "").strip().lower() or None
try:
    _budget_raw = (os.environ.get("OPENCLAW_OR_SHIM_THINKING_BUDGET", "") or "").strip()
    THINKING_BUDGET: int | None = int(_budget_raw) if _budget_raw else None
except ValueError:
    THINKING_BUDGET = None

# tier → reasoning_effort string per OpenRouter "Universal Reasoning" spec.
_TIER_EFFORT: dict[str, str] = {
    "off": "minimal",
    "minimal": "minimal",
    "low": "low",
    "medium": "medium",
    "high": "high",
}


def _resolve_effort(tier: str | None) -> str | None:
    if not tier:
        return None
    return _TIER_EFFORT.get(tier)


# Headers that should never be forwarded to upstream — they are connection-
# specific or need to be recomputed for the upstream request.
_HOP_BY_HOP = frozenset({
    "host",
    "content-length",
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
})

# Response headers we should not blindly copy back to the OpenClaw client; they
# are managed by Python's http.server / chunked transfer machinery.
_RESPONSE_DROP = frozenset({
    "content-length",
    "transfer-encoding",
    "connection",
    "keep-alive",
})


def _maybe_inject_thinking(body_bytes: bytes, path: str) -> bytes:
    """If ``body_bytes`` is a JSON chat-completions request, inject
    ``reasoning_effort``/``reasoning.max_tokens`` per env tier. Otherwise
    return the body unchanged.

    Caller wins: if the body already specifies a reasoning field, do not
    overwrite. If JSON parsing fails, return the body unchanged (forward as-is).
    """
    if "/chat/completions" not in path:
        return body_bytes
    if not body_bytes:
        return body_bytes
    try:
        payload = json.loads(body_bytes)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return body_bytes
    if not isinstance(payload, dict) or "model" not in payload:
        return body_bytes

    has_top_level = "reasoning_effort" in payload
    nested = payload.get("reasoning") if isinstance(payload.get("reasoning"), dict) else None
    has_nested_effort = bool(nested and "effort" in nested)
    if has_top_level or has_nested_effort:
        return body_bytes

    effort = _resolve_effort(THINKING_EFFORT)
    mutated = False
    if effort is not None:
        payload["reasoning_effort"] = effort
        mutated = True
    if THINKING_BUDGET is not None:
        if not isinstance(payload.get("reasoning"), dict):
            payload["reasoning"] = {}
        payload["reasoning"]["max_tokens"] = THINKING_BUDGET
        mutated = True
    if not mutated:
        return body_bytes
    try:
        return json.dumps(payload, ensure_ascii=False).encode("utf-8")
    except (TypeError, ValueError):
        return body_bytes


def _forward_headers(incoming: Any) -> dict[str, str]:
    out: dict[str, str] = {}
    for key in incoming.keys():
        if key.lower() in _HOP_BY_HOP:
            continue
        out[key] = incoming[key]
    return out


def _upstream_url(path: str) -> str:
    """Join an incoming shim path to the configured OpenRouter-compatible base."""
    if path.startswith("/v1/"):
        path = path[3:]
    elif path == "/v1":
        path = "/"
    return UPSTREAM_BASE + (path if path.startswith("/") else f"/{path}")


class ShimHandler(BaseHTTPRequestHandler):
    def _forward(self, method: str) -> None:
        path = self.path or "/"
        # OpenClaw calls the shim at /v1/...; the configured upstream base
        # already normally includes its own /v1 or /api/v1 prefix.
        url = _upstream_url(path)

        content_length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(content_length) if content_length > 0 else b""
        body = _maybe_inject_thinking(body, path)

        headers = _forward_headers(self.headers)
        headers["Host"] = UPSTREAM_HOST

        req = Request(url, data=body if body else None, headers=headers, method=method)
        try:
            with urlopen(req, timeout=TIMEOUT_SEC) as resp:
                self.send_response(resp.status)
                for key, value in resp.headers.items():
                    if key.lower() in _RESPONSE_DROP:
                        continue
                    self.send_header(key, value)
                self.end_headers()
                # Stream the upstream body to the client. For SSE this matters
                # — buffering would defeat the streaming contract.
                while True:
                    chunk = resp.read(8192)
                    if not chunk:
                        break
                    try:
                        self.wfile.write(chunk)
                        self.wfile.flush()
                    except (BrokenPipeError, ConnectionResetError):
                        return
        except HTTPError as e:
            self.send_response(e.code)
            err_body = e.read() or b""
            for key, value in e.headers.items():
                if key.lower() in _RESPONSE_DROP:
                    continue
                self.send_header(key, value)
            self.end_headers()
            try:
                self.wfile.write(err_body)
            except (BrokenPipeError, ConnectionResetError):
                pass
        except URLError as e:
            log.error("upstream URL error: %s", e)
            self._json_response(502, {"error": {"message": f"upstream URLError: {e.reason}"}})
        except Exception as e:  # pragma: no cover - defensive
            log.exception("shim error")
            self._json_response(500, {"error": {"message": str(e)}})

    def do_GET(self):  # noqa: N802 - http.server convention
        self._forward("GET")

    def do_POST(self):  # noqa: N802
        self._forward("POST")

    def do_PUT(self):  # noqa: N802
        self._forward("PUT")

    def do_DELETE(self):  # noqa: N802
        self._forward("DELETE")

    def do_PATCH(self):  # noqa: N802
        self._forward("PATCH")

    def do_OPTIONS(self):  # noqa: N802
        self._forward("OPTIONS")

    def _json_response(self, status: int, data: dict) -> None:
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        # Quiet the default per-request stderr spam; rely on log.info.
        del format, args


class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True


def main() -> int:
    banner_tier = THINKING_EFFORT or "<none>"
    banner_budget = THINKING_BUDGET if THINKING_BUDGET is not None else "<unset>"
    print(
        f"OpenRouter shim for OpenClaw listening on 127.0.0.1:{PORT} "
        f"(thinking_effort={banner_tier}, thinking_budget={banner_budget})",
        flush=True,
    )
    pid_path = f"/tmp/openclaw_or_shim_{PORT}.pid"
    try:
        with open(pid_path, "w") as f:
            f.write(str(os.getpid()))
    except OSError:
        pass
    server = ThreadedHTTPServer(("127.0.0.1", PORT), ShimHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
