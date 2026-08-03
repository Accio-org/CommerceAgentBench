<p align="center">
  <img src="docs/assets/realreplicabench-banner.svg" width="100%" alt="RealReplicaBench — a stateful agent benchmark for real-world commerce workflows">
</p>

<p align="center">
  <a href="https://www.accio.com/">
    <img src="docs/assets/accio-logo.svg" height="30" alt="Accio">
  </a>
</p>

<p align="center">
  <strong>Developed and maintained by the Accio team at Alibaba International.</strong>
</p>

<p align="center">
  <a href="#release-status"><img alt="Release v1.3.1" src="https://img.shields.io/badge/release-v1.3.1-111827"></a>
  <a href="#benchmark-suite"><img alt="107 tasks" src="https://img.shields.io/badge/tasks-107-10b981"></a>
  <a href="#quick-start"><img alt="Python 3.11 or newer" src="https://img.shields.io/badge/python-%E2%89%A53.11-00b2ff"></a>
  <a href="#quick-start"><img alt="OpenClaw harness" src="https://img.shields.io/badge/harness-OpenClaw-059669"></a>
  <a href="#reference-results"><img alt="OpenClaw and Accio reference results" src="https://img.shields.io/badge/results-OpenClaw%20%2B%20Accio-047857"></a>
</p>

<p align="center">
  <a href="#overview">Overview</a> ·
  <a href="https://realreplicabench.site.accio.ai/">Live leaderboard</a> ·
  <a href="https://realreplicabench-mock-showcase.site.accio.ai/">Mock showcase</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#reproducibility-contract">Reproducibility</a> ·
  <a href="#project-ownership">Accio</a>
</p>

<p align="center">
  <sub>Official sites:
  <a href="https://realreplicabench.site.accio.ai/">leaderboard</a> ·
  <a href="https://realreplicabench-mock-showcase.site.accio.ai/">mock showcase</a> ·
  <a href="https://github.com/Accio-Lab">github.com/Accio-Lab</a> ·
  <a href="https://www.accio.com/">accio.com</a></sub>
</p>

---

## Overview

RealReplicaBench evaluates whether an agent can complete long-horizon business
workflows, not just answer questions about them. Tasks cover browser operations,
native-style CLI tools, API/MCP workflows, document and spreadsheet production,
public-web research, supplier analysis, product publishing, logistics, and
commerce operations. Every task runs in a fresh container and is graded by its
own deterministic or LLM-assisted verifier.

- **107 tasks:** 53 CLI, 28 browser, 16 file, and 10 API/MCP tasks.
- **Three capability slices:** 65 text-only, 20 browser-text-capable, and 22
  vision-required tasks.
- **Stateful evaluation:** local mock services model SaaS, commerce, messaging,
  document, and operational systems without requiring production accounts.
- **Auditable outputs:** each run preserves the resolved configuration,
  trajectory, verifier result, artifacts, logs, and container metadata.

<p align="center">
  <img src="docs/assets/benchmark-overview.svg" width="100%" alt="RealReplicaBench evaluation pipeline from business request to verified state change">
</p>

### Real task surfaces

The suite uses reproducible local replicas of commerce and business software,
so agents must operate interfaces and change state rather than merely describe
what they would do.

<table>
  <tr>
    <td width="33%"><img src="docs/assets/screenshots/alibaba-publish-form.jpg" alt="Product publishing workflow"></td>
    <td width="33%"><img src="docs/assets/screenshots/freightos-booking-search.jpg" alt="Freight booking workflow"></td>
    <td width="33%"><img src="docs/assets/screenshots/shopify-admin-theme-customize.jpg" alt="Storefront theme customization workflow"></td>
  </tr>
  <tr>
    <td align="center"><strong>Product publishing</strong><br><sub>Structured catalog and listing operations</sub></td>
    <td align="center"><strong>Freight booking</strong><br><sub>Multi-step logistics workflows</sub></td>
    <td align="center"><strong>Storefront operations</strong><br><sub>Visual configuration and stateful editing</sub></td>
  </tr>
</table>

<p align="center">
  <a href="https://realreplicabench-mock-showcase.site.accio.ai/">
    <img alt="Explore the RealReplicaBench UI Mock Showcase" src="https://img.shields.io/badge/Explore-UI%20Mock%20Showcase-059669?style=for-the-badge">
  </a>
