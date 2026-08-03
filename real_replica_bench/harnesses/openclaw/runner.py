"""OpenClaw harness runner (container-side OpenClaw browser-capable agent).

Extracted from upstream cli.py (2026-06-18 refactor) and adapted for the
release fork (proxy-free; only direct providers / OpenRouter / a user-
declared custom provider). Three model routes are selected by
--openclaw-model's prefix:

  * ``openrouter/...``      — direct OpenRouter (OPENROUTER_API_KEY). When
    ``--openclaw-thinking`` is set, the in-container OpenRouter shim is
    auto-started to translate the tier into ``reasoning_effort``.
  * ``<custom-provider>/...`` — a custom provider declared via
    ``--openclaw-models-config`` (e.g. ``api: google-generative-ai`` pointing
    at Google's public Gemini endpoint or a BYO proxy). OpenClaw speaks that
    wire format directly, no sidecar.
  * anything else            — passes verbatim; the user supplies their own
    plumbing.

Imports shared infra from core, prompts from prompts, config defaults from
constants. cli re-exports ``run_openclaw_agent`` / ``_openclaw_is_relay_mode``.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

from real_replica_bench.constants import (
    DEFAULT_OPENCLAW_BASE_URL,
    DEFAULT_OPENCLAW_MODEL,
    OPENCLAW_PROVIDER_REQUEST_TIMEOUT_SECONDS,
    OPENCLAW_PROXY_USAGE_REMOTE,
    OPENCLAW_TRANSCRIPT_PATH,
    PROJECT_ROOT,
)
from real_replica_bench.core import (
    close_process_log,
    collect_proxy_usage,
    copy_from_container,
    docker,
    expand_env_placeholders,
    extract_json_event_text,
    popen_docker_exec_log,
    run,
    terminate_process,
    write_agent_result,
)
from real_replica_bench.prompts import build_mock_integrity_note, build_task_prompt

if TYPE_CHECKING:
    from real_replica_bench.cli import TaskSpec


# Autonomous-agent directive, prepended to every OpenClaw prompt in the most
# prominent position. OpenClaw's default framing is a conversational personal
# assistant, and persona-forward models (notably GPT-5.6 Luna/Terra/Sol) latch
# onto it — they open with a "我刚上线，你希望怎么称呼我？" self-introduction plus a
# question, end the turn with zero tool calls, and since `openclaw agent
# --message` is a single non-interactive invocation there is no user to answer →
# the loop terminates and the task scores ~0. Reproduced on this runtime with
# gpt-5.6-luna: one upstream call, zero tool calls, reward 0.
#
# It carries NO task-specific or verifier-facing hints, and is applied uniformly
# to every OpenClaw run so the cross-model comparison stays fair. Because it sits
# on the scoring boundary — changing it moves every model's starting line — it is
# a module-level constant rather than an inline string: greppable, diffable in
# review, and overridable in an A/B harness without editing this file.
OPENCLAW_AGENT_DIRECTIVE = (
    "# 角色：自主任务执行 Agent\n\n"
    "你是一个自主运行的任务执行 agent，**不是**聊天助手。请**立即开始执行下面的任务**。\n"
    "- **不要**自我介绍、不要给自己取名字、不要询问「如何称呼你 / 我该怎么称呼你」、不要任何寒暄开场白。\n"
    "- 当前是**无人值守的单次执行**：没有人会回答你的任何反问，任何"
    "「等待用户确认 / 请用户提供」都会导致任务直接失败。\n"
    "- 直接调用工具（read / exec / browser 等）完成任务，把最终产物写到 `/task/outputs/`。"
    "遇到不确定的地方，基于任务描述做出最合理的假设并继续推进，不要停下来等待确认。\n\n"
    "---\n\n"
)

# Vision-capable model substrings used by the OpenClaw set-image precheck.
# Match is case-insensitive substring against the resolved primary model name
# (which is what OpenClaw's `models set-image` would otherwise be left set to
# when --openclaw-image-model is not provided). Anything not in this list is
# treated as non-vision and forces the user to pass --openclaw-image-model
# explicitly. Adding a new model: add the lowercase substring.
_OPENCLAW_VISION_MODEL_SUBSTRINGS: tuple[str, ...] = (
    "gemini-3-flash-preview",
    "gemini-3.1-pro-preview",
    "gemini-3.1-flash",
    "gemini-3.5-flash",
    "gemini-3.5-pro",
    "claude",
    "qwen-vl",
    "qwen3.7-preview",
    "qwen3.7-plus",  # multimodal GA (2026-06-01, DashScope + OpenRouter)
    # Substring covers the whole qwen3.8-max family. The -preview variant was
    # probed on DashScope (2026-07-26: image_url decoded, image_tokens billed);
    # the GA id is covered by the same entry rather than a second line.
    "qwen3.8-max",
    "qwen-latest-series",
    "kimi-vl",
    "glm-vl",
    "gpt-5",
    "gpt-5.5",
    "gpt-5.2",
    "gpt-4o",
    "gpt-4-turbo",
)


def _openclaw_model_is_vision_capable(model: str) -> bool:
    """Heuristic substring match against a curated vision-capable list."""
    if not model:
        return False
    lower = model.lower()
    return any(substr in lower for substr in _OPENCLAW_VISION_MODEL_SUBSTRINGS)


def _openclaw_is_relay_mode(args: argparse.Namespace) -> bool:
    """OpenClaw browser-driver mode dispatch by image tag.

    The explicitly named legacy images (`commercecraftbench/openclaw:base-v1.3`
    and `commercecraftbench/openclaw:ccb-v1.3`) are built on an OpenClaw
    2026.3.x runtime base. That release ships a Chrome extension `Browser
    Relay` that we patch + attach via CDP.
    Profile name = `chrome-relay`, driver = `extension`, cdpUrl points
    at an in-process relay server.

    v2026.5.22 dropped the extension entirely (`assets/chrome-extension/`
    removed, no `chrome-relay` profile in dist) and only supports two
    drivers — `openclaw` (managed) and `existing-session` (limited). The
    correct config for the upstream-entrypoint Chrome at 9222 is:
        driver=openclaw, attachOnly=true, cdpUrl=http://127.0.0.1:9222
    which yields `local-managed` capability (full snapshot+act+tabs) while
    re-using the noVNC-visible Chrome from the entrypoint. We previously
    used driver=existing-session, but that caps capabilities to
    `local-existing-session` (no selector targeting, no managed tabs) and
    triggers the "user-style profile cannot use sandbox browser" error.

    Detection is deliberately opt-in for those two legacy tags. The public
    release pins the May image by digest, so looking for ``2026.5.22`` in the
    image string would misclassify the canonical digest as the March runtime.
    Current and custom images therefore use managed-attach mode by default.
    """
    image = (getattr(args, "image", "") or "").lower()
    legacy_tags = (
        "commercecraftbench/openclaw:base-v1.3",
        "commercecraftbench/openclaw:ccb-v1.3",
    )
    return any(tag in image for tag in legacy_tags)


def collect_openclaw_state_artifacts(container: str, agent_dir: Path) -> dict[str, Any]:
    """Tar /root/.openclaw/agents/main/ + copy /tmp/openclaw/openclaw-*.log
    out of the container into ``agent_dir`` for post-mortem inspection.

    Mirrors the spirit of ``collect_accio_state_artifacts`` but the OpenClaw
    container is destroyed per-task, so there is no host-side cleanup pass.
    Returns a dict for the manifest / debug file.
    """
    out: dict[str, Any] = {"collected": False, "files": [], "openclaw_agents_present": False}

    # 1. agents/main tarball — quick check first to avoid a noisy tar of a
    # missing path.
    probe = docker(
        "exec", container, "bash", "-lc",
        "test -d /root/.openclaw/agents/main && echo yes || echo no",
        check=False, capture=True,
    )
    has_agents = (probe.stdout or "").strip() == "yes"
    out["openclaw_agents_present"] = has_agents
    if has_agents:
        tar_path = agent_dir / "openclaw_state.tar.gz"
        try:
            with tar_path.open("wb") as tf:
                proc = subprocess.run(
                    [
                        "docker", "exec", container, "bash", "-lc",
                        "tar --exclude=main/agent/auth-profiles.json "
                        "--exclude=main/agent/credentials.json "
                        "-czf - -C /root/.openclaw/agents main",
                    ],
                    stdout=tf,
                    stderr=subprocess.PIPE,
                    check=False,
                )
            if proc.returncode == 0 and tar_path.is_file() and tar_path.stat().st_size > 0:
                out["files"].append(str(tar_path.relative_to(agent_dir)))
                # Untar locally for grep-ability.
                state_dir = agent_dir / "openclaw_state"
                state_dir.mkdir(parents=True, exist_ok=True)
                untar = subprocess.run(
                    ["tar", "-xzf", str(tar_path), "-C", str(state_dir)],
                    capture_output=True, text=True, check=False,
                )
                if untar.returncode == 0:
                    out["files"].append(str(state_dir.relative_to(agent_dir)) + "/")
                else:
                    out["untar_error"] = (untar.stderr or "").strip()[:500]
            else:
                out["tar_error"] = (proc.stderr.decode("utf-8", errors="replace") if isinstance(proc.stderr, bytes) else (proc.stderr or "")).strip()[:500]
                if tar_path.is_file() and tar_path.stat().st_size == 0:
                    tar_path.unlink(missing_ok=True)
        except OSError as exc:
            out["tar_error"] = str(exc)

    # 2. OpenClaw runtime logs at /tmp/openclaw/openclaw-*.log. List first,
    # then docker cp each. Tolerate misses.
    list_proc = docker(
        "exec", container, "bash", "-lc",
        "ls -1 /tmp/openclaw/openclaw-*.log 2>/dev/null || true",
        check=False, capture=True,
    )
    log_paths = [line.strip() for line in (list_proc.stdout or "").splitlines() if line.strip()]
    if log_paths:
        runtime_dir = agent_dir / "openclaw_runtime_logs"
        runtime_dir.mkdir(parents=True, exist_ok=True)
        for remote_log in log_paths:
            local_dst = runtime_dir / Path(remote_log).name
            cp = docker("cp", f"{container}:{remote_log}", str(local_dst), check=False, capture=True)
            if cp.returncode == 0 and local_dst.is_file():
                out["files"].append(str(local_dst.relative_to(agent_dir)))

    if out["files"]:
        out["collected"] = True
    elif not has_agents:
        out["reason"] = "openclaw_agents_dir_missing"
    return out


def _parse_openclaw_provider_headers(raw_headers: list[str]) -> dict[str, str]:
    """Parse repeated `--openclaw-provider-header KEY:VALUE` flags into a dict.

    Only the FIRST colon is treated as the separator, so values that
    themselves contain ``:`` (URLs, times) round-trip verbatim.
    """
    parsed: dict[str, str] = {}
    for raw in raw_headers or []:
        if ":" not in raw:
            raise SystemExit(
                f"--openclaw-provider-header must be formatted 'Key:Value' (got: {raw!r})"
            )
        key, _, value = raw.partition(":")
        key = key.strip()
        value = value.strip()
        if not key:
            raise SystemExit(
                f"--openclaw-provider-header has empty key (got: {raw!r})"
            )
        parsed[key] = value
    return parsed


def _synthesize_openclaw_models_config(args: argparse.Namespace) -> dict[str, Any]:
    """Build a one-provider models_config JSON from --openclaw-* CLI flags.

    Fires from `inject_openclaw_models_config` when the user passes
    ``--openclaw-api`` without also passing ``--openclaw-models-config``.
    The result has the same shape as a committed preset JSON — one entry in
    ``providers`` keyed by the model-id prefix — so the downstream
    injection path (docker cp + in-container merge into
    ``~/.openclaw/openclaw.json['models']``) is unchanged.
    """
    api = args.openclaw_api
    base_url = getattr(args, "openclaw_provider_base_url", None)
    if not base_url:
        raise SystemExit(
            "--openclaw-provider-base-url is required when --openclaw-api is set."
        )
    model = args.openclaw_model or ""
    if "/" not in model:
        raise SystemExit(
            "--openclaw-model must be formatted '<provider-key>/<model-id>' "
            f"when --openclaw-api is set (got: {model!r})."
        )
    derived_prefix, _, model_id = model.partition("/")
    provider_key = (
        getattr(args, "openclaw_provider_key", None) or derived_prefix
    )
    if provider_key == "openrouter":
        raise SystemExit(
            "--openclaw-api cannot use the 'openrouter' provider key — the "
            "OpenRouter path is a separate code branch. Pick a different "
            "provider key (e.g. openai / anthropic / custom) that matches "
            "your --openclaw-model prefix."
        )
    env_name = (
        getattr(args, "openclaw_provider_api_key_env", None)
        or "OPENCLAW_PROVIDER_API_KEY"
    )
    api_key = os.environ.get(env_name, "")
    if not api_key:
        raise SystemExit(
            f"--openclaw-api is set but environment variable {env_name!r} is "
            "empty or unset. Export it or pass --openclaw-provider-api-key-env "
            "pointing at a populated variable."
        )
    # NOTE: the attribute name must match argparse's dest for the repeatable
    # `--openclaw-provider-header` flag, which is SINGULAR
    # (cli.py / run_realreplicabench.py both register it without `dest=`).
    # Reading a plural `openclaw_provider_headers` here silently yields []
    # and drops every user-supplied header — including the
    # `anthropic-version` the anthropic-messages path requires.
    headers = _parse_openclaw_provider_headers(
        getattr(args, "openclaw_provider_header", []) or []
    )
    # OpenClaw's config schema requires `name` on each model entry (see the
    # shipped presets under configs/realreplicabench_*_models.json). Default
    # to the model id so a bare --openclaw-api invocation is legal without
    # forcing the user to supply a display name.
    provider_entry: dict[str, Any] = {
        "baseUrl": base_url,
        "apiKey": api_key,
        "api": api,
        "timeoutSeconds": OPENCLAW_PROVIDER_REQUEST_TIMEOUT_SECONDS,
        "models": [
            {
                "id": model_id,
                "name": model_id,
                "reasoning": bool(getattr(args, "openclaw_thinking", None)),
            }
        ],
    }
    if headers:
        provider_entry["headers"] = headers
    return {"providers": {provider_key: provider_entry}}


def inject_openclaw_models_config(container: str, args: argparse.Namespace) -> None:
    synth_requested = bool(getattr(args, "openclaw_api", None))
    file_requested = bool(args.openclaw_models_config)
    if synth_requested and file_requested:
        raise SystemExit(
            "--openclaw-api and --openclaw-models-config are mutually exclusive. "
            "Use --openclaw-api (with --openclaw-provider-*) for the CLI "
            "shortcut, or --openclaw-models-config for a preset JSON file — "
            "not both."
        )
    if not synth_requested and not file_requested:
        return

    if synth_requested:
        models_config = _synthesize_openclaw_models_config(args)
    else:
        source = Path(args.openclaw_models_config).expanduser().resolve()
        if not source.is_file():
            raise SystemExit(f"OpenClaw models config not found: {source}")
        text = expand_env_placeholders(source.read_text(encoding="utf-8"))
        missing_env = sorted(set(re.findall(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}", text)))
        if missing_env:
            names = ", ".join(missing_env)
            raise SystemExit(
                f"OpenClaw models config still contains unresolved environment variables: {names}"
            )
        models_config = json.loads(text)
        if not isinstance(models_config, dict) or not isinstance(models_config.get("providers"), dict):
            raise SystemExit("OpenClaw models config must be a JSON object with a providers object")
        if not models_config["providers"]:
            raise SystemExit("OpenClaw models config providers object must not be empty")
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".json", delete=False) as tmp:
        json.dump(models_config, tmp, ensure_ascii=False, indent=2)
        tmp_path = Path(tmp.name)
    try:
        remote = "/tmp/realreplicabench-openclaw-models.json"
        # The openclaw container drops DAC_OVERRIDE/DAC_READ_SEARCH, so in-container
        # root cannot read this file if it keeps NamedTemporaryFile's 0600 mode under
        # host ownership. Make it world-readable before copying it in.
        tmp_path.chmod(0o644)
        docker("cp", str(tmp_path), f"{container}:{remote}", check=True)
        inject_cmd = (
            "python3 - <<'PY'\n"
            "import json\n"
            "from pathlib import Path\n"
            "config_path = Path('/root/.openclaw/openclaw.json')\n"
            f"models_path = Path({remote!r})\n"
            "config = json.loads(config_path.read_text()) if config_path.exists() else {}\n"
            "config['models'] = json.loads(models_path.read_text())\n"
            "config_path.parent.mkdir(parents=True, exist_ok=True)\n"
            "config_path.write_text(json.dumps(config, indent=2))\n"
            "PY"
        )
        proc = docker("exec", container, "bash", "-lc", inject_cmd, check=False, capture=True)
        if proc.returncode != 0:
            raise SystemExit(f"failed to inject OpenClaw models config:\n{proc.stdout or ''}")
    finally:
        tmp_path.unlink(missing_ok=True)


def inject_openclaw_openrouter_key(container: str, api_key: str) -> None:
    if not api_key:
        return
    inject_cmd = (
        "python3 - <<'PY'\n"
        "import json, os\n"
        "from pathlib import Path\n"
        "p = Path('/root/.openclaw/agents/main/agent/auth-profiles.json')\n"
        "d = json.loads(p.read_text()) if p.exists() else {'version': 1, 'profiles': {}}\n"
        "d.setdefault('profiles', {})['openrouter:default'] = {\n"
        "    'type': 'api_key',\n"
        "    'provider': 'openrouter',\n"
        "    'key': os.environ.get('OPENROUTER_API_KEY', ''),\n"
        "}\n"
        "p.parent.mkdir(parents=True, exist_ok=True)\n"
        "p.write_text(json.dumps(d, indent=2))\n"
        "PY"
    )
    proc = run(
        ["docker", "exec", "-e", f"OPENROUTER_API_KEY={api_key}", container, "bash", "-lc", inject_cmd],
        check=False,
        capture=True,
    )
    if proc.returncode != 0:
        raise SystemExit(f"failed to inject OpenClaw OpenRouter key:\n{proc.stdout or ''}")


def run_openclaw_agent(
    args: argparse.Namespace,
    spec: TaskSpec,
    container: str,
    agent_dir: Path,
    remote_workdir: str,
) -> int:
    started = time.time()
    agent_dir.mkdir(parents=True, exist_ok=True)
    openrouter_api_key = (
        getattr(args, "openclaw_api_key", None)
        or os.environ.get("OPENROUTER_API_KEY")
        or ""
    )
    probe = docker("exec", container, "bash", "-lc", "command -v openclaw", check=False, capture=True)
    if probe.returncode != 0:
        message = "openclaw binary not found in runtime image\n"
        (agent_dir / "run.log").write_text(message, encoding="utf-8")
        write_agent_result(spec=spec, agent_dir=agent_dir, harness="openclaw", returncode=127, started=started, response_text=message)
        return 127

    # Branch chrome-relay (v1.3) vs existing-session (v2026.5.22) plumbing.
    is_relay_mode = _openclaw_is_relay_mode(args)

    base_prompt = build_task_prompt(spec)
    # Pre-compute OpenClaw upload root used both in setup_cmds (cp) and the
    # prompt hint below. `browser action="upload"` requires paths under
    # /tmp/openclaw/uploads (DEFAULT_UPLOAD_DIR, fs.realpath check).
    openclaw_uploads_root = f"/tmp/openclaw/uploads/{spec.task_id}"
    # Agent-visible inputs are staged into the workdir at <workdir>/workspace
    # (new layout); old layout flattens them into the workdir root. Used in the
    # upload pre-copy and the prompt hint below.
    remote_task_input_dir = (
        f"{remote_workdir}/workspace" if (spec.case_dir / "workspace").is_dir() else remote_workdir
    )
    # OpenClaw-specific tool reference. Two non-obvious things the agent needs
    # to know to actually drive the harness:
    #   1) `browser action="upload"` requires paths under /tmp/openclaw/uploads
    #      (enforced via fs.realpath). The task inputs under <workdir>/workspace/
    #      would be rejected for upload. We pre-copy task files there at setup time.
    #   2) Without explicit mention of the upload action, gemini-3-flash-preview
    #      tries to fill <input type="file"> via `act` text typing and silently
    #      skips image uploads.
    if is_relay_mode:
        profile_explainer = (
            "- **必填 `profile=\"chrome-relay\"`**：每次调用 `browser` 工具时，**`profile` 参数必须显式写成 `\"chrome-relay\"`**。"
            "环境已经把 OpenClaw Browser Relay extension 装进容器内的 Chrome 9222 并 attach 好了 chrome-relay profile；"
            "OpenClaw 工具内置文档会建议你省略 `profile` 来用默认的 `\"openclaw\"` profile，但**那条建议在本环境下不适用**——"
            "省略或写 `\"openclaw\"` 会让 OpenClaw 多 spawn 一个独立 Chrome（在 18800 端口），跟 noVNC 显示的页面不同步。"
            "唯一正确选项：所有 browser 调用都加 `\"profile\":\"chrome-relay\"`。\n"
        )
    else:
        # v2026.5.22: harness has configured a default profile that attaches
        # to the upstream-entrypoint Chrome at 9222 via driver=openclaw +
        # attachOnly=true (yields full `local-managed` capability mode —
        # snapshot+act+tabs+reset). Agent can just omit `profile`.
        profile_explainer = (
            "- **browser profile**：环境已经把默认 profile 配置到容器内 Chrome 9222（driver=openclaw + attachOnly=true，"
            "完整 local-managed 能力：snapshot/act/tabs/reset 全可用）。所有 `browser` 调用直接用默认 profile 即可——"
            "可以**不传 `profile` 参数**，或显式写 `\"profile\":\"ccb\"`。"
            "**不要**写 `\"profile\":\"openclaw\"`,那是 OpenClaw 内部默认 profile,行为可能与当前环境期望的不同。\n"
        )
    openclaw_hint = (
        "\n\n## OpenClaw 工具速查\n\n"
        + profile_explainer
        + "- **图片/文件上传**：调用 `browser` 工具，`action=\"upload\"`,传 `targetId`（来自 snapshot）+ "
        "`paths`（绝对路径数组）。**所有要上传的本地文件必须使用 "
        f"`{openclaw_uploads_root}/`** 下的路径"
        f"（任务输入已复制到这里），例如 "
        f"`[\"{openclaw_uploads_root}/images/main_product.jpg\"]`。"
        "**不要**用 `act` / `type` 操作 `<input type=\"file\">`——浏览器对 file input 的 value 是只读的，必须走 upload action。"
        "**也不要**直接用 `/task/workspace/...` 路径上传，OpenClaw 的 upload action 只接受 `/tmp/openclaw/uploads/` 内的文件。\n"
        f"- **页面交互**：先 `browser action=\"snapshot\"` 拿 ref，再调用 `browser action=\"act\"`。"
        "常用结构：`request={\"kind\":\"click\",\"ref\":\"e10\"}`，"
        "`request={\"kind\":\"type\",\"ref\":\"e10\",\"text\":\"...\"}`，"
        "`request={\"kind\":\"type\",\"ref\":\"e13\",\"text\":\"...\",\"submit\":true}`，"
        "`request={\"kind\":\"select\",\"ref\":\"e20\",\"values\":[\"value\"]}`，"
        "`request={\"kind\":\"fill\",\"fields\":[{\"ref\":\"e10\",\"value\":\"...\"},{\"ref\":\"e13\",\"value\":\"...\"}]}`。"
        "通常不要传 `targetId`；如必须传，只能用 `open/navigate/tabs` 返回的长 `targetId`，不要用 `tabId`/`t1`。\n"
        f"- **导航**：`browser action=\"open\" url=...`（开新 tab）或 `action=\"navigate\" url=...`（当前 tab）。\n"
        "- **bash 工具**：`exec` 工具直接传 `command`。读文件优先用 `read` 工具而非 `exec cat`。\n"
        f"- **任务输入参考**：`{remote_task_input_dir}/` 是只读的原始任务输入（用于 read 工具）；"
        f"`{openclaw_uploads_root}/` 是同样内容的可上传副本（专供 browser upload）。\n"
    )
    prompt = (
        OPENCLAW_AGENT_DIRECTIVE + base_prompt + openclaw_hint + build_mock_integrity_note(spec)
    )
    prompt_path = agent_dir / "openclaw-prompt.md"
    prompt_path.write_text(prompt, encoding="utf-8")
    remote_prompt = f"/tmp/{spec.task_id}-openclaw-prompt.md"
    docker("cp", str(prompt_path), f"{container}:{remote_prompt}", check=True)

    # `openclaw_uploads_root` defined above; pre-copy task files into it so
    # the agent's `browser action="upload"` calls work.
    remote_files_src = remote_task_input_dir
    setup_cmds = [
        f"mkdir -p {shlex.quote(remote_workdir)} {shlex.quote(remote_workdir)}/outputs {shlex.quote(remote_workdir)}/tmp",
        "mkdir -p /root/.openclaw/agents/main/sessions",
        f"rm -rf /root/.openclaw/workspace && ln -s {shlex.quote(remote_workdir)} /root/.openclaw/workspace",
        f"mkdir -p /tmp/openclaw/uploads && rm -rf {shlex.quote(openclaw_uploads_root)} && "
        f"if [ -d {shlex.quote(remote_files_src)} ]; then "
        f"  cp -r {shlex.quote(remote_files_src)} {shlex.quote(openclaw_uploads_root)}; "
        f"else mkdir -p {shlex.quote(openclaw_uploads_root)}; fi",
        # Bootstrap ~/.openclaw/openclaw.json before any `openclaw config set`
        # so each subsequent set has a valid config file to mutate. v2026.5.22
        # ships without a default config (errors `Config file not found`).
        # v1.3 already has one from the upstream-image entrypoint, so this is
        # a no-op there. `|| true` guards against any unexpected non-zero
        # from doctor side-checks (e.g. systemd missing in container).
        "openclaw doctor --fix >/dev/null 2>&1 || true",
        "openclaw config set gateway.mode local",
        "openclaw config set gateway.port 18789",
        "openclaw config set browser.enabled true",
        # Safety net for any sub-feature that still tries to spawn its own Chromium.
        "openclaw config set browser.noSandbox true",
        f"openclaw config set agents.defaults.timeoutSeconds {int(spec.timeout_sec)}",
        f"ln -sfn {shlex.quote(remote_workdir)} /root/workspace",
    ]
    if is_relay_mode:
        # v1.3 path: chrome-relay extension drives Chrome 9222 via the
        # in-process relay. Some browser sub-tools (notably file uploads
        # via the sandbox path) still consult the sandbox browser flag and
        # emit "Sandbox browser is unavailable. Enable
        # agents.defaults.sandbox.browser.enabled or use target=\"host\""
        # without this, even though the actual driver is the relay.
        # Then route browser tool through the built-in `chrome-relay`
        # profile: driver=extension, cdpUrl points at the in-process relay
        # server (controlPort+1 = 18792 w/ gateway 18789). The relay
        # server speaks WS to the OpenClaw Browser Relay extension we
        # loaded into the upstream-image entrypoint Chrome via
        # EXTRA_LOAD_EXTENSIONS (see start_container). The extension uses
        # chrome.debugger.attach to drive Chrome on 9222.
        setup_cmds.extend([
            "openclaw config set agents.defaults.sandbox.browser.enabled true",
            "openclaw config set browser.defaultProfile chrome-relay",
        ])
    else:
        # v2026.5.22 path: chrome-relay extension is gone, only `openclaw`
        # and `existing-session` drivers exist. The right config to attach
        # to the upstream-entrypoint Chrome at 9222 is:
        #   driver=openclaw + attachOnly=true + cdpUrl=loopback
        # which yields `local-managed` capability mode (full snapshot+act
        # +tabs+reset). We previously used driver=existing-session but
        # that caps capabilities at `local-existing-session` (no selector
        # targeting, no managed tabs) and trips the "user-style profile
        # cannot use sandbox browser" error. attachOnly=true tells
        # OpenClaw to skip Chrome launch and just attach to the existing
        # 9222 socket — the same Chrome the screenshot sidecar watches
        # and noVNC displays.
        # sandbox.browser.enabled=false: v2026.5.22 tries to docker-run a
        # nested browser sandbox container when this is true, which fails
        # inside our agent container (no docker.sock). false routes the
        # browser tool to target="host" → use the configured profile.
        # SSRF policy: by default v2026.5.22 blocks browser navigation to
        # private/loopback hostnames. Mock services live on 127.0.0.1:*,
        # so we explicitly allow private-network navigation.
        # Setup quirks specific to v2026.5.22:
        #   1) `~/.openclaw/openclaw.json` does not exist by default — must
        #      run `openclaw doctor --fix` first (already in setup_cmds).
        #   2) Browser profile schema validates `color` as a required
        #      field and rejects partial deep-set ("driver: Invalid input")
        #      — must set the whole profile object via `--strict-json`.
        ccb_profile_json = (
            '{"driver":"openclaw",'
            '"cdpUrl":"http://127.0.0.1:9222",'
            '"attachOnly":true,'
            '"color":"#FF4500"}'
        )
        setup_cmds.extend([
            "openclaw config set agents.defaults.sandbox.browser.enabled false",
            "openclaw config set browser.ssrfPolicy.dangerouslyAllowPrivateNetwork true",
            f"openclaw config set browser.profiles.ccb {shlex.quote(ccb_profile_json)} --strict-json",
            "openclaw config set browser.defaultProfile ccb",
        ])
    if args.openclaw_thinking:
        setup_cmds.append(
            "openclaw config set agents.defaults.thinkingDefault "
            + shlex.quote(args.openclaw_thinking)
        )
    docker("exec", container, "bash", "-lc", " && ".join(setup_cmds), check=True)

    inject_openclaw_models_config(container, args)

    model = args.openclaw_model or os.environ.get("OPENCLAW_MODEL") or DEFAULT_OPENCLAW_MODEL

    # Release fork: no proxy-side provider injection. See module docstring for
    # the three model routes (selected by the --openclaw-model prefix).

    set_model = docker(
        "exec",
        container,
        "bash",
        "-lc",
        "openclaw models set " + shlex.quote(model),
        check=False,
        capture=True,
    )
    if set_model.returncode != 0:
        message = f"OpenClaw model setup failed:\n{set_model.stdout or ''}"
        (agent_dir / "run.log").write_text(message, encoding="utf-8")
        write_agent_result(spec=spec, agent_dir=agent_dir, harness="openclaw", returncode=set_model.returncode, started=started, response_text=message)
        return set_model.returncode

    # Vision safety net: OpenClaw's image-tool model must be vision-capable.
    # When the user did not pin --openclaw-image-model and the resolved primary
    # `model` does not look vision-capable, abort early — silently falling back
    # to a non-vision model means every image-bearing tool call (snapshots,
    # uploaded screenshots, PDF page renders) silently no-ops downstream.
    if not args.openclaw_image_model and not _openclaw_model_is_vision_capable(model):
        message = (
            f"OpenClaw image model not configured and primary model {model!r} is not "
            "known to be vision-capable. Set --openclaw-image-model to a vision-capable "
            "model (e.g. gemini-3-flash-preview, claude-sonnet-4.6, qwen-vl-plus).\n"
        )
        (agent_dir / "run.log").write_text(message, encoding="utf-8")
        write_agent_result(spec=spec, agent_dir=agent_dir, harness="openclaw", returncode=2, started=started, response_text=message)
        return 2

    image_model = args.openclaw_image_model or model
    set_image = docker(
        "exec",
        container,
        "bash",
        "-lc",
        "openclaw models set-image " + shlex.quote(image_model),
        check=False,
        capture=True,
    )
    if set_image.returncode != 0:
        message = f"OpenClaw image model setup failed:\n{set_image.stdout or ''}"
        (agent_dir / "run.log").write_text(message, encoding="utf-8")
        write_agent_result(spec=spec, agent_dir=agent_dir, harness="openclaw", returncode=set_image.returncode, started=started, response_text=message)
        return set_image.returncode
    # OpenRouter path authenticates via the openrouter auth profile (the
    # custom-provider native path carries its apiKey in the provider config
    # itself, set by inject_openclaw_models_config above).
    inject_openclaw_openrouter_key(container, openrouter_api_key)

    # Allow OpenClaw's media tools (pdf, image-from-path, etc.) to access task
    # inputs, which are staged under the workdir root "/task". The compiled JS
    # hardcodes the allowed roots in buildMediaLocalRoots — append "/task" to
    # that list. Two anchored seds cover both image states: the plain default
    # roots line, and the all-mocks image which already baked a "/benchmark"
    # entry (its line ends in ,"/benchmark"). Idempotent via the "/task" guard.
    docker(
        "exec", container, "bash", "-lc",
        "set -e; for f in /usr/local/lib/node_modules/openclaw/dist/auth-profiles-*.js; do "
        "  grep -q '\"/task\"' \"$f\" && continue; "
        "  sed -i "
        "-e 's|path.join(resolvedStateDir, \"sandboxes\")$|path.join(resolvedStateDir, \"sandboxes\"),\"/task\"|' "
        "-e 's|path.join(resolvedStateDir, \"sandboxes\"),\"/benchmark\"$|path.join(resolvedStateDir, \"sandboxes\"),\"/benchmark\",\"/task\"|' "
        "\"$f\"; "
        "done; true",
        check=False, capture=True,
    )

    shim_proc: subprocess.Popen[str] | None = None
    gateway_proc: subprocess.Popen[str] | None = None
    agent_proc: subprocess.Popen[str] | None = None
    watchdog_stop: threading.Event | None = None

    # Auto-enable rule (release fork): when the user asked for thinking effort
    # AND the resolved model is an `openrouter/...` ref, transparently wire up
    # the OpenRouter shim so the configured effort is preserved or supplied
    # consistently across OpenClaw provider paths. A native-provider model
    # (e.g. `google/gemini-3-flash-preview`
    # declared via --openclaw-models-config with api=google-generative-ai)
    # speaks its own wire format with native thinkingLevel — auto-starting an
    # OpenRouter shim for it would be wrong. `--openclaw-thinking` still sets
    # OpenClaw's agents.defaults.thinkingDefault for those models.
    if (
        getattr(args, "openclaw_thinking", None)
        and model.startswith("openrouter/")
        and not getattr(args, "openclaw_openrouter_shim", False)
    ):
        args.openclaw_openrouter_shim = True
        print(
            f"[openclaw] auto-enabled OpenRouter shim for thinking_effort={args.openclaw_thinking}",
            file=sys.stderr,
            flush=True,
        )

    try:
        if getattr(args, "openclaw_openrouter_shim", False):
            # OpenRouter direct path with native thinking-effort injection.
            # The shim is a thin forwarder to the configured OpenRouter-
            # compatible base URL (official OpenRouter by default)
            # that adds `reasoning_effort` (and optional `reasoning.max_tokens`)
            # to /chat/completions request bodies based on env tiers. Caller-
            # wins: a payload that already specifies reasoning is passed through.
            shim_port = int(getattr(args, "openclaw_openrouter_shim_port", 19501))
            shim_upstream_base = (
                getattr(args, "openclaw_base_url", None)
                or DEFAULT_OPENCLAW_BASE_URL
            )
            shim_env_parts = [
                f"OPENCLAW_OR_SHIM_PORT={shim_port}",
                f"OPENROUTER_BASE_URL={shlex.quote(str(shim_upstream_base))}",
            ]
            shim_thinking_effort = (
                getattr(args, "openclaw_thinking", None)
                or os.environ.get("OPENCLAW_OR_SHIM_THINKING_EFFORT", "")
            )
            if shim_thinking_effort:
                shim_env_parts.append(
                    f"OPENCLAW_OR_SHIM_THINKING_EFFORT={shlex.quote(str(shim_thinking_effort))}"
                )
            # Hot-load the host-side shim source so iteration doesn't need an
            # image rebuild.
            host_shim_src = PROJECT_ROOT / "docker" / "openclaw" / "proxy" / "openrouter_shim.py"
            if host_shim_src.is_file():
                docker(
                    "exec", container, "bash", "-lc", "mkdir -p /opt/openclaw_proxy",
                    check=False, capture=True,
                )
                docker(
                    "cp",
                    str(host_shim_src),
                    f"{container}:/opt/openclaw_proxy/openrouter_shim.py",
                    check=False,
                    capture=True,
                )
            shim_cmd = " ".join(shim_env_parts) + " python3 /opt/openclaw_proxy/openrouter_shim.py"
            shim_proc = popen_docker_exec_log(container, shim_cmd, agent_dir / "openrouter_shim.log")
            time.sleep(1.5)
            # OpenClaw always talks to the local shim while the shim forwards to
            # the originally configured public or compatible upstream.
            args.openclaw_base_url = f"http://127.0.0.1:{shim_port}/v1"
            # Patch compiled JS to redirect hardcoded OpenRouter URL to the
            # in-container shim. Sed both /api/v1 and /v1 patterns since
            # different OpenClaw builds use slightly different paths.
            shim_url = f"http://127.0.0.1:{shim_port}/v1"
            docker(
                "exec", container, "bash", "-lc",
                "set -e; "
                "find /usr/local/lib/node_modules/openclaw/dist -name '*.js' -print0 | xargs -0 "
                f"sed -i -e 's|https://openrouter.ai/api/v1|{shim_url}|g' "
                f"-e 's|https://openrouter.ai/v1|{shim_url}|g' 2>/dev/null; true",
                check=False, capture=True,
            )
            if not is_relay_mode:
                # v2026.5.22: also override the openclaw.json-stored provider
                # config. The apiKey passes through to real openrouter.ai, so
                # we keep whatever the user supplied via CLI or environment.
                shim_api_key = openrouter_api_key
                shim_timeout = (
                    f"&& openclaw config set models.providers.openrouter.timeoutSeconds "
                    f"{OPENCLAW_PROVIDER_REQUEST_TIMEOUT_SECONDS}"
                )
                docker(
                    "exec", container, "bash", "-lc",
                    f"openclaw config set models.providers.openrouter.baseUrl {shlex.quote(shim_url)} "
                    + (f"&& openclaw config set models.providers.openrouter.apiKey {shlex.quote(shim_api_key)}" if shim_api_key else "")
                    + shim_timeout,
                    check=False, capture=True,
                )

        # Shared gateway auth token between gateway and agent processes. Without
        # this, agent connects to gateway WS with a different token (or none),
        # gateway closes the connection (1006), agent falls back to embedded mode
        # whose browser tool then also fails. OpenClaw's upstream run-harness.sh
        # uses the same OPENCLAW_GATEWAY_TOKEN env var.
        openclaw_gateway_token = uuid.uuid4().hex + uuid.uuid4().hex[:32]
        shared_env = [
            # OpenClaw browser tool needs Xvfb for any chrome interaction. The
            # upstream-image entrypoint already started Xvfb on :99.
            "DISPLAY=:99",
            f"OPENCLAW_GATEWAY_TOKEN={shlex.quote(openclaw_gateway_token)}",
        ]
        gateway_env = list(shared_env)
        if openrouter_api_key:
            gateway_env.append(f"OPENROUTER_API_KEY={shlex.quote(openrouter_api_key)}")
        if args.openclaw_base_url:
            gateway_env.append(f"OPENROUTER_BASE_URL={shlex.quote(args.openclaw_base_url)}")
        gateway_cmd = (
            f"cd {shlex.quote(remote_workdir)} && "
            + " ".join(gateway_env) + " "
            + f"openclaw gateway --port {int(args.openclaw_gateway_port)} "
            + f"--auth token --token {shlex.quote(openclaw_gateway_token)}"
        )
        gateway_proc = popen_docker_exec_log(container, gateway_cmd, agent_dir / "gateway.log")
        time.sleep(max(0.0, float(args.openclaw_gateway_ready_delay)))

        if is_relay_mode:
            # Wire the OpenClaw "Browser Relay" extension up to Chrome 9222
            # by firing connectOrToggleForActiveTab() inside its service
            # worker via CDP. Without this step the extension is loaded but
            # idle (its toolbar-button click handler never fires in a
            # headless container), so OpenClaw's `chrome-relay` profile
            # would have no live relay WS to issue commands through and
            # every browser/* tool call would fail.
            attach_src = PROJECT_ROOT / "real_replica_bench" / "harnesses" / "openclaw" / "attach_openclaw_ext.ts"
            if not attach_src.is_file():
                # FATAL: without the attach script there is no way to wire
                # the Browser Relay extension up to Chrome 9222, so every
                # chrome-relay browser tool call would fail downstream.
                # Abort cleanly so outer finally still terminates procs.
                message = (
                    f"OpenClaw extension attach script missing at {attach_src}; "
                    "cannot wire chrome-relay extension to Chrome 9222. Aborting.\n"
                )
                (agent_dir / "run.log").write_text(message, encoding="utf-8")
                write_agent_result(spec=spec, agent_dir=agent_dir, harness="openclaw", returncode=3, started=started, response_text=message)
                return 3
            remote_attach = "/opt/openclaw_harness/attach_openclaw_ext.ts"
            docker("exec", container, "bash", "-lc", "mkdir -p /opt/openclaw_harness", check=False)
            docker("cp", str(attach_src), f"{container}:{remote_attach}", check=False)
            # Relay port = controlPort+1 = (gatewayPort+2)+1 in OpenClaw's
            # default port-derivation; with gateway 18789 → controlPort
            # 18791 → relayPort 18792.
            relay_port = int(args.openclaw_gateway_port) + 3
            # Initial tab URL — agent will navigate via browser action=open
            # later. about:blank avoids "127.0.0.1:3000 site unreachable"
            # screenshots during the idle warm-up.
            initial_tab_url = "about:blank"
            attach_cmd = (
                f"bun run {shlex.quote(remote_attach)} "
                f"{shlex.quote(openclaw_gateway_token)} "
                f"{relay_port} "
                f"{shlex.quote(initial_tab_url)}"
            )
            attach_result = docker(
                "exec", container, "bash", "-lc", attach_cmd,
                check=False, capture=True,
            )
            (agent_dir / "extension_attach.log").write_text(
                f"$ {attach_cmd}\n--- stdout ---\n{attach_result.stdout or ''}\n"
                f"--- stderr ---\n{attach_result.stderr or ''}\n"
                f"--- returncode={attach_result.returncode}\n",
                encoding="utf-8",
            )
            if attach_result.returncode != 0:
                # FATAL: extension attach failure means every browser/*
                # tool call via chrome-relay will fail; running the agent
                # in this state is worse than failing fast.
                message = (
                    f"OpenClaw extension attach failed (returncode={attach_result.returncode}); "
                    f"chrome-relay browser tool unavailable. See "
                    f"{agent_dir / 'extension_attach.log'}.\n"
                    f"--- attach stdout ---\n{(attach_result.stdout or '').strip()[:2000]}\n"
                    f"--- attach stderr ---\n{(attach_result.stderr or '').strip()[:2000]}\n"
                )
                (agent_dir / "run.log").write_text(message, encoding="utf-8")
                rc = attach_result.returncode if attach_result.returncode else 3
                write_agent_result(spec=spec, agent_dir=agent_dir, harness="openclaw", returncode=rc, started=started, response_text=message)
                return rc
            print("[openclaw] Browser Relay extension attached to Chrome 9222", flush=True)

            # --- Relay-stuck watchdog (v1.3 only) ------------------------
            # Background thread that re-runs attach_openclaw_ext.ts whenever
            # the OpenClaw runtime log emits "Restart the OpenClaw gateway"
            # — that message marks a relay-stuck condition (the embedded
            # Playwright in the chrome-relay extension hangs after a 10s
            # locator timeout, and OpenClaw has no built-in self-heal).
            # v2026.5.22 dropped this whole layer in favor of raw CDP
            # attach, so the watchdog is unnecessary there.
            watchdog_stop = threading.Event()
            watchdog_stop_local = watchdog_stop  # alias for closure
            _attach_recovery_cmd = attach_cmd

            def _relay_stuck_watchdog() -> None:
                prev_count = 0
                last_recovery = 0.0
                debounce_sec = 30.0
                while not watchdog_stop_local.is_set():
                    try:
                        probe = docker(
                            "exec", container, "bash", "-lc",
                            "tail -n 400 /tmp/openclaw/openclaw-*.log 2>/dev/null "
                            "| grep -c 'Restart the OpenClaw gateway' || true",
                            check=False, capture=True,
                        )
                        count = int((probe.stdout or "0").strip() or "0")
                    except (ValueError, Exception):
                        count = prev_count
                    if count > prev_count and (time.time() - last_recovery) > debounce_sec:
                        rec = docker(
                            "exec", container, "bash", "-lc", _attach_recovery_cmd,
                            check=False, capture=True,
                        )
                        last_recovery = time.time()
                        try:
                            with (agent_dir / "relay_watchdog.log").open("a", encoding="utf-8") as wlog:
                                wlog.write(
                                    f"[{datetime.now().isoformat()}] stuck-count={count} "
                                    f"(prev={prev_count}) re-attach rc={rec.returncode}\n"
                                    f"  stdout-tail: {(rec.stdout or '').strip()[-800:]}\n"
                                )
                        except OSError:
                            pass
                        print(
                            f"[openclaw watchdog] relay-stuck detected (events={count}); "
                            f"re-ran attach (rc={rec.returncode})",
                            file=sys.stderr, flush=True,
                        )
                    prev_count = count
                    if watchdog_stop_local.wait(8.0):
                        break

            watchdog_thread = threading.Thread(target=_relay_stuck_watchdog, daemon=True)
            watchdog_thread.start()
            # -------------------------------------------------------------
        else:
            # v2026.5.22 managed-attach mode: chrome-relay extension does
            # not exist; setup_cmds already configured the `ccb` profile
            # with driver=openclaw + attachOnly=true + cdpUrl=:9222 to
            # attach to the upstream-entrypoint Chrome and reach full
            # local-managed capability. No extension to wire up, no
            # relay-stuck class to watchdog against.
            print(
                "[openclaw] v2026.5.22 managed-attach mode: skipping extension "
                "attach + relay watchdog (browser tool drives Chrome 9222 via "
                "OpenClaw's managed CDP)",
                flush=True,
            )

        # `--local` is required: it makes the agent skip the gateway WS handshake
        # and run the loop in-process while still using gateway-side tools (browser,
        # exec) via HTTP/RPC. OpenClaw's upstream run-harness.sh uses --local.
        agent_env = list(shared_env)
        if openrouter_api_key:
            agent_env.append(f"OPENROUTER_API_KEY={shlex.quote(openrouter_api_key)}")
        if args.openclaw_base_url:
            agent_env.append(f"OPENROUTER_BASE_URL={shlex.quote(args.openclaw_base_url)}")
        agent_cmd = (
            f"cd {shlex.quote(remote_workdir)} && "
            + " ".join(agent_env) + " "
            + f"openclaw agent --session-id chat --timeout {spec.timeout_sec} --local "
            + f"--message \"$(cat {shlex.quote(remote_prompt)})\""
        )
        agent_proc = popen_docker_exec_log(container, agent_cmd, agent_dir / "run.log")
        try:
            agent_proc.wait(timeout=spec.timeout_sec + 30)
            returncode = agent_proc.returncode
        except subprocess.TimeoutExpired:
            terminate_process(agent_proc)
            returncode = 124
            with (agent_dir / "run.log").open("a", encoding="utf-8") as log:
                log.write(f"\n[openclaw] timeout after {spec.timeout_sec}s\n")
    finally:
        # Stop the relay-stuck watchdog before tearing down the gateway/agent
        # processes so it doesn't try to re-attach against a dead container.
        if watchdog_stop is not None:
            watchdog_stop.set()
        terminate_process(gateway_proc)
        terminate_process(shim_proc)
        close_process_log(agent_proc)
        close_process_log(gateway_proc)
        close_process_log(shim_proc)

    copy_from_container(container, OPENCLAW_TRANSCRIPT_PATH, agent_dir / "chat.jsonl")
    # Pull a copy of /root/.openclaw/agents/main/ + runtime logs out of the
    # container before it is destroyed. Mirrors collect_accio_state_artifacts
    # but OpenClaw state lives entirely in-container so there is no host
    # cleanup pass. Result dict is written to disk for debug; non-fatal.
    state_collection = collect_openclaw_state_artifacts(container, agent_dir)
    try:
        (agent_dir / "openclaw_state_collection.json").write_text(
            json.dumps(state_collection, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    except OSError:
        pass
    # Billing-aligned token tally (best-effort; no-op unless the OpenRouter
    # shim sidecar ran).
    collect_proxy_usage(container, agent_dir, OPENCLAW_PROXY_USAGE_REMOTE, "openclaw")
    transcript = (agent_dir / "chat.jsonl").read_text(encoding="utf-8", errors="replace") if (agent_dir / "chat.jsonl").is_file() else ""
    if transcript.strip():
        response_text = extract_json_event_text(transcript)
    else:
        response_text = (agent_dir / "run.log").read_text(encoding="utf-8", errors="replace")[-20000:]
    write_agent_result(
        spec=spec,
        agent_dir=agent_dir,
        harness="openclaw",
        returncode=returncode,
        started=started,
        response_text=response_text,
    )
    return returncode
