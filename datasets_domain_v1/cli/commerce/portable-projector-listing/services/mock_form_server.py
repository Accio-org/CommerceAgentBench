#!/usr/bin/env python3
"""Mock Alibaba International publish API (CLI variant) — case-local.

Self-contained for the cli-commerce-portable-projector-listing task; defines a
projector-specific field schema and closed-set ALLOWED values.  This avoids
the schema mismatch between the baked alibaba_publish mock and the projector
task's expected category / saleMode / attribute fields.
"""
from __future__ import annotations

import json
import os
import re
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

TOKEN = os.environ.get("MOCK_CLI_TOKEN", "local-mock-token")
VERIFIER_TOKEN = os.environ.get("MOCK_VERIFIER_TOKEN", "")

# ---------------------------------------------------------------------------
# Field definitions — projector publish flow
# ---------------------------------------------------------------------------

FIELDS_SCHEMA: list[dict] = [
    # --- basic ---
    {"name": "category",       "label": "类目",       "type": "select", "section": "basic", "required": True},
    {"name": "saleMode",       "label": "销售模式",   "type": "select", "section": "basic", "required": True},
    {"name": "productTitle",   "label": "商品标题",   "type": "text",   "section": "basic", "required": True},
    {"name": "productGroup",   "label": "商品分组",   "type": "select", "section": "basic", "required": True},
    # --- attributes ---
    {"name": "attr_brand",        "label": "品牌",     "type": "text",   "section": "attributes", "required": True},
    {"name": "attr_model",        "label": "型号",     "type": "text",   "section": "attributes", "required": True},
    {"name": "attr_resolution",   "label": "分辨率",   "type": "text",   "section": "attributes", "required": True},
    {"name": "attr_brightness",   "label": "亮度",     "type": "text",   "section": "attributes", "required": True},
    {"name": "attr_connectivity", "label": "连接方式", "type": "text",   "section": "attributes", "required": True},
    # --- pricing ---
    {"name": "saleType",         "label": "计价方式",     "type": "select", "section": "pricing", "required": True},
    {"name": "priceUnit",        "label": "计量单位",     "type": "select", "section": "pricing", "required": True},
    {"name": "priceMode",        "label": "价格模式",     "type": "select", "section": "pricing", "required": True},
    {"name": "fobType",          "label": "FOB 起运港",   "type": "select", "section": "pricing", "required": True},
    {"name": "fobPriceMin",      "label": "FOB 最低价",   "type": "number", "section": "pricing", "required": True},
    {"name": "fobPriceMax",      "label": "FOB 最高价",   "type": "number", "section": "pricing", "required": True},
    {"name": "ladderPrice",      "label": "阶梯价",       "type": "json",   "section": "pricing", "required": True},
    {"name": "countryPriceDiff", "label": "国别差异定价", "type": "json",   "section": "pricing", "required": True},
    # --- supply ---
    {"name": "minOrderQuantity", "label": "起订量",       "type": "number", "section": "supply", "required": True},
    {"name": "inventory",        "label": "库存",         "type": "number", "section": "supply", "required": True},
    {"name": "deliveryPeriod",   "label": "发货周期",     "type": "json",   "section": "supply", "required": True},
    # --- markets ---
    {"name": "selectedCountries","label": "可售国家",     "type": "json",   "section": "markets", "required": True},
    # --- listing ---
    {"name": "productVisible",   "label": "上架可见",     "type": "select", "section": "listing", "required": True},
    {"name": "descType",         "label": "描述类型",     "type": "select", "section": "listing", "required": True},
    {"name": "agreement",        "label": "协议确认",     "type": "text",   "section": "listing", "required": True},
    # --- media (file uploads) ---
    {"name": "image_1",          "label": "主图",         "type": "file",   "section": "media",   "required": True},
    {"name": "image_2",          "label": "副图 2",       "type": "file",   "section": "media",   "required": False},
    {"name": "image_3",          "label": "副图 3",       "type": "file",   "section": "media",   "required": False},
    {"name": "image_4",          "label": "副图 4",       "type": "file",   "section": "media",   "required": False},
    {"name": "image_5",          "label": "副图 5",       "type": "file",   "section": "media",   "required": False},
]

