from __future__ import annotations

import argparse
import gzip
import json
import os
import re
import secrets
import shutil
import shlex
import signal
import stat
import subprocess
import sys
import threading
import time
import tomllib
import urllib.request
from dataclasses import dataclass, field, replace
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

from bench_core import __version__
from bench_core.harnesses.registry import DEFAULT_HARNESS, SUPPORTED_HARNESSES
from bench_core.constants import (
    PROJECT_ROOT,
    REMOTE_RUNTIME_MOCKS_ROOT,
    REMOTE_WORKSPACE_ROOT,
    DEFAULT_OPENCLAW_IMAGE,
    DEFAULT_OPENCLAW_MODEL,
    DEFAULT_OPENCLAW_BASE_URL,
    DEFAULT_LINUX_AUTH_IMAGE,
    DEFAULT_MAC_AUTH_IMAGE,
)
from bench_core.core import (
    copy_from_container,
    docker,
    run,
    write_agent_result,
)
from bench_core.prompts import (
    build_scenario,
    build_task_prompt,  # noqa: F401  re-exported for tests (cli.build_task_prompt)
)
from bench_core.reports.html_report import generate_instance_report
from bench_core.harnesses.openclaw.runner import (
    _openclaw_is_relay_mode,
    run_openclaw_agent,
)
from bench_core.reward import (
    actual_checks_count,  # noqa: F401  re-exported for scripts/backfill_v2_report.py
    build_binary_final_reward,
    capacity_score,  # noqa: F401  re-exported (CLAUDE.md source-of-truth API)
    validation_check_breakdown,
)
from bench_core.trajectory import (
    _parse_result_root,
    write_trajectory,
)


# DATASETS_DIR defaults to <repo>/datasets_domain_v1, the active domain-organized
# task set. Set BENCH_DATASETS_DIR to point the CLI at an alternate root.
# Accepts absolute or repo-relative path.
_datasets_env = os.environ.get("BENCH_DATASETS_DIR")
if _datasets_env:
    _candidate = Path(_datasets_env)
    DATASETS_DIR = _candidate if _candidate.is_absolute() else (PROJECT_ROOT / _candidate).resolve()
else:
    DATASETS_DIR = PROJECT_ROOT / "datasets_domain_v1"
RUNS_DIR = PROJECT_ROOT / "runs"
# DEFAULT_LINUX_AUTH_IMAGE / DEFAULT_MAC_AUTH_IMAGE imported from constants
# (release fork: aliased to DEFAULT_OPENCLAW_IMAGE so legacy YAML schema keys
# resolve to the published Docker Hub tag).


@dataclass
class EarlyTerminate:
    """Poll an in-container mock for a completion signal; kill the agent on hit.

    Today only ``match_kind = "list_any_field_equals"`` is supported:
    the response is expected to be a JSON list, and any element whose
    ``match_field`` equals ``match_value`` triggers termination.
    """

    poll_path: str
    poll_interval_sec: float
    match_kind: str
    match_field: str
    match_value: str
    kill_pattern: str = "bun run runner.ts"


@dataclass
class OutputFileEarlyTerminate:
    """Kill the agent once a required in-container output file exists."""

    output_path: str
    poll_interval_sec: float
    kill_pattern: str = "bun run runner.ts"


@dataclass
class RuntimeMockConfig:
    """A repo-local mock service hot-loaded into the task container at runtime."""

    name: str
    source_dir: Path
    install_path: str | None = None
    kind: str = "http"
    port: int | None = None
    health_path: str | None = None
    launcher: str = ""
    env: dict[str, str] = field(default_factory=dict)
    bin_names: tuple[str, ...] = ()
    bench_bin: str | None = None
    include_node_modules: bool = False
    isolate: bool = False
    isolation_model: str | None = None


@dataclass
class TaskSpec:
    task_id: str
    case_dir: Path
    name: str
    language: str
    timeout_sec: int
    max_actions: int
    verifier_timeout_sec: int
    entrypoint: str
    test_script: str
    rubric: str
    private_dir: Path | None = None
    mock_services: bool = False
    host_published_port: int | None = None
    requires_browser: bool = False
    # True iff the task can only be solved by interpreting an image / visual-only UI
    # state (essential photo/chart/diagram, or screenshot-only state with no DOM/text
    # equivalent). NOT implied by requires_browser. Drives the text_only collection
    # so non-multimodal models can run the text-capable subset. See AGENTS.md.
    requires_vision: bool = False
    runtime_mocks: tuple[RuntimeMockConfig, ...] = ()
    early_terminate: EarlyTerminate | None = None
    output_file_early_terminate: OutputFileEarlyTerminate | None = None


def _resolve_project_path(value: str) -> Path:
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = PROJECT_ROOT / path
    return path.resolve()


def _runtime_mock_env_key(name: str, suffix: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9]+", "_", name).strip("_").upper()
    return f"BENCH_RUNTIME_MOCK_{safe}_{suffix}"


def _registry_mock_defaults(name: str) -> dict[str, Any]:
    try:
        from bench_core.mock_services.registry import MOCK_SERVICE_REGISTRY
    except Exception:
        return {}
    spec = MOCK_SERVICE_REGISTRY.get(name)
    if spec is None:
        return {}
    return {
        "source": spec.source_dir,
        "install_path": spec.install_path,
        "kind": spec.kind,
        "port": spec.listen_port,
        "health_path": spec.health_path,
        "launcher": spec.launcher,
        "bin_names": list(spec.bin_names),
        "bench_bin": spec.bench_bin,
        "isolate": getattr(spec, "isolate", False),
        "isolation_model": getattr(spec, "isolation_model", None),
    }


def _runtime_mock_default_source(name: str) -> str | None:
    defaults = _registry_mock_defaults(name)
    if defaults.get("source"):
        return str(defaults["source"])
    candidate = PROJECT_ROOT / "bench_core" / "mock_services" / name
    return str(candidate) if candidate.is_dir() else None


def _parse_runtime_mock_port(task_id: str, mock_name: str, value: Any) -> int | None:
    if value in (None, ""):
        return None
    try:
        port = int(value)
    except (TypeError, ValueError):
        raise SystemExit(
            f"task {task_id}: runtime mock {mock_name!r} port must be an integer, got {value!r}"
        )
    if port <= 0 or port > 65535:
        raise SystemExit(
            f"task {task_id}: runtime mock {mock_name!r} port out of range: {port}"
        )
    return port


def _parse_runtime_mocks(task_id: str, environment: dict[str, Any]) -> tuple[RuntimeMockConfig, ...]:
    raw = environment.get("runtime_mocks")
    if raw is None:
        return ()

    entries: dict[str, dict[str, Any]] = {}
    if isinstance(raw, list):
        for item in raw:
            name = str(item).strip()
            if not name:
                raise SystemExit(f"task {task_id}: runtime_mocks contains an empty service name")
            entries[name] = {}
    elif isinstance(raw, dict):
        listed = raw.get("services") or raw.get("names") or []
        if listed:
            if not isinstance(listed, list):
                raise SystemExit(
                    f"task {task_id}: [environment.runtime_mocks].services must be a list"
                )
            for item in listed:
                name = str(item).strip()
                if not name:
                    raise SystemExit(f"task {task_id}: runtime_mocks.services contains an empty name")
                entries[name] = {}
        for name, value in raw.items():
            if name in {"services", "names"}:
                continue
            if not isinstance(value, dict):
                raise SystemExit(
                    f"task {task_id}: [environment.runtime_mocks.{name}] must be a table"
                )
            entries[str(name)] = dict(value)
    else:
        raise SystemExit(
            f"task {task_id}: [environment].runtime_mocks must be a list or table"
        )

    configs: list[RuntimeMockConfig] = []
    for name, overrides in entries.items():
        if not re.match(r"^[A-Za-z0-9_.-]+$", name):
            raise SystemExit(
                f"task {task_id}: runtime mock name must be path-safe, got {name!r}"
            )
        defaults = _registry_mock_defaults(name)
        source_raw = overrides.get("source") or _runtime_mock_default_source(name)
        if not source_raw:
            raise SystemExit(
                f"task {task_id}: runtime mock {name!r} needs a source path or registry entry"
            )
        source_dir = _resolve_project_path(str(source_raw))
        if not source_dir.is_dir():
            raise SystemExit(
                f"task {task_id}: runtime mock {name!r} source directory missing: {source_dir}"
            )
        kind = str(overrides.get("kind") or defaults.get("kind") or "http")
        if kind not in {"http", "cli"}:
            raise SystemExit(
                f"task {task_id}: runtime mock {name!r} kind must be 'http' or 'cli', got {kind!r}"
            )
        port = _parse_runtime_mock_port(task_id, name, overrides.get("port", defaults.get("port")))
        health_path = overrides.get("health_path", defaults.get("health_path"))
        if health_path is not None:
            health_path = str(health_path)
            if health_path and not health_path.startswith("/"):
                health_path = "/" + health_path
        env_raw = overrides.get("env") or {}
        if not isinstance(env_raw, dict):
            raise SystemExit(
                f"task {task_id}: runtime mock {name!r} env must be a table"
            )
        bin_raw = overrides.get("bin_names", defaults.get("bin_names") or [])
        if isinstance(bin_raw, str):
            bin_names = (bin_raw,)
        elif isinstance(bin_raw, list):
            bin_names = tuple(str(item) for item in bin_raw)
        else:
            raise SystemExit(
                f"task {task_id}: runtime mock {name!r} bin_names must be a string or list"
            )
        configs.append(
            RuntimeMockConfig(
                name=name,
                source_dir=source_dir,
                install_path=(
                    str(overrides.get("install_path") or defaults.get("install_path"))
                    if (overrides.get("install_path") or defaults.get("install_path"))
                    else None
                ),
                kind=kind,
                port=port,
                health_path=health_path or None,
                launcher=str(overrides.get("launcher") or defaults.get("launcher") or ""),
                env={str(k): str(v) for k, v in env_raw.items()},
                bin_names=bin_names,
                bench_bin=(
                    str(overrides.get("bench_bin") or defaults.get("bench_bin"))
                    if (overrides.get("bench_bin") or defaults.get("bench_bin"))
                    else None
                ),
                include_node_modules=bool(overrides.get("include_node_modules", False)),
                isolate=bool(overrides.get("isolate", defaults.get("isolate", False))),
                isolation_model=(
                    str(overrides.get("isolation_model") or defaults.get("isolation_model"))
                    if (overrides.get("isolation_model") or defaults.get("isolation_model"))
                    else None
                ),
            )
        )
    return tuple(configs)


def _container_ports_to_publish(spec: TaskSpec) -> list[int]:
    ports: list[int] = []
    if spec.host_published_port is not None:
        ports.append(spec.host_published_port)
    for mock in spec.runtime_mocks:
        if mock.port is not None and mock.port not in ports:
            ports.append(mock.port)
    return ports


def load_task(task_id: str) -> TaskSpec:
    case_dir = DATASETS_DIR / task_id
    task_toml = case_dir / "task.toml"
    if not task_toml.is_file():
        for candidate in DATASETS_DIR.rglob("task.toml"):
            cdata = tomllib.loads(candidate.read_text(encoding="utf-8"))
            if cdata.get("task", {}).get("id") == task_id:
                case_dir = candidate.parent
                task_toml = candidate
                break
        else:
            raise SystemExit(f"task not found: {task_id} (searched {DATASETS_DIR})")
    data = tomllib.loads(task_toml.read_text(encoding="utf-8"))
    task = data.get("task", {})
    agent = data.get("agent", {})
    verifier = data.get("verifier", {})
    environment = data.get("environment", {})
    host_port_raw = environment.get("host_published_port")
    host_published_port: int | None = None
    if host_port_raw is not None:
        try:
            host_published_port = int(host_port_raw)
        except (TypeError, ValueError):
            raise SystemExit(
                f"task {task_id}: [environment].host_published_port must be an integer, got {host_port_raw!r}"
            )
        if host_published_port <= 0 or host_published_port > 65535:
            raise SystemExit(
                f"task {task_id}: [environment].host_published_port out of range: {host_published_port}"
            )
    runtime_mocks = _parse_runtime_mocks(task_id, environment)
    implicit_host_port = None
    runtime_mock_ports = [mock.port for mock in runtime_mocks if mock.port is not None]
    if host_published_port is None and len(runtime_mock_ports) == 1:
        implicit_host_port = runtime_mock_ports[0]
    early_terminate: EarlyTerminate | None = None
    et_raw = environment.get("early_terminate")
    if et_raw is not None:
        if not isinstance(et_raw, dict):
            raise SystemExit(
                f"task {task_id}: [environment.early_terminate] must be a table"
            )
        required = ("poll_path", "match_kind", "match_field", "match_value")
        for key in required:
            if key not in et_raw:
                raise SystemExit(
                    f"task {task_id}: [environment.early_terminate].{key} is required"
                )
        match_kind = str(et_raw["match_kind"])
        if match_kind != "list_any_field_equals":
            raise SystemExit(
                f"task {task_id}: unsupported early_terminate.match_kind {match_kind!r}"
            )
        if host_published_port is None and implicit_host_port is None:
            raise SystemExit(
                f"task {task_id}: early_terminate requires host_published_port or exactly one runtime mock port"
            )
        early_terminate = EarlyTerminate(
            poll_path=str(et_raw["poll_path"]),
            poll_interval_sec=float(et_raw.get("poll_interval_sec", 5)),
            match_kind=match_kind,
            match_field=str(et_raw["match_field"]),
            match_value=str(et_raw["match_value"]),
            kill_pattern=str(et_raw.get("kill_pattern", "bun run runner.ts")),
        )
    output_file_early_terminate: OutputFileEarlyTerminate | None = None
    output_et_raw = environment.get("output_file_early_terminate")
    if output_et_raw is not None:
        if not isinstance(output_et_raw, dict):
            raise SystemExit(
                f"task {task_id}: [environment.output_file_early_terminate] must be a table"
            )
        output_path = str(output_et_raw.get("output_path") or "")
        if not output_path.startswith("/"):
            raise SystemExit(
                f"task {task_id}: [environment.output_file_early_terminate].output_path must be an absolute path"
            )
        output_file_early_terminate = OutputFileEarlyTerminate(
            output_path=output_path,
            poll_interval_sec=float(output_et_raw.get("poll_interval_sec", 2)),
            kill_pattern=str(output_et_raw.get("kill_pattern", "bun run runner.ts")),
        )
    # Layout-aware default for the verifier entrypoint: the new layout uses
    # grader/run.sh, the old (frozen v2) layout uses test.sh. The task prompt file
    # is `task.md` in BOTH layouts. An explicit [task].entrypoint / [task].test in
    # task.toml always wins over the detected default.
    test_default = "grader/run.sh" if (case_dir / "grader" / "run.sh").is_file() else "test.sh"
    return TaskSpec(
        task_id=str(task.get("id") or task_id),
        case_dir=case_dir,
        name=str(task.get("name") or task_id),
        language=str(task.get("language") or "zh-CN"),
        timeout_sec=int(agent.get("timeout_sec", 900)),
        max_actions=int(agent.get("max_actions", 6)),
        verifier_timeout_sec=int(verifier.get("timeout_sec", 120)),
        entrypoint=str(task.get("entrypoint") or "task.md"),
        test_script=str(task.get("test") or test_default),
        rubric=str(task.get("rubric") or "rubric.json"),
        private_dir=(case_dir / "private") if (case_dir / "private").is_dir() else None,
        mock_services=bool(environment.get("mock_services", False) or runtime_mocks),
        host_published_port=host_published_port,
        requires_browser=bool(environment.get("requires_browser", False)),
        requires_vision=bool(environment.get("requires_vision", False)),
        runtime_mocks=runtime_mocks,
        early_terminate=early_terminate,
        output_file_early_terminate=output_file_early_terminate,
    )


def apply_agent_limit_overrides(spec: TaskSpec, args: argparse.Namespace) -> None:
    """Apply per-run agent limit relaxations on top of task.toml values.

    Both knobs use ``final = max(int(orig * multiplier), floor)`` so the user
    can pick either a relative scale (multiplier > 1.0 for high-thinking runs)
    or an absolute lower bound, or both. Defaults (1.0, 0) are a no-op so
    today's runs are unaffected unless the YAML/CLI explicitly opts in.

    ``--browser-subagent-timeout-sec`` is injected as the
    ``BROWSER_SUBAGENT_TIMEOUT_SECONDS`` env var consumed by the
    ``*-subagent-inherit`` image patch; leaving it unset keeps the image's
    built-in 600s.
    """
    timeout_mult = float(getattr(args, "agent_timeout_multiplier", 1.0) or 1.0)
    timeout_floor = int(getattr(args, "agent_timeout_min_sec", 0) or 0)
    if timeout_mult != 1.0 or timeout_floor > 0:
        spec.timeout_sec = max(int(spec.timeout_sec * timeout_mult), timeout_floor)

    actions_mult = float(getattr(args, "agent_max_actions_multiplier", 1.0) or 1.0)
    actions_floor = int(getattr(args, "agent_max_actions_min", 0) or 0)
    if actions_mult != 1.0 or actions_floor > 0:
        spec.max_actions = max(int(spec.max_actions * actions_mult), actions_floor)

    browser_timeout = getattr(args, "browser_subagent_timeout_sec", None)
    if browser_timeout is not None:
        env_list = list(getattr(args, "env", []) or [])
        if not any(item.startswith("BROWSER_SUBAGENT_TIMEOUT_SECONDS=") for item in env_list):
            env_list.append(f"BROWSER_SUBAGENT_TIMEOUT_SECONDS={int(browser_timeout)}")
            args.env = env_list


def ensure_task_contract(spec: TaskSpec) -> None:
    required = [
        spec.case_dir / spec.entrypoint,
        spec.case_dir / spec.test_script,
        spec.case_dir / spec.rubric,
    ]
    for path in required:
        if not path.exists():
            raise SystemExit(f"task contract missing: {path}")
    if not os.access(spec.case_dir / spec.test_script, os.X_OK):
        raise SystemExit(f"test script is not executable: {spec.case_dir / spec.test_script}")


