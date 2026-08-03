from __future__ import annotations

import base64
import html
import json
import math
import mimetypes
import statistics
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


TEXT_SUFFIXES = {".csv", ".html", ".htm", ".json", ".md", ".txt", ".tsv", ".xml", ".yaml", ".yml"}
IMAGE_MIMES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
MAX_TEXT_PREVIEW = 16000
MAX_INLINE_IMAGE_BYTES = 2 * 1024 * 1024
MAX_TRAJECTORY_ARGUMENT_CHARS = 6000
MAX_TRAJECTORY_RESULT_CHARS = 8000
LEGACY_SOURCE_NAME = "".join(chr(code) for code in (87, 105, 108, 100, 67, 108, 97, 119))
LEGACY_SOURCE_BENCH = LEGACY_SOURCE_NAME + "Bench"
LEGACY_SOURCE_TOKEN = LEGACY_SOURCE_NAME.lower()
LEGACY_PUBLIC_TEXT_REPLACEMENTS = (
    (LEGACY_SOURCE_BENCH + "'s", "RealReplicaBench"),
    (LEGACY_SOURCE_BENCH, "RealReplicaBench"),
    (LEGACY_SOURCE_NAME, "B2B"),
    (LEGACY_SOURCE_TOKEN, "b2b"),
    # Prior brand of this same fork: OperateBench (2026-07-01) → RealReplicaBench.
    # Keeps HTML reports rendered from pre-rename summary.json on-brand.
    ("OperateBench", "RealReplicaBench"),
)


def _read_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def _read_text(path: Path, default: str = "", limit: int | None = None) -> str:
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return default
    return text[:limit] if limit is not None else text


def _yaml_top_scalar(text: str, key: str) -> str:
    prefix = f"{key}:"
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith(prefix):
            value = stripped[len(prefix) :].strip()
            return value.strip("\"'")
    return ""


def _public_text(value: Any) -> str:
    text = "" if value is None else str(value)
    for old, new in LEGACY_PUBLIC_TEXT_REPLACEMENTS:
        text = text.replace(old, new)
    return text


def _e(value: Any) -> str:
    return html.escape(_public_text(value))


def _attr(value: Any) -> str:
    return html.escape("" if value is None else str(value), quote=True)


def _rel(path: Path, root: Path) -> str:
    try:
        return str(path.relative_to(root))
    except ValueError:
        return str(path)


