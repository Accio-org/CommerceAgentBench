"""Agent-facing prompt assembly (task prompt, mock-integrity note, scenario).

Extracted verbatim from cli.py (2026-06-18 refactor). Depends only on the
REMOTE_WORKSPACE_ROOT container-path constant; TaskSpec appears solely in
annotations and is imported under TYPE_CHECKING to avoid importing cli.
"""
from __future__ import annotations

import argparse
from typing import TYPE_CHECKING, Any

from real_replica_bench.constants import REMOTE_WORKSPACE_ROOT

if TYPE_CHECKING:
    from real_replica_bench.cli import TaskSpec


def build_task_prompt(spec: TaskSpec) -> str:
    prompt = (spec.case_dir / spec.entrypoint).read_text(encoding="utf-8")
    remote_workdir = REMOTE_WORKSPACE_ROOT
    # New layout exposes inputs under workspace/; old layout flattens them into
    # the workdir root.
    remote_input_dir = (
        f"{remote_workdir}/workspace" if (spec.case_dir / "workspace").is_dir() else remote_workdir
    )
    remote_output_dir = f"{remote_workdir}/outputs"
    workspace_contract = (
        "本次工作的标准目录约定：\n"
        f"- 任务输入目录：`{remote_input_dir}`。\n"
        f"- 标准工作目录：`{remote_workdir}`。\n"
        f"- 标准产物目录：`{remote_output_dir}`。\n"
        "- 如需创建或修改任何本地文件，请在标准工作目录内完成，并把最终文件保存到标准产物目录。\n"
        "- 不要把最终产物只保存在 `/tmp`、桌面、下载目录或其它临时路径；这些路径不会作为标准结果归档。\n\n"
    )
    if spec.runtime_mocks and "/mcp" in prompt:
        workspace_contract += (
            "MCP 工具约定：`accio-mcp-cli` 不可用；如任务要求使用本地 `/mcp` endpoint，"
            "请直接用 `curl` 或等价命令发送 JSON-RPC `tools/list` / `tools/call` 请求。\n\n"
        )
    return workspace_contract + prompt


def build_mock_integrity_note(spec: TaskSpec) -> str:
    """Anti-tamper integrity boundary for tasks that ship a mock service.

    The OpenClaw single-agent harness runs the agent with full root bash and
    no approval gate, so it *could* poke at the baked mock service to fabricate
    a passing state. Mock-source isolation (mocksvc:700 + cap-drop DAC_OVERRIDE)
    and server-side validation are the structural defense; this note is the
    explicit behavioral contract on top.

    Phrased to forbid tampering with the service *itself* WITHOUT forbidding the
    legitimate task-documented CLI/API path (e.g. dual-mode ``/api/cli``). It is
    deliberately framed as a normal real-world operating constraint and carries
    NO evaluation-revealing language (no "评分"/"作弊"/"评测"/"任务无效", no
    verifier internals) so the agent is not cued that this is a benchmark.
    Empty string for tasks with no mock, so it never appears as noise.
    """
    has_mock = bool(spec.mock_services or spec.host_published_port or spec.runtime_mocks)
    if not has_mock:
        return ""
    return (
        "\n## 操作规范（重要）\n\n"
        "本环境中的各项服务与平台均为真实的线上第三方系统。请始终像真实用户那样，"
        "**只通过它们提供的正常用户界面、或任务中明确说明的 CLI / API 来使用它们**。\n"
        "**不得对这些服务本身做任何越权改动或绕过其正常业务流程**，包括但不限于：\n"
        "- 读取或修改服务的源码、配置、数据库或内部状态文件；\n"
        "- 杀死、重启、替换或重新部署服务进程；\n"
        "- 直接写入或伪造服务的内部数据；\n"
        "- 调用任务正常流程之外的内部 / 管理 / 调试接口；\n"
        "- 任何绕过服务自身校验与业务规则的手段。\n"
        "请始终通过正常、合规的操作真实地完成工作。\n"
    )


def build_scenario(spec: TaskSpec, args: argparse.Namespace) -> dict[str, Any]:
    prompt = build_task_prompt(spec)
    if args.harness == "accio" and args.default_project_dir == REMOTE_WORKSPACE_ROOT:
        # Accio's upload boundary == defaultProject.dir == the standard workdir.
        # Task inputs are staged at <workdir>/workspace, already inside the
        # boundary, so the agent uploads them directly (no separate copy).
        upload_dir = (
            f"{args.default_project_dir}/workspace"
            if (spec.case_dir / "workspace").is_dir()
            else args.default_project_dir
        )
        prompt += (
            "\n【浏览器上传文件约定】`browser action=upload` 只接受工作目录 "
            f"`{args.default_project_dir}` 内的路径（上传边界）；任务输入就在该边界内的 "
            f"`{upload_dir}/`，上传图片/文件直接用该目录下的路径即可。\n"
        )
    timeout_ms = spec.timeout_sec * 1000
    actions: list[dict[str, Any]] = []
    if args.create_agent:
        create_action: dict[str, Any] = {
            "type": "create_agent",
            "name": args.agent_name,
            "runtime": args.agent_runtime,
            "setAsActive": True,
        }
        if args.agent_template_id:
            create_action["templateId"] = args.agent_template_id
        if args.tool_preset:
            create_action["toolPreset"] = args.tool_preset
        if args.default_project_dir:
            create_action["defaultProject"] = {"dir": args.default_project_dir}
        if args.model_provider or args.model_name:
            create_action["model"] = {}
            if args.model_provider:
                create_action["model"]["provider"] = args.model_provider
            if args.model_name:
                create_action["model"]["name"] = args.model_name
        actions.append(create_action)
    actions.append(
        {
            "type": "chat",
            "message": prompt,
            "timeoutMs": timeout_ms,
        }
    )
    return {
        "name": spec.task_id,
        "agentId": args.agent_id,
        "initialSessionKey": f"session-{spec.task_id}",
        "initialSessionName": spec.name,
        "defaultTimeoutMs": timeout_ms,
        "actions": actions,
    }