def copy_public_task_dir(src: Path, dst: Path) -> None:
    """Copy the agent-visible task content, never exposing verifier-only data.

    New layout (allowlist): the agent sees ONLY ``workspace/`` (its inputs) plus
    the task statement ``task.md``. Everything verifier-only — ``grader/``,
    ``services/`` (mock source), ``private/``, ``rubric.json``, ``task.toml`` —
    lives outside ``workspace/`` and is structurally excluded by not copying it.
    This replaces the old blocklist, where a mock/verifier filename missing from
    the ignore tuple would leak answers to the agent.

    Old layout (frozen v2, no ``grader/``/``workspace/``): fall back to the
    historical blocklist over the whole task dir. Removed once v2 migrates (Phase 2).
    """
    workspace = src / "workspace"
    # Detect the new layout by grader/ or workspace/ so browse-only tasks (no
    # agent inputs → no workspace/) still take the allowlist path instead of
    # falling through to the old blocklist (which would leak grader/ + services/).
    is_new_layout = (src / "grader").is_dir() or workspace.is_dir()
    if is_new_layout:
        dst.mkdir(parents=True, exist_ok=True)
        if workspace.is_dir():
            shutil.copytree(
                workspace,
                dst / "workspace",
                ignore=shutil.ignore_patterns(".DS_Store", "__pycache__", "*.pyc"),
            )
        task_md = src / "task.md"
        if task_md.is_file():
            shutil.copy2(task_md, dst / "task.md")
        return
    ignore = shutil.ignore_patterns(
        ".DS_Store",
        "fixtures",
        "attachments",
        "node_modules",
        "private",
        "__pycache__",
        "*.pyc",
        "rubric.json",
        "test.sh",
        "task.toml",
        "source_metadata.json",
        "REFERENCE_SOLUTION.py",
        "_grader.py",
        "host_deps.txt",
        "package.json",
        "package-lock.json",
        "start_mock_services.sh",
        "mock*.py",
        "mock*.js",
        "*server.py",
        "*server.js",
        "*.mjs",
        "verify*.py",
        "INPUTS_TO_BUILD.md",
        "ASSET_INVENTORY.md",
        "EXPECTED_BEHAVIOR.md",
    )
    shutil.copytree(src, dst, ignore=ignore)


def copy_mock_runtime_task_dir(src: Path, dst: Path) -> None:
    """Copy the mock-service source into a non-public runtime path.

    New layout: mock code + launcher live in ``services/``. Old layout (frozen
    v2): they live in ``files/`` (the launcher gets scrubbed post-startup). The
    subtree name (``services``/``files``) is preserved so the in-container
    launcher path matches what ``start_task_mock_services`` expects.
    """
    mock_src = src / "services"
    if not mock_src.is_dir():
        mock_src = src / "files"
    if not mock_src.is_dir():
        return
    dst.mkdir(parents=True, exist_ok=True)
    shutil.copytree(
        mock_src,
        dst / mock_src.name,
        ignore=shutil.ignore_patterns(".DS_Store", "__pycache__", "*.pyc", "verify*.py"),
    )


def copy_mock_runtime_private_dir(src: Path | None, dst: Path) -> None:
    """Copy private materials needed by the mock runtime, excluding grading truth.

    Two channels:
      - ``reactive_replies.json`` at the private/ root (used by the 6 ``*-mock`` tasks).
      - ``seed_overlay.json`` at the private/ root for baked daemon mocks whose
        task-specific state is layered on top of the default seed.
      - ``mock_runtime/`` subdirectory containing mock server source + snapshots,
        for tasks shipping their mock bundle inside the task instead of baking
        it into the workstation image. ``files/fixtures/`` is banned (see
        CLAUDE.md §16); use this private/mock_runtime/ channel instead.
    """
    if src is None:
        return
    dst.mkdir(parents=True, exist_ok=True)
    reactive = src / "reactive_replies.json"
    if reactive.is_file():
        shutil.copy2(reactive, dst / reactive.name)
    seed_overlay = src / "seed_overlay.json"
    if seed_overlay.is_file():
        shutil.copy2(seed_overlay, dst / seed_overlay.name)
    mock_runtime_src = src / "mock_runtime"
    if mock_runtime_src.is_dir():
        shutil.copytree(
            mock_runtime_src,
            dst / "mock_runtime",
            ignore=shutil.ignore_patterns(
                ".DS_Store", "__pycache__", "*.pyc", "node_modules"
            ),
        )


def _runtime_mock_ignore(mock: RuntimeMockConfig):
    patterns = [".DS_Store", "__pycache__", "*.pyc", ".git", "data", "uploads"]
    if not mock.include_node_modules:
        patterns.append("node_modules")
    return shutil.ignore_patterns(*patterns)


def _runtime_mock_uses_baked_daemon(mock: RuntimeMockConfig) -> bool:
    return bool(mock.isolate and mock.isolation_model == "daemon_cli" and mock.install_path)


def _runtime_mock_uses_baked_source(mock: RuntimeMockConfig) -> bool:
    return bool(mock.install_path and str(mock.install_path).startswith("/opt/mock_services/"))


def _runtime_mock_needs_source_isolation_caps(mock: RuntimeMockConfig) -> bool:
    return _runtime_mock_uses_baked_source(mock) or _runtime_mock_uses_baked_daemon(mock)


def _runtime_mock_container_dir(mock: RuntimeMockConfig, remote_runtime_mocks_dir: str) -> str:
    if _runtime_mock_uses_baked_source(mock):
        return str(mock.install_path)
    return f"{remote_runtime_mocks_dir}/{mock.name}"


def copy_runtime_mock_sources(runtime_mocks: tuple[RuntimeMockConfig, ...], dst: Path) -> None:
    if not runtime_mocks:
        return
    copyable = [mock for mock in runtime_mocks if not _runtime_mock_uses_baked_source(mock)]
    if not copyable:
        return
    dst.mkdir(parents=True, exist_ok=True)
    for mock in copyable:
        target = dst / mock.name
        if target.exists():
            shutil.rmtree(target)
        shutil.copytree(mock.source_dir, target, ignore=_runtime_mock_ignore(mock))
    if any(mock.kind == "cli" for mock in copyable):
        bridge_src = PROJECT_ROOT / "bench_core" / "mock_services" / "bench_bridge.py"
        if not bridge_src.is_file():
            raise SystemExit(f"CLI runtime mocks require missing bench bridge: {bridge_src}")
        shutil.copy2(bridge_src, dst / "bench_bridge.py")


def _has_workspace_image_inputs(case_dir: Path) -> bool:
    """True if the task ships image files anywhere under workspace/ (candidates the
    agent may need to browser-upload). Drives Accio upload staging — images live in
    various subdirs across tasks (images/, product_images/, assets/, product_photos/),
    so match by extension, not a fixed subdir name."""
    ws = case_dir / "workspace"
    if not ws.is_dir():
        return False
    exts = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
    return any(p.is_file() and p.suffix.lower() in exts for p in ws.rglob("*"))


def container_running(name: str) -> bool:
    proc = docker("inspect", "-f", "{{.State.Running}}", name, check=False, capture=True)
    return proc.returncode == 0 and (proc.stdout or "").strip() == "true"


def container_exists(name: str) -> bool:
    return docker("inspect", name, check=False, capture=True).returncode == 0


def make_container_name(run_id: str) -> str:
    safe = re.sub(r"[^a-zA-Z0-9_.-]+", "-", run_id).strip("-") or "run"
    safe = safe[:80].strip("-") or "run"
    return f"awb-{safe}-{datetime.now().strftime('%H%M%S%f')}"


def wait_for_exec(container: str, cmd: str, timeout_sec: int, label: str) -> bool:
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        proc = docker("exec", container, "bash", "-lc", cmd, check=False, capture=True)
        if proc.returncode == 0:
            return True
        time.sleep(2)
    print(f"[WARN] timed out waiting for {label}", file=sys.stderr)
    return False


def python_http_probe(*urls: str) -> str:
    code = (
        "import sys, urllib.request\n"
        "for url in sys.argv[1:]:\n"
        "    try:\n"
        "        urllib.request.urlopen(url, timeout=2).read()\n"
        "        raise SystemExit(0)\n"
        "    except Exception:\n"
        "        pass\n"
        "raise SystemExit(1)\n"
    )
    return "python3 -c " + shlex.quote(code) + " " + " ".join(shlex.quote(url) for url in urls)


def _container_user_exists(container: str, user: str) -> bool:
    return docker("exec", container, "getent", "passwd", user, check=False, capture=True).returncode == 0


def _runtime_mock_state_env_lines(mock: RuntimeMockConfig, remote_workdir: str, *, isolated_state_root: str | None = None) -> list[str]:
    state_root = isolated_state_root or f"{remote_workdir}/tmp/runtime_mock_state/{mock.name}"
    lines = [f"mkdir -p {shlex.quote(state_root)}"]
    if mock.name == "gmail_mock":
        lines.append(f"export GMAIL_MOCK_DB=${{GMAIL_MOCK_DB:-{shlex.quote(state_root + '/gmail.db')}}}")
        lines.append('export GMAIL_MOCK_HOST="${GMAIL_MOCK_HOST:-0.0.0.0}"')
    elif mock.name == "box_cli":
        lines.append(f"export BOX_MOCK_HOME=${{BOX_MOCK_HOME:-{shlex.quote(state_root)}}}")
    elif mock.name == "jira_cli":
        lines.append(f"export JIRA_MOCK_HOME=${{JIRA_MOCK_HOME:-{shlex.quote(state_root)}}}")
        lines.append('export JIRA_API_TOKEN="${JIRA_API_TOKEN:-mock-jira-token-bench}"')
    elif mock.name == "todoist_cli":
        lines.append(f"export TODOIST_MOCK_HOME=${{TODOIST_MOCK_HOME:-{shlex.quote(state_root)}}}")
        lines.append('export TODOIST_TOKEN="${TODOIST_TOKEN:-mock-todoist-token-bench}"')
    elif mock.name == "stripe_cli":
        lines.append(f"export STRIPE_MOCK_DB=${{STRIPE_MOCK_DB:-{shlex.quote(state_root + '/stripe_mock.sqlite')}}}")
    elif mock.name == "dws_doc_cli":
        lines.append(f"export DWS_MOCK_HOME=${{DWS_MOCK_HOME:-{shlex.quote(state_root)}}}")
    elif mock.name == "google_workspace_cli":
        lines.append(f"export GWS_MOCK_HOME=${{GWS_MOCK_HOME:-{shlex.quote(state_root)}}}")
    elif mock.name == "notion_cli":
        lines.append(f"export NTN_MOCK_DATA_DIR=${{NTN_MOCK_DATA_DIR:-{shlex.quote(state_root)}}}")
        lines.append('export NTN_MOCK_PORT="${NTN_MOCK_PORT:-3456}"')
        lines.append('export NTN_MOCK_NO_AUTO_SERVER="${NTN_MOCK_NO_AUTO_SERVER:-1}"')
        lines.append('export NTN_MOCK_SEED_PROFILE="${NTN_MOCK_SEED_PROFILE:-commerce}"')
    elif mock.name == "google_docs_mock":
        lines.append(f"export GDOCS_MOCK_STATE_DIR=${{GDOCS_MOCK_STATE_DIR:-{shlex.quote(state_root)}}}")
    for key, value in mock.env.items():
        lines.append(f"export {key}={shlex.quote(value)}")
    return lines


def _runtime_mock_daemon_state_env(mock: RuntimeMockConfig, state_root: str) -> dict[str, str]:
    env = {str(k): str(v) for k, v in mock.env.items()}
    if mock.name == "box_cli":
        env.update({"BOX_MOCK_HOME": state_root})
    elif mock.name == "jira_cli":
        env.update({
            "JIRA_MOCK_HOME": state_root,
            "JIRA_API_TOKEN": "mock-jira-token-bench",
        })
    elif mock.name == "todoist_cli":
        env.update({
            "TODOIST_MOCK_HOME": state_root,
            "TODOIST_TOKEN": "mock-todoist-token-bench",
        })
    elif mock.name == "stripe_cli":
        env.update({
            "STRIPE_MOCK_DB": f"{state_root}/stripe_mock.sqlite",
            "STRIPE_API_KEY": "sk_test_mock_benchmark_key",
        })
    elif mock.name == "dws_doc_cli":
        env.update({"DWS_MOCK_HOME": state_root})
    elif mock.name == "google_workspace_cli":
        env.update({"GWS_MOCK_HOME": state_root})
    elif mock.name == "notion_cli":
        env.update({
            "NTN_MOCK_DATA_DIR": state_root,
            "NTN_MOCK_PORT": str(mock.port or env.get("NTN_MOCK_PORT") or "3456"),
            "NTN_MOCK_NO_AUTO_SERVER": "1",
            "NTN_MOCK_SEED_PROFILE": env.get("NTN_MOCK_SEED_PROFILE", "commerce"),
        })
    return env


def _install_runtime_mock_cli_wrappers(
    container: str,
    runtime_mocks: tuple[RuntimeMockConfig, ...],
    remote_runtime_mocks_dir: str,
    remote_workdir: str,
) -> list[dict[str, Any]]:
    installed: list[dict[str, Any]] = []
    for mock in runtime_mocks:
        if mock.kind != "cli" or not mock.bin_names:
            continue
        service_dir = _runtime_mock_container_dir(mock, remote_runtime_mocks_dir)
        for bin_name in mock.bin_names:
            if not re.match(r"^[A-Za-z0-9_.+-]+$", bin_name):
                raise SystemExit(f"invalid runtime mock CLI binary name: {bin_name!r}")
            target_bin = f"{service_dir}/bin/{bin_name}"
            wrapper_path = f"/usr/local/bin/{bin_name}"
            if mock.isolate and mock.isolation_model == "daemon_cli":
                if not mock.port:
                    raise SystemExit(f"isolated daemon_cli mock {mock.name!r} requires a listen port")
                wrapper = "\n".join([
                    "#!/usr/bin/env python3",
                    "import base64, json, os, sys, urllib.error, urllib.request",
                    f"URL = 'http://127.0.0.1:{mock.port}/__cli/exec'",
                    "def maybe_file_payload(argv):",
                    "    files = {}",
                    "    for arg in argv:",
                    "        if not arg or arg.startswith('-') or arg in files:",
                    "            continue",
                    "        path = os.path.abspath(arg)",
                    "        try:",
                    "            st = os.stat(path)",
                    "        except OSError:",
                    "            continue",
                    "        if not os.path.isfile(path) or st.st_size > 1024 * 1024:",
                    "            continue",
                    "        try:",
                    "            with open(path, 'rb') as fh:",
                    "                content = base64.b64encode(fh.read()).decode('ascii')",
                    "        except OSError:",
                    "            continue",
                    "        files[arg] = {'path': path, 'content_b64': content}",
                    "    return files",
                    "def daemon_usable_cwd():",
                    "    # The daemon spawns the real CLI as the unprivileged mocksvc",
                    "    # user. A cwd mocksvc cannot traverse makes that spawn fail as a",
                    "    # bare exit 127 with empty stdout AND stderr, which from the",
                    "    # agent's side is indistinguishable from a broken CLI. An agent",
                    "    # shell whose default cwd is /root (0700, root-owned) would hit",
                    "    # that on every call.",
                    "    # Forward the cwd only when every component carries the",
                    "    # world-execute bit mocksvc needs, else send '' and let the daemon",
                    "    # fall back to /. Per-component is required: a 0777 leaf under a",
                    "    # 0700 parent is still untraversable.",
                    "    try:",
                    "        cwd = os.getcwd()",
                    "    except OSError:",
                    "        return ''",
                    "    parts = [p for p in cwd.split('/') if p]",
                    "    probe = '/'",
                    "    for part in [''] + parts:",
                    "        probe = os.path.join(probe, part) if part else '/'",
                    "        try:",
                    "            if not os.stat(probe).st_mode & 0o001:",
                    "                return ''",
                    "        except OSError:",
                    "            return ''",
                    "    return cwd",
                    "argv = sys.argv[1:]",
                    "stdin = None if sys.stdin.isatty() else sys.stdin.buffer.read().decode('utf-8', 'surrogateescape')",
                    "env = {k: v for k, v in os.environ.items() if k in ('NO_COLOR', 'TERM', 'COLUMNS', 'LINES', 'LANG', 'LC_ALL')}",
                    "payload = {'argv': argv, 'stdin': stdin or '', 'cwd': daemon_usable_cwd(), 'env': env, 'files': maybe_file_payload(argv)}",
                    "req = urllib.request.Request(URL, data=json.dumps(payload).encode('utf-8'), headers={'Content-Type': 'application/json'})",
                    "try:",
                    "    with urllib.request.urlopen(req, timeout=180) as resp:",
                    "        result = json.loads(resp.read().decode('utf-8'))",
                    "except urllib.error.URLError as exc:",
                    "    sys.stderr.write(f'Error: CLI mock daemon unavailable: {exc}\\n')",
                    "    sys.exit(127)",
                    "sys.stdout.write(result.get('stdout') or '')",
                    "sys.stderr.write(result.get('stderr') or '')",
                    "sys.exit(int(result.get('exit_code', 1)))",
                    "",
                ])
                command = (
                    f"cat > {shlex.quote(wrapper_path)} <<'EOF'\n{wrapper}EOF\n"
                    f"chmod +x {shlex.quote(wrapper_path)}"
                )
            else:
                env_lines = _runtime_mock_state_env_lines(mock, remote_workdir)
                wrapper = "\n".join([
                    "#!/usr/bin/env bash",
                    "set -euo pipefail",
                    *env_lines,
                    f"exec bun {shlex.quote(target_bin)} \"$@\"",
                    "",
                ])
                command = (
                    f"cat > {shlex.quote(wrapper_path)} <<'EOF'\n{wrapper}EOF\n"
                    f"chmod +x {shlex.quote(wrapper_path)} {shlex.quote(target_bin)}"
                )
            proc = docker("exec", container, "bash", "-lc", command, check=False, capture=True)
            installed.append(
                {
                    "mock": mock.name,
                    "bin": bin_name,
                    "path": wrapper_path,
                    "isolated": mock.isolate,
                    "returncode": proc.returncode,
                    "output": (proc.stdout or "").strip(),
                }
            )
            if proc.returncode != 0:
                raise SystemExit(
                    f"failed to install runtime mock CLI wrapper {bin_name!r}: {(proc.stdout or '').strip()}"
                )
    return installed