</p>

<p align="center">
  <sub>Browse 104 rendered pages across eight UI mock services. The showcase is
  a static visual tour; state-changing interactions run inside the benchmark
  runtime.</sub>
</p>

> [!NOTE]
> **RealReplicaBench is an Accio project.** Its public benchmark identity is
> independent of any one harness, while the task design and release are
> developed and maintained by the Accio team at Alibaba International.

## Release status

This repository contains the public **v1.3.1 task suite and OpenClaw harness**.
The reference tables below use the same 107 task IDs as this release.

The supplied OpenClaw result bundles were audited against this repository:

- all **107/107 task IDs** match;
- all **107/107 agent-visible `task.md` files** match;
- among tasks with attachments, **101 workspaces match byte-for-byte** and two
  differ only in regenerated PDF branding/metadata; the remaining four tasks
  have no workspace attachments;
- the refreshed public runtime image has the same 23-layer root filesystem and
  the same `/opt/mock_services` contents as the image used by the OpenClaw
  reference runs.

One boundary remains important: the published OpenClaw scores were produced
through managed evaluation endpoints that are not distributed with this
repository and are not required to run it. The public path uses bring-your-own
credentials for native Gemini, native Qwen, OpenRouter, OpenAI's Responses API,
or a user-declared endpoint. The default public judge uses the same
`gemini-3.1-pro-preview` model identifier as the reference evaluation, but its
Google API route is still not byte-for-byte identical to the original
evaluation route. Treat the tables as **audited reference results**, not a
promise that a run through another endpoint or model snapshot will return the
same score.

## Reference results

Results are aligned by `task_id` over the complete 107-task collection. To keep
the harness comparison direct, the table below shows only the twelve model
families with results from both OpenClaw and Accio.

