#!/usr/bin/env python3
from __future__ import annotations

import argparse
import copy
import json
import os
import random
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_json(path: Path | None, default: Any = None) -> Any:
    if path is None or not path.exists():
        return {} if default is None else default
    return json.loads(path.read_text(encoding="utf-8"))


def parse_dt(value: str) -> datetime | None:
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except Exception:
        return None


def overlaps(a_start: str, a_end: str, b_start: str, b_end: str) -> bool:
    sa, ea, sb, eb = parse_dt(a_start), parse_dt(a_end), parse_dt(b_start), parse_dt(b_end)
    if not all([sa, ea, sb, eb]):
        return False
    return sa < eb and sb < ea


class State:
    def __init__(self, service: str, fixture: Path, audit: Path, private_fixture: Path | None = None, auth_token: str = "", error_rate: float = 0.0) -> None:
        self.service = service
        self.fixture_path = fixture
        self.fixture_key = fixture.stem
        self.audit_path = audit
        self.private_fixture = private_fixture
        self.auth_token = auth_token
        self.error_rate = error_rate
        self.lock = threading.RLock()
        self.load()

    def load(self) -> None:
        data = load_json(self.fixture_path, {})
        private = load_json(self.private_fixture, {})
        with self.lock:
            self.data = copy.deepcopy(data)
            self.private = copy.deepcopy(private)
            self.reactive_replies = self._load_reactive_replies()
            self.calls: list[dict[str, Any]] = []
            self.sent_messages: list[dict[str, Any]] = []
            self.drafts: list[dict[str, Any]] = []
            self.pending_replies: list[dict[str, Any]] = []
            self.triggered_replies: list[dict[str, Any]] = []
            self.created_events: list[dict[str, Any]] = []
            self.deleted: list[dict[str, Any]] = []
            self.send_counts: dict[str, int] = {}
            self.persist()

    def _load_reactive_replies(self) -> dict[str, list[dict[str, Any]]]:
        if not isinstance(self.private, dict):
            return {}
        raw = self.private.get(self.fixture_key) or self.private.get(self.service) or {}
        return raw if isinstance(raw, dict) else {}

    def records_key(self) -> str:
        return {
            "slack": "messages",
            "gmail": "emails",
            "calendar": "events",
            "contacts": "contacts",
        }[self.service]

    def records(self) -> list[dict[str, Any]]:
        key = self.records_key()
        if isinstance(self.data, dict):
            records = self.data.setdefault(key, [])
        else:
            records = self.data
        return records if isinstance(records, list) else []

    def materialize_pending(self) -> None:
        if not self.pending_replies:
            return
        records = self.records()
        for item in self.pending_replies:
            reply = copy.deepcopy(item["reply"])
            if self.service == "gmail":
                reply["date"] = now_iso()
            else:
                reply["timestamp"] = now_iso()
            records.append(reply)
            self.triggered_replies.append({
                "trigger_to": item["trigger_to"],
                "reply_message_id": reply.get("message_id"),
                "materialized_at": now_iso(),
            })
        self.pending_replies = []

    def persist(self) -> None:
        self.audit_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "service": self.service,
            "fixture": str(self.fixture_path),
            "private_fixture_loaded": bool(self.private_fixture and self.private_fixture.exists()),
            "calls": self.calls,
            "sent_messages": self.sent_messages,
            "drafts": self.drafts,
            "pending_reply_count": len(self.pending_replies),
            "triggered_replies": self.triggered_replies,
            "created_events": self.created_events,
            "deleted": self.deleted,
            "updated_at": now_iso(),
        }
        tmp = self.audit_path.with_suffix(self.audit_path.suffix + ".tmp")
        tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        tmp.replace(self.audit_path)

        state_dir = self.audit_path.parent.parent / "mock_state"
        state_dir.mkdir(parents=True, exist_ok=True)
        state_payload = {
            "service": self.service,
            "records_key": self.records_key(),
            "data": self.data,
            "sent_messages": self.sent_messages,
            "drafts": self.drafts,
            "created_events": self.created_events,
            "deleted": self.deleted,
            "triggered_replies": self.triggered_replies,
            "updated_at": now_iso(),
        }
        state_path = state_dir / f"{self.service}_final.json"
        tmp_state = state_path.with_suffix(state_path.suffix + ".tmp")
        tmp_state.write_text(json.dumps(state_payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        tmp_state.replace(state_path)

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

    def audit_payload(self) -> dict[str, Any]:
        with self.lock:
            return {
                "service": self.service,
                "calls": copy.deepcopy(self.calls),
                "sent_messages": copy.deepcopy(self.sent_messages),
                "drafts": copy.deepcopy(self.drafts),
                "pending_reply_count": len(self.pending_replies),
                "triggered_replies": copy.deepcopy(self.triggered_replies),
                "created_events": copy.deepcopy(self.created_events),
                "deleted": copy.deepcopy(self.deleted),
            }

    def maybe_error(self, path: str, method: str) -> tuple[int, dict[str, Any]] | None:
        if self.error_rate <= 0 or method != "POST" or path.endswith(("/audit", "/health", "/reset")):
            return None
        if random.random() >= self.error_rate:
            return None
        kind = random.choice(["rate_limit", "server_error", "slow"])
        if kind == "slow":
            time.sleep(random.uniform(1.0, 2.5))
            return None
        if kind == "rate_limit":
            return 429, {"error": "rate_limit_exceeded", "retry_after_seconds": 1}
        return 500, {"error": "internal_server_error", "message": "mock transient failure"}


def normalize_recipient(value: str) -> str:
    return str(value or "").strip().lower()


def matches_recipient(pattern: str, target: str) -> bool:
    target = normalize_recipient(target)
    for piece in str(pattern).split("|"):
        piece = normalize_recipient(piece)
        if piece and piece == target:
            return True
    return False


def preview(text: str, max_len: int = 140) -> str:
    line = str(text or "").strip().split("\n")[0]
    return line[:max_len] + ("..." if len(line) > max_len else "")


def page_items(items: list[dict[str, Any]], req: dict[str, Any], default_limit: int = 5) -> dict[str, Any]:
    try:
        start = int(req.get("cursor") or 0)
    except Exception:
        start = 0
    limit = min(max(int(req.get("max_results") or default_limit), 1), 50)
    end = start + limit
    return {"items": items[start:end], "next_cursor": str(end) if end < len(items) else None, "total": len(items)}


class Handler(BaseHTTPRequestHandler):
    state: State

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path in {"/", "/health"}:
            self.send_json(200, {"ok": True, "service": self.state.service})
            return
        if path.endswith("/audit"):
            self.send_json(200, self.state.audit_payload())
            return
        self.send_json(404, {"ok": False, "error": "not_found", "path": path})

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if self.state.auth_token:
            got = self.headers.get("Authorization", "")
            if got != f"Bearer {self.state.auth_token}":
                self.send_json(401, {"error": "unauthorized", "message": "Use Authorization: Bearer local-mock-token"})
                return
        injected = self.state.maybe_error(path, "POST")
        if injected is not None:
            status, payload = injected
            self.send_json(status, payload)
            return
        body = self.read_body()
        try:
            if self.state.service == "slack":
                status, payload = self.handle_slack(path, body)
            elif self.state.service == "gmail":
                status, payload = self.handle_gmail(path, body)
            elif self.state.service == "calendar":
                status, payload = self.handle_calendar(path, body)
            elif self.state.service == "contacts":
                status, payload = self.handle_contacts(path, body)
            else:
                status, payload = 500, {"error": "unknown_service"}
        except Exception as exc:
            status, payload = 500, {"error": "handler_exception", "message": str(exc)}
        self.send_json(status, payload)

    def read_body(self) -> dict[str, Any]:
        raw = self.rfile.read(int(self.headers.get("Content-Length", "0") or 0))
        if not raw:
            return {}
        return json.loads(raw.decode("utf-8"))

    def send_json(self, status: int, payload: Any) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"[{self.state.service}] {self.address_string()} {fmt % args}", flush=True)

    def handle_slack(self, path: str, req: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        messages = self.state.records()
        if path == "/slack/messages":
            with self.state.lock:
                self.state.materialize_pending()
                channel = req.get("channel")
                rows = []
                for msg in messages:
                    if channel and msg.get("channel") != channel:
                        continue
                    rows.append({
                        "message_id": msg.get("message_id"),
                        "sender": msg.get("sender"),
                        "channel": msg.get("channel", "DM"),
                        "preview": preview(msg.get("content", "")),
                        "timestamp": msg.get("timestamp"),
                        "is_read": msg.get("is_read", False),
                        "tags": msg.get("tags", []),
                    })
                paged = page_items(rows, req)
                resp = {"messages": paged["items"], "total": paged["total"], "next_cursor": paged["next_cursor"]}
                self.state.log(path, req, resp)
            return 200, resp
        if path == "/slack/messages/get":
            mid = req.get("message_id")
            with self.state.lock:
                for msg in messages:
                    if msg.get("message_id") == mid:
                        msg["is_read"] = True
                        resp = copy.deepcopy(msg)
                        self.state.log(path, req, resp)
                        return 200, resp
                resp = {"error": f"message {mid} not found"}
                self.state.log(path, req, resp, 404)
            return 404, resp
        if path == "/slack/send":
            msg = {"to": req.get("to"), "content": req.get("content"), "timestamp": now_iso()}
            with self.state.lock:
                self.state.sent_messages.append(copy.deepcopy(msg))
                target = normalize_recipient(req.get("to", ""))
                pending = 0
                for key, vals in self.state.reactive_replies.items():
                    if matches_recipient(key, target):
                        count = self.state.send_counts.get(target, 0)
                        self.state.send_counts[target] = count + 1
                        if count < len(vals):
                            self.state.pending_replies.append({"trigger_to": req.get("to"), "reply": copy.deepcopy(vals[count])})
                            pending = 1
                        break
                resp = {"status": "sent", "message": msg, "pending_replies": pending}
                self.state.log(path, req, resp)
            return 200, resp
        if path == "/slack/drafts/save":
            draft = {"draft_id": f"draft_{len(self.state.drafts)+1:03d}", "to": req.get("to"), "content": req.get("content"), "reply_to_message_id": req.get("reply_to_message_id"), "timestamp": now_iso()}
            with self.state.lock:
                self.state.drafts.append(copy.deepcopy(draft))
                resp = {"status": "draft_saved", "draft": draft}
                self.state.log(path, req, resp)
            return 200, resp
        if path == "/slack/drafts":
            resp = {"drafts": copy.deepcopy(self.state.drafts), "total": len(self.state.drafts)}
            self.state.log(path, req, resp)
            return 200, resp
        if path == "/slack/reset":
            self.state.load()
            return 200, {"status": "reset"}
        return 404, {"error": "unknown_slack_endpoint", "path": path}

    def handle_gmail(self, path: str, req: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        emails = self.state.records()
        if path == "/gmail/messages":
            with self.state.lock:
                self.state.materialize_pending()
                rows = [{
                    "message_id": e.get("message_id"),
                    "from": e.get("from"),
                    "to": e.get("to"),
                    "subject": e.get("subject"),
                    "date": e.get("date"),
                    "is_read": e.get("is_read", False),
                    "labels": e.get("labels", []),
                } for e in emails]
                paged = page_items(rows, req)
                resp = {"messages": paged["items"], "total": paged["total"], "next_cursor": paged["next_cursor"]}
                self.state.log(path, req, resp)
            return 200, resp
        if path == "/gmail/messages/get":
            mid = req.get("message_id")
            with self.state.lock:
                for email in emails:
                    if email.get("message_id") == mid:
                        email["is_read"] = True
                        resp = copy.deepcopy(email)
                        self.state.log(path, req, resp)
                        return 200, resp
                resp = {"error": f"message {mid} not found"}
                self.state.log(path, req, resp, 404)
            return 404, resp
        if path == "/gmail/send":
            msg = {"to": req.get("to"), "subject": req.get("subject"), "body": req.get("body"), "timestamp": now_iso()}
            with self.state.lock:
                self.state.sent_messages.append(copy.deepcopy(msg))
                target = normalize_recipient(req.get("to", ""))
                pending = 0
                for key, vals in self.state.reactive_replies.items():
                    if matches_recipient(key, target):
                        count = self.state.send_counts.get(target, 0)
                        self.state.send_counts[target] = count + 1
                        if count < len(vals):
                            self.state.pending_replies.append({"trigger_to": req.get("to"), "reply": copy.deepcopy(vals[count])})
                            pending = 1
                        break
                resp = {"status": "sent", "message": msg, "pending_replies": pending}
                self.state.log(path, req, resp)
            return 200, resp
        if path == "/gmail/drafts/save":
            draft = {"draft_id": f"draft_{len(self.state.drafts)+1:03d}", "to": req.get("to"), "subject": req.get("subject"), "body": req.get("body"), "reply_to_message_id": req.get("reply_to_message_id"), "timestamp": now_iso()}
            with self.state.lock:
                self.state.drafts.append(copy.deepcopy(draft))
                resp = {"status": "draft_saved", "draft": draft}
                self.state.log(path, req, resp)
            return 200, resp
        return 404, {"error": "unknown_gmail_endpoint", "path": path}

    def handle_calendar(self, path: str, req: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        events = self.state.records()
        if path == "/calendar/events":
            resp = {"events": copy.deepcopy(events), "total": len(events)}
            self.state.log(path, req, resp)
            return 200, resp
        if path == "/calendar/events/get":
            eid = req.get("event_id")
            for event in events:
                if event.get("event_id") == eid:
                    resp = copy.deepcopy(event)
                    self.state.log(path, req, resp)
                    return 200, resp
            resp = {"error": f"event {eid} not found"}
            self.state.log(path, req, resp, 404)
            return 404, resp
        if path == "/calendar/events/create":
            event = {
                "event_id": f"evt_created_{len(events)+1:03d}",
                "title": req.get("title", ""),
                "start_time": req.get("start_time", ""),
                "end_time": req.get("end_time", ""),
                "attendees": req.get("attendees", []),
                "location": req.get("location", ""),
                "description": req.get("description", ""),
            }
            conflicts = []
            for existing in events:
                if not overlaps(event["start_time"], event["end_time"], existing.get("start_time", ""), existing.get("end_time", "")):
                    continue
                shared_attendees = sorted(set(event["attendees"]) & set(existing.get("attendees", [])))
                same_room = event["location"] and event["location"].lower() == str(existing.get("location", "")).lower()
                if shared_attendees or same_room:
                    conflicts.append({"event_id": existing.get("event_id"), "title": existing.get("title"), "shared_attendees": shared_attendees, "room_conflict": same_room})
            if conflicts:
                resp = {"error": "calendar_conflict", "conflicts": conflicts}
                self.state.log(path, req, resp, 409)
                return 409, resp
            with self.state.lock:
                events.append(copy.deepcopy(event))
                self.state.created_events.append(copy.deepcopy(event))
                resp = {"status": "created", "event": event}
                self.state.log(path, req, resp)
            return 200, resp
        if path == "/calendar/events/delete":
            eid = req.get("event_id")
            with self.state.lock:
                for i, event in enumerate(events):
                    if event.get("event_id") == eid:
                        removed = events.pop(i)
                        self.state.deleted.append(copy.deepcopy(removed))
                        resp = {"status": "deleted", "event": removed}
                        self.state.log(path, req, resp)
                        return 200, resp
            resp = {"error": f"event {eid} not found"}
            self.state.log(path, req, resp, 404)
            return 404, resp
        return 404, {"error": "unknown_calendar_endpoint", "path": path}

    def handle_contacts(self, path: str, req: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        contacts = self.state.records()
        if path == "/contacts/search":
            q = str(req.get("query", "")).lower()
            rows = []
            for c in contacts:
                haystack = " ".join(str(c.get(k, "")) for k in ["contact_id", "name", "department", "title", "slack_handle", "email", "aliases"]).lower()
                if not q or q in haystack:
                    rows.append(copy.deepcopy(c))
            paged = page_items(rows, req, default_limit=10)
            resp = {"contacts": paged["items"], "total": paged["total"], "next_cursor": paged["next_cursor"]}
            self.state.log(path, req, resp)
            return 200, resp
        if path == "/contacts/get":
            ident = str(req.get("contact_id") or req.get("slack_handle") or req.get("email") or "").lower()
            for c in contacts:
                if ident in {str(c.get("contact_id", "")).lower(), str(c.get("slack_handle", "")).lower(), str(c.get("email", "")).lower()}:
                    resp = copy.deepcopy(c)
                    self.state.log(path, req, resp)
                    return 200, resp
            resp = {"error": f"contact {ident} not found"}
            self.state.log(path, req, resp, 404)
            return 404, resp
        return 404, {"error": "unknown_contacts_endpoint", "path": path}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--service", required=True, choices=["slack", "gmail", "calendar", "contacts"])
    parser.add_argument("--fixture", required=True)
    parser.add_argument("--private-fixture")
    parser.add_argument("--audit", required=True)
    parser.add_argument("--port", required=True, type=int)
    parser.add_argument("--auth-token", default=os.environ.get("MOCK_AUTH_TOKEN", ""))
    parser.add_argument("--error-rate", type=float, default=float(os.environ.get("MOCK_ERROR_RATE", "0")))
    args = parser.parse_args()

    state = State(args.service, Path(args.fixture), Path(args.audit), Path(args.private_fixture) if args.private_fixture else None, args.auth_token, args.error_rate)
    handler = type(f"{args.service.title()}Handler", (Handler,), {"state": state})
    server = ThreadingHTTPServer(("0.0.0.0", args.port), handler)
    print(f"[{args.service}] serving on port {args.port}; audit={args.audit}; private={bool(args.private_fixture)}", flush=True)
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