def setup_runtime_mocks_in_container(
    container: str,
    runtime_mocks: tuple[RuntimeMockConfig, ...],
    remote_runtime_mocks_dir: str,
    remote_workdir: str,
    *,
    isolate_http_mocks: bool,
) -> dict[str, Any]:
    if not runtime_mocks:
        return {"enabled": False}
    unsupported_isolated_cli = [
        m.name for m in runtime_mocks
        if m.isolate and m.bin_names and m.isolation_model != "daemon_cli"
    ]
    if unsupported_isolated_cli:
        raise SystemExit(
            "isolated CLI runtime mocks require isolation_model='daemon_cli': "
            + ", ".join(unsupported_isolated_cli)
        )
    daemon_cli_mocks = [
        m for m in runtime_mocks
        if m.isolate and m.bin_names and m.isolation_model == "daemon_cli"
    ]
    baked_source_mocks = [m for m in runtime_mocks if _runtime_mock_uses_baked_source(m)]
    if daemon_cli_mocks or baked_source_mocks:
        checks = ["test -f /opt/mock_services/cli_daemon/server.mjs"]
        for mock in baked_source_mocks:
            checks.append(f"test -d {shlex.quote(_runtime_mock_container_dir(mock, remote_runtime_mocks_dir))}")
        setup = docker(
            "exec", "--user", "mocksvc", container, "bash", "-lc",
            " && ".join(checks),
            check=False,
            capture=True,
        )
        if setup.returncode != 0:
            raise SystemExit(
                "isolated daemon_cli mock prerequisites missing in container: "
                + (setup.stdout or "").strip()
            )
    result: dict[str, Any] = {
        "enabled": True,
        "container_dir": remote_runtime_mocks_dir,
        "mocks": [
            {
                "name": mock.name,
                "kind": mock.kind,
                "container_dir": _runtime_mock_container_dir(mock, remote_runtime_mocks_dir),
                "port": mock.port,
                "health_path": mock.health_path,
                "bin_names": list(mock.bin_names),
                "isolate": mock.isolate,
                "isolation_model": mock.isolation_model,
            }
            for mock in runtime_mocks
        ],
    }
    if isolate_http_mocks:
        isolated: list[str] = []
        for mock in runtime_mocks:
            if mock.kind != "http":
                continue
            service_dir = _runtime_mock_container_dir(mock, remote_runtime_mocks_dir)
            if _runtime_mock_uses_baked_source(mock):
                docker(
                    "exec", "--user", "mocksvc", container, "bash", "-lc",
                    f"test -d {shlex.quote(service_dir)} && test ! -r /opt/mock_services 2>/dev/null || true",
                    check=False,
                    capture=True,
                )
            else:
                docker(
                    "exec", container, "bash", "-lc",
                    f"chown -R mocksvc:mocksvc {shlex.quote(service_dir)} && chmod -R go-rwx {shlex.quote(service_dir)}",
                    check=False,
                    capture=True,
                )
            isolated.append(mock.name)
        result["http_isolated_as_mocksvc"] = isolated
    result["cli_wrappers"] = _install_runtime_mock_cli_wrappers(
        container,
        runtime_mocks,
        remote_runtime_mocks_dir,
        remote_workdir,
    )
    if daemon_cli_mocks:
        result["cli_isolated_as_mocksvc"] = [mock.name for mock in daemon_cli_mocks]
    return result


def _runtime_mock_metadata(runtime_mocks: tuple[RuntimeMockConfig, ...], remote_runtime_mocks_dir: str) -> list[dict[str, Any]]:
    return [
        {
            "name": mock.name,
            "kind": mock.kind,
            "dir": _runtime_mock_container_dir(mock, remote_runtime_mocks_dir),
            "port": mock.port,
            "health_path": mock.health_path,
            "bin_names": list(mock.bin_names),
            "bench_bin": mock.bench_bin,
            "isolate": mock.isolate,
            "isolation_model": mock.isolation_model,
        }
        for mock in runtime_mocks
    ]


def _runtime_mock_default_launcher(mock: RuntimeMockConfig, service_dir_raw: str) -> str:
    service_dir = shlex.quote(service_dir_raw)
    if mock.kind == "cli":
        return ""
    return f"exec bun {service_dir}/server.js"


def _runtime_mock_start_command(
    spec: TaskSpec,
    remote_runtime_mocks_dir: str,
    remote_workdir: str,
) -> str:
    lines: list[str] = [
        "set -euo pipefail",
        'mkdir -p "$BENCH_WORKDIR/tmp"',
        ': > "$BENCH_WORKDIR/tmp/mock_service_pids"',
        "probe_health() {",
        "  python3 - \"$1\" <<'PY' >/dev/null 2>&1",
        "import sys, urllib.request",
        "urllib.request.urlopen(sys.argv[1], timeout=2).read()",
        "PY",
        "}",
        "wait_health() {",
        "  local name=\"$1\" url=\"$2\" log=\"$3\"",
        "  for _ in $(seq 1 80); do",
        "    if probe_health \"$url\"; then echo \"$name ready: $url\"; return 0; fi",
        "    sleep 0.5",
        "  done",
        "  echo \"$name failed to become ready: $url\" >&2",
        "  tail -n 80 \"$log\" >&2 || true",
        "  return 1",
        "}",
    ]
    for mock in spec.runtime_mocks:
        service_dir_raw = _runtime_mock_container_dir(mock, remote_runtime_mocks_dir)
        service_dir = shlex.quote(service_dir_raw)
        overlay_dir = f'"$BENCH_PRIVATE_DIR/mock_runtime/{mock.name}"'
        log_file = f'"$BENCH_WORKDIR/tmp/{mock.name}.log"'
        lines.append(f"test -d {service_dir} || (echo 'runtime mock missing: {mock.name}' >&2; exit 2)")
        if not _runtime_mock_uses_baked_daemon(mock):
            lines.append(f"if [ -d {overlay_dir} ]; then cp -a {overlay_dir}/. {service_dir}/; fi")
        state_root = f"/var/lib/mocksvc/{mock.name}" if _runtime_mock_uses_baked_daemon(mock) else None
        lines.extend(_runtime_mock_state_env_lines(mock, remote_workdir, isolated_state_root=state_root))
        if mock.isolate and mock.isolation_model == "daemon_cli":
            if mock.port is None or not mock.bench_bin or not mock.bin_names:
                lines.append(f"echo 'daemon_cli mock {mock.name} missing port/bin_names/bench_bin' >&2; exit 2")
                continue
            if mock.name == "notion_cli":
                starter = f"{service_dir_raw}/bin/ntn-daemon-start"
                lines.append(
                    f"{shlex.quote(starter)} --workdir \"$BENCH_WORKDIR\" "
                    f"--private-dir \"$BENCH_PRIVATE_DIR\" --port {shlex.quote(str(mock.port))} "
                    '--token "$MOCK_VERIFIER_TOKEN"'
                )
                continue
            state_env = _runtime_mock_daemon_state_env(mock, f"/var/lib/mocksvc/{mock.name}")
            state_env_json = json.dumps(state_env, ensure_ascii=False)
            target_bin = f"{service_dir_raw}/bin/{mock.bin_names[0]}"
            bench_bin = f"{service_dir_raw}/bin/{mock.bench_bin}"
            lines.append(f"export PORT={mock.port}")
            lines.append('export MOCK_VERIFIER_TOKEN="$MOCK_VERIFIER_TOKEN"')
            lines.append(f"export CCB_CLI_MOCK_NAME={shlex.quote(mock.name)}")
            lines.append(f"export CCB_CLI_TARGET_BIN={shlex.quote(target_bin)}")
            lines.append(f"export CCB_CLI_BENCH_BIN={shlex.quote(bench_bin)}")
            lines.append("export CCB_CLI_BENCH_TOKEN_MODE=env")
            if mock.name in {"dws_doc_cli", "google_workspace_cli"}:
                lines.append("export CCB_CLI_BENCH_PATHS_JSON='{\"/__bench/state\":\"state\",\"/__bench/audit\":\"audit\",\"/api/state\":\"state\",\"/api/audit\":\"audit\"}'")
            lines.append(f"export CCB_CLI_STATE_ENV_JSON={shlex.quote(state_env_json)}")
            lines.append(f"nohup bun /opt/mock_services/cli_daemon/server.mjs >{log_file} 2>&1 &")
            lines.append('echo "$!" >> "$BENCH_WORKDIR/tmp/mock_service_pids"')
            url = f"http://127.0.0.1:{mock.port}/health"
            lines.append(f"wait_health {shlex.quote(mock.name)} {shlex.quote(url)} {log_file}")
            continue
        if mock.kind == "http":
            if mock.port is not None:
                lines.append(f"export PORT={mock.port}")
                lines.append(f"export MOCK_PORT={mock.port}")
            lines.append('export MOCK_VERIFIER_TOKEN="$MOCK_VERIFIER_TOKEN"')
            launcher = mock.launcher or _runtime_mock_default_launcher(mock, service_dir_raw)
            lines.append(f"nohup bash -lc {shlex.quote(launcher)} >{log_file} 2>&1 &")
            lines.append('echo "$!" >> "$BENCH_WORKDIR/tmp/mock_service_pids"')
            if mock.port is not None and mock.health_path:
                url = f"http://127.0.0.1:{mock.port}{mock.health_path}"
                lines.append(f"wait_health {shlex.quote(mock.name)} {shlex.quote(url)} {log_file}")
        elif mock.kind == "cli" and mock.port is not None and mock.bench_bin:
            bridge = '"$BENCH_RUNTIME_MOCKS_DIR/bench_bridge.py"'
            bench_bin = f'"$BENCH_RUNTIME_MOCKS_DIR/{mock.name}/bin/{mock.bench_bin}"'
            lines.append(f"export BENCH_BRIDGE_BIN={bench_bin}")
            lines.append(f"export PORT={mock.port}")
            lines.append(f"nohup python3 {bridge} >{log_file} 2>&1 &")
            lines.append('echo "$!" >> "$BENCH_WORKDIR/tmp/mock_service_pids"')
            url = f"http://127.0.0.1:{mock.port}/health"
            lines.append(f"wait_health {shlex.quote(mock.name)} {shlex.quote(url)} {log_file}")
    lines.append("echo runtime mocks ready")
    return "\n".join(lines)


def start_task_mock_services(
    container: str,
    spec: TaskSpec,
    run_dir: Path,
    remote_mock_case: str,
    remote_mock_private_dir: str,
    remote_runtime_mocks_dir: str,
    remote_workdir: str,
    remote_output_dir: str,
    harness: str = "accio",
) -> dict[str, Any]:
    # New layout keeps the launcher in services/start_services.sh; old (frozen
    # v2) layout keeps it in files/start_mock_services.sh.
    script: str | None = None
    if (spec.case_dir / "services" / "start_services.sh").is_file():
        script = f"{remote_mock_case}/services/start_services.sh"
    elif (spec.case_dir / "files" / "start_mock_services.sh").is_file():
        script = f"{remote_mock_case}/files/start_mock_services.sh"
    verifier_token = secrets.token_urlsafe(32)
    # Mock-source isolation: when the harness image bakes the `mocksvc`
    # system user (commercecraftbench/openclaw:*-publish-shopify-admin and
    # commercecraftbench/codex:*-publish-shopify-admin), mock services run as
    # `mocksvc` so /opt/mock_services/<name>/ stays unreadable to the agent's
    # root bash. Override BENCH_WORKDIR to /var/lib/mocksvc/<task_id> because
    # mocksvc cannot write into the root-owned task workdir; the script uses
    # BENCH_WORKDIR only for log/pid scratch files (mock data still lives
    # under /opt/mock_services/<name>/data/).
    # CLI mocks using daemon_cli isolation run their service side as mocksvc;
    # the agent-facing command remains a root-run thin client with no secrets.
    has_daemon_cli = any(
        m.isolate and m.isolation_model == "daemon_cli" and m.bin_names
        for m in spec.runtime_mocks
    )
    has_baked_source = any(_runtime_mock_uses_baked_source(m) for m in spec.runtime_mocks)
    has_unisolated_cli = any(
        m.kind == "cli" and m.bin_names
        and not (m.isolate and m.isolation_model == "daemon_cli")
        for m in spec.runtime_mocks
    )
    isolate_mocks = (
        _container_user_exists(container, "mocksvc")
        and (
            has_daemon_cli
            or has_baked_source
            or (harness == "openclaw" and not has_unisolated_cli)
        )
    )
    if isolate_mocks:
        mock_workdir = f"/var/lib/mocksvc/{Path(remote_workdir).name}"
        # /var/lib/mocksvc/ is mode 700 owned by mocksvc — root without
        # DAC_OVERRIDE cannot enter it. Create the per-task scratch dir AS
        # mocksvc (who owns the parent).
        docker(
            "exec", "--user", "mocksvc", container, "bash", "-lc",
            f"mkdir -p {shlex.quote(mock_workdir)}",
            check=False, capture=True,
        )
        if not has_daemon_cli:
            # HTTP mock isolation may still need mocksvc to write task-local
            # node_modules or pid/log files in the runtime task copy.
            docker(
                "exec", container, "bash", "-lc",
                f"chown -R mocksvc:mocksvc {shlex.quote(remote_mock_case)}",
                check=False, capture=True,
            )
    else:
        mock_workdir = remote_workdir
    env = {
        "BENCH_TASK_DIR": remote_mock_case,
        "CONTAINER_TASK_DIR": remote_mock_case,
        "BENCH_PRIVATE_DIR": remote_mock_private_dir,
        "CONTAINER_PRIVATE_DIR": remote_mock_private_dir,
        "BENCH_RUNTIME_MOCKS_DIR": remote_runtime_mocks_dir,
        "BENCH_MOCK_ROOT": remote_runtime_mocks_dir,
        "BENCH_RUNTIME_MOCKS_JSON": json.dumps(
            _runtime_mock_metadata(spec.runtime_mocks, remote_runtime_mocks_dir),
            ensure_ascii=False,
        ),
        "BENCH_WORKDIR": mock_workdir,
        "CONTAINER_WORKDIR": mock_workdir,
        "BENCH_OUTPUT_DIR": remote_output_dir,
        "CONTAINER_OUTPUT_DIR": remote_output_dir,
        "MOCK_VERIFIER_TOKEN": verifier_token,
    }
    for mock in spec.runtime_mocks:
        mock_dir = _runtime_mock_container_dir(mock, remote_runtime_mocks_dir)
        env[_runtime_mock_env_key(mock.name, "DIR")] = mock_dir
        if mock.port is not None:
            env[_runtime_mock_env_key(mock.name, "PORT")] = str(mock.port)
            env[_runtime_mock_env_key(mock.name, "URL")] = f"http://127.0.0.1:{mock.port}"
        if mock.health_path:
            env[_runtime_mock_env_key(mock.name, "HEALTH_PATH")] = mock.health_path
        # [environment.runtime_mocks.<name>.env] must reach services/start_services.sh
        # too, not just the generated-runtime-mocks path (else e.g. a non-default
        # NTN_MOCK_SEED_PROFILE silently falls back to the daemon script default).
        for key, value in mock.env.items():
            env[str(key)] = str(value)
    env_prefix = " ".join(f"{key}={shlex.quote(value)}" for key, value in env.items())
    if script:
        command = (
            f"test -f {shlex.quote(script)} || "
            f"(echo 'missing mock service script: {shlex.quote(script)}' >&2; exit 2); "
            f"{env_prefix} bash {shlex.quote(script)}"
        )
        script_label = script
    elif spec.runtime_mocks:
        generated = _runtime_mock_start_command(spec, remote_runtime_mocks_dir, mock_workdir)
        command = f"{env_prefix} bash -lc {shlex.quote(generated)}"
        script_label = "<generated-runtime-mocks>"
    else:
        command = "echo 'missing mock service script and no runtime_mocks declared' >&2; exit 2"
        script_label = "<missing>"
    if isolate_mocks:
        proc = docker("exec", "--user", "mocksvc", container, "bash", "-lc", command, check=False, capture=True)
    else:
        proc = docker("exec", container, "bash", "-lc", command, check=False, capture=True)
    log_path = run_dir / "container" / "mock_services.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log_path.write_text(proc.stdout or "", encoding="utf-8")
    return {
        "enabled": True,
        "script": script_label,
        "returncode": proc.returncode,
        "log": str(log_path),
        "started": proc.returncode == 0,
        "verifier_token": verifier_token,
        "runtime_mocks": _runtime_mock_metadata(spec.runtime_mocks, remote_runtime_mocks_dir),
    }


def scrub_mock_runtime_materials(container: str, remote_mock_case: str, remote_mock_private_dir: str) -> dict[str, Any]:
    """Remove startup scripts and private fixtures after the mock service is live."""
    command = " ; ".join(
        [
            # New layout: services/ is 100% mock-only (launcher + source), so the
            # whole subtree is removed wholesale. No-op when absent (old layout).
            f"rm -rf {shlex.quote(remote_mock_case)}/services",
            f"rm -f {shlex.quote(remote_mock_case)}/files/start_mock_services.sh",
            f"rm -f {shlex.quote(remote_mock_case)}/files/verify*.py",
            f"rm -f {shlex.quote(remote_mock_case)}/files/mock*.py",
            f"rm -f {shlex.quote(remote_mock_case)}/files/*server.py",
            f"find {shlex.quote(remote_mock_case)}/files -type f \\( -name 'server.js' -o -name '*server.js' -o -name 'mock*.js' -o -name '*.mjs' -o -name 'package.json' -o -name 'package-lock.json' \\) -delete 2>/dev/null || true",
            f"find {shlex.quote(remote_mock_case)}/files -type d \\( -name 'node_modules' -o -name 'fixtures' \\) -prune -exec rm -rf {{}} + 2>/dev/null || true",
            f"rm -f {shlex.quote(remote_mock_case)}/files/*.md",
            f"rm -rf {shlex.quote(remote_mock_case)}/files/fixtures",
            f"rm -rf {shlex.quote(remote_mock_private_dir)}" if remote_mock_private_dir else "true",
        ]
    )
    attempts: list[dict[str, Any]] = []
    proc = docker("exec", container, "bash", "-lc", command, check=False, capture=True)
    attempts.append({
        "user": "root",
        "returncode": proc.returncode,
        "output": (proc.stdout or "").strip(),
    })
    if proc.returncode != 0 and _container_user_exists(container, "mocksvc"):
        proc = docker(
            "exec", "--user", "mocksvc", container, "bash", "-lc", command,
            check=False,
            capture=True,
        )
        attempts.append({
            "user": "mocksvc",
            "returncode": proc.returncode,
            "output": (proc.stdout or "").strip(),
        })
    if proc.returncode != 0:
        owner_specs: list[str] = []
        for path in (remote_mock_case, remote_mock_private_dir):
            if not path:
                continue
            stat = docker(
                "exec", container, "stat", "-c", "%u:%g", path,
                check=False,
                capture=True,
            )
            owner = (stat.stdout or "").strip().splitlines()[-1:] or []
            if stat.returncode == 0 and owner and owner[0] not in {"0:0"} and owner[0] not in owner_specs:
                owner_specs.append(owner[0])
        for owner in owner_specs:
            proc = docker(
                "exec", "--user", owner, container, "bash", "-lc", command,
                check=False,
                capture=True,
            )
            attempts.append({
                "user": owner,
                "returncode": proc.returncode,
                "output": (proc.stdout or "").strip(),
            })
            if proc.returncode == 0:
                break
        if proc.returncode != 0:
            proc = docker("exec", container, "bash", "-lc", command, check=False, capture=True)
            attempts.append({
                "user": "root-after-owner",
                "returncode": proc.returncode,
                "output": (proc.stdout or "").strip(),
            })
    return {
        "attempted": True,
        "returncode": proc.returncode,
        "output": (proc.stdout or "").strip(),
        "removed": proc.returncode == 0,
        "attempts": attempts,
    }