# Closed-set validation — server rejects values not in these lists (400).
# Categories and sale-modes are restricted to the projector publish flow.
ALLOWED: dict[str, list[str]] = {
    "category": [
        "Consumer Electronics > Projectors & Accessories > Portable Projectors",
        "Consumer Electronics > Projectors & Accessories > Tripods & Mounts",
        "Consumer Electronics > Projectors & Accessories > Screens",
        "Bags & Cases > Electronics Cases > Projector Cases",
    ],
    "saleMode":       ["Domestic Shipping", "Cross-border Direct", "Cross-border Bonded"],
    "productGroup":   ["Consumer Electronics", "Bags & Cases", "Home & Garden"],
    "saleType":       ["Per Unit", "Per Piece", "Per Set", "Per Lot"],
    "priceUnit":      ["Set", "Piece", "Pair", "Unit", "Lot"],
    "priceMode":      ["ladder", "fixed", "negotiable"],
    "fobType":        ["FOB Shenzhen", "FOB Ningbo", "FOB Shanghai", "FOB Guangzhou"],
    "productVisible": ["yes", "no"],
    "descType":       ["custom", "template", "smart_edit"],
}

# ---------------------------------------------------------------------------
# Session state
# ---------------------------------------------------------------------------

SESSION: dict = {
    "sessionId": str(uuid.uuid4()),
    "status": "active",
    "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "fields": {},
    "files": {},
    "access_log": [],
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _json(handler: BaseHTTPRequestHandler, status: int, payload: object) -> None:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(data)))
    handler.end_headers()
    handler.wfile.write(data)


def _authorized(handler: BaseHTTPRequestHandler) -> bool:
    return handler.headers.get("Authorization", "") == f"Bearer {TOKEN}"


def _verifier_authorized(handler: BaseHTTPRequestHandler) -> bool:
    return bool(VERIFIER_TOKEN) and handler.headers.get("X-Mock-Verifier-Token", "") == VERIFIER_TOKEN


def _require_verifier(handler: BaseHTTPRequestHandler) -> bool:
    if _verifier_authorized(handler):
        return True
    SESSION["access_log"].append({
        "event": "verifier_only",
        "path": urlparse(handler.path).path,
        "at": time.time(),
    })
    _json(handler, 403, {"errors": ["verifier_only"]})
    return False


def _read_body(handler: BaseHTTPRequestHandler) -> bytes:
    length = int(handler.headers.get("Content-Length", 0))
    return handler.rfile.read(length) if length > 0 else b""


def _parse_multipart(body: bytes, boundary: bytes) -> tuple[dict[str, str], dict[str, str]]:
    """Parse multipart/form-data without the deprecated cgi module.

    Returns (fields, files) where files maps field name -> uploaded filename.
    """
    fields: dict[str, str] = {}
    files: dict[str, str] = {}
    delimiter = b"--" + boundary
    parts = body.split(delimiter)
    for part in parts:
        if not part or part.strip() in (b"", b"--"):
            continue
        for sep, skip in ((b"\r\n\r\n", 4), (b"\n\n", 2)):
            idx = part.find(sep)
            if idx != -1:
                header_block = part[:idx].decode("utf-8", errors="replace")
                value_bytes = part[idx + skip:]
                break
        else:
            continue
        if value_bytes.endswith(b"\r\n"):
            value_bytes = value_bytes[:-2]
        elif value_bytes.endswith(b"\n"):
            value_bytes = value_bytes[:-1]

        name = filename = None
        for line in header_block.splitlines():
            line = line.strip()
            if line.lower().startswith("content-disposition:"):
                m = re.search(r'\bname="([^"]*)"', line)
                if m:
                    name = m.group(1)
                m = re.search(r'\bfilename="([^"]*)"', line)
                if m:
                    filename = m.group(1)
        if not name:
            continue
        if filename:
            clean_name = Path(filename).name
            files[name] = clean_name
            fields[name] = clean_name
        else:
            fields[name] = value_bytes.decode("utf-8", errors="replace")
    return fields, files


