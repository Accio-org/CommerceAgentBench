"""Shared module-level constants for RealReplicaBench (release fork).

Extracted from cli.py (2026-06-18 upstream refactor) so sibling modules
(prompts, mock_runtime, harnesses) can import container-path roots without
importing cli — which would be circular. cli re-exports these for backward
compat.

Release fork: OpenClaw-only. Codex/Hermes constants stripped.
"""
from __future__ import annotations

import os
from pathlib import Path

# Repository root (this file lives at <repo>/real_replica_bench/constants.py,
# so parents[1] is the repo root — same value cli.py computed locally before).
# Used by cli for dataset/runs paths and by the openclaw runner to docker-cp
# host-side assets (sidecar, browser-extension) into containers.
PROJECT_ROOT = Path(__file__).resolve().parents[1]

# Standard in-container working tree root (= the agent's workdir; one task per
# fresh container, so no per-task suffix). Inputs are staged at <root>/workspace
# and final artifacts go to <root>/outputs. A neutral, brand-free name chosen so
# the agent's visible paths don't reveal the harness or that this is a benchmark.
REMOTE_WORKSPACE_ROOT = "/task"
# Per-task runtime mock-service install root inside the container.
REMOTE_RUNTIME_MOCKS_ROOT = "/benchmark/runtime/mock_services"

# --- OpenClaw harness defaults ---
# Release-published image (Docker Hub: acciolyk/accio_bench:openclaw-ccb-...).
# Use the immutable digest in runs; the human-readable tag is intentionally
# retained only in build/import documentation because registry tags can move.
DEFAULT_OPENCLAW_IMAGE = (
    "acciolyk/accio_bench@"
    "sha256:1e9cf5c72a56794175b7d06ece036b92e296e6b7e9e9a7fa244026f6acea3859"
)
DEFAULT_OPENCLAW_MODEL = "openrouter/openai/gpt-5.5"
DEFAULT_OPENCLAW_BASE_URL = "https://openrouter.ai/api/v1"
OPENCLAW_TRANSCRIPT_PATH = "/root/.openclaw/agents/main/sessions/chat.jsonl"

# In-container path the OpenRouter shim writes the per-run billing-aligned
# token tally to (when --openclaw-thinking is set). Collected to
# agent_dir/proxy_usage.json after the run by core.collect_proxy_usage.
OPENCLAW_PROXY_USAGE_REMOTE = "/tmp/openclaw_proxy_usage.json"

# Release-only: OpenClaw's `agents.defaults.providers.<name>.timeoutSeconds`
# default is 60s, which is too aggressive for cold-cached generateContent +
# Cloud-Functions latency. Bumped to 600s; overridable via env.
OPENCLAW_PROVIDER_REQUEST_TIMEOUT_SECONDS = int(
    os.environ.get("OPENCLAW_PROVIDER_REQUEST_TIMEOUT_SECONDS", "600")
)

# Legacy auth-image aliases retained for run-config schema compatibility (some
# old YAMLs reference these names through args.image). The release runtime
# image is DEFAULT_OPENCLAW_IMAGE above; these aliases simply default to it.
DEFAULT_LINUX_AUTH_IMAGE = DEFAULT_OPENCLAW_IMAGE
DEFAULT_MAC_AUTH_IMAGE = DEFAULT_OPENCLAW_IMAGE
