#!/usr/bin/env python3
from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import subprocess
import sys
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any

try:
    import tomllib
except ModuleNotFoundError:  # py<3.11
    import tomli as tomllib  # type: ignore


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from real_replica_bench.harnesses.registry import DEFAULT_HARNESS, SUPPORTED_HARNESSES
from real_replica_bench.constants import (
    DEFAULT_OPENCLAW_BASE_URL,
    DEFAULT_OPENCLAW_IMAGE,
    DEFAULT_OPENCLAW_MODEL,
)
from real_replica_bench.reports.html_report import generate_instance_report

RUNS_DIR = ROOT / "runs"
COLLECTION = ROOT / "datasets_domain_v1" / "realreplicabench_domain_v1_all.collection.json"
DEFAULT_JUDGE_MODEL = "gemini-3.1-pro-preview"


def load_json(path: Path, default: Any) -> Any:
    if not path.is_file():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def parse_scalar(value: str) -> Any:
    value = value.strip()
    # Strip inline comments (` # ...`) outside of quotes. YAML treats `#`
    # preceded by whitespace as a comment; without this our custom subset
    # parser silently glued the comment onto the value, breaking numeric coercion.
    if value and not (value.startswith('"') or value.startswith("'")):
        hash_idx = value.find(" #")
        if hash_idx != -1:
            value = value[:hash_idx].rstrip()
    if value in {"", "null", "~"}:
        return None
    if value in {"true", "True"}:
        return True
    if value in {"false", "False"}:
        return False
    if value.startswith('"') and value.endswith('"'):
        return value[1:-1].replace('\\"', '"')
    if value.startswith("'") and value.endswith("'"):
        return value[1:-1].replace("''", "'")
    if value.startswith("[") and value.endswith("]"):
        inner = value[1:-1].strip()
        if not inner:
            return []
        return [parse_scalar(part.strip()) for part in inner.split(",")]
    try:
        return int(value)
    except ValueError:
        pass
    try:
        return float(value)
    except ValueError:
        return value


