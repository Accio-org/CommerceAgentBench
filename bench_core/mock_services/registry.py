"""Registry of in-container mock services bundled into the public runtime image.

Each entry records:
- ``source_dir``: project-relative path of the JS/Python source bundled into
  the derived workstation image.
- ``install_path``: path inside the workstation container where the source
  lives after the derived image is built (``/opt/mock_services/<name>``).
- ``derived_image``: the workstation image tag that ships this service.
- ``listen_port``: TCP port the service binds on ``127.0.0.1`` once started.
- ``health_path``: HTTP path used by ``start_mock_services.sh`` to verify the
  service is ready (and by the host verifier if needed).
- ``launcher``: shell snippet that starts the service in the background. The
  task-side ``start_mock_services.sh`` is the actual entry point; this is a
  documentation hook so the same launch line stays consistent across tasks.

The harness itself does **not** read this registry — mock services are baked
into the workstation image, so launching is the task's responsibility (via
``files/start_mock_services.sh``). The registry exists to document what each
mock service expects and to keep the image-build / launcher scripts in sync.

**Public release baseline**: ``ALL_MOCKS_IMAGE`` is the immutable OpenClaw
2026.5.22 digest used by the v1.3.1 tasks. The ``derived_image`` field on each
included service points to that same artifact.

CLI mocks (``kind="cli"``)
-------------------------
The ``stripe_cli`` / ``todoist_cli`` / ``jira_cli`` / ``box_cli`` /
``dws_doc_cli`` entries are a different
*kind* of mock: they are **PATH binaries the agent shells out to** (``todoist
add ...``, ``jira issue list``, ``box files:get ...``), plus a verifier-only
HTTP readout port. They declare ``bin_names`` (binaries to put on the agent
``$PATH``), ``bench_bin`` (state/seed/reset/audit, NOT on the agent PATH), and
``listen_port``/``health_path`` for the daemon bridge. State lives in a per-task
SQLite DB (Bun ``bun:sqlite``); the verifier reads ground truth through
``/__bench/state`` or a compatibility alias such as ``/api/state``. Box
additionally needs ``js-yaml`` (``package.json`` deps) for byte-identical text
output.

These are remediated + golden-verified against real upstream — each command's
observable output was diffed against the genuine CLI and the remaining
divergences recorded, under an alignment methodology that is not part of this
public release — and high-integrity CLI mocks are baked into the shared
image under ``/opt/mock_services/<name>`` as ``mocksvc:700``. The runtime mock
loader installs only a thin on-PATH client that forwards argv/stdin/cwd to the
mocksvc-owned daemon and publishes verifier readout on the declared port. Two
caveats remain:

1. **node_modules**: ``.gitignore`` excludes ``mock_services/*/node_modules``.
   Box's ``js-yaml`` must be installed at image build time, before the source is
   chowned to ``mocksvc:700``.
2. **PATH vs mocksvc isolation**: runtime-loaded CLI wrappers execute copied
   mock source directly, so plain ``kind="cli"`` mocks are not source-isolated.
   For high-integrity CLI tasks, set ``isolate=True`` and
   ``isolation_model="daemon_cli"`` on the mock spec. That model requires the
   real CLI source to be baked under ``install_path`` as ``mocksvc:700`` and
   exposes only a world-readable thin client on the agent ``PATH``. The thin
   client forwards argv/stdin/cwd to ``/opt/mock_services/cli_daemon/server.mjs``,
   which runs as ``mocksvc`` and owns the SQLite state + verifier token.

Baked SaaS/API mocks
--------------------
``gmail_mock`` / ``amazon_sp_api`` / ``google_docs_mock`` /
``shopify_online_store_v2`` are baked under ``/opt/mock_services/<name>``. A
task still declares them under ``[environment.runtime_mocks.<name>]`` so the
harness can publish ports, copy per-task private seeds, and launch the service,
but the agent-visible runtime copy no longer receives the mock source.
"""
from __future__ import annotations

from dataclasses import dataclass


ALL_MOCKS_IMAGE = (
    "acciolyk/accio_bench@"
    "sha256:1e9cf5c72a56794175b7d06ece036b92e296e6b7e9e9a7fa244026f6acea3859"
)