def _score(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(number) or math.isinf(number):
        return None
    return number


def _format_score(value: Any) -> str:
    number = _score(value)
    if number is None:
        return "&mdash;"
    return f"{number:.4f}".rstrip("0").rstrip(".")


def _is_v2_reward_schema(reward: Any) -> bool:
    if not isinstance(reward, dict):
        return False
    schema = reward.get("schema_version")
    return isinstance(schema, str) and schema.startswith("2.")


def _actual_checks_count(reward: Any) -> tuple[int, int]:
    """(passed, total) for **real** test.sh validation checks.

    v2 reward schema (``schema_version`` >= "2.0") carries
    ``checks_passed`` / ``checks_total`` / ``checks_breakdown`` at the top
    level — these are the actual test.sh check counts (e.g. 11/11, 17/17).
    v1 fallback uses the non-LLM entries inside ``validation_checks`` (a
    list of framework + script meta-checks). See cli.actual_checks_count.
    """
    if not isinstance(reward, dict):
        return (0, 0)
    if _is_v2_reward_schema(reward):
        cp = reward.get("checks_passed")
        ct = reward.get("checks_total")
        if isinstance(cp, int) and isinstance(ct, int) and ct > 0:
            return (cp, ct)
        breakdown = reward.get("checks_breakdown")
        if isinstance(breakdown, list) and breakdown:
            return (
                sum(1 for c in breakdown if isinstance(c, dict) and c.get("passed")),
                len(breakdown),
            )
        return (0, 0)
    checks = reward.get("validation_checks")
    checks = checks if isinstance(checks, list) else []
    other = [c for c in checks if isinstance(c, dict) and c.get("id") != "llm_rubric_judge"]
    return (sum(1 for c in other if c.get("passed")), len(other))


def _capacity_score(reward: Any) -> float | None:
    p, t = _actual_checks_count(reward)
    if t <= 0:
        return None
    return p / t


_CHECK_TYPE_ABBREV = {
    "deterministic_exact": ("det", "ct-det"),
    "llm_judge_boolean": ("llm", "ct-llm"),
}


def _check_type_breakdown(reward: Any) -> list[dict[str, Any]]:
    """Return per-check-type counts: [{'type': 'deterministic_exact',
    'abbrev': 'det', 'cls': 'ct-det', 'passed': 3, 'total': 5}, ...].

    Source: v2 ``checks_breakdown`` (each item has ``check_type``); for v1
    or missing types the bucket falls under ``'<other>'``.
    """
    if not isinstance(reward, dict):
        return []
    raw = None
    if _is_v2_reward_schema(reward):
        raw = reward.get("checks_breakdown")
    if not isinstance(raw, list):
        # v1 fallback or missing breakdown — try validation_checks
        raw = reward.get("validation_checks") if isinstance(reward, dict) else None
    if not isinstance(raw, list) or not raw:
        return []
    bucket: dict[str, dict[str, int]] = {}
    order: list[str] = []
    for c in raw:
        if not isinstance(c, dict):
            continue
        # Skip LLM judge meta-check from v1 final_reward.validation_checks
        # (which used id=='llm_rubric_judge'). v2 entries carry check_type.
        if c.get("id") == "llm_rubric_judge":
            continue
        t = c.get("check_type") or "<other>"
        if t not in bucket:
            bucket[t] = {"passed": 0, "total": 0}
            order.append(t)
        bucket[t]["total"] += 1
        if c.get("passed"):
            bucket[t]["passed"] += 1
    out = []
    for t in order:
        abbrev, cls = _CHECK_TYPE_ABBREV.get(t, (t[:4], "ct-other"))
        out.append({
            "type": t,
            "abbrev": abbrev,
            "cls": cls,
            "passed": bucket[t]["passed"],
            "total": bucket[t]["total"],
        })
    return out


def _format_checks_cell(reward: Any, total_passed: int, total: int) -> str:
    """Render the Checks column: total + per-type chips."""
    if total <= 0:
        return ""
    breakdown = _check_type_breakdown(reward)
    chips_html = ""
    # Always render per-type chips so the reader can see whether failures
    # were deterministic or LLM-judge, even when the task is single-type
    # and fully passing (the chip confirms which type at a glance).
    if breakdown:
        chips = []
        for b in breakdown:
            cls = b["cls"]
            if b["passed"] == b["total"]:
                cls += " fully-passed"
            elif b["passed"] == 0:
                cls += " has-fail"
            type_name = _e(b["type"])
            abbrev = b["abbrev"]
            passed = b["passed"]
            total_b = b["total"]
            chips.append(
                f"<span class='check-type-chip {cls}' title='{type_name}'>"
                f"{passed}/{total_b} {abbrev}</span>"
            )
        chips_html = f"<span class='checks-breakdown'>{''.join(chips)}</span>"
    return (
        f"<span class='checks-cell'>"
        f"<span class='checks-total'>{total_passed}/{total}</span>"
        f"{chips_html}</span>"
    )


def _check_breakdown(reward: Any) -> dict[str, Any]:
    checks = reward.get("validation_checks") if isinstance(reward, dict) else None
    checks = checks if isinstance(checks, list) else []
    llm_check = next(
        (
            check
            for check in checks
            if isinstance(check, dict) and check.get("id") == "llm_rubric_judge"
        ),
        None,
    )
    actual_passed, actual_total = _actual_checks_count(reward)
    return {
        "llm_judge_score": llm_check.get("score") if isinstance(llm_check, dict) else None,
        "llm_check_passed": llm_check.get("passed") if isinstance(llm_check, dict) else None,
        # Back-compat field names that now hold *real* test.sh counts for v2.
        "other_checks_passed": actual_passed,
        "other_checks_total": actual_total,
        "capacity_score": _capacity_score(reward),
    }


def _format_check(value: Any) -> str:
    if value is None:
        return "&mdash;"
    return "pass" if bool(value) else "fail"


def _format_duration(seconds: Any) -> str:
    number = _score(seconds)
    if number is None:
        return "&mdash;"
    if number < 60:
        return f"{number:.1f}s"
    minutes, sec = divmod(int(round(number)), 60)
    hours, minutes = divmod(minutes, 60)
    if hours:
        return f"{hours}h {minutes}m {sec}s"
    return f"{minutes}m {sec}s"


def _format_timestamp(value: Any) -> str:
    number = _score(value)
    if number is None:
        return str(value or "")
    if number > 10_000_000_000:
        number = number / 1000
    try:
        return datetime.fromtimestamp(number, tz=timezone.utc).isoformat()
    except (OSError, OverflowError, ValueError):
        return str(value)


def _clip_text(text: Any, limit: int) -> tuple[str, bool]:
    value = "" if text is None else str(text)
    if len(value) <= limit:
        return value, False
    return value[:limit], True


def _json_preview(value: Any, limit: int) -> tuple[str, bool]:
    if isinstance(value, str):
        return _clip_text(value, limit)
    try:
        text = json.dumps(value, ensure_ascii=False, indent=2)
    except TypeError:
        text = str(value)
    return _clip_text(text, limit)


def _reward_score(reward: Any) -> float | None:
    if not isinstance(reward, dict):
        return None
    return _score(reward.get("score", reward.get("reward")))


def _row_final_score(row: dict[str, Any]) -> Any:
    value = row.get("final_score")
    return row.get("score") if value is None else value


def _is_reward_one(row: dict[str, Any]) -> bool:
    score = _score(_row_final_score(row))
    return score == 1.0


def _status(row: dict[str, Any]) -> str:
    rc = row.get("agent_exec_returncode")
    if rc not in (0, None):
        # SIGTERM (143 = 128+15, or -15 on some runners) is how the harness's
        # early_terminate path proactively kills the agent once the mock
        # signals completion (e.g. session status -> 'submitted'). It is
        # expected, not an exception. Treat the run as success/failure based
        # on the verifier verdict (`passed`) just like a normal exit-0 run.
        if rc not in (143, -15):
            return "exception"
    return "success" if row.get("passed") else "failure"


def _collect_outputs(run_dir: Path) -> list[Path]:
    output_dir = run_dir / "workspace" / "outputs"
    if not output_dir.exists():
        return []
    return sorted(path for path in output_dir.rglob("*") if path.is_file())


def _collect_verifier_files(run_dir: Path) -> list[Path]:
    verifier_dir = run_dir / "verifier"
    if not verifier_dir.exists():
        return []
    return sorted(path for path in verifier_dir.rglob("*") if path.is_file())


def _stable_json_key(value: Any) -> str:
    try:
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    except TypeError:
        return repr(value)


def _trajectory_item_id(item: dict[str, Any]) -> str:
    return str(item.get("id") or item.get("toolCallId") or item.get("tool_call_id") or "")


def _dedupe_items(items: Any, key_fn: Any) -> list[Any]:
    if not isinstance(items, list):
        return []
    seen: set[Any] = set()
    out: list[Any] = []
    for item in items:
        key = key_fn(item)
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out


def _dedupe_tool_calls(calls: Any) -> list[Any]:
    def key_fn(item: Any) -> tuple[str, str]:
        if not isinstance(item, dict):
            return ("value", _stable_json_key(item))
        item_id = _trajectory_item_id(item)
        if item_id:
            return ("id", item_id)
        content = {key: value for key, value in item.items() if key != "_source"}
        return ("value", _stable_json_key(content))

    return _dedupe_items(calls, key_fn)


def _dedupe_tool_results(results: Any) -> list[Any]:
    def key_fn(item: Any) -> tuple[str, str, str]:
        if not isinstance(item, dict):
            return ("value", "", _stable_json_key(item))
        item_id = str(item.get("toolCallId") or item.get("tool_call_id") or item.get("source_call_id") or "")
        if item_id:
            return ("id", item_id, _stable_json_key(item.get("content")))
        content = {key: value for key, value in item.items() if key != "_source"}
        return ("value", "", _stable_json_key(content))

    return _dedupe_items(results, key_fn)


def _dedupe_tool_progress(progress: Any) -> list[Any]:
    def key_fn(item: Any) -> tuple[str, str]:
        if not isinstance(item, dict):
            return ("value", _stable_json_key(item))
        content = {key: value for key, value in item.items() if key != "_source"}
        return ("value", _stable_json_key(content))

    return _dedupe_items(progress, key_fn)


def _dedupe_messages(messages: Any) -> list[Any]:
    def key_fn(item: Any) -> tuple[str, str, str, str, str]:
        if not isinstance(item, dict):
            return ("value", "", "", "", _stable_json_key(item))
        return (
            str(item.get("role") or ""),
            str(item.get("message_type") or ""),
            str(item.get("tool_name") or ""),
            str(item.get("timestamp") or ""),
            str(item.get("content_preview") or ""),
        )

    return _dedupe_items(messages, key_fn)


def _trajectory_counts(run_dir: Path) -> dict[str, int]:
    trajectory = _read_json(run_dir / "agent" / "trajectory.json", {})
    if not isinstance(trajectory, dict):
        return {"steps": 0, "tool_calls": 0, "tool_results": 0, "messages": 0}
    tool_calls = _dedupe_tool_calls(trajectory.get("tool_calls", []))
    tool_results = _dedupe_tool_results(trajectory.get("tool_results", []))
    messages = _dedupe_messages(trajectory.get("messages", []))
    return {
        "steps": len(tool_calls),
        "tool_calls": len(tool_calls),
        "tool_results": len(tool_results),
        "messages": len(messages),
    }


def _agent_answer(run_dir: Path) -> str:
    trajectory = _read_json(run_dir / "agent" / "trajectory.json", {})
    if isinstance(trajectory, dict) and trajectory.get("response_text"):
        return str(trajectory["response_text"])
    result = _read_json(run_dir / "agent" / "result.json", {})
    root = result[0] if isinstance(result, list) and result else result
    if not isinstance(root, dict):
        return ""
    results = root.get("results")
    if isinstance(results, list):
        for item in results:
            if isinstance(item, dict) and item.get("actionType") == "chat":
                return str(item.get("responseText") or "")
    return str(root.get("responseText") or "")


def _task_rows(instance_dir: Path, summary: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for row in summary.get("results", []):
        if not isinstance(row, dict):
            continue
        run_dir = Path(str(row.get("run_dir") or ""))
        if not run_dir.is_absolute():
            run_dir = instance_dir / run_dir
        # If summary.json was produced on a remote box (e.g. eval_sandbox
        # ECS), row['run_dir'] is an absolute path that does not exist
        # locally. Fall back to instance_dir/tasks/<run_id>, which is the
        # canonical layout under any yaml-batch instance dir.
        if not run_dir.is_dir():
            fallback = instance_dir / "tasks" / (row.get("run_id") or "")
            if fallback.is_dir():
                run_dir = fallback
        manifest = _read_json(run_dir / "manifest.json", {})
        reward = _read_json(run_dir / "verifier" / "final_reward.json", manifest.get("reward", {}))
        verifier_reward = _read_json(run_dir / "verifier" / "reward.json", {})
        check_breakdown = _check_breakdown(reward)
        outputs = _collect_outputs(run_dir)
        verifier_files = _collect_verifier_files(run_dir)
        trajectory_counts = _trajectory_counts(run_dir)
        rows.append(
            {
                **row,
                "run_dir_path": run_dir,
                "manifest": manifest,
                "reward_json": reward,
                "verifier_reward_json": verifier_reward,
                "final_score": _reward_score(reward),
                "verifier_score": _reward_score(verifier_reward),
                "raw_score": reward.get("raw_score") if isinstance(reward, dict) else None,
                "check_summary": reward.get("check_summary", {}) if isinstance(reward, dict) else {},
                **check_breakdown,
                "outputs": outputs,
                "verifier_files": verifier_files,
                "trajectory_counts": trajectory_counts,
                "agent_answer": _agent_answer(run_dir),
                "status": _status(row),
            }
        )
    return rows


def _mini_bar(success: int, failure: int, exception: int, total: int) -> str:
    if total <= 0:
        return "<div class='mini-bar'></div>"
    parts = []
    for cls, count, label in (
        ("seg-success", success, "Success"),
        ("seg-failure", failure, "Failure"),
        ("seg-exception", exception, "Exception"),
    ):
        if count:
            parts.append(f"<span class='{cls}' style='width:{100 * count / total:.2f}%' title='{label}: {count}'></span>")
    return "<div class='mini-bar'>" + "".join(parts) + "</div>"


def _score_distribution(rows: list[dict[str, Any]]) -> str:
    buckets = [0] * 10
    for row in rows:
        score = _score(_row_final_score(row))
        if score is None:
            continue
        index = min(9, max(0, int(score * 10)))
        buckets[index] += 1
    if not any(buckets):
        return "<p class='placeholder-note'>No score data yet.</p>"
    width = 460
    height = 150
    left = 34
    bottom = 116
    max_count = max(buckets)
    bar_gap = 4
    bar_w = (width - left - 16 - bar_gap * 9) / 10
    parts = [
        f"<svg class='chart' width='{width}' height='{height}' viewBox='0 0 {width} {height}' role='img' aria-label='score distribution'>",
        f"<line x1='{left}' y1='14' x2='{left}' y2='{bottom}' stroke='#cbd5e1'/>",
        f"<line x1='{left}' y1='{bottom}' x2='{width - 10}' y2='{bottom}' stroke='#cbd5e1'/>",
    ]
    for idx, count in enumerate(buckets):
        x = left + 8 + idx * (bar_w + bar_gap)
        bar_h = 0 if max_count == 0 else (count / max_count) * 92
        y = bottom - bar_h
        cls = "success" if idx >= 7 else "failure" if idx == 0 else "primary"
        label = f"{idx / 10:.1f}-{(idx + 1) / 10:.1f}"
        parts.append(f"<rect x='{x:.1f}' y='{y:.1f}' width='{bar_w:.1f}' height='{bar_h:.1f}' rx='2' class='{cls}'><title>{label}: {count}</title></rect>")
        parts.append(f"<text x='{x + bar_w / 2:.1f}' y='136' text-anchor='middle' font-size='9' fill='#94a3b8'>{idx/10:.1f}</text>")
    parts.append("</svg>")
    return "\n".join(parts)


def _file_preview(path: Path, instance_dir: Path) -> str:
    rel = _rel(path, instance_dir)
    size = path.stat().st_size
    mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    suffix = path.suffix.lower()
    header = (
        f"<div class='artifact-head'><a href='{_attr(rel)}'>{_e(path.name)}</a>"
        f"<span>{_e(mime)}</span><span>{size} bytes</span></div>"
    )
    if mime in IMAGE_MIMES and size <= MAX_INLINE_IMAGE_BYTES:
        data = base64.b64encode(path.read_bytes()).decode("ascii")
        return header + f"<img class='artifact-image' src='data:{_attr(mime)};base64,{data}' alt='{_attr(path.name)}'>"
    if mime.startswith("text/") or suffix in TEXT_SUFFIXES:
        text = _read_text(path, limit=MAX_TEXT_PREVIEW)
        if suffix == ".json":
            parsed = _read_json(path, None)
            if parsed is not None:
                text = json.dumps(parsed, ensure_ascii=False, indent=2)[:MAX_TEXT_PREVIEW]
        clipped = path.stat().st_size > len(text.encode("utf-8", errors="replace"))
        clip_suffix = "\n... clipped ..." if clipped else ""
        return header + f"<pre>{_e(text)}{clip_suffix}</pre>"
    if suffix == ".pdf":
        return header + f"<iframe class='artifact-frame' src='{_attr(rel)}'></iframe>"
    return header + "<p class='placeholder-note'>Binary artifact. Open the linked file to inspect it.</p>"


def _artifact_blocks(instance_dir: Path, outputs: list[Path], empty_message: str = "No output files were produced.") -> str:
    if not outputs:
        return f"<p class='placeholder-note'>{_e(empty_message)}</p>"
    return "\n".join(f"<div class='artifact-card'>{_file_preview(path, instance_dir)}</div>" for path in outputs)


def _call_id(call: dict[str, Any]) -> str:
    return str(call.get("id") or call.get("toolCallId") or call.get("tool_call_id") or "")


def _call_name(call: dict[str, Any]) -> str:
    return str(call.get("name") or call.get("toolName") or call.get("tool_name") or "tool")


def _call_arguments(call: dict[str, Any]) -> Any:
    for key in ("arguments", "args", "input", "parameters"):
        if key in call:
            return call.get(key)
    return {key: value for key, value in call.items() if key not in {"id", "name", "toolName", "tool_call_id", "_source"}}


def _tool_results_by_call_id(trajectory: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    out: dict[str, list[dict[str, Any]]] = {}
    for result in _dedupe_tool_results(trajectory.get("tool_results", [])):
        if not isinstance(result, dict):
            continue
        call_id = str(result.get("toolCallId") or result.get("tool_call_id") or result.get("source_call_id") or "")
        if call_id:
            out.setdefault(call_id, []).append(result)
    return out


def _message_timestamp_by_source(trajectory: dict[str, Any]) -> dict[str, str]:
    out: dict[str, str] = {}
    messages = trajectory.get("messages", [])
    if not isinstance(messages, list):
        return out
    for message in messages:
        if not isinstance(message, dict):
            continue
        source = str(message.get("_source") or "")
        timestamp = message.get("timestamp")
        if source and timestamp is not None:
            out[source] = _format_timestamp(timestamp)
    return out


def _render_tool_result(result: dict[str, Any], index: int) -> str:
    content = result.get("content")
    if isinstance(content, str):
        try:
            parsed = json.loads(content)
        except json.JSONDecodeError:
            parsed = None
        preview, clipped = _json_preview(parsed if parsed is not None else content, MAX_TRAJECTORY_RESULT_CHARS)
    else:
        preview, clipped = _json_preview(content, MAX_TRAJECTORY_RESULT_CHARS)
    meta = []
    if result.get("toolName"):
        meta.append(str(result.get("toolName")))
    if result.get("_source"):
        meta.append(str(result.get("_source")))
    meta_text = " &middot; ".join(_e(item) for item in meta)
    clip_suffix = "\n... clipped ..." if clipped else ""
    return (
        f"<div class='observation-result'>"
        f"<div class='observation-meta'>result {index}{' &middot; ' + meta_text if meta_text else ''}</div>"
        f"<pre><code>{_e(preview)}{clip_suffix}</code></pre>"
        f"</div>"
    )


def _trajectory_steps(trajectory: dict[str, Any]) -> str:
    calls = _dedupe_tool_calls(trajectory.get("tool_calls", []))
    if not calls:
        return "<p class='placeholder-note'>No tool calls were captured.</p>"
    results_by_id = _tool_results_by_call_id(trajectory)
    timestamps_by_source = _message_timestamp_by_source(trajectory)
    blocks: list[str] = []
    for index, call in enumerate(calls, start=1):
        if not isinstance(call, dict):
            continue
        call_id = _call_id(call)
        name = _call_name(call)
        args_preview, args_clipped = _json_preview(_call_arguments(call), MAX_TRAJECTORY_ARGUMENT_CHARS)
        source = str(call.get("_source") or "")
        meta_parts = []
        if source in timestamps_by_source:
            meta_parts.append(timestamps_by_source[source])
        if call_id:
            meta_parts.append(f"id: {call_id}")
        if source:
            meta_parts.append(source)
        meta = " &middot; ".join(_e(part) for part in meta_parts)
        matched_results = results_by_id.get(call_id, []) if call_id else []
        observation_html = ""
        if matched_results:
            observation_html = (
                "<div><strong>Observation results:</strong>"
                + "".join(_render_tool_result(result, result_index) for result_index, result in enumerate(matched_results, start=1))
                + "</div>"
            )
        else:
            observation_html = "<p class='placeholder-note'>No matching tool result captured for this call.</p>"
        args_clip_suffix = "\n... clipped ..." if args_clipped else ""
        blocks.append(
            f"""
<div class="step-card">
  <div class="step-header">
    <span class="step-id">#{index}</span>
    <span class="source-badge source-agent">tool call</span>
    <span class="step-meta">{meta}</span>
  </div>
  <div class="step-body">
    <div><strong>Tool call:</strong>
      <div class="tool-call"><span class="fn-name">{_e(name)}</span><pre><code>{_e(args_preview)}{args_clip_suffix}</code></pre></div>
    </div>
    {observation_html}
  </div>
</div>
"""
        )
    return "\n".join(blocks) if blocks else "<p class='placeholder-note'>No renderable tool calls were captured.</p>"


def _trajectory_block(instance_dir: Path, run_dir: Path) -> str:
    trajectory_path = run_dir / "agent" / "trajectory.json"
    if not trajectory_path.is_file():
        return "<p class='placeholder-note'>No trajectory.json was captured.</p>"
    trajectory = _read_json(trajectory_path, {})
    if not isinstance(trajectory, dict):
        return _file_preview(trajectory_path, instance_dir)

    counts = {
        "tool calls": len(_dedupe_tool_calls(trajectory.get("tool_calls", []))),
        "tool results": len(_dedupe_tool_results(trajectory.get("tool_results", []))),
        "tool progress": len(_dedupe_tool_progress(trajectory.get("tool_progress", []))),
        "messages": len(_dedupe_messages(trajectory.get("messages", []))),
    }
    source_label = {
        "accio_state": "Accio state",
        "openclaw_chat": "OpenClaw chat",
        "codex_rollout": "Codex rollout",
        "hermes_state": "Hermes state.db",
        "run_log": "Hermes run.log (lossy)",
        "proxy_usage": "Hermes proxy_usage (steps only)",
        "result.json": "result.json",
    }.get(str(trajectory.get("source") or ""), "Accio state" if trajectory.get("recovered_from_accio_state") else "result.json")
    summary_rows = [
        ("Source", source_label),
        ("Scenario", trajectory.get("scenario")),
        ("Agent runner passed raw", trajectory.get("passed_raw")),
        ("Duration", _format_duration((_score(trajectory.get("duration_ms")) or 0) / 1000 if trajectory.get("duration_ms") is not None else None)),
        ("Tool calls", counts["tool calls"]),
        ("Tool results", counts["tool results"]),
        ("Tool progress", counts["tool progress"]),
        ("Messages", counts["messages"]),
    ]
    source_files = trajectory.get("recovered_source_files")
    if isinstance(source_files, list) and source_files:
        summary_rows.append(("Recovered files", ", ".join(str(item) for item in source_files[:6]) + (" ..." if len(source_files) > 6 else "")))
    table = "<table class='summary'><tbody>" + "".join(
        f"<tr><td>{_e(key)}</td><td>{_e(value)}</td></tr>" for key, value in summary_rows
    ) + "</tbody></table>"
    if trajectory.get("result_json_tool_calls"):
        table += (
            "<p class='placeholder-note'>"
            "This trajectory was merged from Accio state so subagent/browser calls are shown; "
            "result.json high-level control calls were preserved inside trajectory.json under result_json_* keys."
            "</p>"
        )
    return table + _trajectory_steps(trajectory)


def _trial_details(instance_dir: Path, rows: list[dict[str, Any]]) -> str:
    blocks = []
    for row in rows:
        run_dir = row["run_dir_path"]
        reward = row.get("reward_json", {})
        verifier_reward = row.get("verifier_reward_json", {})
        summary = reward.get("summary") if isinstance(reward, dict) else None
        summary = summary or row.get("summary") or ""
        status = row["status"]
        strengths = reward.get("strengths") if isinstance(reward, dict) else None
        weaknesses = reward.get("weaknesses") if isinstance(reward, dict) else None
        criteria = reward.get("criteria") if isinstance(reward, dict) else None
        validation_checks = reward.get("validation_checks") if isinstance(reward, dict) else None
        check_summary = reward.get("check_summary", {}) if isinstance(reward, dict) else {}
        checks_text = (
            f"{check_summary.get('passed')}/{check_summary.get('total')}"
            if isinstance(check_summary, dict) and check_summary.get("total") is not None
            else ""
        )
        other_checks_text = (
            f"{row.get('other_checks_passed')}/{row.get('other_checks_total')}"
            if row.get("other_checks_total") is not None
            else ""
        )
        cap_val = row.get("capacity_score")
        capacity_text = f"{cap_val:.4f}" if isinstance(cap_val, (int, float)) else "—"
        validation_checks_html = ""
        if isinstance(validation_checks, list) and validation_checks:
            items = "".join(
                f"<tr><td>{_e(c.get('id'))}</td><td>{_e(c.get('passed'))}</td><td>{_format_score(c.get('score'))}</td><td>{_e(c.get('reason'))}</td></tr>"
                for c in validation_checks
                if isinstance(c, dict)
            )
            validation_checks_html = f"<h4>Validation checks</h4><table class='summary'><tbody>{items}</tbody></table>"
        criteria_html = ""
        if isinstance(criteria, list) and criteria:
            items = "".join(
                f"<tr><td>{_e(c.get('id'))}</td><td>{_format_score(c.get('score'))}</td><td>{_e(c.get('reason'))}</td></tr>"
                for c in criteria
                if isinstance(c, dict)
            )
            criteria_html = f"<table class='summary'><tbody>{items}</tbody></table>"
        bullets = ""
        for title, values in (("Strengths", strengths), ("Weaknesses", weaknesses)):
            if isinstance(values, list) and values:
                bullets += f"<h4>{title}</h4><ul>" + "".join(f"<li>{_e(item)}</li>" for item in values[:10]) + "</ul>"
        links = [
            ("manifest", run_dir / "manifest.json"),
            ("agent result", run_dir / "agent" / "result.json"),
            ("trajectory", run_dir / "agent" / "trajectory.json"),
            ("agent log", run_dir / "agent" / "run.log"),
            ("verifier log", run_dir / "verifier" / "verifier.log"),
            ("verifier reward", run_dir / "verifier" / "reward.json"),
            ("final reward", run_dir / "verifier" / "final_reward.json"),
            ("screenshots", run_dir / "screenshots"),
            ("accio state", run_dir / "agent" / "accio_state"),
            ("workspace", run_dir / "workspace"),
        ]
        link_html = " ".join(
            f"<a href='{_attr(_rel(path, instance_dir))}'>{label}</a>"
            for label, path in links
            if path.exists()
        )
        blocks.append(
            f"""
<details class="trial-details" id="trial-{_attr(row.get('index'))}">
  <summary>
    <div class="trial-summary-left">
      <span class="badge badge-{status}">{status}</span>
      <span class="trial-name">{_e(row.get('index'))}. {_e(row.get('task_id'))}</span>
    </div>
    <div class="reward-pair"><span class="reward-value">checks: {_e(other_checks_text)}</span><span class="reward-value">capacity: {_e(capacity_text)}</span><span class="reward-value">reward: {_format_score(_row_final_score(row))}</span></div>
  </summary>
  <div class="trial-body">
    <section class="panel">
      <h2>Summary</h2>
      <table class="summary"><tbody>
        <tr><td>Run directory</td><td><code>{_e(_rel(run_dir, instance_dir))}</code></td></tr>
        <tr><td>LLM judge raw score</td><td>{_format_score(row.get('llm_judge_score'))}</td></tr>
        <tr><td>LLM check</td><td>{_format_check(row.get('llm_check_passed'))}</td></tr>
        <tr><td>Test.sh checks</td><td>{_e(other_checks_text)}</td></tr>
        <tr><td>Capacity score</td><td>{_e(capacity_text)} <span style="color:#6b7280;font-size:12px;">(checks_passed / checks_total)</span></td></tr>
        <tr><td>Final reward</td><td>{_format_score(_row_final_score(row))} <span style="color:#6b7280;font-size:12px;">(binary: all checks must pass)</span></td></tr>
        <tr><td>Raw verifier reward</td><td>{_format_score(row.get('verifier_score'))}</td></tr>
        <tr><td>Raw verifier passed</td><td>{_e(verifier_reward.get('passed') if isinstance(verifier_reward, dict) else None)}</td></tr>
        <tr><td>Return code</td><td>{_e(row.get('returncode'))}</td></tr>
        <tr><td>Agent exec return code</td><td>{_e(row.get('agent_exec_returncode'))}</td></tr>
        <tr><td>Verifier exit</td><td>{_e(row.get('verifier_exit'))}</td></tr>
        <tr><td>Duration</td><td>{_format_duration(row.get('elapsed_sec'))}</td></tr>
        <tr><td>Outputs</td><td>{len(row.get('outputs', []))}</td></tr>
        <tr><td>Verifier files</td><td>{len(row.get('verifier_files', []))}</td></tr>
        <tr><td>Trajectory steps</td><td>{_e(row.get('trajectory_counts', {}).get('steps'))}</td></tr>
        <tr><td>Container removed</td><td>{_e(row.get('container_removed'))}</td></tr>
      </tbody></table>
      <p class="placeholder-note">{_e(summary)}</p>
      {validation_checks_html}
      {bullets}
      {criteria_html}
    </section>
    <section class="panel">
      <h2>Agent Final Text</h2>
      <p class="placeholder-note">Raw agent self-report only. Treat verifier checks, final state, saved artifacts, and trajectory tool results as authoritative when they disagree with this text.</p>
      <pre>{_e(row.get('agent_answer') or 'No final answer text captured.')}</pre>
    </section>
    <section class="panel">
      <h2>Trajectory</h2>
      {_trajectory_block(instance_dir, run_dir)}
    </section>
    <section class="panel">
      <h2>Output Files ({len(row.get('outputs', []))})</h2>
      {_artifact_blocks(instance_dir, row.get('outputs', []))}
    </section>
    <section class="panel">
      <h2>Verifier Files ({len(row.get('verifier_files', []))})</h2>
      {_artifact_blocks(instance_dir, row.get('verifier_files', []), 'No verifier files were captured.')}
    </section>
    <section class="panel">
      <h2>Run Files</h2>
      <p class="links">{link_html}</p>
    </section>
  </div>
</details>
"""
        )
    return "\n".join(blocks) if blocks else "<p class='placeholder-note'>No trials recorded yet.</p>"


CSS = """
:root {
  --c-bg: #f1f5f9; --c-surface: #ffffff; --c-surface-2: #f8fafc;
  --c-border: #e2e8f0; --c-border-strong: #cbd5e1;
  --c-text: #0f172a; --c-text-muted: #475569; --c-text-faint: #94a3b8;
  --c-primary: #4f46e5; --c-primary-soft: #eef2ff;
  --c-success: #10b981; --c-success-soft: #ecfdf5;
  --c-failure: #ef4444; --c-failure-soft: #fef2f2;
  --c-warning: #f59e0b; --c-warning-soft: #fffbeb;
  --c-neutral-soft: #f1f5f9;
  --shadow-sm: 0 1px 2px rgba(15,23,42,0.04), 0 1px 3px rgba(15,23,42,0.06);
  --radius-md: 12px; --radius-sm: 8px; --radius-pill: 999px;
  --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
  --font-mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: var(--c-bg); color: var(--c-text); }
body { font-family: var(--font-sans); font-size: 14.5px; line-height: 1.55; -webkit-font-smoothing: antialiased; }
main.report { max-width: 1200px; margin: 24px auto; padding: 0 20px 64px; }
h1, h2, h3, h4 { letter-spacing: -0.02em; font-weight: 650; }
h1 { font-size: 1.75rem; } h2 { font-size: 1.15rem; } h3 { font-size: 1rem; }
a { color: var(--c-primary); text-decoration: none; } a:hover { text-decoration: underline; }
.hero { background: linear-gradient(180deg, var(--c-surface), var(--c-surface-2)); border: 1px solid var(--c-border); border-radius: var(--radius-md); box-shadow: var(--shadow-sm); padding: 22px 26px; margin-bottom: 16px; display: flex; flex-direction: column; gap: 12px; }
.status-bar { border-radius: var(--radius-md) var(--radius-md) 0 0; height: 4px; margin: -22px -26px 14px; }
.status-green { background: var(--c-success); } .status-yellow { background: var(--c-warning); } .status-red { background: var(--c-failure); }
.hero-top { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; flex-wrap:wrap; }
.hero-title { font-size:1.7rem; word-break:break-all; }
.hero-eyebrow { font-size:.75rem; text-transform:uppercase; letter-spacing:.08em; color:var(--c-text-faint); margin-bottom:4px; }
.hero-meta { display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:10px 24px; margin-top:6px; font-size:.86rem; }
.hero-meta .k { color:var(--c-text-faint); text-transform:uppercase; font-size:.7rem; letter-spacing:.06em; display:block; margin-bottom:2px; }
.hero-meta .v { color:var(--c-text); font-variant-numeric:tabular-nums; font-weight:500; word-break:break-word; }
.badge { display:inline-flex; align-items:center; gap:6px; padding:3px 10px; border-radius:var(--radius-pill); font-weight:600; font-size:.78rem; white-space:nowrap; border:1px solid transparent; font-variant-numeric:tabular-nums; }
.badge::before { content:""; width:6px; height:6px; border-radius:50%; background:currentColor; display:inline-block; opacity:.85; }
.badge-success { background:var(--c-success-soft); color:#047857; border-color:rgba(16,185,129,.25); }
.badge-failure { background:var(--c-failure-soft); color:#b91c1c; border-color:rgba(239,68,68,.25); }
.badge-exception { background:var(--c-warning-soft); color:#b45309; border-color:rgba(245,158,11,.3); }
.badge-partial { background:var(--c-primary-soft); color:#4338ca; border-color:rgba(79,70,229,.25); }
.tabs { position:sticky; top:0; z-index:10; display:flex; gap:4px; background:var(--c-bg); padding:8px 0 6px; border-bottom:1px solid var(--c-border); margin:4px 0 18px; }
.tab-btn { background:transparent; border:0; padding:8px 16px; font:inherit; font-weight:600; font-size:.92rem; color:var(--c-text-muted); border-radius:var(--radius-sm) var(--radius-sm) 0 0; cursor:pointer; border-bottom:2px solid transparent; }
.tab-btn:hover { color:var(--c-text); background:var(--c-surface); }
.tab-btn[aria-selected="true"] { color:var(--c-primary); border-bottom-color:var(--c-primary); }
section[data-tab] { display:none; } section[data-tab][data-active="true"] { display:block; }
section.panel { background:var(--c-surface); border:1px solid var(--c-border); border-radius:var(--radius-md); box-shadow:var(--shadow-sm); padding:18px 22px; margin-bottom:18px; }
section.panel > h2 { display:flex; align-items:center; gap:8px; margin-bottom:14px; }
section.panel > h2::before { content:""; width:4px; height:18px; background:var(--c-primary); border-radius:2px; display:inline-block; }
.tile-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:12px; margin-bottom:16px; }
.tile { background:var(--c-surface); border:1px solid var(--c-border); border-radius:var(--radius-md); box-shadow:var(--shadow-sm); padding:16px 18px; display:flex; flex-direction:column; gap:4px; }
.tile-label { font-size:.72rem; letter-spacing:.06em; text-transform:uppercase; color:var(--c-text-faint); font-weight:600; }
.tile-value { font-size:1.7rem; font-weight:700; letter-spacing:-.02em; color:var(--c-text); font-variant-numeric:tabular-nums; }
.tile-sub { font-size:.78rem; color:var(--c-text-muted); }
.tile-primary .tile-value { color:var(--c-primary); } .tile-success .tile-value { color:var(--c-success); } .tile-failure .tile-value { color:var(--c-failure); }
.mini-bar { display:flex; height:6px; border-radius:var(--radius-pill); overflow:hidden; background:var(--c-neutral-soft); margin-top:6px; }
.mini-bar > span { display:block; height:100%; } .seg-success { background:var(--c-success); } .seg-failure { background:var(--c-failure); } .seg-exception { background:var(--c-warning); }
.dash-row { display:grid; grid-template-columns:minmax(280px,1fr) minmax(280px,1fr); gap:16px; margin-bottom:16px; }
.dash-card { background:var(--c-surface); border:1px solid var(--c-border); border-radius:var(--radius-md); box-shadow:var(--shadow-sm); padding:18px 20px; }
svg.chart { display:block; max-width:100%; height:auto; } rect.primary { fill:var(--c-primary); } rect.success { fill:var(--c-success); } rect.failure { fill:var(--c-failure); }
.toolbar { display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin-bottom:12px; }
.toolbar input.filter { flex:1 1 280px; min-width:220px; padding:8px 12px; border:1px solid var(--c-border-strong); border-radius:var(--radius-sm); font:inherit; font-size:.9rem; background:var(--c-surface); color:var(--c-text); }
.chip-row { display:flex; gap:6px; flex-wrap:wrap; }
.chip { background:var(--c-surface); border:1px solid var(--c-border-strong); color:var(--c-text-muted); border-radius:var(--radius-pill); padding:4px 12px; font:inherit; font-size:.8rem; font-weight:600; cursor:pointer; }
.chip[data-active="true"] { background:var(--c-primary); color:#fff; border-color:var(--c-primary); }
.chip-success[data-active="true"] { background:var(--c-success); border-color:var(--c-success); }
.chip-failure[data-active="true"] { background:var(--c-failure); border-color:var(--c-failure); }
.chip-exception[data-active="true"] { background:var(--c-warning); border-color:var(--c-warning); }
.table-scroll { width:100%; max-width:100%; overflow-x:auto; border:1px solid var(--c-border); border-radius:var(--radius-md); background:var(--c-surface); -webkit-overflow-scrolling:touch; }
.table-scroll:focus { outline:2px solid var(--c-primary); outline-offset:2px; }
table.trial-index-table { border-collapse:collapse; width:100%; min-width:960px; font-size:.84rem; background:var(--c-surface); }
table.trial-index-table thead th { background:var(--c-surface-2); color:var(--c-text-muted); font-weight:600; text-align:left; padding:8px 10px; border-bottom:1px solid var(--c-border); font-size:.72rem; letter-spacing:.02em; text-transform:uppercase; white-space:nowrap; cursor:pointer; user-select:none; }
table.trial-index-table tbody td { padding:8px 10px; border-bottom:1px solid var(--c-border); vertical-align:middle; font-variant-numeric:tabular-nums; white-space:nowrap; }
table.trial-index-table .col-trial { max-width:220px; overflow:hidden; text-overflow:ellipsis; }
table.trial-index-table .col-num, table.trial-index-table .col-reward, table.trial-index-table .col-duration, table.trial-index-table .col-steps { width:1%; }
table.trial-index-table tbody tr:nth-child(even) { background:var(--c-surface-2); } table.trial-index-table tbody tr:hover { background:var(--c-primary-soft); } table.trial-index-table tbody tr[hidden] { display:none; }
table.trial-index-table .col-modality { width:1%; color:var(--c-text-muted); font-size:.78rem; }
table.modality-table { border-collapse:collapse; width:100%; font-size:.84rem; margin-top:6px; }
table.modality-table th, table.modality-table td { padding:6px 10px; border-bottom:1px solid var(--c-border); text-align:left; white-space:nowrap; }
table.modality-table th { color:var(--c-text-muted); font-weight:600; font-size:.72rem; letter-spacing:.02em; text-transform:uppercase; }
table.modality-table th.num, table.modality-table td.num { text-align:right; font-variant-numeric:tabular-nums; }
details.trial-details { background:var(--c-surface); border:1px solid var(--c-border); border-radius:var(--radius-md); margin:14px 0; box-shadow:var(--shadow-sm); overflow:hidden; scroll-margin-top:64px; }
details.trial-details > summary { list-style:none; cursor:pointer; padding:14px 20px; background:var(--c-surface-2); display:grid; grid-template-columns:1fr auto; gap:10px 14px; align-items:center; font-weight:600; }
details.trial-details > summary::-webkit-details-marker { display:none; }
details.trial-details > summary::after { content:"▶"; color:var(--c-text-faint); font-size:.7rem; grid-column:2; grid-row:1; justify-self:end; transition:transform 200ms ease; }
details.trial-details[open] > summary::after { transform:rotate(90deg); }
.trial-summary-left { display:flex; align-items:center; gap:10px; min-width:0; padding-right:18px; }
.trial-name { color:var(--c-text); font-size:1rem; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.trial-body { padding:18px 20px 20px; display:flex; flex-direction:column; gap:14px; background:var(--c-surface); }
.trial-body section.panel { margin-bottom:0; background:var(--c-surface-2); box-shadow:none; }
table.summary { border-collapse:collapse; width:100%; } table.summary td { padding:5px 10px 5px 0; font-size:.88rem; vertical-align:top; } table.summary td:first-child { color:var(--c-text-muted); white-space:nowrap; width:200px; }
pre, code { font-family:var(--font-mono); font-size:.78rem; } pre { background:#0f172a; color:#e2e8f0; border-radius:var(--radius-sm); padding:12px 14px; overflow:auto; white-space:pre-wrap; word-break:break-word; border:1px solid #1e293b; max-height:520px; }
.placeholder-note { color:var(--c-text-muted); font-style:italic; font-size:.9rem; padding:6px 0; }
.links a,.artifact-head a { display:inline-block; margin:0 8px 8px 0; }
.artifact-card { background:var(--c-surface); border:1px solid var(--c-border); border-radius:var(--radius-sm); padding:12px; margin-bottom:12px; }
.artifact-head { display:flex; gap:10px; flex-wrap:wrap; align-items:center; color:var(--c-text-muted); font-size:.82rem; margin-bottom:8px; }
.artifact-head a { font-weight:700; color:var(--c-primary); }
.artifact-image { max-width:100%; max-height:520px; border:1px solid var(--c-border); border-radius:var(--radius-sm); background:#fff; display:block; }
.artifact-frame { width:100%; height:520px; border:1px solid var(--c-border); border-radius:var(--radius-sm); background:#fff; }
.step-card { border:1px solid var(--c-border); border-radius:var(--radius-sm); margin-bottom:10px; overflow:hidden; background:var(--c-surface); }
.step-header { display:flex; align-items:center; gap:10px; background:var(--c-surface-2); padding:8px 14px; flex-wrap:wrap; border-bottom:1px solid var(--c-border); }
.step-id { font-weight:700; font-size:.85rem; color:var(--c-text); font-family:var(--font-mono); }
.source-badge { display:inline-block; padding:2px 9px; border-radius:var(--radius-pill); font-size:.72rem; font-weight:600; letter-spacing:.02em; }
.source-agent { background:var(--c-primary-soft); color:#4338ca; }
.source-user { background:var(--c-success-soft); color:#047857; }
.source-system { background:var(--c-neutral-soft); color:var(--c-text-muted); }
.step-meta { font-size:.74rem; color:var(--c-text-faint); font-family:var(--font-mono); word-break:break-all; }
.step-body { padding:12px 14px; display:flex; flex-direction:column; gap:10px; }
.tool-call,.observation-result { background:var(--c-surface-2); border:1px solid var(--c-border); border-radius:var(--radius-sm); padding:8px 12px; margin-top:4px; }
.tool-call .fn-name { font-weight:700; color:#6f42c1; font-family:var(--font-mono); font-size:.82rem; }
.observation-meta { color:var(--c-text-muted); font-size:.78rem; margin-bottom:4px; word-break:break-all; }
.reward-pair { grid-column:1 / -1; display:grid; grid-template-columns:repeat(4,minmax(120px,1fr)); gap:8px; }
.reward-value { font-size:.85rem; font-weight:600; font-family:var(--font-mono); color:var(--c-text); background:var(--c-neutral-soft); padding:3px 10px; border-radius:var(--radius-pill); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; text-align:center; }
.checks-cell { display:flex; flex-direction:column; gap:3px; align-items:flex-end; }
.checks-cell .checks-total { font-weight:700; font-variant-numeric:tabular-nums; }
.checks-cell .checks-breakdown { display:inline-flex; gap:5px; flex-wrap:wrap; justify-content:flex-end; }
.check-type-chip { display:inline-flex; align-items:center; gap:4px; padding:1px 7px; border-radius:999px; font-size:.7rem; font-weight:700; font-family:var(--font-mono); border:1px solid var(--c-border); background:#fff; color:#475569; white-space:nowrap; }
.check-type-chip.ct-det { background:#eef7ff; color:#075985; border-color:#c7e2f5; }
.check-type-chip.ct-llm { background:#fff7ed; color:#c2410c; border-color:#fed7aa; }
.check-type-chip.fully-passed { font-weight:800; }
.check-type-chip.has-fail { background:#fef2f2; color:#b91c1c; border-color:#fecaca; }
ul { padding-left:22px; }
@media (max-width:900px) { main.report { padding:0 14px 48px; } .dash-row { grid-template-columns:1fr; } .tabs { overflow-x:auto; } .reward-pair { grid-template-columns:repeat(2,minmax(0,1fr)); } }
@media (max-width:560px) { details.trial-details > summary { grid-template-columns:1fr auto; } .reward-pair { grid-template-columns:1fr; } }
"""


_MODALITY_ORDER = ["text_only", "browser_textcapable", "vision"]
_MODALITY_LABELS = {
    "text_only": "Text-only (non-multimodal)",
    "browser_textcapable": "Browser (text-capable)",
    "vision": "Vision (multimodal)",
}
_MODALITY_SHORT = {"text_only": "text", "browser_textcapable": "browser", "vision": "vision"}


def _modality_breakdown_html(rows: list[dict[str, Any]]) -> str:
    """Per-modality solve-rate / capacity card for the Overview tab.

    Renders only when at least one row carries a `modality` tag (emitted by the
    yaml-batch runner). Lets a single full-set run be split into the text_only /
    browser_textcapable / vision domains without re-deriving from each task.toml.
    Returns "" for older runs whose summary.json predates the tag, so the card
    simply does not appear.
    """
    groups: dict[str, dict[str, Any]] = {}
    for row in rows:
        modality = row.get("modality")
        if not modality:
            continue
        group = groups.setdefault(modality, {"n": 0, "reward_one": 0, "caps": []})
        group["n"] += 1
        if _is_reward_one(row):
            group["reward_one"] += 1
        cap = row.get("capacity_score")
        if isinstance(cap, (int, float)):
            group["caps"].append(cap)
    if not groups:
        return ""
    keys = [k for k in _MODALITY_ORDER if k in groups] + [
        k for k in groups if k not in _MODALITY_ORDER
    ]
    body = []
    for key in keys:
        group = groups[key]
        solve = group["reward_one"] / group["n"] if group["n"] else 0.0
        cap_mean = sum(group["caps"]) / len(group["caps"]) if group["caps"] else None
        body.append(
            f"<tr><td>{_e(_MODALITY_LABELS.get(key, key))}</td>"
            f"<td class='num'>{group['n']}</td>"
            f"<td class='num'>{solve * 100:.1f}%</td>"
            f"<td class='num'>{_format_score(cap_mean)}</td></tr>"
        )
    return (
        '<div class="dash-row" style="grid-template-columns:1fr">'
        '<div class="dash-card"><h3>By modality</h3>'
        '<table class="modality-table"><thead><tr>'
        "<th>Modality</th><th class='num'>Tasks</th>"
        "<th class='num'>Solve rate</th><th class='num'>Capacity</th>"
        "</tr></thead><tbody>" + "".join(body) + "</tbody></table>"
        '<div class="tile-sub">Solve rate = reward-1 trials / tasks; '
        "capacity = macro mean of per-task checks_passed / checks_total.</div>"
        "</div></div>"
    )


def generate_instance_report(instance_dir: Path) -> Path:
    instance_dir = instance_dir.resolve()
    summary = _read_json(instance_dir / "summary.json", {})
    rows = _task_rows(instance_dir, summary)
    total = int(summary.get("total") or len(rows))
    done = len(rows)
    success = sum(1 for row in rows if row["status"] == "success")
    exception = sum(1 for row in rows if row["status"] == "exception")
    failure = done - success - exception
    reward_one_count = sum(1 for row in rows if _is_reward_one(row))
    reward_total = max(total, done)
    solve_rate = (reward_one_count / reward_total) if reward_total else 0.0
    # Macro-avg capacity = mean of per-task (checks_passed/checks_total).
    # Distinct from solve_rate (binary pass) and raw_score (which can be
    # hard-capped). This is the headline v2 reporting metric.
    capacity_scores = [row.get("capacity_score") for row in rows]
    capacity_scores = [c for c in capacity_scores if isinstance(c, (int, float))]
    capacity_average = sum(capacity_scores) / len(capacity_scores) if capacity_scores else None
    durations = [_score(row.get("elapsed_sec")) for row in rows if _score(row.get("elapsed_sec")) is not None]
    median_duration = statistics.median(durations) if durations else None
    overall_status = "success" if done and success == done else "partial" if done else "unknown"
    status_bar = "status-green" if overall_status == "success" else "status-yellow" if done else "status-red"
    run_yaml = _read_text(instance_dir / "run.yaml")
    harness = summary.get("harness") or _yaml_top_scalar(run_yaml, "harness")
    runtime_os = summary.get("runtime_os") or _yaml_top_scalar(run_yaml, "runtime_os")
    image = summary.get("image") or _yaml_top_scalar(run_yaml, "image")

    table_rows = []
    for row in rows:
        status = row["status"]
        final_score = _row_final_score(row)
        checks_cell_html = _format_checks_cell(
            row.get("reward_json"),
            row.get("other_checks_passed") or 0,
            row.get("other_checks_total") or 0,
        )
        steps = row.get("trajectory_counts", {}).get("steps", 0)
        verifier_file_count = len(row.get("verifier_files", []))
        table_rows.append(
            f"""
<tr data-status="{status}" data-query="{_attr((row.get('run_id') or '') + ' ' + (row.get('task_id') or '') + ' ' + status + ' ' + (row.get('modality') or ''))}">
  <td class="col-num" data-sort-value="{_attr(row.get('index'))}">{_e(row.get('index'))}</td>
  <td class="col-trial" data-sort-value="{_attr(row.get('run_id'))}"><a href="#trial-{_attr(row.get('index'))}">{_e(row.get('run_id'))}</a></td>
  <td class="col-modality" data-sort-value="{_attr(row.get('modality') or '')}">{_e(_MODALITY_SHORT.get(row.get('modality') or '', row.get('modality') or '—'))}</td>
  <td class="col-reward" data-sort-value="{_attr(row.get('capacity_score') if row.get('capacity_score') is not None else -1)}">{checks_cell_html}</td>
  <td class="col-reward" data-sort-value="{_attr(row.get('capacity_score') if row.get('capacity_score') is not None else -1)}">{_format_score(row.get('capacity_score'))}</td>
  <td class="col-reward" data-sort-value="{_attr(_score(final_score) if _score(final_score) is not None else -1)}">{_format_score(final_score)}</td>
  <td class="col-status" data-sort-value="{status}"><span class="badge badge-{status}">{status}</span></td>
  <td class="col-duration" data-sort-value="{_attr(_score(row.get('elapsed_sec')) or 0)}">{_format_duration(row.get('elapsed_sec'))}</td>
  <td class="col-steps" data-sort-value="{_attr(steps)}">{_e(steps)}</td>
  <td>{len(row.get('outputs', []))}</td>
  <td>{verifier_file_count}</td>
</tr>
"""
        )

    html_text = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>RealReplicaBench Report: {_e(summary.get('run_id', instance_dir.name))}</title>
<style>{CSS}</style>
</head>
<body>
<main class="report">
  <div class="hero">
    <div class="status-bar {status_bar}"></div>
    <div class="hero-top">
      <div>
        <div class="hero-eyebrow">RealReplicaBench report</div>
        <h1 class="hero-title">{_e(summary.get('run_id', instance_dir.name))}</h1>
      </div>
      <div class="hero-status"><span class="badge badge-{overall_status if overall_status != 'unknown' else 'exception'}">{overall_status}</span></div>
    </div>
    <div class="hero-meta">
      <div><span class="k">Total trials</span><span class="v">{total}</span></div>
      <div><span class="k">Trials recorded</span><span class="v">{done}</span></div>
      <div><span class="k">Exceptions</span><span class="v">{exception}</span></div>
      <div><span class="k">Started</span><span class="v">{_e(summary.get('started_at'))}</span></div>
      <div><span class="k">Harness</span><span class="v">{_e(harness)}</span></div>
      <div><span class="k">Runtime</span><span class="v">{_e(runtime_os)}</span></div>
      <div><span class="k">Image</span><span class="v">{_e(image)}</span></div>
      <div><span class="k">Model</span><span class="v">{_e(summary.get('model_provider'))}/{_e(summary.get('model_name'))}</span></div>
    </div>
  </div>

  <nav class="tabs" role="tablist">
    <button type="button" class="tab-btn" data-tab-trigger="overview" aria-selected="true">Overview</button>
    <button type="button" class="tab-btn" data-tab-trigger="trials" aria-selected="false">Trials ({done})</button>
    <button type="button" class="tab-btn" data-tab-trigger="raw" aria-selected="false">Raw</button>
  </nav>

  <section data-tab="overview" data-active="true">
    <div class="tile-grid">
      <div class="tile tile-primary"><div class="tile-label">Solve rate</div><div class="tile-value">{solve_rate * 100:.1f}%</div><div class="tile-sub">{reward_one_count} / {reward_total} trials</div></div>
      <div class="tile tile-primary"><div class="tile-label">Capacity score (macro)</div><div class="tile-value">{_format_score(capacity_average)}</div><div class="tile-sub">mean of per-case (checks_passed / checks_total)</div></div>
      <div class="tile tile-success"><div class="tile-label">Trials</div><div class="tile-value">{done}</div>{_mini_bar(success, failure, exception, max(done, 1))}<div class="tile-sub">{success} success &middot; {failure} failure &middot; {exception} exception</div></div>
      <div class="tile tile-failure"><div class="tile-label">Exceptions</div><div class="tile-value">{exception}</div><div class="tile-sub">counted as reward 0</div></div>
      <div class="tile"><div class="tile-label">Median duration</div><div class="tile-value">{_format_duration(median_duration)}</div><div class="tile-sub">timed trials</div></div>
    </div>
    <div class="dash-row">
      <div class="dash-card"><h3>Status mix</h3>{_mini_bar(success, failure, exception, max(done, 1))}<div class="tile-sub">{success} success / {failure} failure / {exception} exception</div></div>
      <div class="dash-card"><h3>Task score distribution</h3>{_score_distribution(rows)}</div>
    </div>
    {_modality_breakdown_html(rows)}
  </section>

  <section data-tab="trials">
    <section class="panel">
      <h2>Trials ({done})</h2>
      <div class="toolbar">
        <input type="text" class="filter" placeholder="Filter by trial / task / status..." data-filter>
        <div class="chip-row">
          <button type="button" class="chip" data-status-chip="all" data-active="true">All ({done})</button>
          <button type="button" class="chip chip-success" data-status-chip="success" data-active="false">Success ({success})</button>
          <button type="button" class="chip chip-failure" data-status-chip="failure" data-active="false">Failure ({failure})</button>
          <button type="button" class="chip chip-exception" data-status-chip="exception" data-active="false">Exception ({exception})</button>
        </div>
      </div>
      <div class="table-scroll" role="region" aria-label="Trials table" tabindex="0">
        <table class="trial-index-table" data-sort-table>
          <thead><tr><th data-sortable>#</th><th data-sortable>Trial</th><th data-sortable>Modality</th><th data-sortable>Checks</th><th data-sortable>Capacity</th><th data-sortable>Final Reward</th><th data-sortable>Status</th><th data-sortable>Duration</th><th data-sortable>Steps</th><th>Outputs</th><th>Verifier Files</th></tr></thead>
          <tbody>{''.join(table_rows)}</tbody>
        </table>
      </div>
    </section>
    <section class="panel"><h2>Trial details</h2>{_trial_details(instance_dir, rows)}</section>
  </section>

  <section data-tab="raw">
    <section class="panel"><h2>Resolved run.yaml</h2><pre>{_e(run_yaml)}</pre></section>
    <section class="panel"><h2>summary.json</h2><pre>{_e(json.dumps(summary, ensure_ascii=False, indent=2))}</pre></section>
  </section>
</main>
<script>
const triggers = document.querySelectorAll('[data-tab-trigger]');
const tabs = document.querySelectorAll('section[data-tab]');
for (const btn of triggers) {{
  btn.addEventListener('click', () => {{
    const name = btn.dataset.tabTrigger;
    for (const b of triggers) b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
    for (const tab of tabs) tab.dataset.active = tab.dataset.tab === name ? 'true' : 'false';
  }});
}}
let activeStatus = 'all';
const filter = document.querySelector('[data-filter]');
const chips = document.querySelectorAll('[data-status-chip]');
const tableRows = Array.from(document.querySelectorAll('.trial-index-table tbody tr'));
function applyFilters() {{
  const q = (filter?.value || '').toLowerCase();
  for (const row of tableRows) {{
    const textOk = !q || row.dataset.query.toLowerCase().includes(q);
    const statusOk = activeStatus === 'all' || row.dataset.status === activeStatus;
    row.hidden = !(textOk && statusOk);
  }}
}}
filter?.addEventListener('input', applyFilters);
for (const chip of chips) {{
  chip.addEventListener('click', () => {{
    activeStatus = chip.dataset.statusChip;
    for (const c of chips) c.dataset.active = c === chip ? 'true' : 'false';
    applyFilters();
  }});
}}
for (const table of document.querySelectorAll('[data-sort-table]')) {{
  const headers = table.querySelectorAll('th[data-sortable]');
  headers.forEach((th, index) => {{
    th.addEventListener('click', () => {{
      const tbody = table.tBodies[0];
      const rows = Array.from(tbody.rows);
      const asc = th.getAttribute('aria-sort') !== 'ascending';
      headers.forEach(h => h.removeAttribute('aria-sort'));
      th.setAttribute('aria-sort', asc ? 'ascending' : 'descending');
      rows.sort((a, b) => {{
        const av = a.cells[index]?.dataset.sortValue || a.cells[index]?.innerText || '';
        const bv = b.cells[index]?.dataset.sortValue || b.cells[index]?.innerText || '';
        const an = Number(av), bn = Number(bv);
        const cmp = Number.isFinite(an) && Number.isFinite(bn) ? an - bn : av.localeCompare(bv);
        return asc ? cmp : -cmp;
      }});
      rows.forEach(row => tbody.appendChild(row));
    }});
  }});
}}
</script>
</body>
</html>
"""
    out = instance_dir / "report.html"
    out.write_text(html_text, encoding="utf-8")
    return out