def load_yaml_subset(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise SystemExit(f"config file not found: {path}")
    root: dict[str, Any] = {}
    stack: list[tuple[int, Any]] = [(-1, root)]
    last_key_at_indent: dict[int, tuple[Any, str]] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        if not raw_line.strip() or raw_line.lstrip().startswith("#"):
            continue
        indent = len(raw_line) - len(raw_line.lstrip(" "))
        line = raw_line.strip()
        parent = stack[-1][1]
        if line.startswith("- "):
            while stack and indent < stack[-1][0]:
                stack.pop()
            parent = stack[-1][1]
            if not isinstance(parent, list):
                grand_parent, key = last_key_at_indent.get(indent, (None, None))
                if grand_parent is None:
                    raise SystemExit(f"invalid yaml list item: {raw_line}")
                if isinstance(grand_parent.get(key), list):
                    parent = grand_parent[key]
                else:
                    parent = []
                    grand_parent[key] = parent
                if not stack or stack[-1][1] is not parent:
                    stack.append((indent, parent))
            item_text = line[2:].strip()
            if not item_text:
                item: Any = {}
                parent.append(item)
                stack.append((indent, item))
            elif ": " in item_text:
                key, value = item_text.split(":", 1)
                item = {key.strip(): parse_scalar(value)}
                parent.append(item)
                stack.append((indent, item))
            else:
                parent.append(parse_scalar(item_text))
            continue
        while stack and indent <= stack[-1][0]:
            stack.pop()
        parent = stack[-1][1]
        if ":" not in line:
            raise SystemExit(f"invalid yaml line: {raw_line}")
        if not isinstance(parent, dict):
            raise SystemExit(f"invalid yaml mapping line under list: {raw_line}")
        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip()
        if value:
            parent[key] = parse_scalar(value)
        else:
            parent[key] = {}
            last_key_at_indent[indent + 2] = (parent, key)
            stack.append((indent, parent[key]))
    return root


def yaml_quote(value: str) -> str:
    if value == "" or value.strip() != value or any(ch in value for ch in ":#[]{}&,!*?|>'\"%@`"):
        return json.dumps(value, ensure_ascii=False)
    return value


def dump_yaml(value: Any, indent: int = 0) -> str:
    space = " " * indent
    if isinstance(value, dict):
        lines: list[str] = []
        for key, item in value.items():
            if isinstance(item, (dict, list)):
                lines.append(f"{space}{key}:")
                lines.append(dump_yaml(item, indent + 2))
            else:
                lines.append(f"{space}{key}: {dump_yaml(item, 0).strip()}")
        return "\n".join(lines)
    if isinstance(value, list):
        lines = []
        for item in value:
            if isinstance(item, dict):
                lines.append(f"{space}-")
                lines.append(dump_yaml(item, indent + 2))
            elif isinstance(item, list):
                lines.append(f"{space}-")
                lines.append(dump_yaml(item, indent + 2))
            else:
                lines.append(f"{space}- {dump_yaml(item, 0).strip()}")
        return "\n".join(lines)
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    return yaml_quote(str(value))


# Header names whose VALUE is a credential. `--openclaw-provider-header` /
# `openclaw.provider_headers` carry `Key:Value` strings, and the BYO-endpoint
# docs explicitly suggest putting a shared proxy auth token there — so these
# must be scrubbed before run.yaml is archived as shareable evidence. Matched
# case-insensitively against the part before the FIRST colon.
_SENSITIVE_HEADER_NAMES = {
    "authorization",
    "proxy-authorization",
    "x-api-key",
    "api-key",
    "x-goog-api-key",
    "x-auth-token",
    "cookie",
}


def _redact_header_entry(item: str) -> str:
    """Redact the value of a `Key:Value` header string when Key is a secret.

    Non-credential headers (e.g. `anthropic-version:2023-06-01`) are kept
    verbatim — they are useful run evidence and carry nothing sensitive.
    """
    name, separator, raw_value = item.partition(":")
    if not separator or not raw_value.strip():
        return item
    normalized = name.strip().lower()
    if normalized in _SENSITIVE_HEADER_NAMES or any(
        marker in normalized for marker in ("token", "secret", "auth", "key")
    ):
        return f"{name}:<redacted>"
    return item


def redact_config_secrets(value: Any) -> Any:
    """Return a copy safe to persist in run.yaml.

    Explicit credentials may be supplied in a private YAML for convenience,
    but run archives are intended to be shareable benchmark evidence.
    """
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for key, item in value.items():
            normalized = str(key).lower().replace("-", "_")
            if (
                normalized in {"api_key", "apikey", "token", "password", "secret"}
                or normalized.endswith(("_api_key", "_token", "_password", "_secret"))
            ):
                out[key] = "<redacted>" if item not in (None, "") else item
            elif normalized in {"headers", "provider_headers"} and isinstance(
                item, list
            ):
                out[key] = [
                    _redact_header_entry(entry) if isinstance(entry, str) else
                    redact_config_secrets(entry)
                    for entry in item
                ]
            elif normalized in {"headers", "provider_headers"} and isinstance(
                item, dict
            ):
                # Same rule for the `{"Authorization": "Bearer ..."}` mapping
                # form used by a models_config `headers` block.
                out[key] = {
                    header_name: (
                        _redact_header_entry(f"{header_name}:{header_value}").partition(
                            ":"
                        )[2]
                        if isinstance(header_value, str)
                        else redact_config_secrets(header_value)
                    )
                    for header_name, header_value in item.items()
                }
            else:
                out[key] = redact_config_secrets(item)
        return out
    if isinstance(value, list):
        redacted: list[Any] = []
        for item in value:
            if isinstance(item, str) and "=" in item:
                name, _separator, raw_value = item.partition("=")
                normalized = name.strip().lower()
                if normalized.endswith(("_api_key", "_token", "_password", "_secret")):
                    redacted.append(f"{name}=<redacted>" if raw_value else item)
                    continue
            redacted.append(redact_config_secrets(item))
        return redacted
    return value


def get_nested(config: dict[str, Any], path: str, default: Any = None) -> Any:
    current: Any = config
    for part in path.split("."):
        if not isinstance(current, dict) or part not in current:
            return default
        current = current[part]
    return current


def normalize_env_entries(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, dict):
        return [f"{key}={item}" for key, item in value.items()]
    if isinstance(value, list):
        return [str(item) for item in value if str(item).strip()]
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    return []


def set_if_cli(config: dict[str, Any], path: str, value: Any, parser_default: Any) -> None:
    if value == parser_default:
        return
    current = config
    parts = path.split(".")
    for part in parts[:-1]:
        current = current.setdefault(part, {})
    current[parts[-1]] = value


def as_path(value: str | Path | None, default: Path) -> Path:
    if value is None:
        return default
    path = Path(value).expanduser()
    return path if path.is_absolute() else ROOT / path


def _is_v2_reward_schema(reward: dict[str, Any]) -> bool:
    if not isinstance(reward, dict):
        return False
    schema = reward.get("schema_version")
    return isinstance(schema, str) and schema.startswith("2.")


def actual_checks_count(reward: dict[str, Any]) -> tuple[int, int]:
    """(passed, total) for real test.sh validation checks (v2 schema-aware).

    Mirror of real_replica_bench.cli.actual_checks_count — kept duplicated
    so this script stays import-light. v2 schema uses top-level
    ``checks_passed`` / ``checks_total`` / ``checks_breakdown``; v1 falls back
    to the non-LLM entries inside ``validation_checks``.
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
    other_checks = [
        c for c in checks
        if isinstance(c, dict) and c.get("id") != "llm_rubric_judge"
    ]
    return (
        sum(1 for c in other_checks if c.get("passed")),
        len(other_checks),
    )


def capacity_score(reward: dict[str, Any]) -> float | None:
    p, t = actual_checks_count(reward)
    if t <= 0:
        return None
    return p / t


def validation_check_breakdown(reward: dict[str, Any]) -> dict[str, Any]:
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
    other_passed, other_total = actual_checks_count(reward)
    return {
        "llm_judge_score": llm_check.get("score") if isinstance(llm_check, dict) else None,
        "llm_check_passed": llm_check.get("passed") if isinstance(llm_check, dict) else None,
        "llm_check_threshold": llm_check.get("threshold") if isinstance(llm_check, dict) else None,
        "other_checks_passed": other_passed,
        "other_checks_total": other_total,
        "capacity_score": capacity_score(reward),
    }


# Modality split mirrors scripts/gen_modality_collections.py (canonical):
# `vision` if the task needs an image / visual-only UI; `browser_textcapable` if
# it needs the browser but no vision; `text_only` otherwise. Tagging each result
# row lets a single full-set run be partitioned into these domains in summary.json
# and the HTML report, instead of having to re-join task_id -> task.toml by hand.
def task_modality(requires_vision: bool, requires_browser: bool) -> str:
    if requires_vision:
        return "vision"
    if requires_browser:
        return "browser_textcapable"
    return "text_only"


def build_modality_map(datasets_dir: Path) -> dict[str, dict[str, Any]]:
    """Scan task.toml under datasets_dir -> {task_id: {requires_vision,
    requires_browser, modality}} using the canonical derivation above."""
    out: dict[str, dict[str, Any]] = {}
    if not datasets_dir.is_dir():
        return out
    for toml_path in datasets_dir.rglob("task.toml"):
        try:
            data = tomllib.loads(toml_path.read_text(encoding="utf-8"))
        except Exception:
            continue
        tid = (data.get("task") or {}).get("id") or toml_path.parent.name
        env = data.get("environment") or {}
        rv = bool(env.get("requires_vision", False))
        rb = bool(env.get("requires_browser", False))
        out[tid] = {
            "requires_vision": rv,
            "requires_browser": rb,
            "modality": task_modality(rv, rb),
        }
    return out


def modality_breakdown(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Aggregate per-modality {count, passed, capacity_score_mean} for the
    top-level summary.json. Empty when no row carries a modality tag (e.g. a
    run whose tasks live outside the scanned datasets dir)."""
    groups: dict[str, dict[str, Any]] = {}
    for row in rows:
        modality = row.get("modality")
        if not modality:
            continue
        group = groups.setdefault(modality, {"count": 0, "passed": 0, "_caps": []})
        group["count"] += 1
        if row.get("passed"):
            group["passed"] += 1
        cap = row.get("capacity_score")
        if isinstance(cap, (int, float)):
            group["_caps"].append(cap)
    out: dict[str, dict[str, Any]] = {}
    for modality, group in groups.items():
        caps = group.pop("_caps")
        out[modality] = {
            "count": group["count"],
            "passed": group["passed"],
            "capacity_score_mean": round(sum(caps) / len(caps), 4) if caps else None,
        }
    return out


def write_summaries(instance_dir: Path, summary: dict[str, Any]) -> None:
    instance_dir.mkdir(parents=True, exist_ok=True)
    rows = summary["results"]
    passed = sum(1 for row in rows if row.get("passed"))
    # Macro-avg capacity score across cases. Per-case capacity is
    # checks_passed/checks_total (real test.sh checks); the macro mean
    # treats each task equally regardless of how many checks it has
    # (different tasks have wildly different check counts and that count
    # is not a difficulty proxy).
    caps = [row.get("capacity_score") for row in rows if row.get("capacity_score") is not None]
    summary["capacity_score_mean"] = round(sum(caps) / len(caps), 4) if caps else None
    summary["capacity_score_count"] = len(caps)
    # Per-modality split (text_only / browser_textcapable / vision) so a single
    # full-set run can be partitioned by domain without re-joining task.toml.
    summary["modality_breakdown"] = modality_breakdown(rows)
    (instance_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    cap_str = f"{summary['capacity_score_mean']:.4f}" if summary["capacity_score_mean"] is not None else "—"
    lines = [
        f"# {summary['run_id']}",
        "",
        f"- started_at: {summary['started_at']}",
        f"- updated_at: {datetime.now().isoformat()}",
        f"- config: `{summary['config_path']}`",
        f"- runtime_os: {summary['runtime_os']}",
        f"- harness: {summary['harness']}",
        f"- image: `{summary['image']}`",
        f"- model: `{summary['model_provider']}/{summary['model_name']}`",
        f"- judge: `{summary['llm_judge_provider']}/{summary['llm_judge_model']}`",
        f"- progress: {len(rows)}/{summary['total']} complete, {passed} passed",
        f"- capacity (macro avg of per-case checks_passed/checks_total): {cap_str} over {len(caps)} scored tasks",
        "",
        "| # | task | exit | llm_judge_raw | llm_check | checks | capacity | reward | passed | outputs | cleanup | run_dir |",
        "|---:|---|---:|---:|---|---:|---:|---:|---|---:|---|---|",
    ]
    for row in rows:
        cap = row.get("capacity_score")
        lines.append(
            "| {idx} | {task_id} | {returncode} | {llm_judge_score} | {llm_check} | {checks} | {capacity} | {score} | {passed} | {outputs} | {cleanup} | `{run_dir}` |".format(
                idx=row["index"],
                task_id=row["task_id"],
                returncode=row.get("returncode"),
                llm_judge_score=row.get("llm_judge_score", ""),
                llm_check=row.get("llm_check_passed", ""),
                checks=(
                    f"{row.get('checks_passed')}/{row.get('checks_total')}"
                    if row.get("checks_total") is not None
                    else ""
                ),
                capacity=f"{cap:.4f}" if isinstance(cap, (int, float)) else "",
                score=row.get("score", ""),
                passed=row.get("passed", ""),
                outputs=row.get("output_file_count", 0),
                cleanup=row.get("container_removed", ""),
                run_dir=row.get("run_dir", ""),
            )
        )
    (instance_dir / "summary.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    generate_instance_report(instance_dir)


def collect_result(run_dir: Path, run_id: str, index: int, task_id: str, returncode: int, elapsed_sec: float) -> dict[str, Any]:
    manifest = load_json(run_dir / "manifest.json", {})
    reward = load_json(run_dir / "verifier" / "final_reward.json", manifest.get("reward", {}))
    check_summary = reward.get("check_summary", {}) if isinstance(reward, dict) else {}
    check_breakdown = validation_check_breakdown(reward)
    output_dir = run_dir / "workspace" / "outputs"
    output_count = len([p for p in output_dir.rglob("*") if p.is_file()]) if output_dir.exists() else 0
    cleanup = manifest.get("container_cleanup", {})
    return {
        "index": index,
        "task_id": task_id,
        "run_id": run_id,
        "run_dir": str(run_dir),
        "returncode": returncode,
        "elapsed_sec": round(elapsed_sec, 3),
        "score": reward.get("score", reward.get("reward")),
        "raw_score": reward.get("raw_score"),
        # v2 schema: real test.sh check counts; v1 fallback: non-LLM
        # validation_checks count. See actual_checks_count() docstring.
        "checks_passed": check_breakdown["other_checks_passed"],
        "checks_total": check_breakdown["other_checks_total"],
        "framework_checks_passed": check_summary.get("passed"),
        "framework_checks_total": check_summary.get("total"),
        **check_breakdown,
        "passed": bool(reward.get("passed")),
        "verifier_exit": reward.get("verifier_exit"),
        "summary": reward.get("summary"),
        "output_file_count": output_count,
        "container_removed": cleanup.get("removed"),
        "agent_exec_returncode": manifest.get("agent_exec_returncode"),
    }


def parser_defaults(parser: argparse.ArgumentParser) -> argparse.Namespace:
    return parser.parse_args([])


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run a benchmark instance from a YAML config.")
    parser.add_argument(
        "--config",
        type=Path,
        default=ROOT / "configs" / "realreplicabench_openclaw.yaml",
    )
    parser.add_argument("--collection", type=Path, default=COLLECTION)
    parser.add_argument("--batch-id")
    parser.add_argument("--run-id")
    parser.add_argument("--runtime-os", choices=["linux", "mac"], default="linux")
    parser.add_argument("--image")
    parser.add_argument("--platform", default="linux/amd64")
    parser.add_argument("--login-state-dir")
    parser.add_argument("--harness", choices=SUPPORTED_HARNESSES, default=DEFAULT_HARNESS)
    parser.add_argument("--agent-template-id", default="coder")
    parser.add_argument("--agent-runtime", choices=["local", "remote"], default="local")
    parser.add_argument("--tool-preset", choices=["full", "standard", "developer", "minimal", "tl", "none"])
    parser.add_argument("--model-provider", default="gemini")
    parser.add_argument("--model-name", default="gemini-3-flash-preview")
    parser.add_argument("--llm-judge-provider", default="gemini", choices=["openai", "gemini", "mock"])
    parser.add_argument("--llm-judge-model", default=DEFAULT_JUDGE_MODEL)
    parser.add_argument("--llm-judge-base-url")
    parser.add_argument("--llm-judge-api-key")
    parser.add_argument("--llm-judge-timeout", type=int, default=240)
    parser.add_argument("--openclaw-model", default=DEFAULT_OPENCLAW_MODEL)
    parser.add_argument("--openclaw-image-model")
    parser.add_argument("--openclaw-base-url", default=DEFAULT_OPENCLAW_BASE_URL)
    parser.add_argument("--openclaw-api-key")
    parser.add_argument("--openclaw-models-config")
    parser.add_argument("--openclaw-gateway-port", type=int, default=14567)
    parser.add_argument("--openclaw-gateway-ready-delay", type=float, default=2.0)
    parser.add_argument("--openclaw-thinking")
    parser.add_argument("--openclaw-openrouter-shim", action="store_true")
    parser.add_argument("--openclaw-openrouter-shim-port", type=int, default=19501)
    # BYO-endpoint shortcut: passthrough to `real-replica-bench run`. See
    # docs/openclaw-byo-endpoint.md and the CLI-level flags on cli.py.
    parser.add_argument(
        "--openclaw-api",
        choices=[
            "openai-completions",
            "openai-responses",
            "openai-codex-responses",
            "anthropic-messages",
            "google-generative-ai",
            "github-copilot",
            "bedrock-converse-stream",
            "ollama",
            "azure-openai-responses",
        ],
    )
    parser.add_argument("--openclaw-provider-base-url")
    parser.add_argument("--openclaw-provider-key")
    parser.add_argument(
        "--openclaw-provider-api-key-env", default="OPENCLAW_PROVIDER_API_KEY"
    )
    parser.add_argument(
        "--openclaw-provider-header",
        action="append",
        default=[],
        metavar="KEY:VALUE",
    )
    parser.add_argument("--start-index", type=int, default=1)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--parallelism", type=int, default=1)
    return parser


def resolve_config(args: argparse.Namespace, defaults: argparse.Namespace) -> dict[str, Any]:
    config = load_yaml_subset(
        as_path(args.config, ROOT / "configs" / "realreplicabench_openclaw.yaml")
    )
    set_if_cli(config, "run_id", args.run_id or args.batch_id, defaults.run_id)
    set_if_cli(config, "collection", str(args.collection), str(defaults.collection))
    set_if_cli(config, "runtime.os", args.runtime_os, defaults.runtime_os)
    set_if_cli(config, "runtime.image", args.image, defaults.image)
    set_if_cli(config, "runtime.platform", args.platform, defaults.platform)
    set_if_cli(config, "runtime.login_state_dir", args.login_state_dir, defaults.login_state_dir)
    set_if_cli(config, "harness", args.harness, defaults.harness)
    set_if_cli(config, "agent.template_id", args.agent_template_id, defaults.agent_template_id)
    set_if_cli(config, "agent.runtime", args.agent_runtime, defaults.agent_runtime)
    set_if_cli(config, "agent.tool_preset", args.tool_preset, defaults.tool_preset)
    set_if_cli(config, "agent.model_provider", args.model_provider, defaults.model_provider)
    set_if_cli(config, "agent.model_name", args.model_name, defaults.model_name)
    set_if_cli(config, "judge.provider", args.llm_judge_provider, defaults.llm_judge_provider)
    set_if_cli(config, "judge.model", args.llm_judge_model, defaults.llm_judge_model)
    set_if_cli(config, "judge.base_url", args.llm_judge_base_url, defaults.llm_judge_base_url)
    set_if_cli(config, "judge.api_key", args.llm_judge_api_key, defaults.llm_judge_api_key)
    set_if_cli(config, "judge.timeout", args.llm_judge_timeout, defaults.llm_judge_timeout)
    set_if_cli(config, "openclaw.model", args.openclaw_model, defaults.openclaw_model)
    set_if_cli(config, "openclaw.image_model", args.openclaw_image_model, defaults.openclaw_image_model)
    set_if_cli(config, "openclaw.base_url", args.openclaw_base_url, defaults.openclaw_base_url)
    set_if_cli(config, "openclaw.api_key", args.openclaw_api_key, defaults.openclaw_api_key)
    set_if_cli(config, "openclaw.models_config", args.openclaw_models_config, defaults.openclaw_models_config)
    set_if_cli(config, "openclaw.gateway_port", args.openclaw_gateway_port, defaults.openclaw_gateway_port)
    set_if_cli(
        config,
        "openclaw.gateway_ready_delay",
        args.openclaw_gateway_ready_delay,
        defaults.openclaw_gateway_ready_delay,
    )
    set_if_cli(config, "openclaw.thinking", args.openclaw_thinking, defaults.openclaw_thinking)
    if args.openclaw_openrouter_shim:
        config.setdefault("openclaw", {})["openrouter_shim"] = True
    if args.openclaw_openrouter_shim_port != defaults.openclaw_openrouter_shim_port:
        config.setdefault("openclaw", {})["openrouter_shim_port"] = args.openclaw_openrouter_shim_port
    set_if_cli(config, "openclaw.api", args.openclaw_api, defaults.openclaw_api)
    set_if_cli(
        config,
        "openclaw.provider_base_url",
        args.openclaw_provider_base_url,
        defaults.openclaw_provider_base_url,
    )
    set_if_cli(
        config,
        "openclaw.provider_key",
        args.openclaw_provider_key,
        defaults.openclaw_provider_key,
    )
    set_if_cli(
        config,
        "openclaw.provider_api_key_env",
        args.openclaw_provider_api_key_env,
        defaults.openclaw_provider_api_key_env,
    )
    # provider_headers is a repeatable list flag; only forward it if the user
    # supplied at least one value on this invocation (the default is []).
    if args.openclaw_provider_header:
        config.setdefault("openclaw", {})["provider_headers"] = list(
            args.openclaw_provider_header
        )
    set_if_cli(config, "start_index", args.start_index, defaults.start_index)
    set_if_cli(config, "limit", args.limit, defaults.limit)
    set_if_cli(config, "parallelism", args.parallelism, defaults.parallelism)
    return config


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    defaults = parser_defaults(build_parser())
    config_path = as_path(
        args.config,
        ROOT / "configs" / "realreplicabench_openclaw.yaml",
    )
    config = resolve_config(args, defaults)

    configured_tasks = get_nested(config, "tasks")
    configured_collection = get_nested(config, "collection")
    has_explicit_tasks = configured_tasks is not None
    collection_path = as_path(configured_collection, COLLECTION) if configured_collection is not None else None
    if collection_path is None and not has_explicit_tasks:
        collection_path = COLLECTION
    collection = load_json(collection_path, {}) if collection_path is not None else {}
    task_ids = list(configured_tasks if has_explicit_tasks else collection.get("task_ids") or [])
    collection_value = str(collection_path) if collection_path is not None else None
    # task_id -> modality map, used to tag each result row so the run can be
    # partitioned by domain (text_only / browser_textcapable / vision).
    datasets_dir_cfg = get_nested(config, "datasets_dir")
    datasets_path = Path(datasets_dir_cfg) if datasets_dir_cfg else COLLECTION.parent
    if not datasets_path.is_absolute():
        datasets_path = ROOT / datasets_path
    modality_map = build_modality_map(datasets_path)
    limit = get_nested(config, "limit")
    if limit is not None:
        task_ids = task_ids[: int(limit)]

    runtime_os = get_nested(config, "runtime.os", "linux")
    harness = get_nested(config, "harness", DEFAULT_HARNESS)
    image = get_nested(config, "runtime.image") or DEFAULT_OPENCLAW_IMAGE
    run_id = get_nested(config, "run_id") or f"realreplicabench-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    instance_dir = RUNS_DIR / run_id
    task_runs_dir = instance_dir / "tasks"
    logs_dir = instance_dir / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)

    resolved_config = {
        **config,
        "run_id": run_id,
        "collection": collection_value,
        "tasks": task_ids,
        "runtime": {
            **get_nested(config, "runtime", {}),
            "os": runtime_os,
            "image": image,
            "platform": get_nested(config, "runtime.platform", "linux/amd64"),
            "login_state_dir": get_nested(config, "runtime.login_state_dir"),
        },
        "output": {
            "instance_dir": str(instance_dir),
            "task_runs_dir": str(task_runs_dir),
            "summary_json": str(instance_dir / "summary.json"),
            "summary_md": str(instance_dir / "summary.md"),
        },
    }
    (instance_dir / "run.yaml").write_text(
        dump_yaml(redact_config_secrets(resolved_config)) + "\n",
        encoding="utf-8",
    )

    parallelism = max(1, int(get_nested(config, "parallelism", 1) or 1))
    # Release fork: only the openclaw harness ships. The real model lives in
    # openclaw.model (the YAML schema has no `agent:` block for openclaw runs),
    # so pull it explicitly to keep summary.json honest.
    if harness == "openclaw":
        summary_model_provider = "openclaw"
        summary_model_name = get_nested(config, "openclaw.model", DEFAULT_OPENCLAW_MODEL)
    else:
        summary_model_provider = get_nested(config, "agent.model_provider", "gemini")
        summary_model_name = get_nested(config, "agent.model_name", "gemini-3-flash-preview")
    summary: dict[str, Any] = {
        "run_id": run_id,
        "started_at": datetime.now().isoformat(),
        "config_path": str(instance_dir / "run.yaml"),
        "source_config_path": str(config_path),
        "collection": collection_value,
        "total": len(task_ids),
        "runtime_os": runtime_os,
        "harness": harness,
        "image": image,
        "model_provider": summary_model_provider,
        "model_name": summary_model_name,
        "tool_preset": get_nested(config, "agent.tool_preset"),
        "llm_judge_provider": get_nested(config, "judge.provider", "gemini"),
        "llm_judge_model": get_nested(config, "judge.model", DEFAULT_JUDGE_MODEL),
        "llm_judge_base_url": get_nested(config, "judge.base_url"),
        "parallelism": parallelism,
        "results": [],
    }
    write_summaries(instance_dir, summary)

    start_index = int(get_nested(config, "start_index", 1))
    selected_tasks = [(index, task_id) for index, task_id in enumerate(task_ids, start=1) if index >= start_index]

    def run_one(index: int, task_id: str) -> dict[str, Any]:
        task_run_id = f"{index:02d}-{task_id}"
        cmd = [
            sys.executable,
            "-m",
            "real_replica_bench",
            "run",
            task_id,
            "--runtime-os",
            runtime_os,
            "--image",
            image,
            "--platform",
            get_nested(config, "runtime.platform", "linux/amd64"),
            "--harness",
            harness,
        ]
        if get_nested(config, "runtime.login_state_dir"):
            cmd.extend([
                "--login-state-dir",
                get_nested(config, "runtime.login_state_dir"),
            ])
        cmd.extend([
            "--agent-template-id",
            get_nested(config, "agent.template_id", "coder"),
            "--agent-runtime",
            get_nested(config, "agent.runtime", "local"),
            "--model-provider",
            get_nested(config, "agent.model_provider", "gemini"),
            "--model-name",
            get_nested(config, "agent.model_name", "gemini-3-flash-preview"),
            "--llm-judge-provider",
            get_nested(config, "judge.provider", "gemini"),
            "--llm-judge-model",
            get_nested(config, "judge.model", DEFAULT_JUDGE_MODEL),
            "--llm-judge-timeout",
            str(get_nested(config, "judge.timeout", 240)),
            "--output-dir",
            str(task_runs_dir),
            "--run-id",
            task_run_id,
        ])
        if get_nested(config, "judge.base_url"):
            cmd.extend(["--llm-judge-base-url", get_nested(config, "judge.base_url")])
        if get_nested(config, "agent.tool_preset"):
            cmd.extend(["--tool-preset", get_nested(config, "agent.tool_preset")])
        if harness == "openclaw":
            cmd.extend(["--openclaw-model", get_nested(config, "openclaw.model", DEFAULT_OPENCLAW_MODEL)])
            if get_nested(config, "openclaw.image_model"):
                cmd.extend(["--openclaw-image-model", get_nested(config, "openclaw.image_model")])
            if get_nested(config, "openclaw.base_url"):
                cmd.extend(["--openclaw-base-url", get_nested(config, "openclaw.base_url")])
            if get_nested(config, "openclaw.models_config"):
                cmd.extend(["--openclaw-models-config", get_nested(config, "openclaw.models_config")])
            if get_nested(config, "openclaw.gateway_port"):
                cmd.extend(["--openclaw-gateway-port", str(get_nested(config, "openclaw.gateway_port"))])
            if get_nested(config, "openclaw.gateway_ready_delay") is not None:
                cmd.extend(["--openclaw-gateway-ready-delay", str(get_nested(config, "openclaw.gateway_ready_delay"))])
            if get_nested(config, "openclaw.thinking"):
                cmd.extend(["--openclaw-thinking", get_nested(config, "openclaw.thinking")])
            if get_nested(config, "openclaw.openrouter_shim"):
                cmd.append("--openclaw-openrouter-shim")
            if get_nested(config, "openclaw.openrouter_shim_port"):
                cmd.extend(["--openclaw-openrouter-shim-port", str(get_nested(config, "openclaw.openrouter_shim_port"))])
            if get_nested(config, "openclaw.api"):
                cmd.extend(["--openclaw-api", get_nested(config, "openclaw.api")])
            if get_nested(config, "openclaw.provider_base_url"):
                cmd.extend([
                    "--openclaw-provider-base-url",
                    get_nested(config, "openclaw.provider_base_url"),
                ])
            if get_nested(config, "openclaw.provider_key"):
                cmd.extend([
                    "--openclaw-provider-key",
                    get_nested(config, "openclaw.provider_key"),
                ])
            provider_api_key_env = get_nested(config, "openclaw.provider_api_key_env")
            # Skip the default; the child parser applies the same default itself.
            if provider_api_key_env and provider_api_key_env != "OPENCLAW_PROVIDER_API_KEY":
                cmd.extend([
                    "--openclaw-provider-api-key-env",
                    provider_api_key_env,
                ])
            provider_headers = get_nested(config, "openclaw.provider_headers") or []
            for header in provider_headers:
                cmd.extend(["--openclaw-provider-header", str(header)])
        screenshot_interval = get_nested(config, "screenshots.interval")
        if screenshot_interval is not None:
            cmd.extend(["--screenshot-interval", str(screenshot_interval)])
        if get_nested(config, "screenshots.disable_network_trigger"):
            cmd.append("--no-screenshot-on-network")
        # Per-run agent limit relaxation: lets high-thinking models get more
        # wall-clock / steps without rewriting per-task task.toml values.
        # Defaults (1.0 multiplier / 0 floor / unset env) leave behaviour
        # identical to today; only forward flags when YAML opts in.
        agent_timeout_mult = get_nested(config, "runtime.agent_timeout_multiplier")
        if agent_timeout_mult is not None and float(agent_timeout_mult) != 1.0:
            cmd.extend(["--agent-timeout-multiplier", str(agent_timeout_mult)])
        agent_timeout_min = get_nested(config, "runtime.agent_timeout_min_sec")
        if agent_timeout_min:
            cmd.extend(["--agent-timeout-min-sec", str(agent_timeout_min)])
        actions_mult = get_nested(config, "runtime.agent_max_actions_multiplier")
        if actions_mult is not None and float(actions_mult) != 1.0:
            cmd.extend(["--agent-max-actions-multiplier", str(actions_mult)])
        actions_min = get_nested(config, "runtime.agent_max_actions_min")
        if actions_min:
            cmd.extend(["--agent-max-actions-min", str(actions_min)])
        browser_subagent_timeout = get_nested(config, "runtime.browser_subagent_timeout_sec")
        if browser_subagent_timeout:
            cmd.extend(["--browser-subagent-timeout-sec", str(browser_subagent_timeout)])
        for env_entry in normalize_env_entries(get_nested(config, "runtime.env")):
            cmd.extend(["-e", env_entry])

        log_path = logs_dir / f"{task_run_id}.command.log"
        print(f"[{index}/{len(task_ids)}] start {task_id} -> {task_runs_dir / task_run_id}", flush=True)
        started = time.time()
        # If the YAML pins a non-default dataset root,
        # propagate it to the per-task subprocess via env so cli.py's
        # DATASETS_DIR resolver finds the right task directory. Inherits the
        # parent env first so unrelated vars (PATH, GEMINI_API_KEY, etc.) survive.
        subprocess_env = os.environ.copy()
        if get_nested(config, "judge.api_key"):
            subprocess_env["BENCH_LLM_JUDGE_API_KEY"] = str(get_nested(config, "judge.api_key"))
        if get_nested(config, "openclaw.api_key"):
            subprocess_env["OPENROUTER_API_KEY"] = str(get_nested(config, "openclaw.api_key"))
        datasets_dir = get_nested(config, "datasets_dir")
        if datasets_dir:
            subprocess_env["BENCH_DATASETS_DIR"] = str(datasets_dir)
        with log_path.open("w", encoding="utf-8") as log:
            proc = subprocess.run(cmd, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, text=True, check=False, env=subprocess_env)
        elapsed = time.time() - started
        row = collect_result(task_runs_dir / task_run_id, task_run_id, index, task_id, proc.returncode, elapsed)
        row.update(modality_map.get(task_id, {}))
        print(
            f"[{index}/{len(task_ids)}] done {task_id}: exit={proc.returncode} "
            f"score={row.get('score')} passed={row.get('passed')} outputs={row.get('output_file_count')}",
            flush=True,
        )
        return row

    if parallelism <= 1 or len(selected_tasks) <= 1:
        for index, task_id in selected_tasks:
            row = run_one(index, task_id)
            summary["results"].append(row)
            summary["results"].sort(key=lambda item: item["index"])
            write_summaries(instance_dir, summary)
    else:
        summary_lock = threading.Lock()
        print(f"parallelism={parallelism}", flush=True)
        with concurrent.futures.ThreadPoolExecutor(max_workers=parallelism) as executor:
            futures = [executor.submit(run_one, index, task_id) for index, task_id in selected_tasks]
            for future in concurrent.futures.as_completed(futures):
                row = future.result()
                with summary_lock:
                    summary["results"].append(row)
                    summary["results"].sort(key=lambda item: item["index"])
                    write_summaries(instance_dir, summary)

    summary["finished_at"] = datetime.now().isoformat()
    write_summaries(instance_dir, summary)
    failed = [row for row in summary["results"] if not row.get("passed")]
    print(f"summary_dir={instance_dir}")
    print(f"passed={len(summary['results']) - len(failed)} failed={len(failed)} total={len(summary['results'])}")
    return 0 if not failed else 6


if __name__ == "__main__":
    raise SystemExit(main())