@dataclass(frozen=True)
class MockServiceSpec:
    name: str
    source_dir: str
    install_path: str
    # ``"http"`` = long-running daemon bound to ``listen_port`` (default).
    # ``"cli"`` = PATH binaries the agent shells out to (no port); see the
    # "CLI mocks" section of the module docstring.
    kind: str = "http"
    # None for CLI mocks (not yet baked into any image) and until baking is
    # wired up.
    derived_image: str | None = None
    listen_port: int | None = None
    health_path: str | None = None
    launcher: str = ""
    # Optional env var that flips the service into a CLI/API-only surface
    # alongside its default browser surface. When the variable is set to
    # ``"1"`` in the task's ``start_mock_services.sh``, the service mounts
    # ``/api/cli/*`` routes authenticated with ``Authorization: Bearer
    # <MOCK_CLI_TOKEN>`` (default ``local-mock-token``). Browser anti-cheat
    # and closed-set validation stay enforced; the integrity log emits
    # ``cli_submit_valid`` / ``cli_access_valid`` events so the host
    # verifier (run with ``--mode cli``) can confirm the CLI path was used.
    dual_mode_env: str | None = None
    # CLI-mock (``kind="cli"``) fields:
    #  - ``bin_names``: binaries to expose on the agent ``$PATH``
    #  - ``bench_bin``: verifier-only control binary (state/seed/reset/audit),
    #    NOT placed on the agent PATH; requires ``verifier_token_env``.
    bin_names: tuple[str, ...] = ()
    bench_bin: str | None = None
    verifier_token_env: str = "MOCK_VERIFIER_TOKEN"
    isolate: bool = False
    isolation_model: str | None = None


