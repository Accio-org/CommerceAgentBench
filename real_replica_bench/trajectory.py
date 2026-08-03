"""Trajectory reconstruction from per-harness agent state.

Extracted verbatim from cli.py (2026-06-18 refactor): pure stdlib, no cli
dependencies. Recovers a normalized trajectory.json from Accio SQLite state,
OpenClaw chat JSONL, Codex rollout, Hermes state, run.log JSON events, and
proxy usage.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any


def _safe_json_loads(text: str) -> Any:
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None


def _parse_result_root(result_path: Path) -> dict[str, Any]:
    if not result_path.is_file():
        return {}
    payload = json.loads(result_path.read_text(encoding="utf-8"))
    root = payload[0] if isinstance(payload, list) and payload else payload
    if not isinstance(root, dict):
        return {}
    return root


def _sanitize_tool_call(call: Any) -> Any:
    if not isinstance(call, dict):
        return call
    cleaned = dict(call)
    cleaned.pop("thoughtSignature", None)
    cleaned.pop("reasoning", None)
    return cleaned


def _flatten_tool_progress(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        out: list[Any] = []
        for item in value.values():
            if isinstance(item, list):
                out.extend(item)
            else:
                out.append(item)
        return out
    return []


def _stable_json_key(value: Any) -> str:
    try:
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    except TypeError:
        return repr(value)


def _tool_call_key(call: Any) -> tuple[str, str]:
    if not isinstance(call, dict):
        return ("value", _stable_json_key(call))
    call_id = call.get("id") or call.get("toolCallId") or call.get("tool_call_id")
    if call_id:
        return ("id", str(call_id))
    content = {key: value for key, value in call.items() if key != "_source"}
    return ("value", _stable_json_key(content))


def _tool_result_key(result: Any) -> tuple[str, str, str]:
    if not isinstance(result, dict):
        return ("value", "", _stable_json_key(result))
    call_id = result.get("toolCallId") or result.get("tool_call_id") or result.get("source_call_id")
    if call_id:
        return ("call", str(call_id), _stable_json_key(result.get("content")))
    content = {key: value for key, value in result.items() if key != "_source"}
    return ("value", "", _stable_json_key(content))


def _progress_key(progress: Any) -> tuple[str, str]:
    if not isinstance(progress, dict):
        return ("value", _stable_json_key(progress))
    content = {key: value for key, value in progress.items() if key != "_source"}
    return ("value", _stable_json_key(content))


def _message_key(message: Any) -> tuple[str, str, str, str, str]:
    if not isinstance(message, dict):
        return ("value", "", "", "", _stable_json_key(message))
    return (
        str(message.get("role") or ""),
        str(message.get("message_type") or ""),
        str(message.get("tool_name") or ""),
        str(message.get("timestamp") or ""),
        str(message.get("content_preview") or ""),
    )


def _dedupe_sequence(items: list[Any], key_fn: Any) -> tuple[list[Any], int]:
    seen: set[Any] = set()
    out: list[Any] = []
    duplicates = 0
    for item in items:
        key = key_fn(item)
        if key in seen:
            duplicates += 1
            continue
        seen.add(key)
        out.append(item)
    return out, duplicates


def recover_trajectory_from_accio_state(agent_dir: Path) -> dict[str, Any]:
    state_dir = agent_dir / "accio_state"
    if not state_dir.exists():
        return {}
    jsonl_files = sorted(state_dir.rglob("*.jsonl"))
    tool_calls: list[Any] = []
    tool_results: list[Any] = []
    tool_progress: list[Any] = []
    messages: list[dict[str, Any]] = []
    response_chunks: list[str] = []
    response_chunk_seen: set[str] = set()
    usage_records: list[Any] = []
    source_files: list[str] = []

    for path in jsonl_files:
        source_files.append(str(path.relative_to(agent_dir)))
        for line_no, line in enumerate(path.read_text(encoding="utf-8", errors="replace").splitlines(), start=1):
            item = _safe_json_loads(line.strip())
            if not isinstance(item, dict):
                continue

            raw_calls = item.get("toolCalls") or item.get("tool_calls") or []
            if isinstance(raw_calls, list):
                for call in raw_calls:
                    if isinstance(call, dict):
                        tool_calls.append({**_sanitize_tool_call(call), "_source": f"{path.relative_to(agent_dir)}:{line_no}"})

            progress = item.get("toolProgress") or item.get("tool_progress")
            for progress_item in _flatten_tool_progress(progress):
                if isinstance(progress_item, dict):
                    tool_progress.append({**progress_item, "_source": f"{path.relative_to(agent_dir)}:{line_no}"})

            metadata = item.get("metadata")
            if isinstance(metadata, dict) and isinstance(metadata.get("usage"), dict):
                usage_records.append(metadata["usage"])

            role = item.get("role")
            message_type = item.get("messageType") or item.get("message_type")
            content = item.get("content")
            if role == "assistant" and isinstance(content, str) and content.strip():
                chunk = content.strip()
                if chunk not in response_chunk_seen:
                    response_chunk_seen.add(chunk)
                    response_chunks.append(chunk)
            if role == "tool" or message_type == "tool_result":
                result = {
                    "toolCallId": item.get("toolCallId") or item.get("tool_call_id"),
                    "toolName": item.get("name"),
                    "content": content if isinstance(content, str) else json.dumps(content, ensure_ascii=False),
                    "_source": f"{path.relative_to(agent_dir)}:{line_no}",
                }
                tool_results.append(result)
                if isinstance(content, str) and "<task_result>" in content:
                    chunk = content.strip()
                    if chunk not in response_chunk_seen:
                        response_chunk_seen.add(chunk)
                        response_chunks.append(chunk)

            if role in {"assistant", "tool", "user"} or message_type:
                preview = content if isinstance(content, str) else ""
                messages.append(
                    {
                        "role": role,
                        "message_type": message_type,
                        "tool_name": item.get("name"),
                        "tool_call_count": len(raw_calls) if isinstance(raw_calls, list) else 0,
                        "content_preview": preview[:4000],
                        "timestamp": item.get("timestamp") or item.get("ts"),
                        "_source": f"{path.relative_to(agent_dir)}:{line_no}",
                    }
                )

    usage: dict[str, int] = {}
    for record in usage_records:
        for key, value in record.items():
            if isinstance(value, int):
                usage[key] = usage.get(key, 0) + value

    tool_calls, duplicate_tool_calls = _dedupe_sequence(tool_calls, _tool_call_key)
    tool_results, duplicate_tool_results = _dedupe_sequence(tool_results, _tool_result_key)
    tool_progress, duplicate_tool_progress = _dedupe_sequence(tool_progress, _progress_key)
    messages, duplicate_messages = _dedupe_sequence(messages, _message_key)
    duplicate_counts = {
        "tool_calls": duplicate_tool_calls,
        "tool_results": duplicate_tool_results,
        "tool_progress": duplicate_tool_progress,
        "messages": duplicate_messages,
    }

    if not any([tool_calls, tool_results, tool_progress, messages, response_chunks]):
        return {}
    return {
        "source": "accio_state",
        "recovered_from_accio_state": True,
        "recovered_source_files": source_files,
        "deduplicated_recovery_items": duplicate_counts,
        "response_text": "\n\n".join(response_chunks)[-60000:],
        "tool_calls": tool_calls,
        "tool_results": tool_results,
        "tool_progress": tool_progress,
        "messages": messages,
        "usage": usage,
    }


# Assistant content-part types that carry reasoning rather than the visible
# answer. "thinking" is what OpenClaw 2026.5.22 writes; the others are accepted
# so a provider/version that labels the part differently still gets captured.
_OPENCLAW_REASONING_PART_TYPES = frozenset({"thinking", "reasoning", "reasoning_content"})


def recover_trajectory_from_openclaw_chat(agent_dir: Path) -> dict[str, Any]:
    """Parse OpenClaw's chat.jsonl session log into a trajectory dict.

    OpenClaw v3 session format wraps messages in ``{type:"message", message:{role, content:[...]}}``
    where assistant content items have ``type=toolCall`` with ``name`` + ``arguments``,
    and toolResult messages have ``role=toolResult``/``toolCallId`` + ``content[].text``.
    Mirrors the shape produced by ``recover_trajectory_from_accio_state``.
    """
    chat_path = agent_dir / "chat.jsonl"
    if not chat_path.is_file():
        return {}
    tool_calls: list[dict[str, Any]] = []
    tool_results: list[dict[str, Any]] = []
    response_chunks: list[str] = []
    response_chunk_seen: set[str] = set()
    reasoning_chunks: list[str] = []
    messages: list[dict[str, Any]] = []
    usage: dict[str, int] = {}
    for line_no, line in enumerate(chat_path.read_text(encoding="utf-8", errors="replace").splitlines(), start=1):
        item = _safe_json_loads(line.strip())
        if not isinstance(item, dict) or item.get("type") != "message":
            continue
        msg = item.get("message")
        if not isinstance(msg, dict):
            continue
        role = msg.get("role")
        content = msg.get("content")
        if not isinstance(content, list):
            content = []
        for u_key, u_val in (msg.get("usage") or {}).items():
            if isinstance(u_val, int):
                usage[u_key] = usage.get(u_key, 0) + u_val
        if role == "assistant":
            turn_text: list[str] = []
            turn_reasoning: list[str] = []
            turn_calls: list[dict[str, Any]] = []
            turn_parts: list[dict[str, Any]] = []
            for part in content:
                if not isinstance(part, dict):
                    continue
                ptype = part.get("type")
                if ptype == "text":
                    txt = part.get("text") or ""
                    if isinstance(txt, str) and txt.strip():
                        turn_text.append(txt)
                        turn_parts.append({"type": "text", "text": txt})
                        if txt not in response_chunk_seen:
                            response_chunk_seen.add(txt)
                            response_chunks.append(txt)
                elif ptype in _OPENCLAW_REASONING_PART_TYPES:
                    # OpenClaw serialises the model's reasoning as a sibling
                    # content part. Observed on 2026.5.22: type "thinking" with
                    # the plaintext under a "thinking" key, not "text".
                    txt = part.get("text") or part.get("thinking") or part.get("reasoning") or ""
                    if isinstance(txt, str) and txt.strip():
                        turn_reasoning.append(txt)
                        turn_parts.append({"type": "reasoning", "text": txt})
                        reasoning_chunks.append(txt)
                elif ptype == "toolCall":
                    call = {
                        "id": part.get("id"),
                        "name": part.get("name"),
                        "arguments": part.get("arguments"),
                        "_source": f"chat.jsonl:{line_no}",
                    }
                    turn_calls.append(call)
                    turn_parts.append({"type": "toolCall", **call})
                    tool_calls.append(call)
            if turn_parts:
                text_joined = "\n".join(turn_text)
                messages.append({
                    "role": "assistant",
                    "message_type": None,
                    "tool_name": None,
                    # `parts` is the turn as the provider returned it: reasoning,
                    # visible text and tool calls interleaved in their original
                    # order. The flat tool_calls/response_text/reasoning bags
                    # below are aggregates over every turn and cannot say which
                    # reasoning preceded which call.
                    "parts": turn_parts,
                    "text": text_joined,
                    "reasoning": "\n".join(turn_reasoning),
                    "tool_calls": turn_calls,
                    "tool_call_count": len(turn_calls),
                    "usage": msg.get("usage") if isinstance(msg.get("usage"), dict) else None,
                    "content_preview": text_joined[:4000],
                    "timestamp": msg.get("timestamp") or item.get("timestamp"),
                    "_source": f"chat.jsonl:{line_no}",
                })
        elif role in ("tool", "toolResult"):
            text_chunks: list[str] = []
            for part in content:
                if isinstance(part, dict) and part.get("type") == "text":
                    t = part.get("text")
                    if isinstance(t, str):
                        text_chunks.append(t)
                elif isinstance(part, str):
                    text_chunks.append(part)
            joined = "\n".join(text_chunks)
            result = {
                "toolCallId": msg.get("toolCallId"),
                "toolName": msg.get("toolName") or msg.get("name"),
                "content": joined,
                "_source": f"chat.jsonl:{line_no}",
            }
            tool_results.append(result)
            # Tool results are turns too. Recording them in `messages` keeps the
            # sequence readable end to end (assistant turn -> its results -> next
            # assistant turn) instead of leaving holes the reader has to rejoin
            # by toolCallId.
            messages.append({
                "role": "toolResult",
                "message_type": "tool_result",
                "tool_name": result["toolName"],
                "toolCallId": result["toolCallId"],
                "parts": [{"type": "toolResult", "text": joined}],
                "text": joined,
                "reasoning": "",
                "tool_calls": [],
                "tool_call_count": 0,
                "usage": None,
                "content_preview": joined[:4000],
                "timestamp": msg.get("timestamp") or item.get("timestamp"),
                "_source": f"chat.jsonl:{line_no}",
            })
    if not any([tool_calls, tool_results, response_chunks, reasoning_chunks]):
        return {}
    return {
        "source": "openclaw_chat",
        "recovered_from_openclaw_chat": True,
        "recovered_source_files": ["chat.jsonl"],
        "response_text": "\n\n".join(response_chunks)[-60000:],
        # Same key the codex rollout reader emits, so consumers do not have to
        # branch on which harness produced the trajectory.
        "reasoning": "\n\n".join(reasoning_chunks)[-20000:] if reasoning_chunks else "",
        "tool_calls": tool_calls,
        "tool_results": tool_results,
        "tool_progress": [],
        "messages": messages,
        "usage": usage,
    }


def recover_trajectory_from_codex_rollout(agent_dir: Path) -> dict[str, Any]:
    """Parse codex's rollout JSONL (promoted by collect_codex_state_artifacts
    to agent_dir/chat.jsonl) into the same trajectory dict shape as
    recover_trajectory_from_openclaw_chat.

    Codex Responses-API rollout format wraps each item as
    ``{type:"response_item", payload:{type, role, content, ...}}`` where:
      - assistant messages: payload.type="message", payload.role="assistant",
        payload.content=[{type:"output_text"|"text", text:...}, ...]
      - tool calls: payload.type="function_call" (or "custom_tool_call"),
        with payload.name + payload.arguments + payload.call_id (or id)
      - tool results: payload.type="function_call_output", with
        payload.call_id + payload.output (string or content list)
      - reasoning: payload.type="reasoning" (some models only)
    The reverse-walk picks tool_name for tool_results from the matching
    tool_call (same call_id) so html_report can render the pair.
    """
    chat_path = agent_dir / "chat.jsonl"
    if not chat_path.is_file():
        return {}
    tool_calls: list[dict[str, Any]] = []
    tool_results: list[dict[str, Any]] = []
    response_chunks: list[str] = []
    response_chunk_seen: set[str] = set()
    reasoning_chunks: list[str] = []
    tool_name_by_call_id: dict[str, str] = {}
    usage: dict[str, int] = {}
    saw_response_item = False

    def _flatten_output(value: Any) -> str:
        if isinstance(value, str):
            return value
        if isinstance(value, list):
            parts: list[str] = []
            for item in value:
                if isinstance(item, dict):
                    t = item.get("text")
                    if isinstance(t, str):
                        parts.append(t)
                    elif isinstance(item.get("content"), str):
                        parts.append(item["content"])
                elif isinstance(item, str):
                    parts.append(item)
            return "\n".join(parts)
        if isinstance(value, dict):
            t = value.get("text") or value.get("content") or value.get("output")
            if isinstance(t, str):
                return t
        return ""

    for line_no, line in enumerate(chat_path.read_text(encoding="utf-8", errors="replace").splitlines(), start=1):
        item = _safe_json_loads(line.strip())
        if not isinstance(item, dict):
            continue
        item_type = item.get("type")
        if item_type != "response_item":
            # Track usage from event_msg if present (codex emits totals at
            # turn boundaries). Best-effort; skip on shape surprise.
            if item_type == "event_msg":
                evt = item.get("payload") or {}
                evt_type = evt.get("type") if isinstance(evt, dict) else None
                if evt_type in ("token_count", "turn_complete"):
                    info = evt.get("info") if isinstance(evt, dict) else None
                    if isinstance(info, dict):
                        for u_key, u_val in info.items():
                            if isinstance(u_val, int) and (
                                "token" in u_key.lower() or u_key.endswith("_tokens")
                            ):
                                usage[u_key] = usage.get(u_key, 0) + u_val
            continue
        saw_response_item = True
        payload = item.get("payload")
        if not isinstance(payload, dict):
            continue
        ptype = payload.get("type")
        if ptype == "message" and payload.get("role") == "assistant":
            content = payload.get("content")
            if not isinstance(content, list):
                continue
            for part in content:
                if not isinstance(part, dict):
                    continue
                if part.get("type") in ("output_text", "text"):
                    txt = part.get("text") or ""
                    if isinstance(txt, str) and txt.strip() and txt not in response_chunk_seen:
                        response_chunk_seen.add(txt)
                        response_chunks.append(txt)
        elif ptype in ("function_call", "custom_tool_call", "tool_use"):
            call_id = payload.get("call_id") or payload.get("id") or ""
            name = payload.get("name") or "?"
            if call_id:
                tool_name_by_call_id[str(call_id)] = name
            tool_calls.append({
                "id": str(call_id) if call_id else None,
                "name": name,
                "arguments": payload.get("arguments"),
                "_source": f"chat.jsonl:{line_no}",
            })
        elif ptype in ("function_call_output", "tool_result", "custom_tool_call_output"):
            call_id = payload.get("call_id") or payload.get("id") or ""
            tool_results.append({
                "toolCallId": str(call_id) if call_id else None,
                "toolName": tool_name_by_call_id.get(str(call_id), payload.get("name")),
                "content": _flatten_output(payload.get("output")),
                "_source": f"chat.jsonl:{line_no}",
            })
        elif ptype == "reasoning":
            # Some models emit summarized reasoning blocks. Keep them in a
            # separate bag so trajectories show what the model "thought"
            # between tool calls.
            summary = payload.get("summary")
            if isinstance(summary, list):
                for part in summary:
                    if isinstance(part, dict) and isinstance(part.get("text"), str):
                        reasoning_chunks.append(part["text"])
            elif isinstance(payload.get("content"), list):
                for part in payload["content"]:
                    if isinstance(part, dict) and isinstance(part.get("text"), str):
                        reasoning_chunks.append(part["text"])

    if not saw_response_item:
        # Not a codex rollout (probably an openclaw chat.jsonl that the
        # earlier recovery already handled or some other format).
        return {}
    if not any([tool_calls, tool_results, response_chunks]):
        return {}
    return {
        "source": "codex_rollout",
        "recovered_from_codex_rollout": True,
        "recovered_source_files": ["chat.jsonl"],
        "response_text": "\n\n".join(response_chunks)[-60000:],
        "tool_calls": tool_calls,
        "tool_results": tool_results,
        "tool_progress": [],
        "messages": [],
        "usage": usage,
        "reasoning": "\n\n".join(reasoning_chunks)[-20000:] if reasoning_chunks else "",
    }


# Runs INSIDE the hermes container (sqlite3 available there) to export the
# state.db transcript to /tmp/hermes_messages.json. Kept as a string so it can
# be docker-cp'd and executed by the container's python; the host never imports
# sqlite3 (its python3 lacks _sqlite3). See recover_trajectory_from_hermes_state.
_HERMES_EXTRACT_SCRIPT = r'''
import json, sqlite3
db = "/root/.hermes/state.db"
out = {"messages": [], "session": {}}
try:
    c = sqlite3.connect("file:%s?mode=ro" % db, uri=True)
    try:
        try:
            rows = c.execute(
                "SELECT id,role,content,tool_call_id,tool_calls,tool_name,timestamp "
                "FROM messages WHERE COALESCE(active,1)=1 ORDER BY timestamp,id"
            ).fetchall()
        except sqlite3.OperationalError:
            rows = c.execute(
                "SELECT id,role,content,tool_call_id,tool_calls,tool_name,timestamp "
                "FROM messages ORDER BY timestamp,id"
            ).fetchall()
        for r in rows:
            out["messages"].append({
                "id": r[0], "role": r[1], "content": r[2], "tool_call_id": r[3],
                "tool_calls": r[4], "tool_name": r[5], "timestamp": r[6],
            })
        try:
            s = c.execute(
                "SELECT input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,"
                "reasoning_tokens,tool_call_count,message_count "
                "FROM sessions ORDER BY started_at DESC LIMIT 1"
            ).fetchone()
            if s:
                out["session"] = {
                    "input_tokens": s[0], "output_tokens": s[1], "cache_read_tokens": s[2],
                    "cache_write_tokens": s[3], "reasoning_tokens": s[4],
                    "tool_call_count": s[5], "message_count": s[6],
                }
        except sqlite3.OperationalError:
            pass
    finally:
        c.close()
except Exception:
    pass
with open("/tmp/hermes_messages.json", "w") as f:
    json.dump(out, f, default=str)
'''


def recover_trajectory_from_hermes_state(agent_dir: Path) -> dict[str, Any]:
    """Rebuild a trajectory from the Hermes session store.

    Hermes 0.16 keeps the canonical transcript in ~/.hermes/state.db (SQLite),
    not in the empty ~/.hermes/sessions/ JSON dir. collect_hermes_state_artifacts
    extracts it *inside the container* (which has sqlite3 — the eval host's
    python3 is built WITHOUT _sqlite3) into agent_dir/hermes_messages.json:
    ``{"messages":[{id,role,content,tool_call_id,tool_calls,tool_name,timestamp}],
    "session":{...token aggregates...}}``. This host-side function only reads that
    JSON (no sqlite3 dependency) and maps it into the report's tool_calls /
    tool_results shape so the Steps column + step cards populate (was always 0
    because write_agent_result emits empty toolCalls and no hermes recovery
    path existed).

    The stored tool_calls JSON is one of two shapes (see
    run_agent._flush_messages_to_session_db): flat ``[{"name","arguments"}]``
    (gemini-native path, no call id) or OpenAI-style
    ``[{"id","function":{"name","arguments"}}]``. Both are normalized here.
    Returns {} when no extract / no messages so write_trajectory falls through.
    """
    extract_path = agent_dir / "hermes_messages.json"
    if not extract_path.is_file():
        return {}
    try:
        extract = json.loads(extract_path.read_text(encoding="utf-8", errors="replace"))
    except (json.JSONDecodeError, OSError):
        return {}
    if not isinstance(extract, dict):
        return {}
    rows = extract.get("messages")
    if not isinstance(rows, list):
        return {}

    tool_calls: list[Any] = []
    tool_results: list[Any] = []
    messages_out: list[Any] = []
    response_chunks: list[str] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        mid = row.get("id")
        role = row.get("role")
        content = row.get("content")
        tcid = row.get("tool_call_id")
        tc_json = row.get("tool_calls")
        tname = row.get("tool_name")
        ts = row.get("timestamp")
        src = f"hermes_state.db:msg{mid}"
        messages_out.append({
            "role": role,
            "content_preview": (content or "")[:200] if isinstance(content, str) else "",
            "timestamp": ts,
            "_source": src,
        })
        if role == "assistant":
            if isinstance(content, str) and content.strip():
                response_chunks.append(content)
            if tc_json:
                calls = tc_json
                if isinstance(calls, str):
                    try:
                        calls = json.loads(calls)
                    except (json.JSONDecodeError, TypeError):
                        calls = []
                if isinstance(calls, list):
                    for i, call in enumerate(calls):
                        if not isinstance(call, dict):
                            continue
                        fn = call.get("function") if isinstance(call.get("function"), dict) else {}
                        name = fn.get("name") or call.get("name") or "tool"
                        args = fn.get("arguments") if fn.get("arguments") is not None else call.get("arguments")
                        cid = call.get("id") or call.get("tool_call_id") or f"{mid}:{i}"
                        tool_calls.append({
                            "id": cid,
                            "name": name,
                            "arguments": args,
                            "_source": f"{src}:call{i}",
                        })
        elif role == "tool":
            tool_results.append({
                "tool_call_id": tcid or "",
                "toolName": tname,
                "content": content,
                "_source": src,
            })

    session = extract.get("session") if isinstance(extract.get("session"), dict) else {}
    usage = dict(session) if session else {}

    if not any([tool_calls, tool_results, messages_out]):
        return {}
    recovered: dict[str, Any] = {
        "source": "hermes_state",
        "recovered_from_hermes_state": True,
        "recovered_source_files": ["hermes_state.db"],
        "tool_calls": tool_calls,
        "tool_results": tool_results,
        "tool_progress": [],
        "messages": messages_out,
        "usage": usage,
    }
    # Only supply response_text if result.json didn't already carry the (richer)
    # -Q stdout answer — keep the run.log answer authoritative when present.
    if response_chunks:
        recovered["hermes_state_last_assistant"] = response_chunks[-1][-60000:]
    return recovered


# ----- Lossy fallbacks for tasks whose state.db never got flushed -----------
#
# Hermes 0.16 flushes /root/.hermes/state.db ONCE on the exit path
# (run_agent._persist_session). A timeout, SIGKILL, OOM or hard crash leaves the
# DB empty and recover_trajectory_from_hermes_state returns nothing. For those
# tasks (plus every pre-0.16 run, which never had state.db) we mine the only
# two artifacts that always exist: run.log (Hermes UI render) and proxy_usage.json
# (per-task proxy/shim aggregates). These give us Steps + tool names + the
# inter-turn assistant text — but never tool arguments / tool_results (the UI
# never prints them).

_RUN_LOG_TOOL_RE = re.compile(r"^\s*┊\s+\S+\s+preparing\s+([A-Za-z_][A-Za-z0-9_]*)")
_RUN_LOG_PANEL_OPEN_RE = re.compile(r"^\s*╭.*Hermes")
_RUN_LOG_PANEL_CLOSE_RE = re.compile(r"^\s*╰.*╯")


def recover_trajectory_from_run_log(agent_dir: Path) -> dict[str, Any]:
    """Mine `agent/run.log` for tool names + assistant text in line order.

    The Hermes UI emits two markers we can match precisely:

    - ``  ┊ <emoji> preparing <tool_name>…``  → one tool call
    - ``╭─ ⚕ Hermes ───╮ <text…> ╰─────╯``     → one assistant message

    They appear in chronological order. We record tool_calls (name only, no
    args — the UI never prints arguments), assistant messages (the panel body
    with the 4-space indent stripped), interleaved by line position. usage
    comes from proxy_usage.json (per-task proxy/shim aggregates) when present.

    Lossy by design: args / tool_results stay empty. Coverage is still much
    higher than result.json alone (Steps + tool names + assistant reasoning).
    Returns {} when run.log is missing or yields no markers (e.g. gpt-5 logs
    only render the final Hermes panel; use the proxy_usage fallback for those).
    """
    log_path = agent_dir / "run.log"
    if not log_path.is_file():
        return {}
    try:
        text = log_path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return {}
    lines = text.splitlines()

    tool_calls: list[Any] = []
    messages_out: list[Any] = []
    response_chunks: list[str] = []
    in_panel = False
    panel_lines: list[str] = []
    counter = 0
    for ln in lines:
        if in_panel:
            if _RUN_LOG_PANEL_CLOSE_RE.match(ln):
                content = "\n".join(s[4:] if s.startswith("    ") else s for s in panel_lines).strip()
                if content:
                    messages_out.append({
                        "role": "assistant",
                        "content_preview": content[:200],
                        "_source": f"run.log:panel{counter}",
                    })
                    response_chunks.append(content)
                in_panel = False
                panel_lines = []
                counter += 1
            else:
                panel_lines.append(ln)
            continue
        if _RUN_LOG_PANEL_OPEN_RE.match(ln):
            in_panel = True
            continue
        m = _RUN_LOG_TOOL_RE.match(ln)
        if m:
            name = m.group(1)
            tool_calls.append({
                "id": f"run.log:{counter}",
                "name": name,
                "arguments": None,
                "_source": f"run.log:tool{counter}",
            })
            counter += 1

    if not tool_calls and not messages_out:
        return {}

    # Token usage from the proxy aggregates (best-effort).
    usage: dict[str, Any] = {}
    pu_path = agent_dir / "proxy_usage.json"
    if pu_path.is_file():
        try:
            pu = json.loads(pu_path.read_text(encoding="utf-8", errors="replace"))
            if isinstance(pu, dict):
                # Map proxy/shim field names → trajectory.usage shape.
                usage = {
                    "input_tokens": pu.get("input_uncached_tokens"),
                    "output_tokens": pu.get("output_tokens"),
                    "cache_read_tokens": pu.get("cache_read_tokens"),
                    "cache_write_tokens": pu.get("cache_write_tokens"),
                    "tool_call_count": len(tool_calls),
                    "message_count": len(messages_out),
                    "proxy_requests": pu.get("requests"),
                }
        except (json.JSONDecodeError, OSError):
            pass

    recovered: dict[str, Any] = {
        "source": "run_log",
        "recovered_from_run_log": True,
        "recovered_source_files": ["run.log"] + (["proxy_usage.json"] if usage else []),
        "tool_calls": tool_calls,
        "tool_results": [],  # never recoverable from the UI render
        "tool_progress": [],
        "messages": messages_out,
        "usage": usage,
        "_run_log_note": "lossy: tool args/results not recoverable from run.log; trajectory mined from UI render",
    }
    if response_chunks:
        recovered["run_log_last_assistant"] = response_chunks[-1][-60000:]
    return recovered


def recover_trajectory_from_proxy_usage(agent_dir: Path) -> dict[str, Any]:
    """Last-resort: synthesize a tool_calls list from proxy_usage.requests count.

    Used when neither state.db nor run.log gave us anything (e.g. gpt-5 tasks
    where Hermes UI only renders the final panel and the session never
    flushed). Generates N stub tool_calls so the Steps column populates;
    tool names are "<unknown>" so the report doesn't claim a specific tool
    when we don't know which one.
    """
    pu_path = agent_dir / "proxy_usage.json"
    if not pu_path.is_file():
        return {}
    try:
        pu = json.loads(pu_path.read_text(encoding="utf-8", errors="replace"))
    except (json.JSONDecodeError, OSError):
        return {}
    if not isinstance(pu, dict):
        return {}
    reqs = pu.get("requests")
    if not isinstance(reqs, int) or reqs <= 0:
        return {}
    tool_calls = [
        {"id": f"proxy:{i}", "name": "<unknown>", "arguments": None,
         "_source": f"proxy_usage.json:req{i}"}
        for i in range(reqs)
    ]
    usage = {
        "input_tokens": pu.get("input_uncached_tokens"),
        "output_tokens": pu.get("output_tokens"),
        "cache_read_tokens": pu.get("cache_read_tokens"),
        "cache_write_tokens": pu.get("cache_write_tokens"),
        "tool_call_count": reqs,
        "proxy_requests": reqs,
    }
    return {
        "source": "proxy_usage",
        "recovered_from_proxy_usage": True,
        "recovered_source_files": ["proxy_usage.json"],
        "tool_calls": tool_calls,
        "tool_results": [],
        "tool_progress": [],
        "messages": [],
        "usage": usage,
        "_proxy_usage_note": "step count only: proxy.requests; tool names unknown (model UI didn't render them)",
    }


def write_trajectory(result_path: Path, out_path: Path, agent_dir: Path | None = None) -> None:
    if not result_path.is_file():
        trajectory = {"error": "missing result.json"}
        if agent_dir is not None:
            recovered = recover_trajectory_from_accio_state(agent_dir)
            if recovered:
                trajectory.update(recovered)
        out_path.write_text(json.dumps(trajectory, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return
    root = _parse_result_root(result_path)
    raw_results = root.get("results")
    results_list = raw_results if isinstance(raw_results, list) else []
    chat_result = next((r for r in results_list if isinstance(r, dict) and r.get("actionType") == "chat"), None)
    result = chat_result or (results_list[-1] if results_list else root)
    if not isinstance(result, dict):
        result = {}
    trajectory = {
        "source": "result.json",
        "scenario": root.get("scenarioName") or result.get("scenarioName"),
        "passed_raw": root.get("passed", result.get("passed")),
        "duration_ms": root.get("totalDurationMs", result.get("durationMs")),
        "response_text": result.get("responseText", ""),
        "tool_calls": result.get("toolCalls", []),
        "tool_results": result.get("toolResults", []),
        "tool_progress": result.get("toolProgress", []),
        "iterations": result.get("iterations", []),
        "usage": result.get("totalUsage", {}),
    }
    # Whether the result.json had usable per-action signals. The OpenClaw
    # path always writes empty toolCalls/toolResults (see
    # write_agent_result), so we re-derive both from chat.jsonl below; the
    # garbled responseText extracted by walking every "text" key in the
    # transcript would otherwise short-circuit recovery.
    has_signals = bool(
        trajectory.get("tool_calls")
        or trajectory.get("tool_results")
        or trajectory.get("tool_progress")
        or trajectory.get("iterations")
    )
    if agent_dir is not None:
        recovered = recover_trajectory_from_accio_state(agent_dir)
        # Accio result.json often contains only the main agent control-plane
        # calls (task_create / sessions_spawn / task_update). The actual
        # browser subagent trajectory is archived under accio_state. Merge it
        # even when result.json has high-level signals so report.html can show
        # the operations that really happened inside the UI.
        if recovered and has_signals:
            trajectory["result_json_response_text"] = trajectory.get("response_text", "")
            trajectory["result_json_tool_calls"] = trajectory.get("tool_calls", [])
            trajectory["result_json_tool_results"] = trajectory.get("tool_results", [])
            trajectory["result_json_tool_progress"] = trajectory.get("tool_progress", [])
            trajectory["result_json_iterations"] = trajectory.get("iterations", [])
        if not recovered and not has_signals:
            # Hermes 0.16: rebuild from the SQLite state.db snapshot (the
            # openclaw/codex recoverers look for chat.jsonl / rollout files
            # hermes never writes, so try hermes first among the no-signal
            # fallbacks).
            recovered = recover_trajectory_from_hermes_state(agent_dir)
        if not recovered and not has_signals:
            # Hermes timeout / crash / pre-0.16: state.db empty or absent.
            # Mine the always-present run.log UI render for tool names +
            # assistant text (lossy: no args/results — see function docstring).
            recovered = recover_trajectory_from_run_log(agent_dir)
        if not recovered and not has_signals:
            # Last resort (e.g. gpt-5 which only renders the final panel):
            # use proxy_usage.requests as a Steps-only signal.
            recovered = recover_trajectory_from_proxy_usage(agent_dir)
        if not recovered and not has_signals:
            recovered = recover_trajectory_from_openclaw_chat(agent_dir)
        if not recovered:
            if not has_signals:
                recovered = recover_trajectory_from_codex_rollout(agent_dir)
        if recovered:
            trajectory.update(recovered)
    text = json.dumps(trajectory, ensure_ascii=False, indent=2) + "\n"
    # Model output can contain unpaired UTF-16 surrogates (e.g. a split emoji),
    # which utf-8 refuses to encode and would abort the run before the verifier.
    out_path.write_bytes(text.encode("utf-8", errors="replace"))
