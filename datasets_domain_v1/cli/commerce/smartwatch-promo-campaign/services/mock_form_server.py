#!/usr/bin/env python3
"""Mock DTC Campaign Platform server (CLI variant).

Self-contained — no dependency on private/expected_answer.json.  Field schema
and closed-set allowed values are hardcoded.  The verifier (verify_task.py)
handles correctness checking separately on the host side.
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
# Field definitions — hardcoded, not loaded from private/expected_answer.json
# ---------------------------------------------------------------------------

FIELDS_SCHEMA: list[dict] = [
    # --- basic ---
    {"name": "campaignName",       "label": "活动名称",      "type": "text",   "section": "basic",     "required": True},
    {"name": "campaignType",       "label": "活动类型",      "type": "select", "section": "basic",     "required": True,
     "options": ["flash_sale", "clearance", "seasonal", "bundle"]},
    {"name": "productSku",         "label": "产品SKU",       "type": "text",   "section": "basic",     "required": True},
    {"name": "productTitle",       "label": "产品标题",      "type": "text",   "section": "basic",     "required": True},
    {"name": "category",           "label": "类目",          "type": "text",   "section": "basic",     "required": True},
    # --- pricing ---
    {"name": "basePrice",          "label": "基准价格",      "type": "number", "section": "pricing",   "required": True},
    {"name": "currency",           "label": "币种",          "type": "select", "section": "pricing",   "required": True,
     "options": ["USD", "EUR", "GBP", "JPY", "CNY"]},
    {"name": "discountType",       "label": "折扣类型",      "type": "select", "section": "pricing",   "required": True,
     "options": ["tiered_time", "flat", "bogo", "threshold"]},
    {"name": "discountTiers",      "label": "折扣阶梯",      "type": "json",   "section": "pricing",   "required": True},
    {"name": "freeShippingThreshold", "label": "包邮门槛",   "type": "number", "section": "pricing",   "required": True},
    # --- regions ---
    {"name": "targetRegions",      "label": "目标区域",      "type": "json",   "section": "regions",   "required": True},
    {"name": "regionSurcharge",    "label": "区域附加费",    "type": "json",   "section": "regions",   "required": True},
    # --- inventory ---
    {"name": "warehouseAllocation","label": "仓库分配",      "type": "json",   "section": "inventory", "required": True},
    {"name": "totalCampaignStock", "label": "总库存",        "type": "number", "section": "inventory", "required": True},
    {"name": "maxPerCustomer",     "label": "每人限购",      "type": "number", "section": "inventory", "required": True},
    {"name": "stockReserveMode",   "label": "库存锁定模式",  "type": "select", "section": "inventory", "required": True,
     "options": ["hard_reserve", "soft_reserve", "none"]},
    # --- schedule ---
    {"name": "campaignStart",      "label": "开始时间",      "type": "text",   "section": "schedule",  "required": True},
    {"name": "campaignEnd",        "label": "结束时间",      "type": "text",   "section": "schedule",  "required": True},
    # --- marketing ---
    {"name": "dailyAdBudget",      "label": "日广告预算",    "type": "number", "section": "marketing", "required": True},
    {"name": "adPlatforms",        "label": "投放平台",      "type": "json",   "section": "marketing", "required": True},
    {"name": "landingPageSlug",    "label": "落地页Slug",    "type": "text",   "section": "marketing", "required": True},
    # --- payment ---
    {"name": "paymentMethods",     "label": "支付方式",      "type": "json",   "section": "payment",   "required": True},
    # --- agreement ---
    {"name": "agreement",          "label": "确认协议",      "type": "text",   "section": "agreement", "required": True},
    # --- media (file uploads) ---
    {"name": "banner_1",           "label": "主Banner",      "type": "file",   "section": "media",     "required": True},
    {"name": "banner_2",           "label": "Banner 2",      "type": "file",   "section": "media",     "required": True},
    {"name": "banner_3",           "label": "Banner 3",      "type": "file",   "section": "media",     "required": True},
    {"name": "banner_4",           "label": "Banner 4",      "type": "file",   "section": "media",     "required": True},
    {"name": "banner_5",           "label": "Banner 5",      "type": "file",   "section": "media",     "required": True},
]

# Closed-set validation — server rejects values not in these lists (400).
ALLOWED: dict[str, list[str]] = {
    "campaignType":     ["flash_sale", "clearance", "seasonal", "bundle"],
    "discountType":     ["tiered_time", "flat", "bogo", "threshold"],
    "stockReserveMode": ["hard_reserve", "soft_reserve", "none"],
    "currency":         ["USD", "EUR", "GBP", "JPY", "CNY"],
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
        # Skip preamble, epilogue, and closing delimiter
        if not part or part.strip() in (b"", b"--"):
            continue
        # Separate headers from body (CRLFCRLF or LFLF)
        for sep, skip in ((b"\r\n\r\n", 4), (b"\n\n", 2)):
            idx = part.find(sep)
            if idx != -1:
                header_block = part[:idx].decode("utf-8", errors="replace")
                value_bytes = part[idx + skip :]
                break
        else:
            continue
        # Strip trailing CRLF left by boundary splitting
        if value_bytes.endswith(b"\r\n"):
            value_bytes = value_bytes[:-2]
        elif value_bytes.endswith(b"\n"):
            value_bytes = value_bytes[:-1]

        # Extract name= and filename= from Content-Disposition
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
    """Parse request body as multipart/form-data or JSON."""
    body = _read_body(handler)
    ct = handler.headers.get("Content-Type", "")

    # multipart/form-data
    if "multipart/form-data" in ct:
        m = re.search(r"boundary=([^\s;]+)", ct)
        if m:
            return _parse_multipart(body, m.group(1).encode("utf-8"))
        return {}, {}

    # application/x-www-form-urlencoded
    if "x-www-form-urlencoded" in ct:
        from urllib.parse import parse_qs
        qs = parse_qs(body.decode("utf-8", errors="replace"), keep_blank_values=True)
        return {k: v[0] for k, v in qs.items()}, {}

    # application/json (fallback)
    if body:
        try:
            obj = json.loads(body)
            if isinstance(obj, dict):
                return {k: str(v) if not isinstance(v, str) else v for k, v in obj.items()}, {}
        except (json.JSONDecodeError, ValueError):
            pass
    return {}, {}


def _validate_closed_set(fields: dict[str, str]) -> list[str]:
    """Return list of error strings for fields with invalid enum values."""
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
        return  # suppress default stderr logging

    # --- GET ---

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
            # /api/state  or  /api/state/<id>  — only one session
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

    # --- POST ---

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path

        if path == "/api/cli/session":
            if not _authorized(self):
                _json(self, 401, {"errors": ["unauthorized"]})
                return
            _json(self, 200, {k: SESSION[k] for k in ("sessionId", "status", "createdAt")})
            return

        if path != "/api/cli/campaign/submit":
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

        # Server-side closed-set validation
        validation_errors = _validate_closed_set(fields)
        if validation_errors:
            SESSION["access_log"].append({
                "event": "validation_failed",
                "errors": validation_errors,
                "at": time.time(),
            })
            _json(self, 400, {"errors": validation_errors})
            return

        # Store submission
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