MOCK_SERVICE_REGISTRY: dict[str, MockServiceSpec] = {
    "alibaba_publish": MockServiceSpec(
        name="alibaba_publish",
        source_dir="bench_core/mock_services/alibaba_publish",
        install_path="/opt/mock_services/alibaba_publish",
        derived_image=ALL_MOCKS_IMAGE,
        listen_port=3000,
        health_path="/health",
        launcher=(
            "nohup bun /opt/mock_services/alibaba_publish/server.js "
            ">>/tmp/alibaba_publish.log 2>&1 &"
        ),
        dual_mode_env="MOCK_ALLOW_CLI",
    ),
    "reddit_mock": MockServiceSpec(
        name="reddit_mock",
        source_dir="bench_core/mock_services/reddit_mock",
        install_path="/opt/mock_services/reddit_mock",
        derived_image=ALL_MOCKS_IMAGE,
        listen_port=3001,
        health_path="/health",
        launcher=(
            "PORT=3001 nohup bun /opt/mock_services/reddit_mock/server.js "
            ">>/tmp/reddit_mock.log 2>&1 &"
        ),
        dual_mode_env="MOCK_ALLOW_CLI",
    ),
    "shopify_admin": MockServiceSpec(
        name="shopify_admin",
        source_dir="bench_core/mock_services/shopify_admin",
        install_path="/opt/mock_services/shopify_admin",
        derived_image=ALL_MOCKS_IMAGE,
        listen_port=3000,
        health_path="/health",
        launcher=(
            "nohup bun /opt/mock_services/shopify_admin/server.js "
            ">>/tmp/shopify_admin.log 2>&1 &"
        ),
    ),
    "gmail_mock": MockServiceSpec(
        name="gmail_mock",
        source_dir="bench_core/mock_services/gmail_mock",
        install_path="/opt/mock_services/gmail_mock",
        derived_image=ALL_MOCKS_IMAGE,
        listen_port=3071,
        health_path="/health",
        launcher='PORT=3071 GMAIL_MOCK_DB="${GMAIL_MOCK_DB:-$BENCH_WORKDIR/tmp/gmail_mock.db}" bun "$BENCH_RUNTIME_MOCK_GMAIL_MOCK_DIR/server.js"',
    ),
    "amazon_sp_api": MockServiceSpec(
        name="amazon_sp_api",
        source_dir="bench_core/mock_services/amazon_sp_api",
        install_path="/opt/mock_services/amazon_sp_api",
        derived_image=ALL_MOCKS_IMAGE,
        listen_port=4000,
        health_path="/__bench/health",
        launcher='PORT=4000 MOCK_VERIFIER_TOKEN="$MOCK_VERIFIER_TOKEN" bun "$BENCH_RUNTIME_MOCK_AMAZON_SP_API_DIR/server.js"',
    ),
    "google_docs_mock": MockServiceSpec(
        name="google_docs_mock",
        source_dir="bench_core/mock_services/google_docs_mock",
        install_path="/opt/mock_services/google_docs_mock",
        derived_image=ALL_MOCKS_IMAGE,
        listen_port=3081,
        health_path="/health",
        launcher='PORT=3081 MOCK_VERIFIER_TOKEN="$MOCK_VERIFIER_TOKEN" bun "$BENCH_RUNTIME_MOCK_GOOGLE_DOCS_MOCK_DIR/server.js"',
    ),
    "google_workspace_cli": MockServiceSpec(
        name="google_workspace_cli",
        source_dir="bench_core/mock_services/google_workspace_cli",
        install_path="/opt/mock_services/google_workspace_cli",
        kind="cli",
        derived_image=ALL_MOCKS_IMAGE,
        listen_port=3081,
        health_path="/health",
        bin_names=("gws",),
        bench_bin="gws-bench",
        isolate=True,
        isolation_model="daemon_cli",
    ),
    "notion_cli": MockServiceSpec(
        name="notion_cli",
        source_dir="bench_core/mock_services/notion_cli",
        install_path="/opt/mock_services/notion_cli",
        kind="cli",
        derived_image=ALL_MOCKS_IMAGE,
        listen_port=3456,
        health_path="/health",
        bin_names=("ntn",),
        bench_bin="ntn-mock-bench",
        isolate=True,
        isolation_model="daemon_cli",
    ),
    "shopify_online_store_v2": MockServiceSpec(
        name="shopify_online_store_v2",
        source_dir="bench_core/mock_services/shopify_online_store_v2",
        install_path="/opt/mock_services/shopify_online_store_v2",
        derived_image=ALL_MOCKS_IMAGE,
        listen_port=3098,
        health_path="/health",
        launcher='PORT=3098 MOCK_VERIFIER_TOKEN="$MOCK_VERIFIER_TOKEN" bun "$BENCH_RUNTIME_MOCK_SHOPIFY_ONLINE_STORE_V2_DIR/server.js"',
        bin_names=("shopify",),
        bench_bin="shopify-bench",
    ),
    # --- Hybrid HTTP + CLI: DingTalk Workspace doc mock ---------------------
    # SQLite-backed doc CLI (`dws`) + daemon-backed HTTP verifier surface (:3020).
    # Agent uses `dws doc ...`; verifier reads `/api/state` via bench token.
    "dws_doc_cli": MockServiceSpec(
        name="dws_doc_cli",
        source_dir="bench_core/mock_services/dws_doc_cli",
        install_path="/opt/mock_services/dws_doc_cli",
        kind="cli",
        derived_image=ALL_MOCKS_IMAGE,
        listen_port=3020,
        health_path="/health",
        bin_names=("dws",),
        bench_bin="dws-bench",
        isolate=True,
        isolation_model="daemon_cli",
    ),
    # High-integrity daemon-backed CLI mock. Agent still runs `stripe ...`, but
    # /usr/local/bin/stripe is a thin client; the real source + SQLite state are
    # mocksvc-owned inside the image.
    "stripe_cli": MockServiceSpec(
        name="stripe_cli",
        source_dir="bench_core/mock_services/stripe_cli",
        install_path="/opt/mock_services/stripe_cli",
        kind="cli",
        derived_image=ALL_MOCKS_IMAGE,
        listen_port=3000,
        health_path="/health",
        bin_names=("stripe",),
        bench_bin="stripe-bench",
        isolate=True,
        isolation_model="daemon_cli",
    ),
    # --- CLI mocks (PATH binaries, no port; see module docstring) -----------
    # Remediated + golden-verified vs real upstream; NOT yet baked into an
    # image (derived_image=None). bench_bin reads ground truth via
    # ``<bench_bin> state --token "$MOCK_VERIFIER_TOKEN"``.
    "todoist_cli": MockServiceSpec(
        name="todoist_cli",
        source_dir="bench_core/mock_services/todoist_cli",
        install_path="/opt/mock_services/todoist_cli",
        kind="cli",
        derived_image=ALL_MOCKS_IMAGE,
        listen_port=3000,
        health_path="/health",
        bin_names=("todoist",),
        bench_bin="todoist-bench",
        isolate=True,
        isolation_model="daemon_cli",
    ),
    "jira_cli": MockServiceSpec(
        name="jira_cli",
        source_dir="bench_core/mock_services/jira_cli",
        install_path="/opt/mock_services/jira_cli",
        kind="cli",
        derived_image=ALL_MOCKS_IMAGE,
        listen_port=3000,
        health_path="/health",
        bin_names=("jira",),
        bench_bin="jira-bench",
        isolate=True,
        isolation_model="daemon_cli",
    ),
    "box_cli": MockServiceSpec(
        name="box_cli",
        source_dir="bench_core/mock_services/box_cli",
        install_path="/opt/mock_services/box_cli",
        kind="cli",
        derived_image=ALL_MOCKS_IMAGE,
        listen_port=3000,
        health_path="/health",
        bin_names=("box",),
        bench_bin="box-bench",
        isolate=True,
        isolation_model="daemon_cli",
    ),
}