**The live leaderboard at
[realreplicabench.site.accio.ai](https://realreplicabench.site.accio.ai/) is the
source of record** — it carries analysis charts, task composition, benchmark
anatomy, and any model added since this README was written. The snapshot here
is for reading the repository offline; where the two differ, the site is right.

<p align="center">
  <img src="docs/assets/reference-leaderboard.svg" width="100%" alt="RealReplicaBench Leaderboard comparing OpenClaw and Accio">
</p>

### OpenClaw vs. Accio

<a href="https://www.accio.com/"><img src="docs/assets/accio-logo.svg" height="24" alt="Accio"></a>

Only model families with results from both harnesses over the same 107 task IDs
are included.

| Model | OpenClaw | Accio |
|---|---:|---:|
| Claude Opus 5 | **60/107 (56.1%)** | **66/107 (61.7%)** |
| Claude Opus 4.8 | **55/107 (51.4%)** | **59/107 (55.1%)** |
| GPT-5.6 Sol | **53/107 (49.5%)** | **55/107 (51.4%)** |
| GPT-5.5 | **51/107 (47.7%)** | **48/107 (44.9%)** |
| Claude Opus 4.7 | **49/107 (45.8%)** | **56/107 (52.3%)** |
| Qwen 3.8 Max Preview | **48/107 (44.9%)** | **49/107 (45.8%)** |
| Gemini 3.6 Flash | **48/107 (44.9%)** | **50/107 (46.7%)** |
| DeepSeek V4 Flash | **46/107 (43.0%)** | **50/107 (46.7%)** |
| GLM 5.2 | **42/107 (39.3%)** | **50/107 (46.7%)** |
| Gemini 3.5 Flash | **39/107 (36.4%)** | **46/107 (43.0%)** |
| GPT-5.6 Luna | **36/107 (33.6%)** | **48/107 (44.9%)** |
| Gemini 3 Flash | **31/107 (29.0%)** | **31/107 (29.0%)** |

### Detailed evaluation statistics

Pass and capacity use the same verifier semantics across harnesses. Steps,
time, and tokens are descriptive telemetry: tool granularity, runtime
scheduling, and provider usage accounting differ, so these values are not
normalized efficiency scores.

#### OpenClaw

| Model | Pass | Avg. capacity | Avg. steps | Avg. time | Avg. tokens |
|---|---:|---:|---:|---:|---:|
| Claude Opus 5 | 60/107 (56.1%) | 0.905 | 47.7 | 12.7 min | 3.47M |
| Claude Opus 4.8 | 55/107 (51.4%) | 0.860 | 47.6 | 16.4 min | 4.05M |
| GPT-5.6 Sol | 53/107 (49.5%) | 0.855 | 28.6 | 14.4 min | 2.09M |
| GPT-5.5 | 51/107 (47.7%) | 0.835 | 37.1 | 12.7 min | 2.85M |
| Claude Opus 4.7 | 49/107 (45.8%) | 0.871 | 47.4 | 14.3 min | 4.10M |
| Qwen 3.8 Max Preview | 48/107 (44.9%) | 0.822 | 40.6 | 18.9 min | 2.13M |
| Gemini 3.6 Flash | 48/107 (44.9%) | 0.867 | 46.3 | 13.5 min | 3.28M |
| DeepSeek V4 Flash | 46/107 (43.0%) | 0.827 | 137.8 | 19.2 min | 11.04M |
| GLM 5.2 | 42/107 (39.3%) | 0.814 | 56.9 | 14.8 min | 3.12M |
| Gemini 3.5 Flash | 39/107 (36.4%) | 0.798 | 63.9 | 17.9 min | 5.54M |
| GPT-5.6 Luna | 36/107 (33.6%) | 0.797 | 27.5 | 12.2 min | 1.81M |
| Gemini 3 Flash | 31/107 (29.0%) | 0.744 | 45.1 | 16.1 min | 3.09M |

#### Accio

| Model | Pass | Avg. capacity | Avg. steps | Avg. time | Avg. tokens |
|---|---:|---:|---:|---:|---:|
| Claude Opus 5 | 66/107 (61.7%) | 0.861 | 63.2 | 10.1 min | 3.69M |
| Claude Opus 4.8 | 59/107 (55.1%) | 0.886 | 67.4 | 11.6 min | 4.82M |
| Claude Opus 4.7 | 56/107 (52.3%) | 0.878 | 61.5 | 6.4 min | 4.32M |
| GPT-5.6 Sol | 55/107 (51.4%) | 0.873 | 53.0 | 5.5 min | 1.85M |
| Gemini 3.6 Flash | 50/107 (46.7%) | 0.815 | 47.7 | 4.6 min | 2.62M |
| GLM 5.2 | 50/107 (46.7%) | 0.787 | 81.0 | 10.8 min | 3.62M |
| DeepSeek V4 Flash | 50/107 (46.7%) | 0.838 | 84.0 | 10.0 min | 5.35M |
| Qwen 3.8 Max Preview | 49/107 (45.8%) | 0.856 | 69.8 | 12.7 min | 2.51M |
| GPT-5.5 | 48/107 (44.9%) | 0.864 | 45.3 | 4.5 min | 1.44M |
| GPT-5.6 Luna | 48/107 (44.9%) | 0.809 | 66.0 | 5.7 min | 2.49M |
| Gemini 3.5 Flash | 46/107 (43.0%) | 0.821 | 91.2 | 9.0 min | 4.80M |
| Kimi K3 | 43/107 (40.2%) | 0.832 | 61.5 | 13.8 min | 2.31M |
| Gemini 3 Flash | 31/107 (29.0%) | 0.769 | 46.0 | 4.5 min | 2.48M |

Full-precision values, public result IDs, runtime references, telemetry
coverage, and alignment metadata are on the
[live leaderboard](https://realreplicabench.site.accio.ai/).

The raw task-level result bundles are not stored in Git and do not yet have
public immutable URLs or checksums. Until they do, the published board is an
audited aggregate keyed by public result IDs, not a standalone reproduction
package.

### Get your model on the leaderboard

We run models on request, including **pre-release and internal builds** under
whatever access arrangement you need. If you want a result published on the
board — or an evaluation run privately against your own checkpoint before you
ship it — reach out: Yukun Lian, <lianyukun.lyk@alibaba-inc.com>; Sicong Xie,
<sicong.xsc@alibaba-inc.com>.

### Metrics

| Metric | Definition |
|---|---|
| Pass | A task passes only when every required verifier check passes. |
| Pass rate | Binary passes divided by the 107 aligned tasks. |
| Avg. capacity | Macro mean of each task's `checks_passed / checks_total`; this preserves partial task completion but is not a weighted official score. |
| Avg. steps | Mean trajectory tool-call count over the displayed task attempts. |
| Avg. time | Mean task wall-clock duration, using summary duration or audited manifest timestamps when the summary duration is zero. |
| Avg. tokens | Mean total model tokens per task after normalizing provider-specific usage fields; cached tokens are included when reported. |

## Quick start

### Requirements

- Docker with Linux container support.
- Python 3.11 or newer.
- A model API key and an LLM-judge API key.
- `linux/amd64` support. Apple Silicon hosts can use Docker emulation.

### Install

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e .
real-replica-bench list
```

### Pull the pinned OpenClaw runtime

The human-readable tag is mutable, so evaluation commands pin the current
release digest:

```bash
docker pull --platform linux/amd64 \
  acciolyk/accio_bench@sha256:1e9cf5c72a56794175b7d06ece036b92e296e6b7e9e9a7fa244026f6acea3859
```

The image contains OpenClaw `2026.5.22`, the browser stack, and the isolated
domain mock suite.

### Run one task

This example uses Gemini's native `generateContent` path and the public Google
API:

```bash
export GEMINI_API_KEY="..."

real-replica-bench run api-amazon-margin-floor-audit \
  --harness openclaw \
  --image acciolyk/accio_bench@sha256:1e9cf5c72a56794175b7d06ece036b92e296e6b7e9e9a7fa244026f6acea3859 \
  --platform linux/amd64 \
  --openclaw-model google/gemini-3.5-flash \
  --openclaw-image-model google/gemini-3.5-flash \
  --openclaw-models-config configs/realreplicabench_native_google_direct_models.json \
  --llm-judge-provider gemini \
  --llm-judge-model gemini-3.1-pro-preview \
  --run-id realreplicabench-smoke
```

### Run a collection

```bash
export GEMINI_API_KEY="..."

real-replica-bench run \
  --config configs/realreplicabench_openclaw_native_google_direct.yaml \
  --run-id "realreplicabench-openclaw-$(date +%Y%m%d-%H%M%S)"
```

Use `--limit 1` for a batch-path smoke test. The full suite can be partitioned
with the `*_text_only`, `*_browser_textcapable`, and `*_vision` collection
files under `datasets_domain_v1/`.

### Provider configurations

| Route | Configuration | Credentials |
|---|---|---|
| Native Gemini | `configs/realreplicabench_openclaw_native_google_direct.yaml` | `GEMINI_API_KEY` |
| Native Qwen / DashScope | `configs/realreplicabench_openclaw_qwen37plus_native.yaml` | `DASHSCOPE_API_KEY` plus judge key |
| OpenRouter | `configs/realreplicabench_openclaw.yaml` | `OPENROUTER_API_KEY` plus judge key |
| Qwen through OpenRouter | `configs/realreplicabench_openclaw_qwen37plus_openrouter.yaml` | `OPENROUTER_API_KEY` plus judge key |
| Custom native Gemini endpoint | `configs/realreplicabench_openclaw_native_google.yaml` | Provider-specific |
| OpenAI `/v1/chat/completions` (BYO) | `configs/realreplicabench_openclaw_openai_chat.yaml` | `OPENAI_API_KEY` (or your endpoint's env var) |
| OpenAI `/v1/responses` (BYO) | `configs/realreplicabench_openclaw_openai_responses.yaml` | `OPENAI_API_KEY` (or your endpoint's env var) |
| Anthropic `/v1/messages` (BYO) | `configs/realreplicabench_openclaw_anthropic_messages.yaml` | `ANTHROPIC_API_KEY` (or your endpoint's env var) |
| Custom Gemini `generateContent` proxy | `configs/realreplicabench_openclaw_custom_gemini.yaml` | `CUSTOM_GEMINI_BASE_URL` + `CUSTOM_GEMINI_API_KEY` |

The last four rows are vendor-neutral BYO-endpoint templates covering the
four common LLM wire formats — the presets ship with public defaults but
are meant to be edited (or bypassed via the CLI shortcut). See
[`docs/openclaw-byo-endpoint.md`](docs/openclaw-byo-endpoint.md) for the
full contract, the schema, and the `--openclaw-api` shortcut that
synthesizes a preset in memory.

### Public API routing

The agent API and Judge API are independent. Public commands use only the
provider routes documented below.

| Role | Public protocol | Credential | Endpoint control |
|---|---|---|---|
| Gemini agent | Native `generateContent` through OpenClaw | `GEMINI_API_KEY` | `baseUrl` in the models JSON |
| Qwen agent | DashScope OpenAI-compatible chat completions | `DASHSCOPE_API_KEY` | `baseUrl` in the models JSON |
| OpenAI Chat agent (BYO) | OpenAI `/v1/chat/completions` | `OPENAI_API_KEY` (or your endpoint's env var) | `baseUrl` in the models JSON, or `--openclaw-provider-base-url` |
| OpenAI Responses agent (BYO) | OpenAI `/v1/responses` | `OPENAI_API_KEY` (or your endpoint's env var) | `baseUrl` in the models JSON, or `--openclaw-provider-base-url` |
| Anthropic agent (BYO) | Anthropic `/v1/messages` | `ANTHROPIC_API_KEY` (or your endpoint's env var) | `baseUrl` in the models JSON, or `--openclaw-provider-base-url` |
| Custom Gemini agent (BYO) | Native `generateContent` proxy | `CUSTOM_GEMINI_API_KEY` | `baseUrl` in the models JSON, or `--openclaw-provider-base-url` |
| OpenRouter agent | OpenRouter chat completions through the bundled shim | `OPENROUTER_API_KEY` | `openclaw.base_url` / `--openclaw-base-url` |
| Gemini Judge | Native `generateContent` | `GEMINI_API_KEY` | `judge.base_url` / `--llm-judge-base-url` |
| OpenAI Judge | Responses API with structured output | `OPENAI_API_KEY` | `judge.base_url` / `--llm-judge-base-url` |

Six tasks include LLM-assisted checks; the other checks are deterministic.
For comparable public runs, keep the Judge fixed to
`gemini-3.1-pro-preview` unless you explicitly report a different Judge.

Supply credentials through environment variables. CLI key flags remain
available for direct one-task use, but environment variables keep secrets out
of the benchmark command itself. The batch runner redacts credential fields
from `run.yaml`, and unresolved `${...}` placeholders now fail before a
container run instead of being sent to a provider.

> [!CAUTION]
> The evaluated agent has shell access inside its task container. Provider
> credentials are available to the runtime while a task is executing, even
> though the release excludes them from archived OpenClaw state and redacts
> persisted configs. Use dedicated evaluation keys with minimum permissions,
> strict spend/rate limits, and no access to production data; rotate or revoke
> them after the run.

### API validation boundary

The pinned public image has been exercised against local protocol recorders,
without real credentials or billable calls:

- Gemini agent: versioned
  `/v1beta/models/<model>:streamGenerateContent?alt=sse`,
  `x-goog-api-key`, Gemini `contents`, and `thinkingConfig`.
- Qwen agent: `/compatible-mode/v1/chat/completions`, Bearer authentication,
  streaming messages, and native `enable_thinking`.
- OpenRouter agent: `/api/v1/chat/completions`, Bearer authentication, and
  reasoning preserved through the bundled shim, including a custom upstream
  base URL.
- Gemini Judge and OpenAI Judge: exact native `generateContent` and Responses
  API request/response contracts covered by `tests/test_public_api.py`.

This proves request construction and response parsing, not provider-side model
entitlement, quota, or billing. Before a full run, use `--limit 1` with your own
keys and record the provider/model snapshot in the run metadata.

## Reproducibility contract

Comparable runs must pin all of the following:

| Component | v1.3.1 pin |
|---|---|
| Task set | `realreplicabench_domain_v1_all` — 107 task IDs |
| Task definitions | This repository release, including task workspaces and graders |
| Harness | OpenClaw runner in this repository |
| Runtime | `acciolyk/accio_bench@sha256:1e9cf5c72a56794175b7d06ece036b92e296e6b7e9e9a7fa244026f6acea3859` |
| Model route | Record provider, exact model identifier, endpoint class, and reasoning configuration |
| Judge | Record provider, exact judge model, endpoint class, and timeout |
| Evaluation settings | Record task count, retry policy, aggregation rule, and stopping conditions before comparing scores |

Pin the runtime by digest, not by the mutable Docker Hub tag. Compare results
only within one benchmark version — a release can change what a task accepts,
so scores carry across versions only where the task did not.

Do not compare results solely by a displayed model name. Provider routing,
model snapshots, prompt adapters, retry policies, and judge endpoints can all
change outcomes.

## Benchmark suite

```text
datasets_domain_v1/
├── realreplicabench_domain_v1_all.collection.json
├── realreplicabench_domain_v1_text_only.collection.json
├── realreplicabench_domain_v1_browser_textcapable.collection.json
├── realreplicabench_domain_v1_vision.collection.json
└── <interface>/<platform>/<task>/
    ├── task.toml
    ├── task.md
    ├── workspace/
    ├── grader/
    ├── services/
    ├── private/
    └── rubric.json
```

Only `task.md` and `workspace/` are staged into the agent-visible task tree.
Graders, rubrics, private seeds, service launchers, and mock implementations
remain outside it. Final artifacts must be written to `/task/outputs/`.

The benchmark uses a fresh container for each task. After the agent exits, the
host-side verifier reads the final outputs and isolated mock state, writes the
reward record, archives available logs and trajectories, and removes the task
container.

## Result artifacts

```text
runs/<run_id>/
├── run.yaml
├── summary.json
├── summary.md
├── report.html
└── tasks/
    └── <index>-<task_id>/
        ├── manifest.json
        ├── agent/
        ├── verifier/
        ├── workspace/outputs/
        ├── screenshots/
        └── container/
```

## Repository layout

```text
real_replica_bench/       Python package, verifiers, reports, and OpenClaw harness
configs/                  Public provider and batch-run configurations
datasets_domain_v1/       The 107 task definitions and local assets
docker/openclaw/          Runtime image recipes and provider sidecars
docs/                     Runtime and provider docs, plus README assets
scripts/                  Build, run, validation, and artifact helpers
```

The runtime image's identity, immutable pin, and customization boundary are documented in
[`docs/openclaw-runtime-image.md`](docs/openclaw-runtime-image.md). Native
provider details are in
[`docs/openclaw-native-gemini.md`](docs/openclaw-native-gemini.md) and
[`docs/openclaw-native-qwen.md`](docs/openclaw-native-qwen.md).

## Validate a checkout

```bash
python scripts/validate_release.py
python -m compileall -q real_replica_bench scripts
python -m unittest discover -s tests -v
```

The release validator checks collection membership, task IDs, modality
partitions, required task files, config references, leaderboard shape, and
tracked absolute developer paths.

## Contributing

**We are asking for your mock environments.** A benchmark with a fixed task set
decays on a schedule: models saturate it, and its answers drift into training
data. RealReplicaBench is released in large part so that its mock surface can
keep growing — each new replica service is a new family of tasks that no model
has been trained on. Widening that surface faster than the field moves is not
work one team can do alone, which is why the mocks ship under an open license
and why this is the contribution we ask for first.

### Contribute a mock environment

A mock environment is a replica of a real service — its API semantics, its
state transitions, and above all its rejections — that runs offline and can be
scored deterministically. The thirteen registered in
`real_replica_bench/mock_services/registry.py` are the ones shipping today.
[`CONTRIBUTING.md`](CONTRIBUTING.md) states the bar a new one has to clear and
shows how to bake a local image to test it before you open the pull request.

**When your pull request is merged, you are credited under
[Contributors](#contributors).** That is the loop this release exists to start:
new mocks become new tasks, and new tasks keep the evaluation set ahead of the
models it measures.

One caveat worth stating plainly: mock services run from inside the pinned
runtime image, not from a checkout, so a merged mock reaches the published
benchmark only once the maintainers rebake that image and repin its digest.
That step is ours, and it happens on the release cadence rather than per merge.

### Other contributions and security

Task fixes, grader corrections, harness improvements, and documentation are all
welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md) for the task-integrity and
validation rules. Report integrity or security vulnerabilities privately as
described in [`SECURITY.md`](SECURITY.md). Third-party runtime and snapshot
provenance is inventoried in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

## Accio evaluation ecosystem

RealReplicaBench is the first public release in Accio's evaluation matrix.

| Property | Link | What it is |
|---|---|---|
| Live leaderboard | [realreplicabench.site.accio.ai](https://realreplicabench.site.accio.ai/) | Interactive results, analysis charts, and benchmark anatomy for this release |
| UI mock showcase | [realreplicabench-mock-showcase.site.accio.ai](https://realreplicabench-mock-showcase.site.accio.ai/) | 104 rendered pages across eight UI mock services — a static visual tour of the task surfaces |
| GitHub | [github.com/Accio-Lab](https://github.com/Accio-Lab) | The Accio-Lab organization hosting this repository |
| Accio | [accio.com](https://www.accio.com/) | The Accio product by Alibaba International |

## Project ownership

<p>
  <a href="https://www.accio.com/">
    <img src="docs/assets/accio-logo.svg" height="30" alt="Accio">
  </a>
</p>

RealReplicaBench is developed and maintained by the **Accio team at Alibaba
International**. Accio owns the project identity and coordinates benchmark
releases, task-integrity changes, and reference evaluations. Public releases
are published under the [Accio-Lab](https://github.com/Accio-Lab) GitHub
organization.

## Contributors

### Core contributors

The Accio team at Alibaba International — the harness, the mock services, and
the v1 task suite. Listed in author order, matching
[`CITATION.cff`](CITATION.cff) and the [Citation](#citation) entry.

**Yukun Lian** · **Lei Wei** · **Sicong Xie** · **Kesu Wang** ·
**Hongyu Li** · **Chenhao Jiang** · **Lanbo Lin** · **Tianyuan Yang** ·
**Xiaoyu Guo** · **Li Cai** · **Jialong Zhu**

Contact: Yukun Lian, <lianyukun.lyk@alibaba-inc.com>; Sicong Xie,
<sicong.xsc@alibaba-inc.com>.

### Community contributors

Authors of merged mock environments, tasks, graders, and fixes. Land a pull
request and you are listed here.

_This list opens with the first community contribution. Be the first._

Being listed is a credit line rather than paper authorship:
[`CITATION.cff`](CITATION.cff) stays with the core contributors. Where a
contribution is substantial enough to warrant formal authorship, the
maintainers may invite it.

## Citation

Citation metadata is available in [`CITATION.cff`](CITATION.cff). Cite
**RealReplicaBench (Accio)** together with release `v1.3.1` and the exact Git
commit used for evaluation. Until the accompanying paper is published, cite
the repository directly:

```bibtex
@misc{Lian2026RealReplicaBench,
    author={Yukun Lian and Lei Wei and Sicong Xie and Kesu Wang and Hongyu Li
            and Chenhao Jiang and Lanbo Lin and Tianyuan Yang and Xiaoyu Guo
            and Li Cai and Jialong Zhu},
    title={RealReplicaBench: A Stateful Agent Benchmark for Long-Horizon Commerce and Business Workflows},
    note={GitHub repository, v1.3.1},
    howpublished={\url{https://github.com/Accio-Lab/RealReplicaBench}},
    year={2026}
}
```

## License

RealReplicaBench is **open source**. It ships under two licenses, split the
same way as the repository itself:

| Scope | License | File |
|---|---|---|
| Harness, Python package, mock-service code, scripts, and configs | Apache License 2.0 | [`LICENSE`](LICENSE) |
| Task suite under `datasets_domain_v1/` (task definitions, workspaces, graders, rubrics) | Creative Commons Attribution 4.0 International (CC BY 4.0) | [`LICENSE-DATA`](LICENSE-DATA) |

Commercial use is allowed. Keep the license and attribution notices, state
significant changes, and credit the benchmark as described under
[Citation](#citation). Neither license grants trademark rights — "Accio" and
"RealReplicaBench" identify this benchmark, not a fork of it.

> [!IMPORTANT]
> These terms cover **Accio's own contributions only**. The repository also
> contains mirrored stylesheets, webfonts, icons, and recorded API responses
> whose rights their owners retain. Every one is inventoried by owner and path
> in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md); read it before
> redistributing.