def start_container(
    args: argparse.Namespace,
    run_dir: Path,
    run_id: str,
    task_id: str,
    *,
    host_published_port: int | None = None,
    host_published_ports: list[int] | None = None,
    isolate_cli_mocks: bool = False,
) -> str:
    login_state = Path(args.login_state_dir).expanduser().resolve() if args.login_state_dir else None
    use_accio_login = args.harness == "accio" and login_state and not args.no_login_mounts
    if use_accio_login:
        if not (login_state / ".accio").is_dir():
            raise SystemExit(f"login state missing .accio/: {login_state}")
        if not (login_state / ".config" / "accio").is_dir():
            raise SystemExit(f"login state missing .config/accio/: {login_state}")

    name = args.container_name or make_container_name(run_id)
    if container_exists(name):
        raise SystemExit(f"container already exists, refusing to replace it: {name}")

    log_mount = run_dir / "container" / "host-logs"
    workspace_mount = run_dir / "workspace"
    output_mount = workspace_mount / "outputs"
    # Both OpenClaw and Codex (when running the *-publish-shopify-admin
    # all-mocks image) drop DAC_OVERRIDE — without 0777 the in-container
    # root cannot write to bind-mounted host dirs owned by the host user.
    # Accio also drops caps when a task declares isolate=true on CLI mocks.
    isolate_mocks_caps = args.harness == "openclaw" or isolate_cli_mocks
    if not args.no_output_mounts:
        log_mount.mkdir(parents=True, exist_ok=True)
        output_mount.mkdir(parents=True, exist_ok=True)
        (workspace_mount / "tmp").mkdir(parents=True, exist_ok=True)
        if isolate_mocks_caps:
            for d in (workspace_mount, output_mount, workspace_mount / "tmp", log_mount):
                d.chmod(0o777)

    screenshots_mount = run_dir / "screenshots"
    screenshots_enabled = not args.no_screenshots and not args.no_output_mounts
    if screenshots_enabled:
        screenshots_mount.mkdir(parents=True, exist_ok=True)
        if isolate_mocks_caps:
            screenshots_mount.chmod(0o777)

    cmd = [
        "run",
        "-d",
        "--name",
        name,
        "--label",
        "commerce-agent-bench=true",
        "--label",
        f"commerce-agent-bench.run_id={run_id}",
        "--label",
        f"commerce-agent-bench.task_id={task_id}",
    ]
    if args.platform != "native":
        cmd.extend(["--platform", args.platform])
    if not args.no_relaxed_security and not isolate_cli_mocks:
        cmd.extend(["--cap-add", "SYS_PTRACE", "--security-opt", "seccomp=unconfined"])
    # OpenClaw mock-source isolation: drop the caps that let root in-container
    # bypass file perms or escalate to mocksvc. Agent runs as root via
    # OpenClaw's exec tool but must NOT be able to read mocksvc-owned
    # /opt/mock_services/<name>/server.js / validation.js / fields.js / *.db.
    #   - DAC_OVERRIDE      → root reading non-readable files
    #   - DAC_READ_SEARCH   → root searching dirs without x
    #   - FOWNER            → root chmod-ing files it does not own
    #   - SETUID + SETGID   → root setuid-ing to mocksvc via runuser/su/python
    #                         (image already strips the setuid bit on those
    #                         binaries, but raw setuid syscall is a 2nd path)
    # Image-side prep is in docker/openclaw/Dockerfile.all-mocks (mocksvc
    # user, chown /opt/mock_services to mocksvc:mocksvc mode 0700, strip
    # setuid bits). Mock services launch via `docker exec --user mocksvc`
    # at orchestration level (start_task_mock_services), which goes through
    # the Docker daemon and bypasses these in-container cap drops — so mock
    # startup is unaffected.
    if args.harness == "openclaw":
        cap_drops = [
            "--cap-drop", "DAC_OVERRIDE",
            "--cap-drop", "DAC_READ_SEARCH",
            "--cap-drop", "FOWNER",
            "--cap-drop", "SETUID",
            "--cap-drop", "SETGID",
        ]
        if isolate_cli_mocks:
            cap_drops.extend(["--cap-drop", "CHOWN", "--cap-drop", "SYS_PTRACE"])
        cmd.extend(cap_drops)
    elif isolate_cli_mocks:
        # daemon_cli isolation: agent remains root for task compatibility, but
        # loses the capabilities that would let it read/chmod/chown mocksvc
        # files, become mocksvc, or ptrace mocksvc processes.
        cmd.extend([
            "--cap-drop", "DAC_OVERRIDE",
            "--cap-drop", "DAC_READ_SEARCH",
            "--cap-drop", "CHOWN",
            "--cap-drop", "FOWNER",
            "--cap-drop", "SETUID",
            "--cap-drop", "SETGID",
            "--cap-drop", "SYS_PTRACE",
        ])
    if use_accio_login:
        cmd.extend([
            "-v",
            f"{login_state / '.accio'}:/root/.accio",
            "-v",
            f"{login_state / '.config' / 'accio'}:/root/.config/accio",
        ])
    if not args.no_output_mounts:
        cmd.extend([
            "-v",
            f"{log_mount}:/data/logs",
            "-v",
            f"{output_mount}:/data/amt-out",
            "-v",
            f"{workspace_mount}:{REMOTE_WORKSPACE_ROOT}",
        ])
    if screenshots_enabled:
        cmd.extend(["-v", f"{screenshots_mount}:/data/screenshots"])
    for port in args.publish:
        cmd.extend(["-p", port])
    publish_ports: list[int] = []
    if host_published_port is not None:
        publish_ports.append(host_published_port)
    for port in host_published_ports or []:
        if port not in publish_ports:
            publish_ports.append(port)
    for port in publish_ports:
        cmd.extend(["-p", f"127.0.0.1:0:{port}"])
    # The OpenClaw runtime base image runs Xvfb :99 + x11vnc + noVNC
    # (`/opt/novnc/utils/novnc_proxy ... --listen 6080`) so a human can watch
    # the agent operate Chrome over a browser. We publish 6080 to a random
    # host port so users (and CI) can find it via `docker port <ct> 6080`.
    if args.harness == "openclaw":
        cmd.extend(["-p", "127.0.0.1:0:6080"])
        # Tell the upstream OpenClaw image entrypoint to load the patched
        # "Browser Relay" extension alongside the ClawBench recorder. The
        # entrypoint resolves --load-extension to
        # "/app/src/chrome-extension${EXTRA_LOAD_EXTENSIONS:+,$EXTRA_LOAD_EXTENSIONS}".
        # The patched extension is baked at /opt/openclaw-ext-patched by
        # docker/openclaw/Dockerfile (it's a copy of OpenClaw's bundled
        # extension with a globalThis hook so we can attach via CDP without
        # the toolbar-button click). Once loaded, harnesses/openclaw/
        # attach_openclaw_ext.ts wires it up after the gateway starts and
        # OpenClaw's `chrome-relay` profile then drives this Chrome through
        # the extension's chrome.debugger session.
        # Only the legacy v1.3 image carries /opt/openclaw-ext-patched + the
        # chrome-relay profile. v2026.5.22 dropped the extension entirely
        # and uses driver=existing-session via raw CDP, so the env var is
        # both useless and would point at a missing path.
        if _openclaw_is_relay_mode(args):
            cmd.extend(["-e", "EXTRA_LOAD_EXTENSIONS=/opt/openclaw-ext-patched"])
    for env in args.env:
        cmd.extend(["-e", env])
    cmd.append(args.image)
    if args.harness == "openclaw":
        # OpenClaw/Codex derived images already idle on `tail -f /dev/null`,
        # but the de-branded Hermes image's CMD is `/bin/bash` (it would exit
        # immediately under `docker run -d`). Force a quiescent shell for all
        # three so we get a stable container to `docker exec` into, regardless
        # of the image's baked entrypoint/CMD.
        cmd.extend(["/bin/bash", "-lc", "tail -f /dev/null"])
    docker(*cmd, check=True)
    return name


SIDECAR_PID_PATH = "/tmp/screenshot_sidecar.pid"
SIDECAR_SCRIPT_PATH = "/tmp/screenshot_sidecar.ts"


def start_screenshot_sidecar(
    container: str,
    cdp_port: int = 9223,
    interval_ms: int = 10000,
    min_gap_ms: int = 800,
    network_trigger: bool = True,
) -> bool:
    sidecar_src = PROJECT_ROOT / "bench_core" / "harnesses" / "accio_work" / "screenshot_sidecar.ts"
    if not sidecar_src.is_file():
        print(f"[WARN] screenshot sidecar source missing: {sidecar_src}", file=sys.stderr)
        return False
    bun_probe = docker("exec", container, "bash", "-lc", "command -v bun", check=False, capture=True)
    runner: str | None = None
    if bun_probe.returncode == 0 and (bun_probe.stdout or "").strip():
        runner = "bun run"
    else:
        node_probe = docker("exec", container, "bash", "-lc", "node --version 2>/dev/null", check=False, capture=True)
        node_ver = (node_probe.stdout or "").strip().lstrip("v")
        if node_ver:
            major = int(node_ver.split(".")[0]) if node_ver.split(".")[0].isdigit() else 0
            if major >= 22:
                runner = "node --experimental-strip-types --no-warnings=ExperimentalWarning"
    if not runner:
        print("[WARN] no bun or node>=22 in container; skipping screenshot sidecar", file=sys.stderr)
        return False
    docker("exec", container, "mkdir", "-p", "/data/screenshots", check=False)
    docker("cp", str(sidecar_src), f"{container}:{SIDECAR_SCRIPT_PATH}", check=True)
    start_cmd = (
        f"CDP_HTTP=http://127.0.0.1:{cdp_port}/json/version "
        f"SCREENSHOT_FALLBACK_MS={interval_ms} "
        f"SCREENSHOT_MIN_GAP_MS={min_gap_ms} "
        f"SCREENSHOT_NETWORK_TRIGGER={'1' if network_trigger else '0'} "
        f"nohup {runner} {SIDECAR_SCRIPT_PATH} "
        f">/data/screenshots/sidecar.log 2>&1 & echo $! > {SIDECAR_PID_PATH}"
    )
    proc = docker("exec", container, "bash", "-lc", start_cmd, check=False, capture=True)
    if proc.returncode != 0:
        print(f"[WARN] sidecar launch failed: {(proc.stdout or '').strip()}", file=sys.stderr)
        return False
    return True


def stop_screenshot_sidecar(container: str) -> None:
    docker(
        "exec", container, "bash", "-lc",
        (
            f"if [ -f {SIDECAR_PID_PATH} ]; then "
            f"  pid=$(cat {SIDECAR_PID_PATH}); "
            f"  kill -TERM \"$pid\" 2>/dev/null; "
            f"  for _ in 1 2 3 4 5; do kill -0 \"$pid\" 2>/dev/null || break; sleep 1; done; "
            f"  kill -KILL \"$pid\" 2>/dev/null; "
            f"fi"
        ),
        check=False,
    )


def validate_env(values: list[str]) -> list[str]:
    for value in values:
        if "=" not in value or value.startswith("="):
            raise SystemExit(f"--env must be KEY=VALUE, got: {value}")
    return values


_CONTAINER_FIND_PATTERN_PIDS_SCRIPT = r'''
pattern="$1"
self="$$"
found=0
for f in /proc/[0-9]*/cmdline; do
  pid="${f#/proc/}"
  pid="${pid%/cmdline}"
  [ "$pid" = "$self" ] && continue
  cmd=""
  while IFS= read -r -d "" part; do
    cmd="${cmd}${part} "
  done < "$f" 2>/dev/null || true
  case "$cmd" in
    *"$pattern"*)
      echo "$pid"
      found=1
      ;;
  esac
done
exit $((1 - found))
'''


_CONTAINER_SIGNAL_PATTERN_PIDS_SCRIPT = r'''
sig="$1"
pattern="$2"
self="$$"
found=0
for f in /proc/[0-9]*/cmdline; do
  pid="${f#/proc/}"
  pid="${pid%/cmdline}"
  [ "$pid" = "$self" ] && continue
  cmd=""
  while IFS= read -r -d "" part; do
    cmd="${cmd}${part} "
  done < "$f" 2>/dev/null || true
  case "$cmd" in
    *"$pattern"*)
      if kill "-$sig" "$pid" 2>/dev/null; then
        echo "$pid"
        found=1
      fi
      ;;
  esac
done
exit $((1 - found))
'''


def _container_pattern_pids(container: str, pattern: str) -> tuple[list[str], subprocess.CompletedProcess[str]]:
    probe = docker(
        "exec",
        container,
        "bash",
        "-lc",
        _CONTAINER_FIND_PATTERN_PIDS_SCRIPT,
        "_",
        pattern,
        check=False,
        capture=True,
    )
    pids = [line.strip() for line in (probe.stdout or "").splitlines() if line.strip().isdigit()]
    return pids, probe


def _signal_container_pattern(
    container: str,
    pattern: str,
    signal_name: str,
) -> tuple[list[str], subprocess.CompletedProcess[str]]:
    proc = docker(
        "exec",
        container,
        "bash",
        "-lc",
        _CONTAINER_SIGNAL_PATTERN_PIDS_SCRIPT,
        "_",
        signal_name,
        pattern,
        check=False,
        capture=True,
    )
    pids = [line.strip() for line in (proc.stdout or "").splitlines() if line.strip().isdigit()]
    return pids, proc


def _ps_output() -> str:
    for cmd in (["ps", "-axo", "pid=,command="], ["ps", "-eo", "pid=,args="]):
        proc = run(cmd, check=False, capture=True)
        if proc.returncode == 0 and proc.stdout:
            return proc.stdout
    return ""


def _host_docker_exec_pids(container: str, pattern: str) -> list[int]:
    pids: list[int] = []
    current_pid = os.getpid()
    for line in _ps_output().splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        parts = stripped.split(None, 1)
        if len(parts) != 2 or not parts[0].isdigit():
            continue
        pid = int(parts[0])
        command = parts[1]
        if pid == current_pid:
            continue
        if "docker" in command and " exec " in f" {command} " and container in command and pattern in command:
            pids.append(pid)
    return pids


def _signal_host_docker_exec_clients(container: str, pattern: str, sig: signal.Signals) -> list[int]:
    killed: list[int] = []
    for pid in _host_docker_exec_pids(container, pattern):
        try:
            os.kill(pid, sig)
            killed.append(pid)
        except ProcessLookupError:
            continue
    return killed


def _terminate_host_docker_exec_clients(container: str, pattern: str, log: Callable[[str], None]) -> bool:
    host_term = _signal_host_docker_exec_clients(container, pattern, signal.SIGTERM)
    if host_term:
        log(f"sent SIGTERM to host docker exec clients pids={host_term} for pattern={pattern!r}")
        for attempt in range(3):
            time.sleep(1.0)
            remaining_host = _host_docker_exec_pids(container, pattern)
            if not remaining_host:
                log(f"host docker exec clients exited after SIGTERM (attempt {attempt + 1})")
                return True
            log(f"host docker exec clients still running after SIGTERM attempt {attempt + 1}: pids={remaining_host}")

    host_kill = _signal_host_docker_exec_clients(container, pattern, signal.SIGKILL)
    if host_kill:
        log(f"escalated to SIGKILL for host docker exec clients pids={host_kill} pattern={pattern!r}")
        return True
    return False


def _terminate_agent_by_pattern(container: str, pattern: str, log: Callable[[str], None]) -> None:
    # procps tools (`pkill`/`pgrep`) can crash under Docker Desktop's
    # linux/amd64 Rosetta path while reading /proc/*/auxv. Use bash builtins
    # for /proc/*/cmdline scanning, then fall back to killing the host-side
    # `docker exec` client so the harness can continue collecting artifacts.
    term_pids, term = _signal_container_pattern(container, pattern, "TERM")
    log(
        f"sent SIGTERM to container pids={term_pids} for pattern={pattern!r}; "
        f"rc={term.returncode} out={(term.stdout or '').strip()!r}"
    )
    if term.returncode not in (0, 1):
        log("container SIGTERM helper failed; falling back to host docker exec clients")
        if _terminate_host_docker_exec_clients(container, pattern, log):
            return

    for attempt in range(5):
        time.sleep(1.0)
        remaining, probe = _container_pattern_pids(container, pattern)
        if probe.returncode in (0, 1):
            if not remaining:
                log(f"agent exited after SIGTERM (attempt {attempt + 1})")
                return
            log(f"agent still running after SIGTERM attempt {attempt + 1}: pids={remaining}")
            continue
        log(
            f"pid probe failed after SIGTERM attempt {attempt + 1}; "
            f"rc={probe.returncode} out={(probe.stdout or '').strip()!r}"
        )

    kill_pids, kill = _signal_container_pattern(container, pattern, "KILL")
    log(
        f"escalated to SIGKILL for container pids={kill_pids} pattern={pattern!r}; "
        f"rc={kill.returncode} out={(kill.stdout or '').strip()!r}"
    )
    for attempt in range(3):
        time.sleep(1.0)
        remaining, probe = _container_pattern_pids(container, pattern)
        if probe.returncode in (0, 1):
            if not remaining:
                log(f"agent exited after SIGKILL (attempt {attempt + 1})")
                return
            log(f"agent still running after SIGKILL attempt {attempt + 1}: pids={remaining}")
            continue
        log(
            f"pid probe failed after SIGKILL attempt {attempt + 1}; "
            f"rc={probe.returncode} out={(probe.stdout or '').strip()!r}"
        )

    _terminate_host_docker_exec_clients(container, pattern, log)


class EarlyTerminatePoller:
    """Watch a mock endpoint while the agent runs; SIGTERM agent on hit.

    Tasks where the mock has a discrete "done" signal (e.g. a session whose
    status flips to ``submitted``) use this so the harness doesn't have to
    wait for the agent's wall-clock timeout when the work is already done.
    Without it, agents that finish at ~50% of the time budget but loop idle
    afterward get gated to ``reward = 0`` on returncode 124.
    """

    def __init__(
        self,
        mock_url: str,
        config: EarlyTerminate,
        container: str,
        log_path: Path,
        verifier_token: str | None = None,
    ) -> None:
        self._url = f"{mock_url.rstrip('/')}{config.poll_path}"
        self._interval = max(1.0, float(config.poll_interval_sec))
        self._kind = config.match_kind
        self._field = config.match_field
        self._value = config.match_value
        self._kill_pattern = config.kill_pattern
        self._container = container
        self._log_path = log_path
        self._verifier_token = verifier_token
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.triggered = False
        self.trigger_reason: str | None = None

    def start(self) -> None:
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=self._interval + 2)

    def _log(self, msg: str) -> None:
        line = f"[{datetime.now().isoformat(timespec='seconds')}] {msg}\n"
        try:
            with self._log_path.open("a", encoding="utf-8") as f:
                f.write(line)
        except OSError:
            pass

    def _condition_met(self, body: Any) -> bool:
        if self._kind == "list_any_field_equals":
            if not isinstance(body, list):
                return False
            for item in body:
                if isinstance(item, dict) and str(item.get(self._field)) == self._value:
                    return True
            return False
        return False

    def _kill_agent(self) -> None:
        _terminate_agent_by_pattern(self._container, self._kill_pattern, self._log)

    def _loop(self) -> None:
        self._log(f"poller started; url={self._url} every {self._interval}s")
        while not self._stop.wait(self._interval):
            try:
                headers = {}
                if self._verifier_token:
                    headers["X-Mock-Verifier-Token"] = self._verifier_token
                req = urllib.request.Request(self._url, headers=headers, method="GET")
                with urllib.request.urlopen(req, timeout=5) as resp:
                    body = json.loads(resp.read().decode())
            except Exception as exc:
                self._log(f"poll error: {exc}")
                continue
            if self._condition_met(body):
                self.triggered = True
                self.trigger_reason = (
                    f"{self._kind}: {self._field}={self._value} matched at {self._url}"
                )
                self._log(self.trigger_reason)
                self._kill_agent()
                return
        self._log("poller stopped without triggering")


