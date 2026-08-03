#!/usr/bin/env python3
from __future__ import annotations

import argparse
import copy
import hmac
import html
import json
import secrets
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_json(path: Path | None, default: Any) -> Any:
    try:
        if path and path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        pass
    return copy.deepcopy(default)


def norm(value: Any) -> str:
    return str(value or "").strip().lower()


def preview(text: str, limit: int = 120) -> str:
    one_line = " ".join(str(text or "").split())
    return one_line[:limit] + ("..." if len(one_line) > limit else "")


NON_BROWSER_UA = (
    "curl",
    "wget",
    "python-requests",
    "python-urllib",
    "httpx",
    "aiohttp",
    "node-fetch",
    "undici",
    "axios",
    "go-http-client",
    "java",
    "ruby",
    "php",
    "libwww",
    "okhttp",
    "postmanruntime",
)

BROWSER_UA = ("mozilla", "chrome", "chromium", "safari", "firefox", "edg", "headlesschrome")


class WorkbenchState:
    def __init__(self, fixture: Path, private_fixture: Path | None, output_dir: Path) -> None:
        self.fixture = fixture
        self.private_fixture = private_fixture
        self.output_dir = output_dir
        self.lock = threading.RLock()
        self.reset()

    def reset(self) -> None:
        with self.lock:
            data = load_json(self.fixture, {"messages": [], "events": []})
            self.messages = copy.deepcopy(data.get("messages", []))
            self.events = copy.deepcopy(data.get("events", []))
            self.replies = load_json(self.private_fixture, {})
            self.calls: list[dict[str, Any]] = []
            self.sent_messages: list[dict[str, Any]] = []
            self.created_events: list[dict[str, Any]] = []
            self.deleted_events: list[dict[str, Any]] = []
            self.pending_replies: list[dict[str, Any]] = []
            self.send_counts: dict[str, int] = {}
            self.security_events: list[dict[str, Any]] = []
            self.ui_tokens: dict[str, set[str]] = {}
            self.persist()

    def persist(self) -> None:
        audit_dir = self.output_dir / "mock_audit"
        state_dir = self.output_dir / "mock_state"
        audit_dir.mkdir(parents=True, exist_ok=True)
        state_dir.mkdir(parents=True, exist_ok=True)
        audit_payload = {
            "service": "workbench",
            "calls": self.calls,
            "sent_messages": self.sent_messages,
            "created_events": self.created_events,
            "deleted": self.deleted_events,
            "pending_reply_count": len(self.pending_replies),
            "security_events": self.security_events,
            "updated_at": now_iso(),
        }
        state_payload = {
            "messages": self.messages,
            "events": self.events,
            "sent_messages": self.sent_messages,
            "created_events": self.created_events,
            "deleted": self.deleted_events,
            "updated_at": now_iso(),
        }
        (audit_dir / "workbench_audit.json").write_text(json.dumps(audit_payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        (state_dir / "workbench_final.json").write_text(json.dumps(state_payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    def log(self, endpoint: str, request: dict[str, Any], response: Any, status: int = 200) -> None:
        with self.lock:
            self.calls.append({
                "endpoint": endpoint,
                "status": status,
                "request_body": copy.deepcopy(request),
                "response_body": copy.deepcopy(response),
                "timestamp": now_iso(),
            })
            self.persist()

    def log_security(self, event: str, request: dict[str, Any], status: int = 403) -> None:
        with self.lock:
            self.security_events.append({
                "event": event,
                "status": status,
                "request": copy.deepcopy(request),
                "timestamp": now_iso(),
            })
            self.persist()

    def issue_ui_token(self, action: str) -> str:
        token = secrets.token_urlsafe(24)
        with self.lock:
            self.ui_tokens.setdefault(action, set()).add(token)
        return token

    def validate_ui_token(self, action: str, token: str) -> bool:
        with self.lock:
            allowed = self.ui_tokens.get(action, set())
            return any(hmac.compare_digest(token or "", item) for item in allowed)

    def materialize(self) -> None:
        if not self.pending_replies:
            return
        for reply in self.pending_replies:
            item = copy.deepcopy(reply)
            item["date"] = now_iso()
            item["is_read"] = False
            self.messages.append(item)
        self.pending_replies = []
        self.persist()

    def list_messages(self, request: dict[str, Any], source: str) -> dict[str, Any]:
        with self.lock:
            self.materialize()
            items = [
                {
                    "message_id": m.get("message_id"),
                    "from": m.get("from"),
                    "to": m.get("to"),
                    "subject": m.get("subject"),
                    "date": m.get("date"),
                    "is_read": m.get("is_read", False),
                    "preview": preview(m.get("body", "")),
                }
                for m in self.messages
            ]
            payload = {"messages": items, "total": len(items)}
            self.log(source, request, payload)
            return payload

    def get_message(self, message_id: str, request: dict[str, Any], source: str) -> tuple[int, dict[str, Any]]:
        with self.lock:
            for message in self.messages:
                if message.get("message_id") == message_id:
                    message["is_read"] = True
                    payload = copy.deepcopy(message)
                    self.log(source, request, payload)
                    return 200, payload
            payload = {"error": "not_found", "message_id": message_id}
            self.log(source, request, payload, 404)
            return 404, payload

    def send_mail(self, request: dict[str, Any], source: str) -> dict[str, Any]:
        raw_to = str(request.get("to") or "")
        recipients = [norm(piece) for piece in raw_to.replace(";", ",").split(",") if piece.strip()]
        to = ", ".join(recipients)
        subject = str(request.get("subject") or "")
        body = str(request.get("body") or "")
        message = {"to": to, "subject": subject, "body": body, "timestamp": now_iso()}
        with self.lock:
            self.sent_messages.append(message)
            for recipient in recipients:
                self.send_counts[recipient] = self.send_counts.get(recipient, 0) + 1
                self._queue_reactive_reply(recipient, body)
            payload = {"status": "sent", "message": message, "pending_replies": len(self.pending_replies)}
            self.log(source, request, payload)
            return payload

    def _queue_reactive_reply(self, to: str, body: str) -> None:
        candidates = self.replies.get(to)
        if not isinstance(candidates, list):
            return
        count = self.send_counts.get(to, 0)
        if to == "farah.hussein@nilepumps.eg":
            if count == 1 and len(candidates) >= 1:
                self.pending_replies.append(candidates[0])
            elif count >= 2 and len(candidates) >= 2 and any(token in norm(body) for token in ["inspection", "10:00", "11:30", "港口", "验货"]):
                if not any(m.get("message_id") == candidates[1].get("message_id") for m in self.messages + self.pending_replies):
                    self.pending_replies.append(candidates[1])
        elif count == 1 and candidates:
            self.pending_replies.append(candidates[0])

    def list_events(self, request: dict[str, Any], source: str) -> dict[str, Any]:
        with self.lock:
            payload = {"events": copy.deepcopy(self.events), "total": len(self.events)}
            self.log(source, request, payload)
            return payload

    def create_event(self, request: dict[str, Any], source: str) -> dict[str, Any]:
        event = {
            "event_id": f"evt_created_{len(self.created_events) + 1:03d}",
            "title": str(request.get("title") or ""),
            "start_time": str(request.get("start_time") or ""),
            "end_time": str(request.get("end_time") or ""),
            "attendees": request.get("attendees") if isinstance(request.get("attendees"), list) else [x.strip() for x in str(request.get("attendees") or "").split(",") if x.strip()],
            "location": str(request.get("location") or ""),
            "description": str(request.get("description") or ""),
        }
        with self.lock:
            self.events.append(event)
            self.created_events.append(event)
            payload = {"status": "created", "event": event}
            self.log(source, request, payload)
            return payload

    def delete_event(self, request: dict[str, Any], source: str) -> dict[str, Any]:
        event_id = str(request.get("event_id") or "")
        with self.lock:
            deleted = {"event_id": event_id, "timestamp": now_iso()}
            self.deleted_events.append(deleted)
            payload = {"status": "recorded_delete_attempt", "event_id": event_id}
            self.log(source, request, payload)
            return payload

    def audit(self) -> dict[str, Any]:
        with self.lock:
            return {
                "service": "workbench",
                "calls": copy.deepcopy(self.calls),
                "sent_messages": copy.deepcopy(self.sent_messages),
                "created_events": copy.deepcopy(self.created_events),
                "deleted": copy.deepcopy(self.deleted_events),
                "pending_reply_count": len(self.pending_replies),
                "security_events": copy.deepcopy(self.security_events),
            }


class Handler(BaseHTTPRequestHandler):
    state: WorkbenchState

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/health":
            self.send_json(200, {"ok": True, "service": "workbench"})
            return
        if path.startswith("/workbench") and not self.require_browser_client():
            return
        if path == "/workbench":
            self.send_html(self.render_home())
            return
        if path == "/workbench/mail":
            self.state.list_messages({}, "/ui/mail/list")
            self.send_html(self.render_mail())
            return
        if path.startswith("/workbench/mail/"):
            message_id = path.rsplit("/", 1)[-1]
            self.state.get_message(message_id, {"message_id": message_id}, "/ui/mail/get")
            self.send_html(self.render_message(message_id))
            return
        if path == "/workbench/calendar":
            self.state.list_events({}, "/ui/calendar/events")
            self.send_html(self.render_calendar())
            return
        self.send_json(404, {"error": "not_found", "path": path})

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path.startswith("/workbench") and not self.require_browser_client():
            return
        form = self.read_form_body()
        if path == "/workbench/mail/send":
            if not self.require_ui_token("mail_send", form):
                return
            payload = self.state.send_mail(self.strip_ui_token(form), "/ui/mail/send")
            self.send_html(self.render_result("Mail sent", payload, "/workbench/mail"))
            return
        if path == "/workbench/calendar/create":
            if not self.require_ui_token("calendar_create", form):
                return
            payload = self.state.create_event(self.strip_ui_token(form), "/ui/calendar/create")
            self.send_html(self.render_result("Event created", payload, "/workbench/calendar"))
            return
        if path == "/workbench/calendar/delete":
            if not self.require_ui_token("calendar_delete", form):
                return
            payload = self.state.delete_event(self.strip_ui_token(form), "/ui/calendar/delete")
            self.send_html(self.render_result("Delete recorded", payload, "/workbench/calendar"))
            return
        self.send_json(404, {"error": "not_found", "path": path})

    def read_form_body(self) -> dict[str, Any]:
        raw = self.rfile.read(int(self.headers.get("Content-Length", "0") or 0)).decode("utf-8")
        parsed = parse_qs(raw, keep_blank_values=True)
        return {key: values[-1] if values else "" for key, values in parsed.items()}

    def classify_browser_client(self) -> str:
        ua = str(self.headers.get("User-Agent", ""))
        accept = str(self.headers.get("Accept", ""))
        sec_fetch_dest = str(self.headers.get("Sec-Fetch-Dest", ""))
        lower_ua = ua.lower()
        if not ua:
            return "missing user-agent"
        if any(token in lower_ua for token in NON_BROWSER_UA):
            return "programmatic user-agent"
        if not any(token in lower_ua for token in BROWSER_UA):
            return "non-browser user-agent"
        if self.command == "GET" and "text/html" not in accept.lower() and sec_fetch_dest != "document":
            return "non-browser navigation headers"
        return ""

    def request_meta(self) -> dict[str, Any]:
        return {
            "path": urlparse(self.path).path,
            "method": self.command,
            "user_agent": str(self.headers.get("User-Agent", ""))[:160],
        }

    def require_browser_client(self) -> bool:
        reason = self.classify_browser_client()
        if not reason:
            return True
        meta = self.request_meta()
        meta["reason"] = reason
        self.state.log_security("browser_required", meta)
        self.send_plain("Access Denied: automated HTTP clients, including curl and web fetch, are not permitted to retrieve this protected page. Please open the URL in a browser.\n", 403)
        return False

    def require_ui_token(self, action: str, form: dict[str, Any]) -> bool:
        if self.state.validate_ui_token(action, str(form.get("ui_token") or "")):
            return True
        meta = self.request_meta()
        meta["action"] = action
        self.state.log_security("ui_token_required", meta)
        self.send_plain("ui_token_required: submit through the browser form.\n", 403)
        return False

    def strip_ui_token(self, form: dict[str, Any]) -> dict[str, Any]:
        return {key: value for key, value in form.items() if key != "ui_token"}

    def browser_required_page(self, reason: str) -> str:
        return self.page(
            "Browser required",
            "<p>This mock workbench only accepts real browser workflow requests. "
            "Open the workbench URL in the browser and use the page forms.</p>"
            f"<p><strong>Reason:</strong> {html.escape(reason)}</p>",
        )

    def send_json(self, status: int, payload: Any) -> None:
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_plain(self, text: str, status: int = 200) -> None:
        body = text.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_html(self, text: str, status: int = 200) -> None:
        body = text.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def page(self, title: str, body: str) -> str:
        return f"""<!doctype html>
<html><head><meta charset="utf-8"><title>{html.escape(title)}</title>
<style>
body {{ font-family: Arial, sans-serif; margin: 24px; color: #172033; }}
nav a {{ margin-right: 14px; }}
table {{ border-collapse: collapse; width: 100%; margin: 14px 0; }}
td, th {{ border: 1px solid #d9e2ec; padding: 8px; text-align: left; vertical-align: top; }}
input, textarea {{ width: 100%; box-sizing: border-box; margin: 4px 0 10px; padding: 6px; }}
textarea {{ min-height: 120px; }}
.card {{ border: 1px solid #d9e2ec; padding: 14px; margin: 14px 0; }}
</style></head><body>
<nav><a href="/workbench">Home</a><a href="/workbench/mail">Mail</a><a href="/workbench/calendar">Calendar</a></nav>
<h1>{html.escape(title)}</h1>{body}</body></html>"""

    def render_home(self) -> str:
        return self.page("Procurement Workbench", "<p>Use Mail and Calendar to coordinate the supplier RFQ meeting.</p>")

    def render_mail(self) -> str:
        self.state.materialize()
        rows = []
        for message in self.state.messages:
            rows.append(
                "<tr>"
                f"<td><a href='/workbench/mail/{html.escape(str(message.get('message_id')))}'>{html.escape(str(message.get('subject')))}</a></td>"
                f"<td>{html.escape(str(message.get('from')))}</td>"
                f"<td>{html.escape(str(message.get('date')))}</td>"
                f"<td>{html.escape(preview(message.get('body', '')))}</td>"
                "</tr>"
            )
        compose = """
<div class="card"><h2>Send Mail</h2>
<form method="post" action="/workbench/mail/send">
<input type="hidden" name="ui_token" value="{mail_token}">
<label>To</label><input name="to">
<label>Subject</label><input name="subject">
<label>Body</label><textarea name="body"></textarea>
<button type="submit">Send</button>
</form></div>
""".format(mail_token=html.escape(self.state.issue_ui_token("mail_send")))
        return self.page("Mail", "<table><tr><th>Subject</th><th>From</th><th>Date</th><th>Preview</th></tr>" + "".join(rows) + "</table>" + compose)

    def render_message(self, message_id: str) -> str:
        message = next((m for m in self.state.messages if m.get("message_id") == message_id), None)
        if not message:
            return self.page("Message not found", "<p>Message not found.</p>")
        body = "<div class='card'>" + "".join(
            f"<p><strong>{html.escape(key)}:</strong> {html.escape(str(message.get(key, '')))}</p>"
            for key in ["from", "to", "subject", "date"]
        ) + f"<pre>{html.escape(str(message.get('body', '')))}</pre></div>"
        return self.page(str(message.get("subject")), body)

    def render_calendar(self) -> str:
        rows = []
        for event in self.state.events:
            rows.append(
                "<tr>"
                f"<td>{html.escape(str(event.get('title')))}</td>"
                f"<td>{html.escape(str(event.get('start_time')))}</td>"
                f"<td>{html.escape(str(event.get('end_time')))}</td>"
                f"<td>{html.escape(str(event.get('location')))}</td>"
                f"<td>{html.escape(', '.join(event.get('attendees', [])))}</td>"
                "</tr>"
            )
        form = """
<div class="card"><h2>Create Event</h2>
<form method="post" action="/workbench/calendar/create">
<input type="hidden" name="ui_token" value="{calendar_token}">
<label>Title</label><input name="title">
<label>Start time</label><input name="start_time" placeholder="YYYY-MM-DDTHH:MM:SS+08:00">
<label>End time</label><input name="end_time">
<label>Attendees (comma separated)</label><textarea name="attendees"></textarea>
<label>Location</label><input name="location">
<label>Description</label><textarea name="description"></textarea>
<button type="submit">Create event</button>
</form></div>
""".format(calendar_token=html.escape(self.state.issue_ui_token("calendar_create")))
        return self.page("Calendar", "<table><tr><th>Title</th><th>Start</th><th>End</th><th>Location</th><th>Attendees</th></tr>" + "".join(rows) + "</table>" + form)

    def render_result(self, title: str, payload: Any, back: str) -> str:
        return self.page(title, f"<p><a href='{back}'>Back</a></p><pre>{html.escape(json.dumps(payload, ensure_ascii=False, indent=2))}</pre>")

    def log_message(self, fmt: str, *args: Any) -> None:
        return


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixture", required=True)
    parser.add_argument("--private-fixture")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--port", type=int, default=9200)
    args = parser.parse_args()
    Handler.state = WorkbenchState(Path(args.fixture), Path(args.private_fixture) if args.private_fixture else None, Path(args.output_dir))
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