def _parse_body(handler: BaseHTTPRequestHandler) -> tuple[dict[str, str], dict[str, str]]:
    body = _read_body(handler)
    ct = handler.headers.get("Content-Type", "")

    if "multipart/form-data" in ct:
        m = re.search(r"boundary=([^\s;]+)", ct)
        if m:
            return _parse_multipart(body, m.group(1).encode("utf-8"))
        return {}, {}

    if "x-www-form-urlencoded" in ct:
        from urllib.parse import parse_qs
        qs = parse_qs(body.decode("utf-8", errors="replace"), keep_blank_values=True)
        return {k: v[0] for k, v in qs.items()}, {}

    if body:
        try:
            obj = json.loads(body)
            if isinstance(obj, dict):
                return {k: str(v) if not isinstance(v, str) else v for k, v in obj.items()}, {}
        except (json.JSONDecodeError, ValueError):
            pass
    return {}, {}


def _validate_closed_set(fields: dict[str, str]) -> list[str]:
    errors: list[str] = []
    for field_name, allowed_values in ALLOWED.items():
        if field_name in fields:
            val = fields[field_name]
            if val not in allowed_values:
                errors.append(
                    f"field '{field_name}': value '{val}' is not allowed; "
                    f"must be one of {allowed_values}"
                )
    return errors


# ---------------------------------------------------------------------------
# HTTP handler
# ---------------------------------------------------------------------------


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # noqa: N802
        return

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path

        if path == "/health":
            _json(self, 200, {"ok": True})

        elif path == "/api/sessions":
            if not _require_verifier(self):
                return
            _json(self, 200, [
                {"sessionId": SESSION["sessionId"], "status": SESSION["status"]},
            ])

        elif path.startswith("/api/state"):
            if not _require_verifier(self):
                return
            _json(self, 200, SESSION)

        elif path == "/api/access-log":
            if not _require_verifier(self):
                return
            _json(self, 200, SESSION["access_log"])

        elif path == "/api/cli/fields":
            if not _authorized(self):
                _json(self, 401, {"errors": ["unauthorized"]})
                return
            _json(self, 200, FIELDS_SCHEMA)

        else:
            _json(self, 404, {"errors": ["not_found"]})

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path

        if path == "/api/cli/session":
            if not _authorized(self):
                _json(self, 401, {"errors": ["unauthorized"]})
                return
            _json(self, 200, {k: SESSION[k] for k in ("sessionId", "status", "createdAt")})
            return

        # The submit endpoint is intentionally /api/cli/submit (same as the
        # baked alibaba_publish convention) so an agent following
        # api_reference.md can target it.
        if path != "/api/cli/submit":
            _json(self, 404, {"errors": ["not_found"]})
            return

        if not _authorized(self):
            SESSION["access_log"].append({
                "event": "cli_token_required",
                "at": time.time(),
            })
            _json(self, 401, {"errors": ["unauthorized"]})
            return

        fields, files = _parse_body(self)

        validation_errors = _validate_closed_set(fields)
        if validation_errors:
            SESSION["access_log"].append({
                "event": "validation_failed",
                "errors": validation_errors,
                "at": time.time(),
            })
            _json(self, 400, {"errors": validation_errors})
            return

        SESSION["fields"].update(fields)
        SESSION["files"].update(files)
        SESSION["status"] = "submitted"
        SESSION["access_log"].append({
            "event": "cli_submit_valid",
            "at": time.time(),
        })
        _json(self, 200, {
            "sessionId": SESSION["sessionId"],
            "fieldsSaved": len(SESSION["fields"]),
            "fields": list(SESSION["fields"].keys()),
        })


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------


def main() -> int:
    port = int(os.environ.get("MOCK_PORT", "3000"))
    srv = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"mock_form_server listening on 127.0.0.1:{port}", flush=True)
    srv.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