class OutputFileEarlyTerminatePoller:
    """Watch an in-container output file while the agent runs."""

    def __init__(
        self,
        config: OutputFileEarlyTerminate,
        container: str,
        log_path: Path,
    ) -> None:
        self._output_path = config.output_path
        self._interval = max(1.0, float(config.poll_interval_sec))
        self._kill_pattern = config.kill_pattern
        self._container = container
        self._log_path = log_path
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.triggered = False
        self.trigger_reason: str | None = None

    def start(self) -> None:
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=self._interval + 2)

    def _log(self, msg: str) -> None:
        line = f"[{datetime.now().isoformat(timespec='seconds')}] {msg}\n"
        try:
            with self._log_path.open("a", encoding="utf-8") as f:
                f.write(line)
        except OSError:
            pass

    def _matching_pids(self) -> list[str]:
        pids, _ = _container_pattern_pids(self._container, self._kill_pattern)
        return pids

    def _kill_agent(self) -> None:
        _terminate_agent_by_pattern(self._container, self._kill_pattern, self._log)

    def _loop(self) -> None:
        self._log(
            f"output-file poller started; path={self._output_path} every {self._interval}s"
        )
        while not self._stop.wait(self._interval):
            probe = docker(
                "exec",
                self._container,
                "bash",
                "-lc",
                f"test -s {shlex.quote(self._output_path)}",
                check=False,
                capture=True,
            )
            if probe.returncode == 0:
                self.triggered = True
                self.trigger_reason = f"output file exists and is non-empty: {self._output_path}"
                self._log(self.trigger_reason)
                self._kill_agent()
                return
        self._log("output-file poller stopped without triggering")


def _read_host_published_port(container: str, container_port: int) -> int | None:
    """Return the host-side port docker assigned for ``container_port``.

    Used when the harness publishes a container port (``-p 127.0.0.1:0:P``)
    so the host verifier can hit the in-container mock service over HTTP.
    """
    proc = docker("port", container, str(container_port), check=False, capture=True)
    if proc.returncode != 0 or not proc.stdout:
        return None
    for line in proc.stdout.splitlines():
        line = line.strip()
        if not line or ":" not in line:
            continue
        try:
            return int(line.rsplit(":", 1)[-1])
        except ValueError:
            continue
    return None


def container_path_exists(container: str, src: str) -> bool:
    return docker("exec", container, "test", "-e", src, check=False, capture=True).returncode == 0


def _extract_accio_model_items(payload: Any) -> list[dict[str, Any]]:
    groups: Any
    if isinstance(payload, dict):
        groups = payload.get("data", payload.get("modelList", payload.get("models", [])))
    else:
        groups = payload
    if not isinstance(groups, list):
        return []
    items: list[dict[str, Any]] = []
    for group in groups:
        if isinstance(group, dict) and isinstance(group.get("modelList"), list):
            for item in group["modelList"]:
                if isinstance(item, dict):
                    items.append(item)
        elif isinstance(group, dict):
            items.append(group)
    return items


def _visible_accio_model_codes(payload: Any) -> list[str]:
    codes: list[str] = []
    for item in _extract_accio_model_items(payload):
        if item.get("visible") is False:
            continue
        code = item.get("modelCode") or item.get("modelName") or item.get("id")
        if isinstance(code, str) and code and code not in codes:
            codes.append(code)
    return codes


def _should_check_accio_model_visibility(args: argparse.Namespace) -> bool:
    provider = (getattr(args, "model_provider", "") or "").lower()
    return bool(
        args.harness == "accio"
        and getattr(args, "create_agent", False)
        and getattr(args, "model_name", None)
        and (not provider or provider == "accio")
    )


def accio_models_endpoint_ready_probe() -> str:
    command = r"""python3 - <<'PY'
import base64
import glob
import json
import os
import sys
import urllib.error
import urllib.request

def read_gateway_auth():
    token = (
        os.environ.get("ACCIO_GATEWAY_TOKEN")
        or os.environ.get("PHOENIX_TELEMETRY_DEBUG_GATEWAY_PASSWORD")
    )
    if token:
        return ("phoenix", token)
    for path in sorted(glob.glob("/root/.accio/accounts/*/.accio/runtime/gateway-cli.json")):
        try:
            with open(path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
        except Exception:
            continue
        password = data.get("password") if isinstance(data, dict) else None
        if isinstance(password, str) and password:
            username = data.get("username") if isinstance(data, dict) else None
            return (username if isinstance(username, str) and username else "phoenix", password)
    return None

def probe_models(auth):
    request = urllib.request.Request("http://127.0.0.1:4098/models")
    if auth:
        raw = f"{auth[0]}:{auth[1]}".encode("utf-8")
        request.add_header("Authorization", "Basic " + base64.b64encode(raw).decode("ascii"))
    with urllib.request.urlopen(request, timeout=5) as response:
        response.read(1)
        return response.status == 200

try:
    raise SystemExit(0 if probe_models(read_gateway_auth()) else 1)
except urllib.error.HTTPError:
    raise SystemExit(1)
except Exception:
    raise SystemExit(1)
PY"""
    return command


def check_accio_model_visibility(container: str, args: argparse.Namespace) -> dict[str, Any]:
    target = str(args.model_name)
    command = r"""python3 - <<'PY'
import json
import base64
import glob
import os
import sys
import urllib.error
import urllib.request

def read_gateway_auth() -> tuple[str, str] | None:
    token = (
        os.environ.get("ACCIO_GATEWAY_TOKEN")
        or os.environ.get("PHOENIX_TELEMETRY_DEBUG_GATEWAY_PASSWORD")
    )
    if token:
        return ("phoenix", token)
    for path in sorted(glob.glob("/root/.accio/accounts/*/.accio/runtime/gateway-cli.json")):
        try:
            with open(path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
        except Exception:
            continue
        password = data.get("password") if isinstance(data, dict) else None
        if isinstance(password, str) and password:
            username = data.get("username") if isinstance(data, dict) else None
            return (username if isinstance(username, str) and username else "phoenix", password)
    return None

try:
    request = urllib.request.Request("http://127.0.0.1:4098/models")
    auth = read_gateway_auth()
    if auth:
        raw = f"{auth[0]}:{auth[1]}".encode("utf-8")
        request.add_header("Authorization", "Basic " + base64.b64encode(raw).decode("ascii"))
    with urllib.request.urlopen(request, timeout=20) as response:
        body = response.read().decode("utf-8", errors="replace")
        print(json.dumps({"status": response.status, "body": body}))
except urllib.error.HTTPError as exc:
    body = exc.read().decode("utf-8", errors="replace")
    print(json.dumps({"status": exc.code, "body": body, "error": str(exc)}))
except Exception as exc:
    print(json.dumps({"status": None, "body": "", "error": str(exc)}))
PY"""
    proc = docker("exec", container, "bash", "-lc", command, check=False, capture=True)
    result: dict[str, Any] = {
        "required": True,
        "target_model": target,
        "returncode": proc.returncode,
        "passed": False,
    }
    try:
        response = json.loads(proc.stdout or "{}")
    except json.JSONDecodeError:
        result.update(
            {
                "reason": "models_endpoint_output_not_json",
                "output": (proc.stdout or "").strip()[:1000],
            }
        )
        return result
    result["status"] = response.get("status")
    if response.get("error"):
        result["error"] = response.get("error")
    if response.get("status") != 200:
        result["reason"] = "models_endpoint_unavailable"
        result["body_preview"] = str(response.get("body") or "")[:1000]
        return result
    try:
        payload = json.loads(response.get("body") or "{}")
    except json.JSONDecodeError:
        result.update(
            {
                "reason": "models_endpoint_body_not_json",
                "body_preview": str(response.get("body") or "")[:1000],
            }
        )
        return result
    visible_codes = _visible_accio_model_codes(payload)
    result["visible_model_codes"] = visible_codes
    result["visible_models"] = [
        {
            "modelCode": item.get("modelCode") or item.get("modelName") or item.get("id"),
            "modelDisplayName": item.get("modelDisplayName") or item.get("name"),
        }
        for item in _extract_accio_model_items(payload)
        if item.get("visible") is not False
    ]
    if target not in visible_codes:
        result["reason"] = "target_model_not_visible"
        return result
    result["passed"] = True
    result["reason"] = "target_model_visible"
    return result


def _remove_directory_children(directory: Path) -> int:
    if not directory.is_dir():
        return 0
    removed = 0
    for child in directory.iterdir():
        if child.is_symlink() or child.is_file():
            child.unlink(missing_ok=True)
        else:
            shutil.rmtree(child)
        removed += 1
    return removed


def _write_json_if_changed(path: Path, data: Any) -> bool:
    path.parent.mkdir(parents=True, exist_ok=True)
    after = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    before = path.read_text(encoding="utf-8") if path.exists() else ""
    if before == after:
        return False
    path.write_text(after, encoding="utf-8")
    return True


def _scrub_runtime_accio_skills(runtime_login_state_dir: Path) -> dict[str, Any]:
    """Remove skills copied from the source login state without mutating source."""

    accio_root = runtime_login_state_dir / ".accio"
    stats: dict[str, Any] = {
        "enabled": True,
        "agent_core_skill_dirs": 0,
        "agent_core_entries_removed": 0,
        "account_skill_dirs": 0,
        "account_skill_entries_removed": 0,
        "metadata_files_written": 0,
    }
    if not accio_root.is_dir():
        stats["enabled"] = False
        stats["reason"] = "missing_accio_root"
        return stats

    for root, dirs, _files in os.walk(accio_root, followlinks=False):
        current = Path(root)
        if current.name == "skills" and current.parent.name == "agent-core":
            stats["agent_core_skill_dirs"] += 1
            stats["agent_core_entries_removed"] += _remove_directory_children(current)
            dirs.clear()

    account_skill_dirs: set[Path] = {accio_root / "skills"}
    accounts_root = accio_root / "accounts"
    if accounts_root.is_dir():
        for account_dir in accounts_root.iterdir():
            if account_dir.is_dir() and not account_dir.is_symlink():
                account_skill_dirs.add(account_dir / "skills")

    for skills_dir in sorted(account_skill_dirs):
        skills_dir.mkdir(parents=True, exist_ok=True)
        stats["account_skill_dirs"] += 1
        stats["account_skill_entries_removed"] += _remove_directory_children(skills_dir)
        if _write_json_if_changed(skills_dir / "skills_config.json", {}):
            stats["metadata_files_written"] += 1
        if _write_json_if_changed(skills_dir / "remote_skills_cache.json", {"skills": []}):
            stats["metadata_files_written"] += 1
        if _write_json_if_changed(skills_dir / ".preinstalled", {"succeeded": [], "failed": []}):
            stats["metadata_files_written"] += 1

    return stats


def _remove_stale_runtime_gateway_auth(runtime_login_state_dir: Path) -> dict[str, Any]:
    accio_root = runtime_login_state_dir / ".accio"
    stats: dict[str, Any] = {"gateway_cli_json_removed": 0}
    if not accio_root.is_dir():
        stats["reason"] = "missing_accio_root"
        return stats
    for stale in accio_root.rglob("gateway-cli.json"):
        try:
            stale.unlink(missing_ok=True)
            stats["gateway_cli_json_removed"] += 1
        except OSError as exc:
            stats.setdefault("errors", []).append({"path": str(stale), "error": str(exc)})
    return stats


def _make_runtime_login_state_container_writable(runtime_login_state_dir: Path) -> dict[str, Any]:
    stats: dict[str, Any] = {
        "enabled": True,
        "reason": "container_root_without_dac_override_can_update_runtime_auth_state",
        "dir_mode": "a+rwx",
        "file_mode": "a+rw_preserve_execute",
        "dirs_chmod": 0,
        "files_chmod": 0,
        "symlinks_skipped": 0,
    }
    if not runtime_login_state_dir.exists():
        stats["enabled"] = False
        stats["reason"] = "missing_runtime_login_state"
        return stats
    runtime_login_state_dir.chmod(stat.S_IMODE(runtime_login_state_dir.stat().st_mode) | 0o777)
    stats["dirs_chmod"] += 1
    for root, dirs, files in os.walk(runtime_login_state_dir, followlinks=False):
        current = Path(root)
        for name in list(dirs):
            path = current / name
            if path.is_symlink():
                dirs.remove(name)
                stats["symlinks_skipped"] += 1
                continue
            path.chmod(stat.S_IMODE(path.stat().st_mode) | 0o777)
            stats["dirs_chmod"] += 1
        for name in files:
            path = current / name
            if path.is_symlink():
                stats["symlinks_skipped"] += 1
                continue
            path.chmod(stat.S_IMODE(path.stat().st_mode) | 0o666)
            stats["files_chmod"] += 1
    return stats


