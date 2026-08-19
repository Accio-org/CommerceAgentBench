"""Shared low-level infrastructure for Commerce Agent Bench harnesses.

Extracted verbatim from cli.py (2026-06-18 refactor). Subprocess/docker
wrappers, container I/O, process management, env expansion, proxy-usage
collection and agent-result writing — the harness-agnostic foundation that
harness modules (openclaw and its trajectory readers) import. Depends only on stdlib;
TaskSpec is annotation-only (TYPE_CHECKING) so there is no cli import cycle.
cli re-exports these names for run_task / tests / backfill back-compat.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import time
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from bench_core.cli import TaskSpec


def run(cmd: list[str], *, cwd: Path | None = None, check: bool = True, capture: bool = False) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        check=check,
        text=True,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.STDOUT if capture else None,
    )


def docker(*args: str, check: bool = True, capture: bool = False) -> subprocess.CompletedProcess[str]:
    return run(["docker", *args], check=check, capture=capture)


def copy_from_container(container: str, src: str, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    docker("cp", f"{container}:{src}", str(dst), check=False)


def extract_json_event_text(log_text: str) -> str:
    """Best-effort "what the agent said" from a JSONL agent transcript.

    Prefers assistant-authored text. OpenClaw writes
    ``{type:"message", message:{role, content:[{type:"text", text}, ...]}}``,
    so for that shape we take only the assistant text parts — the same parse
    trajectory.recover_trajectory_from_openclaw_chat performs.

    The recursive walk below is the fallback for transcript shapes we do not
    recognise. It is deliberately *not* the primary path: it collects every
    "text"/"content"/"message"/"delta" key at any depth, which splices the task
    brief and every tool result (fetched pages, file dumps) into what callers
    then label as the agent's answer.

    Falls back further to the raw log tail so an unparseable transcript still
    yields something rather than an empty string.
    """
    assistant_chunks: list[str] = []
    walked_chunks: list[str] = []
    interesting_keys = {"text", "content", "message", "delta"}

    def visit(value: Any, depth: int = 0) -> None:
        if depth > 5:
            return
        if isinstance(value, dict):
            for key, item in value.items():
                if key in interesting_keys and isinstance(item, str):
                    walked_chunks.append(item)
                elif isinstance(item, (dict, list)):
                    visit(item, depth + 1)
        elif isinstance(value, list):
            for item in value:
                visit(item, depth + 1)

    def assistant_text(item: Any) -> list[str]:
        if not isinstance(item, dict) or item.get("type") != "message":
            return []
        message = item.get("message")
        if not isinstance(message, dict) or message.get("role") != "assistant":
            return []
        content = message.get("content")
        if not isinstance(content, list):
            return []
        out: list[str] = []
        for part in content:
            if not isinstance(part, dict) or part.get("type") != "text":
                continue
            text = part.get("text")
            if isinstance(text, str) and text.strip():
                out.append(text)
        return out

    # split("\n"), not splitlines(): the latter also breaks on U+2028/U+2029,
    # which are legal inside a JSON string, splitting one record into two
    # unparseable halves that are then silently dropped.
    for line in log_text.split("\n"):
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            item = json.loads(line)
        except json.JSONDecodeError:
            continue
        assistant_chunks.extend(assistant_text(item))
        visit(item)

    for chunks in (assistant_chunks, walked_chunks):
        text = "\n".join(chunk for chunk in chunks if chunk.strip())
        if text:
            return text[-20000:]
    return log_text[-20000:]


def write_agent_result(
    *,
    spec: TaskSpec,
    agent_dir: Path,
    harness: str,
    returncode: int,
    started: float,
    response_text: str,
) -> None:
    duration_ms = int((time.time() - started) * 1000)
    result = [
        {
            "scenarioName": spec.task_id,
            "agentId": harness,
            "passed": returncode == 0,
            "totalActions": 1,
            "passedActions": 1 if returncode == 0 else 0,
            "failedActions": 0 if returncode == 0 else 1,
            "totalDurationMs": duration_ms,
            "results": [
                {
                    "actionIndex": 0,
                    "actionType": "chat",
                    "passed": returncode == 0,
                    "durationMs": duration_ms,
                    "responseText": response_text,
                    "toolCalls": [],
                    "toolResults": [],
                    "toolProgress": [],
                    "totalUsage": {},
                }
            ],
        }
    ]
    (agent_dir / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def expand_env_placeholders(text: str) -> str:
    pattern = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}")

    def replace(match: re.Match[str]) -> str:
        key = match.group(1)
        return os.environ.get(key, match.group(0))

    return pattern.sub(replace, text)


def terminate_process(proc: subprocess.Popen[str] | None, timeout: float = 5.0) -> None:
    if proc is None or proc.poll() is not None:
        return
    proc.terminate()
    try:
        proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=timeout)


def close_process_log(proc: subprocess.Popen[str] | None) -> None:
    log_file = getattr(proc, "_log_file", None)
    if log_file is not None and not log_file.closed:
        log_file.close()


def popen_docker_exec_log(container: str, bash_cmd: str, log_path: Path) -> subprocess.Popen[str]:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log_file = log_path.open("w", encoding="utf-8")
    proc = subprocess.Popen(
        ["docker", "exec", container, "bash", "-lc", bash_cmd],
        stdout=log_file,
        stderr=subprocess.STDOUT,
        text=True,
    )
    proc._log_file = log_file
    return proc


def collect_proxy_usage(container: str, agent_dir: Path, remote_path: str, label: str) -> dict[str, Any] | None:
    """docker cp the in-container proxy/shim's billing-aligned token tally
    out → agent_dir/proxy_usage.json, and echo a one-line summary. The proxy
    only writes the file when the per-harness usage-file env is set, so this
    is a best-effort no-op when accounting wasn't enabled. Release fork:
    populated by the OpenRouter shim when --openclaw-thinking is on."""
    dest = agent_dir / "proxy_usage.json"
    cp = docker("cp", f"{container}:{remote_path}", str(dest), check=False, capture=True)
    if cp.returncode != 0 or not dest.is_file():
        return None
    try:
        usage = json.loads(dest.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    print(f"[{label}] token usage (billing split): {json.dumps(usage, ensure_ascii=False)}", flush=True)
    return usage