def prepare_runtime_login_state(args: argparse.Namespace, run_dir: Path) -> Path | None:
    if args.harness != "accio" or not args.login_state_dir or args.no_login_mounts:
        return None
    source = Path(args.login_state_dir).expanduser().resolve()
    if not (source / ".accio").is_dir():
        raise SystemExit(f"login state missing .accio/: {source}")
    if not (source / ".config" / "accio").is_dir():
        raise SystemExit(f"login state missing .config/accio/: {source}")

    runtime = run_dir / ".runtime-login-state"
    if runtime.exists():
        shutil.rmtree(runtime)
    (runtime / ".config").mkdir(parents=True, exist_ok=True)
    shutil.copytree(source / ".accio", runtime / ".accio", symlinks=True)
    shutil.copytree(source / ".config" / "accio", runtime / ".config" / "accio", symlinks=True)
    stale_gateway_auth = _remove_stale_runtime_gateway_auth(runtime)
    scrub_stats = _scrub_runtime_accio_skills(runtime)
    scrub_stats["stale_gateway_auth"] = stale_gateway_auth
    scrub_stats["permission_normalization"] = _make_runtime_login_state_container_writable(runtime)
    scrub_meta = runtime / ".ccb_skill_scrub.json"
    scrub_meta.write_text(
        json.dumps(scrub_stats, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    scrub_meta.chmod(0o666)
    return runtime


def write_manifest(run_dir: Path, manifest: dict[str, Any]) -> None:
    (run_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def write_single_run_summary(run_dir: Path, manifest: dict[str, Any]) -> None:
    reward = manifest.get("reward", {})
    check_summary = reward.get("check_summary", {}) if isinstance(reward, dict) else {}
    check_breakdown = validation_check_breakdown(reward)
    summary = {
        "run_id": manifest.get("run_id") or run_dir.name,
        "started_at": manifest.get("started_at"),
        "finished_at": manifest.get("finished_at"),
        "config_path": str(run_dir / "run.yaml"),
        "source_config_path": None,
        "collection": None,
        "total": 1,
        "runtime_os": manifest.get("runtime_os"),
        "harness": manifest.get("harness"),
        "image": manifest.get("image"),
        "model_provider": manifest.get("model_provider"),
        "model_name": manifest.get("model_name"),
        "llm_judge_provider": manifest.get("llm_judge_provider"),
        "llm_judge_model": manifest.get("llm_judge_model"),
        "llm_judge_base_url": manifest.get("llm_judge_base_url"),
        "results": [
            {
                "index": 1,
                "task_id": manifest.get("task_id"),
                "run_id": manifest.get("run_id") or run_dir.name,
                "run_dir": str(run_dir),
                "returncode": 0 if reward.get("passed") else 6,
                "elapsed_sec": None,
                "score": reward.get("score", reward.get("reward")),
                "raw_score": reward.get("raw_score"),
                # v2 schema: real test.sh check counts (e.g. 11/11, 17/17);
                # v1 fallback: non-LLM validation_checks count. See
                # actual_checks_count() docstring.
                "checks_passed": check_breakdown["other_checks_passed"],
                "checks_total": check_breakdown["other_checks_total"],
                "framework_checks_passed": check_summary.get("passed"),
                "framework_checks_total": check_summary.get("total"),
                **check_breakdown,
                "passed": bool(reward.get("passed")),
                "verifier_exit": reward.get("verifier_exit"),
                "summary": reward.get("summary"),
                "output_file_count": len([p for p in (run_dir / "workspace" / "outputs").rglob("*") if p.is_file()])
                if (run_dir / "workspace" / "outputs").exists()
                else 0,
                "container_removed": manifest.get("container_cleanup", {}).get("removed"),
                "agent_exec_returncode": manifest.get("agent_exec_returncode"),
            }
        ],
    }
    cap = check_breakdown.get("capacity_score")
    summary["capacity_score_mean"] = round(cap, 4) if cap is not None else None
    summary["capacity_score_count"] = 1 if cap is not None else 0
    (run_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    cap_str = f"{cap:.4f}" if cap is not None else "—"
    lines = [
        f"# {summary['run_id']}",
        "",
        f"- started_at: {summary.get('started_at')}",
        f"- finished_at: {summary.get('finished_at')}",
        f"- harness: {summary.get('harness')}",
        f"- image: `{summary.get('image')}`",
        f"- judge: `{summary.get('llm_judge_provider')}/{summary.get('llm_judge_model')}`",
        f"- progress: 1/1 complete, {1 if reward.get('passed') else 0} passed",
        f"- capacity (checks_passed/checks_total ratio): {cap_str}",
        "",
        "| # | task | exit | llm_judge_raw | llm_check | checks | capacity | reward | passed | outputs | cleanup | run_dir |",
        "|---:|---|---:|---:|---|---:|---:|---:|---|---:|---|---|",
        "| 1 | {task_id} | {returncode} | {llm_judge_score} | {llm_check} | {checks} | {capacity} | {score} | {passed} | {outputs} | {cleanup} | `{run_dir}` |".format(
            task_id=manifest.get("task_id"),
            returncode=0 if reward.get("passed") else 6,
            llm_judge_score=check_breakdown.get("llm_judge_score"),
            llm_check=check_breakdown.get("llm_check_passed"),
            checks=f"{check_breakdown.get('other_checks_passed')}/{check_breakdown.get('other_checks_total')}",
            capacity=cap_str,
            score=reward.get("score", reward.get("reward")),
            passed=bool(reward.get("passed")),
            outputs=summary["results"][0]["output_file_count"],
            cleanup=summary["results"][0]["container_removed"],
            run_dir=run_dir,
        ),
    ]
    (run_dir / "summary.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    run_yaml = [
        f"run_id: {manifest.get('run_id') or run_dir.name}",
        f"tasks:",
        f"  - {manifest.get('task_id')}",
        f"runtime:",
        f"  os: {manifest.get('runtime_os')}",
        f"  image: {manifest.get('image')}",
        f"harness: {manifest.get('harness')}",
        f"agent:",
        f"  model_provider: {manifest.get('model_provider')}",
        f"  model_name: {manifest.get('model_name')}",
        f"judge:",
        f"  provider: {manifest.get('llm_judge_provider')}",
        f"  model: {manifest.get('llm_judge_model')}",
        f"  base_url: {manifest.get('llm_judge_base_url')}",
    ]
    (run_dir / "run.yaml").write_text("\n".join(run_yaml) + "\n", encoding="utf-8")
    generate_instance_report(run_dir)


def collect_container_artifacts(
    container: str,
    container_dir: Path,
    agent_dir: Path,
    workspace_dir: Path,
    remote_result: str,
    remote_log: str,
    remote_output_dir: str,
    workspace_mounted: bool,
    collect_remote_agent_files: bool = True,
    collect_remote_evo_out: bool = True,
) -> dict[str, Any]:
    artifacts: dict[str, Any] = {"collected_at": datetime.now().isoformat()}
    container_dir.mkdir(parents=True, exist_ok=True)

    inspect_proc = docker("inspect", container, check=False, capture=True)
    artifacts["inspect_returncode"] = inspect_proc.returncode
    if inspect_proc.stdout:
        (container_dir / "inspect.json").write_text(inspect_proc.stdout, encoding="utf-8")

    logs_proc = docker("logs", container, check=False, capture=True)
    artifacts["docker_logs_returncode"] = logs_proc.returncode
    if logs_proc.stdout is not None:
        (container_dir / "docker.log").write_text(logs_proc.stdout, encoding="utf-8")

    if collect_remote_agent_files:
        copy_from_container(container, remote_result, agent_dir / "result.json")
        copy_from_container(container, remote_log, agent_dir / "run.log")
    if not workspace_mounted:
        outputs_dir = workspace_dir / "outputs"
        if outputs_dir.exists():
            if outputs_dir.is_dir():
                shutil.rmtree(outputs_dir)
            else:
                outputs_dir.unlink()
        copy_from_container(container, remote_output_dir, outputs_dir)
    if collect_remote_evo_out:
        evo_out = agent_dir / "evo-out"
        if evo_out.exists():
            if evo_out.is_dir():
                shutil.rmtree(evo_out)
            else:
                evo_out.unlink()
        if container_path_exists(container, "/opt/agent-memory-test/evo-out"):
            copy_from_container(container, "/opt/agent-memory-test/evo-out", evo_out)
    artifacts["agent_result_exists"] = (agent_dir / "result.json").is_file()
    artifacts["agent_run_log_exists"] = (agent_dir / "run.log").is_file()
    artifacts["agent_evo_out_exists"] = (agent_dir / "evo-out").exists()
    artifacts["workspace_outputs_exists"] = (workspace_dir / "outputs").exists()
    return artifacts


def compress_host_logs(log_dir: Path) -> dict[str, Any]:
    result: dict[str, Any] = {
        "at": datetime.now().isoformat(),
        "compressed": [],
        "skipped_empty": [],
        "errors": [],
        "bytes_before": 0,
        "bytes_after": 0,
    }
    if not log_dir.is_dir():
        return result
    for path in sorted(log_dir.iterdir()):
        if not path.is_file():
            continue
        if path.suffix == ".gz":
            continue
        name = path.name
        if ".log" not in name and ".err" not in name:
            continue
        try:
            size = path.stat().st_size
        except OSError:
            continue
        if size == 0:
            result["skipped_empty"].append(name)
            continue
        gz_path = path.with_name(path.name + ".gz")
        try:
            with open(path, "rb") as src, gzip.open(gz_path, "wb", compresslevel=6) as dst:
                shutil.copyfileobj(src, dst, length=1024 * 1024)
            path.unlink()
            try:
                after = gz_path.stat().st_size
            except OSError:
                after = 0
            result["compressed"].append(name)
            result["bytes_before"] += size
            result["bytes_after"] += after
        except OSError as exc:
            result["errors"].append({"file": name, "error": str(exc)})
            if gz_path.exists():
                try:
                    gz_path.unlink()
                except OSError:
                    pass
    return result


def run_host_verifier(
    args: argparse.Namespace,
    spec: TaskSpec,
    run_dir: Path,
    agent_dir: Path,
    verifier_dir: Path,
    *,
    mock_host_url: str | None = None,
    mock_verifier_token: str | None = None,
    runtime_mock_urls: dict[str, str] | None = None,
) -> int:
    env = os.environ.copy()
    env.update(
        {
            "RESULT_JSON": str(agent_dir / "result.json"),
            "RUBRIC_JSON": str(spec.case_dir / spec.rubric),
            "REWARD_JSON": str(verifier_dir / "reward.json"),
            "TRAJECTORY_JSON": str(agent_dir / "trajectory.json"),
            "TASK_MD": str(spec.case_dir / spec.entrypoint),
            "RUN_DIR": str(run_dir),
            "WORKSPACE_DIR": str(run_dir / "workspace"),
            "OUTPUT_DIR": str(run_dir / "workspace" / "outputs"),
            "PRIVATE_DIR": str(spec.private_dir) if spec.private_dir is not None else "",
            "BENCH_ROOT": str(PROJECT_ROOT),
            "PYTHONPATH": f"{PROJECT_ROOT}{os.pathsep}{env.get('PYTHONPATH', '')}",
            "CONTAINER_TASK_DIR": REMOTE_WORKSPACE_ROOT,
            "CONTAINER_PRIVATE_DIR": f"/benchmark/private/{spec.task_id}" if spec.private_dir is not None else "",
            "CONTAINER_WORKDIR": REMOTE_WORKSPACE_ROOT,
            "CONTAINER_OUTPUT_DIR": f"{REMOTE_WORKSPACE_ROOT}/outputs",
        }
    )
    if mock_host_url:
        env["MOCK_SITE_URL"] = mock_host_url
    if mock_verifier_token:
        env["MOCK_VERIFIER_TOKEN"] = mock_verifier_token
    for name, url in (runtime_mock_urls or {}).items():
        safe = re.sub(r"[^A-Za-z0-9]+", "_", name).strip("_").upper()
        env[f"MOCK_SITE_URL_{safe}"] = url
    if args.llm_judge_provider:
        env["BENCH_LLM_JUDGE_PROVIDER"] = args.llm_judge_provider
    if args.llm_judge_model:
        env["BENCH_LLM_JUDGE_MODEL"] = args.llm_judge_model
    if args.llm_judge_base_url:
        env["BENCH_LLM_JUDGE_BASE_URL"] = args.llm_judge_base_url
    if args.llm_judge_api_key:
        env["BENCH_LLM_JUDGE_API_KEY"] = args.llm_judge_api_key
    if args.llm_judge_timeout:
        env["BENCH_LLM_JUDGE_TIMEOUT"] = str(args.llm_judge_timeout)

    log_path = verifier_dir / "verifier.log"
    with log_path.open("w", encoding="utf-8") as log:
        try:
            proc = subprocess.run(
                ["bash", str(spec.case_dir / spec.test_script)],
                cwd=str(spec.case_dir),
                text=True,
                stdout=log,
                stderr=subprocess.STDOUT,
                env=env,
                timeout=spec.verifier_timeout_sec,
            )
        except subprocess.TimeoutExpired:
            log.write(f"\n[verifier] timeout after {spec.verifier_timeout_sec}s\n")
            return 124
    return proc.returncode


def _parse_run_ids(agent_dir: Path) -> tuple[str | None, str | None]:
    conversation_id = None
    agent_id = None
    log_text = (agent_dir / "run.log").read_text(encoding="utf-8", errors="replace") if (agent_dir / "run.log").is_file() else ""
    match = re.search(r"conversationId=(CID-[A-Za-z0-9-]+)", log_text)
    if match:
        conversation_id = match.group(1)
    match = re.search(r"\[CreateAgent\] id=([A-Z]+-[A-Za-z0-9-]+)", log_text)
    if match:
        agent_id = match.group(1)

    root = _parse_result_root(agent_dir / "result.json")
    if not agent_id:
        agent_id = str(root.get("agentId") or "") or None
        for item in root.get("results", []) if isinstance(root.get("results"), list) else []:
            if isinstance(item, dict) and item.get("createdAgentId"):
                agent_id = str(item["createdAgentId"])
                break
    return conversation_id, agent_id


def _accio_accounts_root(login_state_dir: Path | None) -> Path | None:
    if not login_state_dir:
        return None
    accounts_root = login_state_dir / ".accio" / "accounts"
    return accounts_root if accounts_root.exists() else None


def _accio_state_patterns(conversation_id: str | None, agent_id: str | None) -> list[str]:
    patterns: list[str] = []
    if conversation_id:
        patterns.extend(
            [
                f"**/conversations/dm/{conversation_id}.jsonc",
                f"**/conversations/dm/{conversation_id}.message_*.jsonl",
                f"**/sessions/*{conversation_id}*.jsonl",
                f"**/subagent-sessions/*{conversation_id}*.jsonl",
                f"**/subagent-sessions/*{conversation_id}*.jsonc",
                f"**/tasks/{conversation_id}/*.json",
            ]
        )
    if agent_id:
        if conversation_id:
            patterns.append(f"**/agents/{agent_id}/sessions/*{conversation_id}*.jsonl")
        patterns.extend(
            [
                f"**/agents/{agent_id}/permissions/audit.jsonl",
                f"**/agents/{agent_id}/profile.jsonc",
                f"**/agents/{agent_id}/runtime/state.jsonc",
            ]
        )
    return patterns


def _matching_accio_state_files(accounts_root: Path, patterns: list[str]) -> list[Path]:
    files: list[Path] = []
    seen: set[Path] = set()
    for pattern in patterns:
        for src in accounts_root.glob(pattern):
            if src.is_file() and src not in seen:
                seen.add(src)
                files.append(src)
    return files


def collect_accio_state_artifacts(args: argparse.Namespace, agent_dir: Path) -> dict[str, Any]:
    login_state_dir = Path(args.login_state_dir).expanduser().resolve() if args.login_state_dir else None
    if login_state_dir is None:
        return {"collected": False, "reason": "login_state_dir_not_configured"}
    accounts_root = _accio_accounts_root(login_state_dir)
    if accounts_root is None:
        return {"collected": False, "reason": f"accounts_root_missing: {accounts_root}"}

    conversation_id, agent_id = _parse_run_ids(agent_dir)
    if not conversation_id and not agent_id:
        return {"collected": False, "reason": "could_not_parse_conversation_or_agent_id"}

    out_dir = agent_dir / "accio_state"
    copied: list[str] = []
    for src in _matching_accio_state_files(accounts_root, _accio_state_patterns(conversation_id, agent_id)):
        rel = src.relative_to(accounts_root)
        dst = out_dir / "accounts" / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        copied.append(str(dst.relative_to(agent_dir)))

    result: dict[str, Any] = {
        "collected": bool(copied),
        "conversation_id": conversation_id,
        "agent_id": agent_id,
        "file_count": len(copied),
        "files": copied,
    }

    if os.environ.get("CCB_DUMP_FULL_ACCIO_STATE") == "1":
        accio_root = login_state_dir / ".accio"
        # NOTE: this path is INTENTIONALLY a sibling of accio_state/ (not a child)
        # so that recover_trajectory_from_accio_state's rglob does not slurp these
        # files in — that would mix unrelated conversations into the trajectory.
        full_dst = agent_dir / "accio_state_full"
        full_dump: dict[str, Any] = {"enabled": True, "source": str(accio_root)}
        if accio_root.is_dir():
            file_errors: list[str] = []

            def _onerror(_func, path, excinfo):
                file_errors.append(f"{path}: {excinfo[1]}")

            try:
                if full_dst.exists():
                    shutil.rmtree(full_dst, onerror=_onerror)
                shutil.copytree(accio_root, full_dst, symlinks=True, ignore_dangling_symlinks=True)
            except shutil.Error as exc:
                file_errors.extend(str(arg) for arg in (exc.args or ()))
            except OSError as exc:
                file_errors.append(str(exc))
            file_count = sum(1 for _ in full_dst.rglob("*") if _.is_file()) if full_dst.exists() else 0
            full_dump["copied"] = file_count > 0
            full_dump["dest"] = str(full_dst.relative_to(agent_dir))
            full_dump["file_count"] = file_count
            if file_errors:
                full_dump["partial_errors"] = file_errors[:30]
                full_dump["partial_error_count"] = len(file_errors)
        else:
            full_dump["copied"] = False
            full_dump["error"] = "accio_root_missing"
        result["full_accio_dump"] = full_dump

    return result


def _remove_empty_parents(path: Path, stop_at: Path) -> None:
    current = path.parent
    stop_at = stop_at.resolve()
    while current.exists() and current.resolve() != stop_at:
        try:
            current.rmdir()
        except OSError:
            break
        current = current.parent


def cleanup_accio_state_artifacts(args: argparse.Namespace, agent_dir: Path) -> dict[str, Any]:
    login_state_dir = Path(args.login_state_dir).expanduser().resolve() if args.login_state_dir else None
    if login_state_dir is None:
        return {"attempted": False, "reason": "login_state_dir_not_configured"}
    accounts_root = _accio_accounts_root(login_state_dir)
    if accounts_root is None:
        return {"attempted": False, "reason": f"accounts_root_missing: {accounts_root}"}

    conversation_id, agent_id = _parse_run_ids(agent_dir)
    if not conversation_id and not agent_id:
        return {"attempted": False, "reason": "could_not_parse_conversation_or_agent_id"}

    removed_files: list[str] = []
    errors: list[str] = []
    for src in _matching_accio_state_files(accounts_root, _accio_state_patterns(conversation_id, agent_id)):
        try:
            rel = src.relative_to(accounts_root)
            src.unlink()
            removed_files.append(str(rel))
            _remove_empty_parents(src, accounts_root)
        except OSError as exc:
            errors.append(f"{src}: {exc}")

    removed_dirs: list[str] = []
    if getattr(args, "create_agent", False) and agent_id:
        for agent_root in accounts_root.glob(f"**/agents/{agent_id}"):
            if not agent_root.is_dir():
                continue
            try:
                rel = agent_root.relative_to(accounts_root)
                shutil.rmtree(agent_root)
                removed_dirs.append(str(rel))
                _remove_empty_parents(agent_root, accounts_root)
            except OSError as exc:
                errors.append(f"{agent_root}: {exc}")

    sessions_json_updates: list[str] = []
    if conversation_id:
        for sessions_json in accounts_root.glob("**/subagent-sessions/sessions.json"):
            try:
                data = json.loads(sessions_json.read_text(encoding="utf-8"))
            except Exception:
                continue
            if not isinstance(data, dict):
                continue
            before = len(data)
            data = {key: value for key, value in data.items() if conversation_id not in key and conversation_id not in json.dumps(value, ensure_ascii=False)}
            if len(data) != before:
                try:
                    sessions_json.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                    sessions_json_updates.append(str(sessions_json.relative_to(accounts_root)))
                except OSError as exc:
                    errors.append(f"{sessions_json}: {exc}")

    return {
        "attempted": True,
        "conversation_id": conversation_id,
        "agent_id": agent_id,
        "removed_file_count": len(removed_files),
        "removed_dir_count": len(removed_dirs),
        "sessions_json_updates": sessions_json_updates,
        "removed_files": removed_files,
        "removed_dirs": removed_dirs,
        "errors": errors,
    }

def json_events_have_error(log_text: str) -> bool:
    for line in log_text.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(event, dict) and event.get("type") == "error":
            return True
    return False


def run_task(args: argparse.Namespace) -> int:
    resolve_runtime_defaults(args)
    if not args.task_id:
        raise SystemExit("task_id is required unless --config is provided")
    spec = load_task(args.task_id)
    apply_agent_limit_overrides(spec, args)
    ensure_task_contract(spec)

    run_id = args.run_id or f"{datetime.now().strftime('%Y%m%d-%H%M%S')}-{spec.task_id}"
    run_dir = (Path(args.output_dir).expanduser().resolve() if args.output_dir else RUNS_DIR) / run_id
    agent_dir = run_dir / "agent"
    verifier_dir = run_dir / "verifier"
    container_dir = run_dir / "container"
    workspace_dir = run_dir / "workspace"
    for directory in (agent_dir, verifier_dir, container_dir, workspace_dir):
        directory.mkdir(parents=True, exist_ok=True)

    args.env = validate_env(args.env)
    source_login_state_dir = Path(args.login_state_dir).expanduser().resolve() if args.login_state_dir else None
    runtime_login_state_dir = prepare_runtime_login_state(args, run_dir)
    runtime_login_state_skill_scrub: dict[str, Any] | None = None
    if runtime_login_state_dir is not None:
        scrub_meta = runtime_login_state_dir / ".ccb_skill_scrub.json"
        if scrub_meta.is_file():
            runtime_login_state_skill_scrub = json.loads(scrub_meta.read_text(encoding="utf-8"))
        args.login_state_dir = str(runtime_login_state_dir)
    # The browser upload tool (`browser action=upload`) restricts paths to the
    # agent's configured workspace boundary. The runtime default may sit outside
    # the documented task workdir, so browser tasks with image inputs pin the
    # boundary to that workdir. Inputs are staged at <workdir>/workspace, already
    # inside the boundary. A user-supplied --default-project-dir always wins.
    if (
        args.harness == "accio"
        and not args.default_project_dir
        and spec.requires_browser
        and _has_workspace_image_inputs(spec.case_dir)
    ):
        args.default_project_dir = REMOTE_WORKSPACE_ROOT
    scenario = build_scenario(spec, args)
    scenario_path = run_dir / "scenario.json"
    scenario_path.write_text(json.dumps(scenario, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    remote_result = f"/output/{spec.task_id}/result.json"
    remote_log = f"/output/{spec.task_id}/run.log"
    # Task content (task.md + workspace/ inputs) is staged into the workdir root
    # itself, so the "task dir" and the "workdir" coincide at REMOTE_WORKSPACE_ROOT.
    remote_workdir = REMOTE_WORKSPACE_ROOT
    remote_case = remote_workdir
    remote_mock_case = f"/benchmark/runtime/tasks/{spec.task_id}"
    remote_mock_private_dir = f"/benchmark/runtime/private/{spec.task_id}" if spec.private_dir is not None else ""
    remote_runtime_mocks_dir = f"{REMOTE_RUNTIME_MOCKS_ROOT}/{spec.task_id}"
    remote_output_dir = f"{remote_workdir}/outputs"
    container = ""
    sidecar_started = False
    manifest: dict[str, Any] = {
        "run_id": run_id,
        "task_id": spec.task_id,
        "case_dir": str(spec.case_dir),
        "image": args.image,
        "runtime_os": args.runtime_os,
        "login_state_dir": str(source_login_state_dir) if source_login_state_dir else None,
        "runtime_login_state": {
            "mode": "per_run_copy" if runtime_login_state_dir is not None else ("disabled" if args.no_login_mounts else "none"),
            "source_dir": str(source_login_state_dir) if source_login_state_dir else None,
            "active_copy_dir": str(runtime_login_state_dir) if runtime_login_state_dir is not None else None,
            "source_mutated": False,
            "delete_active_copy_after_run": runtime_login_state_dir is not None,
            "skill_scrub": runtime_login_state_skill_scrub,
        },
        "agent_id": args.agent_id,
        "create_agent": args.create_agent,
        "agent_name": args.agent_name if args.create_agent else None,
        "agent_template_id": args.agent_template_id if args.create_agent else None,
        "agent_runtime": args.agent_runtime if args.create_agent else None,
        "tool_preset": args.tool_preset if args.create_agent else None,
        "model_provider": args.model_provider if args.create_agent else None,
        "model_name": args.model_name if args.create_agent else None,
        "container_env": [item.split("=", 1)[0] for item in args.env],
        "llm_judge_provider": args.llm_judge_provider,
        "llm_judge_model": args.llm_judge_model,
        "llm_judge_base_url": args.llm_judge_base_url,
        "started_at": datetime.now().isoformat(),
        "run_dir": str(run_dir),
        "harness": args.harness,
        "alternative_harness": {
            "openclaw_model": args.openclaw_model if args.harness == "openclaw" else None,
            "openclaw_base_url_configured": bool(args.openclaw_base_url) if args.harness == "openclaw" else None,
            "openclaw_models_config": str(Path(args.openclaw_models_config).expanduser().resolve())
            if args.harness == "openclaw" and args.openclaw_models_config
            else None,
        },
        "workspace": {
            "container_task_dir": remote_case,
            "container_private_dir": None,
            "container_mock_runtime_dir": remote_mock_case if spec.mock_services else None,
            "container_mock_private_dir": remote_mock_private_dir if spec.mock_services and remote_mock_private_dir else None,
            "container_runtime_mocks_dir": remote_runtime_mocks_dir if spec.runtime_mocks else None,
            "container_workdir": remote_workdir,
            "container_output_dir": remote_output_dir,
            "host_workspace_dir": str(workspace_dir),
            "host_output_dir": str(workspace_dir / "outputs"),
            "host_private_dir": str(spec.private_dir) if spec.private_dir is not None else None,
        },
        "runtime_isolation": {
            "mode": "fresh_container_per_task",
            "container_reuse_allowed": False,
            "source_image_mutated": False,
            "container_cleanup": "always_after_artifact_collection",
        },
        "mock_services": {
            "enabled": spec.mock_services,
            "started": False,
            "runtime_mocks_declared": [
                {
                    "name": mock.name,
                    "kind": mock.kind,
                    "source_dir": str(mock.source_dir),
                    "port": mock.port,
                    "health_path": mock.health_path,
                }
                for mock in spec.runtime_mocks
            ],
        },
    }
    mock_host_url: str | None = None
    mock_verifier_token: str | None = None
    runtime_mock_host_urls: dict[str, str] = {}
    try:
        container = start_container(
            args, run_dir, run_id, spec.task_id,
            host_published_ports=_container_ports_to_publish(spec),
            isolate_cli_mocks=any(_runtime_mock_needs_source_isolation_caps(m) for m in spec.runtime_mocks),
        )
        manifest["container"] = container
        manifest["container_created_by_harness"] = True
        manifest["container_reused"] = False
        write_manifest(run_dir, manifest)

        if args.harness == "accio":
            wait_for_exec(
                container,
                python_http_probe("http://127.0.0.1:4098/health", "http://127.0.0.1:4098"),
                args.ready_timeout,
                "gateway",
            )
            wait_for_exec(
                container,
                python_http_probe("http://127.0.0.1:9237/status"),
                min(args.ready_timeout, 150),
                "browser relay",
            )
            if _should_check_accio_model_visibility(args):
                model_endpoint_ready = wait_for_exec(
                    container,
                    accio_models_endpoint_ready_probe(),
                    min(args.ready_timeout, 60),
                    "Accio gateway /models auth readiness",
                )
                manifest["accio_model_endpoint_ready"] = model_endpoint_ready
                write_manifest(run_dir, manifest)
                visibility = check_accio_model_visibility(container, args)
                manifest["accio_model_visibility_check"] = visibility
                write_manifest(run_dir, manifest)
                if not visibility.get("passed"):
                    message = (
                        "Accio model visibility check failed before agent execution: "
                        f"target={visibility.get('target_model')!r}, "
                        f"reason={visibility.get('reason')!r}, "
                        f"visible={visibility.get('visible_model_codes')}"
                    )
                    docker(
                        "exec",
                        container,
                        "bash",
                        "-lc",
                        f"mkdir -p {shlex.quote('/output/' + spec.task_id)} && "
                        f"printf '%s\\n' {shlex.quote(message)} > {shlex.quote(remote_log)} && "
                        f"printf '%s\\n' {shlex.quote(json.dumps({'error': 'model_visibility_check_failed', 'message': message}, ensure_ascii=False))} > {shlex.quote(remote_result)}",
                        check=False,
                    )
                    write_agent_result(
                        spec=spec,
                        agent_dir=agent_dir,
                        harness="accio",
                        returncode=2,
                        started=time.time(),
                        response_text=message,
                    )
                    raise SystemExit(message)
        elif args.harness == "openclaw":
            wait_for_exec(container, "command -v openclaw", min(args.ready_timeout, 60), "OpenClaw CLI")
            # noVNC is started by the OpenClaw runtime base entrypoint on
            # container port 6080 so a human can watch Chrome live.
            # We publish it to a random host port; surface that here.
            novnc_port = _read_host_published_port(container, 6080)
            if novnc_port is not None:
                novnc_url = f"http://127.0.0.1:{novnc_port}/vnc.html"
                manifest["novnc"] = {"host_port": novnc_port, "url": novnc_url}
                write_manifest(run_dir, manifest)
                print(f"[openclaw] noVNC viewer: {novnc_url}", flush=True)
        else:
            raise SystemExit(f"unsupported harness: {args.harness}")

        if not args.no_screenshots and not args.no_output_mounts:
            # OpenClaw now drives the upstream-image entrypoint's Chrome on
            # 9222 via the chrome-relay extension (see run_openclaw_agent's
            # setup_cmds + attach_openclaw_ext.ts). The extension uses
            # chrome.debugger to control specific tabs but does NOT keep the
            # remote-debugging-port socket pinned, so sidecar's
            # Page.captureScreenshot on the same 9222 socket no longer
            # contends with playwright's automation. Accio still uses 9223.
            if args.harness == "openclaw":
                cdp_port = 9222
            else:
                cdp_port = 9223
            raw_interval = getattr(args, "screenshot_interval", None)
            interval = 10000 if raw_interval is None else int(raw_interval)
            network_trigger = not getattr(args, "no_screenshot_on_network", False)
            sidecar_started = start_screenshot_sidecar(
                container,
                cdp_port=cdp_port,
                interval_ms=interval,
                network_trigger=network_trigger,
            )
            manifest["screenshots_sidecar"] = sidecar_started
            manifest["screenshot_interval_ms"] = interval
            manifest["screenshot_network_trigger"] = network_trigger
            write_manifest(run_dir, manifest)

        remote_scenario = f"/tmp/{spec.task_id}-scenario.json"

        docker(
            "exec",
            container,
            "mkdir",
            "-p",
            "/benchmark/runtime/tasks",
            "/benchmark/runtime/private",
            REMOTE_RUNTIME_MOCKS_ROOT,
            f"/output/{spec.task_id}",
            remote_workdir,
            remote_output_dir,
            f"{remote_workdir}/tmp",
            check=True,
        )
        # Scrub any baked agent-visible task dir from the image (inputs now live
        # under the workdir, not /benchmark/tasks). Do NOT rm remote_case here:
        # it is the workdir mount and removing it would wipe outputs/tmp.
        docker("exec", container, "rm", "-rf", "/benchmark/tasks", check=False)
        docker("exec", container, "rm", "-rf", remote_mock_case, check=True)
        docker("exec", container, "rm", "-rf", remote_runtime_mocks_dir, check=True)
        if remote_mock_private_dir:
            docker("exec", container, "rm", "-rf", remote_mock_private_dir, check=True)
        docker("exec", container, "rm", "-rf", f"/benchmark/private/{spec.task_id}", check=False)
        docker("exec", container, "rm", "-rf", "/opt/agent-memory-test/evo-out", check=False)
        public_task_parent = run_dir / "container_task_public"
        public_task_dir = public_task_parent / spec.task_id
        if public_task_parent.exists():
            shutil.rmtree(public_task_parent)
        copy_public_task_dir(spec.case_dir, public_task_dir)
        # Stage the task content (workspace/ inputs + task.md) into the workdir
        # root itself: copy the *contents* of the staging dir (trailing /.) so
        # inputs land at <workdir>/workspace, not <workdir>/<task_id>/workspace.
        docker("cp", f"{public_task_dir}/.", f"{container}:{remote_workdir}", check=True)
        if spec.mock_services:
            mock_runtime_parent = run_dir / "container_mock_runtime"
            mock_runtime_task_dir = mock_runtime_parent / spec.task_id
            if mock_runtime_parent.exists():
                shutil.rmtree(mock_runtime_parent)
            copy_mock_runtime_task_dir(spec.case_dir, mock_runtime_task_dir)
            if mock_runtime_task_dir.exists():
                docker("cp", str(mock_runtime_task_dir), f"{container}:/benchmark/runtime/tasks/", check=True)
            if remote_mock_private_dir:
                mock_runtime_private_parent = run_dir / "container_mock_private"
                mock_runtime_private_dir = mock_runtime_private_parent / spec.task_id
                if mock_runtime_private_parent.exists():
                    shutil.rmtree(mock_runtime_private_parent)
                copy_mock_runtime_private_dir(spec.private_dir, mock_runtime_private_dir)
                if mock_runtime_private_dir.exists():
                    docker("cp", str(mock_runtime_private_dir), f"{container}:/benchmark/runtime/private/", check=True)
            if spec.runtime_mocks:
                runtime_mocks_parent = run_dir / "container_runtime_mocks"
                runtime_mocks_dir = runtime_mocks_parent / spec.task_id
                if runtime_mocks_parent.exists():
                    shutil.rmtree(runtime_mocks_parent)
                copy_runtime_mock_sources(spec.runtime_mocks, runtime_mocks_dir)
                if runtime_mocks_dir.exists():
                    docker("cp", str(runtime_mocks_dir), f"{container}:{REMOTE_RUNTIME_MOCKS_ROOT}/", check=True)
                manifest["runtime_mock_loader"] = setup_runtime_mocks_in_container(
                    container,
                    spec.runtime_mocks,
                    remote_runtime_mocks_dir,
                    remote_workdir,
                    isolate_http_mocks=(
                        _container_user_exists(container, "mocksvc")
                        and (
                            args.harness == "openclaw"
                            or any(_runtime_mock_uses_baked_source(m) for m in spec.runtime_mocks)
                        )
                    ),
                )
                write_manifest(run_dir, manifest)
        docker("cp", str(scenario_path), f"{container}:{remote_scenario}", check=True)
        # Inputs are staged directly at <workdir>/workspace — a real directory
        # inside /task. For Accio that path is already inside the upload boundary
        # (defaultProject.dir == /task), so `browser action=upload` reads it
        # directly. No separate `inputs/` alias or copy is created: under the old
        # two-tree layout inputs lived outside the workdir (on the read-only
        # /benchmark mount) and needed a symlink + Accio real-copy to be
        # uploadable, but in the /task scheme that just produced a confusing
        # second identical copy of the inputs.
        inputs_target = (
            f"{remote_case}/workspace" if (spec.case_dir / "workspace").is_dir() else remote_case
        )
        docker(
            "exec",
            container,
            "bash",
            "-lc",
            f"cat > {shlex.quote(remote_workdir)}/README.md <<'EOF'\n"
            f"task_id={spec.task_id}\n"
            f"inputs={inputs_target}\n"
            f"outputs={remote_output_dir}\n"
            f"tmp={remote_workdir}/tmp\n"
            "EOF",
            check=False,
        )

        if spec.mock_services:
            mock_service_result = start_task_mock_services(
                container,
                spec,
                run_dir,
                remote_mock_case,
                remote_mock_private_dir,
                remote_runtime_mocks_dir,
                remote_workdir,
                remote_output_dir,
                harness=args.harness,
            )
            mock_verifier_token = mock_service_result.pop("verifier_token", None)
            manifest["mock_services"] = mock_service_result
            if mock_verifier_token:
                manifest["mock_services"]["verifier_token_present"] = True
            write_manifest(run_dir, manifest)
            if manifest["mock_services"].get("returncode") != 0:
                raise SystemExit(
                    "mock service startup failed; see "
                    f"{manifest['mock_services'].get('log')}"
                )
            published_port_map: dict[int, int] = {}
            for container_port in _container_ports_to_publish(spec):
                host_port = _read_host_published_port(container, container_port)
                if host_port is None:
                    raise SystemExit(
                        f"failed to read host port for container port {container_port}"
                    )
                published_port_map[container_port] = host_port
            for mock in spec.runtime_mocks:
                if mock.port is not None and mock.port in published_port_map:
                    runtime_mock_host_urls[mock.name] = f"http://127.0.0.1:{published_port_map[mock.port]}"
            if spec.host_published_port is not None and spec.host_published_port in published_port_map:
                mock_host_url = f"http://127.0.0.1:{published_port_map[spec.host_published_port]}"
            elif len(runtime_mock_host_urls) == 1:
                mock_host_url = next(iter(runtime_mock_host_urls.values()))
            if mock_host_url:
                manifest["mock_services"]["host_url"] = mock_host_url
            if published_port_map:
                manifest["mock_services"]["published_ports"] = {
                    str(container_port): host_port
                    for container_port, host_port in sorted(published_port_map.items())
                }
                manifest["mock_services"]["runtime_mock_host_urls"] = runtime_mock_host_urls
                write_manifest(run_dir, manifest)
            manifest["mock_runtime_scrub"] = scrub_mock_runtime_materials(
                container,
                remote_mock_case,
                remote_mock_private_dir,
            )
            write_manifest(run_dir, manifest)

        if args.harness == "accio":
            agent_cmd = (
                "cd /opt/agent-memory-test && "
                f"MEMORY_TEST_GATEWAY_URL='http://127.0.0.1:4098' "
                "MEMORY_TEST_SKIP_LLM_JUDGE=1 "
                f"BENCH_TASK_DIR='{remote_case}' "
                f"BENCH_WORKDIR='{remote_workdir}' "
                f"BENCH_OUTPUT_DIR='{remote_output_dir}' "
                f"timeout '{spec.timeout_sec}' bun run runner.ts '{remote_scenario}' "
                "--gateway 'http://127.0.0.1:4098' "
                f"--output '{remote_result}' "
                f"--max-actions '{spec.max_actions}' "
                f"--verbose >'{remote_log}' 2>&1; "
                f"status=$?; echo exit=$status >> '{remote_log}'; exit $status"
            )
            poller: EarlyTerminatePoller | None = None
            if spec.early_terminate is not None and mock_host_url:
                poller = EarlyTerminatePoller(
                    mock_url=mock_host_url,
                    config=spec.early_terminate,
                    container=container,
                    log_path=agent_dir / "early_terminate.log",
                    verifier_token=mock_verifier_token,
                )
                poller.start()
            try:
                agent_proc = docker("exec", container, "bash", "-lc", agent_cmd, check=False, capture=True)
            finally:
                if poller is not None:
                    poller.stop()
            (agent_dir / "exec.log").write_text(agent_proc.stdout or "", encoding="utf-8")
            manifest["agent_exec_returncode"] = agent_proc.returncode
            if poller is not None and poller.triggered:
                manifest["agent_early_terminated"] = True
                manifest["agent_early_terminate_reason"] = poller.trigger_reason
        elif args.harness == "openclaw":
            poller: EarlyTerminatePoller | None = None
            output_poller: OutputFileEarlyTerminatePoller | None = None
            if spec.early_terminate is not None and mock_host_url:
                # task.toml's default kill_pattern targets the Accio runner
                # ("bun run runner.ts"). For OpenClaw the wrapping process
                # is `openclaw agent --session-id ...`, so override unless
                # the task already customized it.
                oc_config = (
                    spec.early_terminate
                    if spec.early_terminate.kill_pattern != "bun run runner.ts"
                    else replace(spec.early_terminate, kill_pattern="openclaw agent")
                )
                poller = EarlyTerminatePoller(
                    mock_url=mock_host_url,
                    config=oc_config,
                    container=container,
                    log_path=agent_dir / "early_terminate.log",
                    verifier_token=mock_verifier_token,
                )
                poller.start()
            if spec.output_file_early_terminate is not None:
                oc_output_config = (
                    spec.output_file_early_terminate
                    if spec.output_file_early_terminate.kill_pattern != "bun run runner.ts"
                    else replace(spec.output_file_early_terminate, kill_pattern="openclaw agent")
                )
                output_poller = OutputFileEarlyTerminatePoller(
                    config=oc_output_config,
                    container=container,
                    log_path=agent_dir / "early_terminate_output_file.log",
                )
                output_poller.start()
            try:
                manifest["agent_exec_returncode"] = run_openclaw_agent(args, spec, container, agent_dir, remote_workdir)
            finally:
                if poller is not None:
                    poller.stop()
                if output_poller is not None:
                    output_poller.stop()
            if poller is not None and poller.triggered:
                manifest["agent_early_terminated"] = True
                manifest["agent_early_terminate_reason"] = poller.trigger_reason
            if output_poller is not None and output_poller.triggered:
                manifest["agent_early_terminated"] = True
                manifest["agent_early_terminate_reason"] = output_poller.trigger_reason
        else:
            raise SystemExit(f"unsupported harness: {args.harness}")

        if sidecar_started:
            stop_screenshot_sidecar(container)
            sidecar_started = False

        manifest["container_artifacts"] = collect_container_artifacts(
            container,
            container_dir,
            agent_dir,
            workspace_dir,
            remote_result,
            remote_log,
            remote_output_dir,
            not args.no_output_mounts,
            collect_remote_agent_files=args.harness == "accio",
            collect_remote_evo_out=args.harness == "accio",
        )
        if args.harness == "accio":
            manifest["accio_state_artifacts"] = collect_accio_state_artifacts(args, agent_dir)
            manifest["accio_state_cleanup"] = cleanup_accio_state_artifacts(args, agent_dir)

        write_trajectory(agent_dir / "result.json", agent_dir / "trajectory.json", agent_dir=agent_dir)

        verifier_exit = run_host_verifier(
            args, spec, run_dir, agent_dir, verifier_dir,
            mock_host_url=mock_host_url,
            mock_verifier_token=mock_verifier_token,
            runtime_mock_urls=runtime_mock_host_urls,
        )
        reward_path = verifier_dir / "reward.json"
        reward = json.loads(reward_path.read_text(encoding="utf-8")) if reward_path.is_file() else {"reward": 0, "passed": False}
        final_reward = build_binary_final_reward(
            reward,
            verifier_exit=verifier_exit,
            agent_exec_returncode=manifest.get("agent_exec_returncode"),
            agent_early_terminated=bool(manifest.get("agent_early_terminated")),
        )
        if manifest.get("agent_exec_returncode") not in (0, None):
            final_reward["agent_exec_returncode"] = manifest.get("agent_exec_returncode")
            if manifest.get("agent_early_terminated"):
                final_reward["agent_early_terminated"] = True
                final_reward["agent_early_terminate_reason"] = manifest.get("agent_early_terminate_reason")
            elif not final_reward.get("raw_passed"):
                final_reward["agent_error"] = "agent execution failed; verifier result was gated off"
            else:
                final_reward["agent_warning"] = "agent process exited non-zero after verifier-passable artifacts were produced"
        (verifier_dir / "final_reward.json").write_text(
            json.dumps(final_reward, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        manifest["finished_at"] = datetime.now().isoformat()
        manifest["reward"] = final_reward
        write_manifest(run_dir, manifest)
        write_single_run_summary(run_dir, manifest)

        print(f"run_dir={run_dir}")
        check_summary = final_reward.get("check_summary", {})
        checks_text = (
            f"{check_summary.get('passed')}/{check_summary.get('total')}"
            if isinstance(check_summary, dict) and check_summary.get("total") is not None
            else ""
        )
        print(
            f"reward={final_reward.get('reward')} raw_score={final_reward.get('raw_score')} "
            f"checks={checks_text} passed={final_reward.get('passed')}"
        )
        return 0 if final_reward.get("passed") else 6
    finally:
        if container:
            if sidecar_started:
                stop_screenshot_sidecar(container)
            manifest["container_artifacts"] = collect_container_artifacts(
                container,
                container_dir,
                agent_dir,
                workspace_dir,
                remote_result,
                remote_log,
                remote_output_dir,
                not args.no_output_mounts,
                collect_remote_agent_files=args.harness == "accio",
                collect_remote_evo_out=args.harness == "accio",
            )
            if args.harness == "accio" and "accio_state_cleanup" not in manifest:
                manifest["accio_state_artifacts"] = collect_accio_state_artifacts(args, agent_dir)
                manifest["accio_state_cleanup"] = cleanup_accio_state_artifacts(args, agent_dir)
                write_trajectory(agent_dir / "result.json", agent_dir / "trajectory.json", agent_dir=agent_dir)
            cleanup_proc = docker("rm", "-f", container, check=False, capture=True)
            manifest["container_cleanup"] = {
                "attempted": True,
                "removed": cleanup_proc.returncode == 0,
                "returncode": cleanup_proc.returncode,
                "output": (cleanup_proc.stdout or "").strip(),
                "at": datetime.now().isoformat(),
            }
            manifest["host_logs_compression"] = compress_host_logs(container_dir / "host-logs")
            write_manifest(run_dir, manifest)
            if manifest.get("reward"):
                write_single_run_summary(run_dir, manifest)
            if runtime_login_state_dir is not None and runtime_login_state_dir.exists():
                try:
                    shutil.rmtree(runtime_login_state_dir)
                    manifest.setdefault("runtime_login_state", {})["active_copy_removed"] = True
                    manifest["runtime_login_state"]["active_copy_removed_at"] = datetime.now().isoformat()
                    manifest["runtime_login_state"].pop("active_copy_remove_error", None)
                except OSError as exc:
                    manifest.setdefault("runtime_login_state", {})["active_copy_removed"] = False
                    manifest["runtime_login_state"]["active_copy_remove_error"] = str(exc)
                write_manifest(run_dir, manifest)
                if manifest.get("reward"):
                    write_single_run_summary(run_dir, manifest)
        if runtime_login_state_dir is not None and runtime_login_state_dir.exists():
            try:
                shutil.rmtree(runtime_login_state_dir)
                manifest.setdefault("runtime_login_state", {})["active_copy_removed"] = True
                manifest["runtime_login_state"]["active_copy_removed_at"] = datetime.now().isoformat()
                manifest["runtime_login_state"].pop("active_copy_remove_error", None)
            except OSError as exc:
                manifest.setdefault("runtime_login_state", {})["active_copy_removed"] = False
                manifest["runtime_login_state"]["active_copy_remove_error"] = str(exc)
            write_manifest(run_dir, manifest)
            if manifest.get("reward"):
                write_single_run_summary(run_dir, manifest)


def list_tasks(_: argparse.Namespace) -> int:
    for task_toml in sorted(DATASETS_DIR.rglob("task.toml")):
        data = tomllib.loads(task_toml.read_text(encoding="utf-8"))
        task = data.get("task", {})
        print(f"{task.get('id', task_toml.parent.name)}\t{task.get('name', '')}")
    return 0


def resolve_runtime_defaults(args: argparse.Namespace) -> None:
    if args.image:
        return
    if args.harness == "openclaw":
        args.image = DEFAULT_OPENCLAW_IMAGE
        return
    if args.runtime_os == "mac":
        args.image = DEFAULT_MAC_AUTH_IMAGE
    else:
        args.image = DEFAULT_LINUX_AUTH_IMAGE


def is_yaml_path(value: str | None) -> bool:
    return bool(value) and Path(value).suffix.lower() in {".yaml", ".yml"}


def raw_run_args(args: argparse.Namespace) -> list[str]:
    raw = list(getattr(args, "_raw_argv", []))
    return raw[1:] if raw and raw[0] == "run" else raw


def append_explicit_config_overrides(cmd: list[str], args: argparse.Namespace) -> None:
    raw = raw_run_args(args)
    value_flags = {
        "--collection",
        "--batch-id",
        "--run-id",
        "--runtime-os",
        "--image",
        "--platform",
        "--login-state-dir",
        "--harness",
        "--agent-template-id",
        "--agent-runtime",
        "--tool-preset",
        "--model-provider",
        "--model-name",
        "--llm-judge-provider",
        "--llm-judge-model",
        "--llm-judge-base-url",
        "--llm-judge-timeout",
        "--openclaw-model",
        "--openclaw-image-model",
        "--openclaw-base-url",
        "--openclaw-models-config",
        "--openclaw-gateway-port",
        "--openclaw-gateway-ready-delay",
        "--openclaw-thinking",
        "--openclaw-openrouter-shim-port",
        "--openclaw-gemini-proxy-port",
        "--start-index",
        "--limit",
        "--parallelism",
        "--agent-timeout-multiplier",
        "--agent-timeout-min-sec",
        "--agent-max-actions-multiplier",
        "--agent-max-actions-min",
        "--browser-subagent-timeout-sec",
    }
    bool_flags: set[str] = {
        "--openclaw-gemini-proxy",
    }
    skip_next = False
    for index, item in enumerate(raw):
        if skip_next:
            skip_next = False
            continue
        if item == "--config":
            skip_next = True
            continue
        if item.startswith("--config="):
            continue
        if item == args.task_id and is_yaml_path(args.task_id):
            continue
        if item in bool_flags:
            cmd.append(item)
            continue
        if item in value_flags:
            if index + 1 >= len(raw):
                raise SystemExit(f"{item} requires a value")
            cmd.extend([item, raw[index + 1]])
            skip_next = True
            continue
        matched_value_flag = next((flag for flag in value_flags if item.startswith(flag + "=")), None)
        if matched_value_flag:
            cmd.append(item)


def run_config_instance(args: argparse.Namespace) -> int:
    config = args.config or (Path(args.task_id) if is_yaml_path(args.task_id) else None)
    if not config:
        raise SystemExit("--config is required for YAML benchmark runs")
    config_path = Path(config).expanduser()
    if not config_path.is_absolute():
        config_path = PROJECT_ROOT / config_path
    runner = PROJECT_ROOT / "scripts" / "run_bench.py"
    cmd = [sys.executable, str(runner), "--config", str(config_path)]
    append_explicit_config_overrides(cmd, args)
    child_env = os.environ.copy()
    if args.llm_judge_api_key:
        child_env["BENCH_LLM_JUDGE_API_KEY"] = args.llm_judge_api_key
    if args.openclaw_api_key:
        child_env["OPENROUTER_API_KEY"] = args.openclaw_api_key
    proc = subprocess.run(
        cmd,
        cwd=PROJECT_ROOT,
        text=True,
        check=False,
        env=child_env,
    )
    return proc.returncode


def run_dispatch(args: argparse.Namespace) -> int:
    if args.config or is_yaml_path(args.task_id):
        return run_config_instance(args)
    return run_task(args)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="commerce-agent-bench")
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    sub = parser.add_subparsers(dest="cmd", required=True)

    run_parser = sub.add_parser("run")
    run_parser.add_argument("task_id", nargs="?")
    run_parser.add_argument("--config", type=Path, help="run a benchmark instance from a YAML config")
    run_parser.add_argument("--collection", type=Path, help="override the task collection for YAML config runs")
    run_parser.add_argument("--batch-id", help="deprecated alias for --run-id in YAML config runs")
    run_parser.add_argument("--start-index", type=int, help="start from this 1-based task index in YAML config runs")
    run_parser.add_argument("--limit", type=int, help="limit the number of tasks selected from the YAML config")
    run_parser.add_argument("--parallelism", type=int, help="number of tasks to run concurrently in YAML config runs")
    run_parser.add_argument("--runtime-os", choices=["linux", "mac"], default="linux", help="select the runtime image family")
    run_parser.add_argument("--image", help="override the runtime image tag; defaults to the selected harness/runtime image")
    run_parser.add_argument("--platform", default="linux/amd64")
    run_parser.add_argument("--login-state-dir")
    run_parser.add_argument("--container-name")
    run_parser.add_argument("--no-relaxed-security", action="store_true", help="skip SYS_PTRACE/seccomp relaxations; useful for mock runtime smoke tests")
    run_parser.add_argument("--no-login-mounts", action="store_true", help="do not mount login state into the container")
    run_parser.add_argument("--no-output-mounts", action="store_true", help="do not mount host output directories into the container")
    run_parser.add_argument("--run-id")
    run_parser.add_argument("--output-dir")
    run_parser.add_argument("--harness", choices=SUPPORTED_HARNESSES, default=DEFAULT_HARNESS)
    run_parser.add_argument("--agent-id", default="DID-F456DA-2B0D4C")
    run_parser.add_argument("--create-agent", action="store_true", help="prepend a create_agent action before the task chat")
    run_parser.add_argument("--agent-name", default="BenchmarkAgent")
    run_parser.add_argument("--agent-template-id", default="coder")
    run_parser.add_argument("--agent-runtime", choices=["local", "remote"], default="local")
    run_parser.add_argument("--tool-preset", choices=["full", "standard", "developer", "minimal", "tl", "none"], default="full")
    run_parser.add_argument("--model-provider")
    run_parser.add_argument("--model-name")
    run_parser.add_argument("--default-project-dir")
    run_parser.add_argument(
        "--agent-timeout-multiplier",
        type=float,
        default=1.0,
        help="multiply task.toml [agent].timeout_sec by this factor (default 1.0 = no change); final = max(orig*mult, --agent-timeout-min-sec)",
    )
    run_parser.add_argument(
        "--agent-timeout-min-sec",
        type=int,
        default=0,
        help="absolute floor on the final [agent].timeout_sec; default 0 disables the floor",
    )
    run_parser.add_argument(
        "--agent-max-actions-multiplier",
        type=float,
        default=1.0,
        help="multiply task.toml [agent].max_actions by this factor (default 1.0 = no change); final = max(orig*mult, --agent-max-actions-min)",
    )
    run_parser.add_argument(
        "--agent-max-actions-min",
        type=int,
        default=0,
        help="absolute floor on the final [agent].max_actions; default 0 disables the floor",
    )
    run_parser.add_argument(
        "--browser-subagent-timeout-sec",
        type=int,
        help="inject BROWSER_SUBAGENT_TIMEOUT_SECONDS env into the container (Accio *-subagent-inherit image); leave unset to keep the image's built-in 600s",
    )
    run_parser.add_argument("-e", "--env", action="append", default=[], help="pass KEY=VALUE to docker run; can be repeated")
    run_parser.add_argument("--llm-judge-provider", choices=["openai", "gemini", "mock"])
    run_parser.add_argument("--llm-judge-model")
    run_parser.add_argument("--llm-judge-base-url")
    run_parser.add_argument("--llm-judge-api-key")
    run_parser.add_argument("--llm-judge-timeout", type=int, default=120)
    run_parser.add_argument("--ready-timeout", type=int, default=180)
    run_parser.add_argument("--publish", action="append", default=[])
    run_parser.add_argument(
        "--openclaw-model",
        default=DEFAULT_OPENCLAW_MODEL,
        help=(
            "OpenClaw model id, formatted '<provider>/<model>'. Use 'openrouter/...' "
            "to go through OpenRouter (set OPENROUTER_API_KEY) or any non-'openrouter/' "
            "prefix that matches a provider key declared via --openclaw-models-config "
            "(e.g. 'google/gemini-3-flash-preview' with api=google-generative-ai)."
        ),
    )
    run_parser.add_argument("--openclaw-image-model", help="optional OpenClaw image tool model; defaults to --openclaw-model")
    run_parser.add_argument("--openclaw-base-url", default=DEFAULT_OPENCLAW_BASE_URL)
    run_parser.add_argument("--openclaw-api-key", help="OpenRouter API key passed only to the OpenClaw container process")
    run_parser.add_argument(
        "--openclaw-models-config",
        help=(
            "JSON object to write into ~/.openclaw/openclaw.json['models']. To declare a "
            "NATIVE provider (e.g. Gemini generateContent against your own baseUrl, no "
            "OpenAI chat-completions sidecar), declare a provider here with "
            "`api: google-generative-ai` + baseUrl + timeoutSeconds + models[], and set "
            "--openclaw-model <provider>/<model>. A non-'openrouter/' model prefix is "
            "auto-detected as native (no sidecar). See "
            "configs/native_google_models.json."
        ),
    )
    run_parser.add_argument("--openclaw-gateway-port", type=int, default=18789)
    run_parser.add_argument("--openclaw-gateway-ready-delay", type=float, default=2.0)
    run_parser.add_argument("--openclaw-thinking")
    run_parser.add_argument(
        "--openclaw-openrouter-shim",
        action="store_true",
        help=(
            "start an in-container OpenRouter-compatible shim that forwards to "
            "--openclaw-base-url, preserves an existing reasoning field, and "
            "supplies one from --openclaw-thinking when absent. Auto-enabled "
            "when --openclaw-thinking is set AND --openclaw-model starts with "
            "'openrouter/' (native-provider models use native thinking fields)."
        ),
    )
    run_parser.add_argument("--openclaw-openrouter-shim-port", type=int, default=19501)
    # --- Bring-your-own-endpoint CLI shortcut ---
    # Synthesises a one-provider models_config JSON in memory from these five
    # flags, so a one-off probe does not require creating configs/*.json on
    # disk. Distinct from --openclaw-base-url / --openclaw-api-key, which are
    # OpenRouter-scoped (see runner.py:544-563 for the auto-shim guard) and
    # silently ignored on native paths. Mutually exclusive with
    # --openclaw-models-config; if both are set the runner errors instead of
    # picking one. See docs/openclaw-byo-endpoint.md for the full contract.
    run_parser.add_argument(
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
        help=(
            "OpenClaw provider wire format. Setting this switches on the "
            "BYO-endpoint shortcut path — an in-memory models_config JSON is "
            "synthesised from --openclaw-provider-* flags below. Cannot be "
            "combined with --openclaw-models-config."
        ),
    )
    run_parser.add_argument(
        "--openclaw-provider-base-url",
        help=(
            "Upstream base URL for the BYO endpoint (e.g. "
            "https://api.openai.com/v1). Required when --openclaw-api is set. "
            "Must be reachable from INSIDE the container."
        ),
    )
    run_parser.add_argument(
        "--openclaw-provider-key",
        help=(
            "Provider key name used inside the synthesised JSON. Defaults to "
            "the head of --openclaw-model (e.g. 'openai/gpt-4o' -> 'openai'). "
            "Only set this to override the derived name; the value must "
            "match the model prefix or OpenClaw will not find the provider."
        ),
    )
    run_parser.add_argument(
        "--openclaw-provider-api-key-env",
        default="OPENCLAW_PROVIDER_API_KEY",
        help=(
            "Name of the environment variable that holds the upstream API "
            "key. Read at inject time and put verbatim into the synthesised "
            "provider config's apiKey (sent as Authorization: Bearer, "
            "x-api-key, or x-goog-api-key depending on --openclaw-api). "
            "Errors if the variable is unset or empty when --openclaw-api is "
            "set. Default: OPENCLAW_PROVIDER_API_KEY."
        ),
    )
    run_parser.add_argument(
        "--openclaw-provider-header",
        action="append",
        default=[],
        metavar="KEY:VALUE",
        help=(
            "Extra request header to attach to every provider request, "
            "formatted 'Key:Value'. Repeatable. Typical use: "
            "'anthropic-version:2023-06-01' on the anthropic-messages path."
        ),
    )
    # --- Optional release-only Gemini sidecar (reserved; not started today) ---
    # Kept as argparse no-op so future runs can opt into a host-side native
    # generateContent gateway without re-bumping the schema. The standard path
    # is --openclaw-models-config + a google/* model id and does NOT need this.
    run_parser.add_argument(
        "--openclaw-gemini-proxy",
        action="store_true",
        help=argparse.SUPPRESS,
    )
    run_parser.add_argument(
        "--openclaw-gemini-proxy-port",
        type=int,
        default=19502,
        help=argparse.SUPPRESS,
    )
    run_parser.add_argument(
        "--no-screenshots",
        action="store_true",
        help="disable the in-container CDP screenshot sidecar (default: enabled)",
    )
    run_parser.add_argument(
        "--screenshot-interval",
        type=int,
        default=None,
        help="periodic screenshot interval in ms (default: 10000; 0 disables, only event-driven captures remain)",
    )
    run_parser.add_argument(
        "--no-screenshot-on-network",
        action="store_true",
        help="disable network-event-driven screenshots (XHR/Fetch/Document responses); periodic interval still applies",
    )
    run_parser.set_defaults(func=run_dispatch)

    list_parser = sub.add_parser("list")
    list_parser.set_defaults(func=list_tasks)

    raw_argv = list(sys.argv[1:] if argv is None else argv)
    args = parser.parse_args(argv)
    args._raw_argv = raw_argv
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
