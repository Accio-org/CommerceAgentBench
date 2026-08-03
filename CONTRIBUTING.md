# Contributing to RealReplicaBench

Thank you for helping improve RealReplicaBench. Changes should preserve the
benchmark's task integrity, reproducibility, and public/private boundary.

## Development setup

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e .
python scripts/validate_release.py
```

Before opening a pull request, also run:

```bash
python -m compileall -q real_replica_bench scripts
python -m unittest discover -s tests
for file in scripts/*.sh; do bash -n "$file"; done
```

Docker-backed task smokes are welcome when a change touches the harness, a
runtime mock, or a verifier. Record the exact image digest, provider route,
model ID, judge ID, and protocol used.

### Test imports

`scripts/` is a plain directory, not a package: `pyproject.toml`'s
`packages.find` installs only `real_replica_bench*`, and
`unittest discover -s tests` puts `tests/` — not the repo root — on
`sys.path`. A plain `from scripts.x import y` in a test therefore fails
under CI. Import repo modules outside `real_replica_bench` by file path
with the `_load_by_path` helper in `tests/test_public_api.py`.

### OpenClaw provider configs

Every `models[]` entry in a `configs/*_models.json` provider config needs
both an `id` and a non-empty `name`. Omitting `name` — or setting it to
`""` or `null` — aborts the run at injection time with
`models.0.name: Invalid input`, before any request is sent. The value
itself is unrestricted: descriptive labels containing `/` or parentheses
validate fine. See
[`docs/openclaw-byo-endpoint.md`](docs/openclaw-byo-endpoint.md) for the
full provider-entry schema and the `--openclaw-api` CLI shortcut that
synthesizes one in memory.

## Public sites (leaderboard, matrix, showcase)

The public web pages are **not tracked in this repository**. They are
maintained in local, gitignored site workspaces (`rrb-report/`, together with
the legacy `docs/index.html` page it was built from) and deployed to:

- <https://realreplicabench.site.accio.ai/> — RealReplicaBench live
  leaderboard, analysis, and benchmark anatomy
- <https://realreplicabench-mock-showcase.site.accio.ai/> — UI mock showcase

The live leaderboard is the **source of record for results**. The repository
carries a human-readable snapshot in the README and says the site wins; it no
longer ships a results JSON, because a second copy only ever drifts behind and
leaves readers two numbers to choose between. Task composition figures still
come from this repository: each task's `task.toml` and `rubric.json`.

When results change, update the site, then refresh the README snapshot and
`docs/assets/reference-leaderboard.svg` from it. **Never hand-edit numbers into
a page or a figure without a source** — an earlier revision kept three
divergent copies of the same figures and they drifted. Pull requests should
not add web pages back under `docs/`; the tracked `docs/` tree carries only
runtime/provider documentation and README assets.

## Contributing a mock environment

New replica services are the contribution this project most wants, because the
mock surface is what keeps the evaluation set ahead of the models it measures.
A mock is a replica of a real service that runs offline and can be scored
deterministically; `real_replica_bench/mock_services/registry.py` documents
what each of the thirteen current services declares.

The bar a new mock has to clear:

- **Offline and deterministic.** No live network. Nothing a grader reads may
  depend on wall-clock time or randomness. The same seed state plus the same
  agent actions must produce the same verifier readout on every run.
- **Server-side validation.** Closed-set fields, state transitions, and
  rejections are enforced by the service. Whatever the mock accepts *is* the
  scoring contract, so a check that lives only in a page's JavaScript is not a
  check — an agent that never loads the page will never hit it.
- **A verifier readout.** Ground truth is read out of the service (`/__bench/state`
  or a documented alias), not scraped from the agent's own output.
- **Seed data committed to the repository.** Deterministic fixtures, never
  fetch-at-run-time. No real personal data, credentials, or customer records.
- **A registry entry** recording source dir, install path, listen port, health
  path, and launcher, so the image build and the task launchers stay in sync.
- **At least one task that exercises it.** A mock with no task cannot be
  evaluated, and therefore cannot be reviewed. See "Task changes" below.
- **Redistributable assets only.** Mirrored stylesheets, webfonts, icons,
  product photography, and captured third-party responses must either be
  clearly redistributable under this repository's licenses or be replaced with
  an original equivalent — and recorded in
  [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) when kept.
- **Lawful, good-faith scenarios**, same as the task suite.

### Test it before opening the pull request

Mock services run from `/opt/mock_services/` inside the runtime image, not from
your checkout, so a repository-only change does nothing to a run. Bake a local
image — note the build context is the mock-services directory, not the repo
root:

```bash
docker build --platform linux/amd64 \
  -f docker/openclaw/Dockerfile.all-mocks \
  -t realreplicabench/openclaw:dev \
  real_replica_bench/mock_services
```

Then point your task's `base_images` at `realreplicabench/openclaw:dev` while
you iterate, and restore the pinned digest before you commit.

### What happens after the merge

Merging a mock does not by itself change the published benchmark: the official
runtime image has to be rebaked with the new service and its digest repinned.
That is a maintainer step on the release cadence rather than a per-merge one —
[Shipping a mock-source change to the published image](#shipping-a-mock-source-change-to-the-published-image)
describes it. Once it ships, you are listed under Contributors in the README.

## Task changes

A benchmark task must remain a realistic user request rather than an exposed
scoring rubric.

- Keep agent-visible inputs in `task.md` and `workspace/`.
- Keep graders, rubrics, private seeds, service launchers, and mock source out
  of the agent-visible task tree.
- Write final artifacts to `/task/outputs/`.
- Validate closed-set fields and state transitions on the mock server, not only
  in frontend code.
- Do not add required remote assets that can disappear; commit the permitted
  local input or document the reproducible acquisition step.
- Keep every scenario lawful and good-faith.

When `requires_vision` or `requires_browser` changes, update the modality
collections. `python scripts/validate_release.py` checks that the three subsets
form an exact partition of the full collection.

### Shipping a mock-source change to the published image

Editing `real_replica_bench/mock_services/` has no effect on a run until the
image is rebuilt and the digest repinned — see
[Test it before opening the pull request](#test-it-before-opening-the-pull-request)
for why, and for the local build that lets you iterate without one.

This section is the other half: how such a change reaches the *published*
benchmark. Rebuild on a **new tag** rather than overwriting the current one, so
runs already recorded against the old digest stay reproducible, and record the
version boundary — a mock-behaviour change is a scoring change.

The runtime is then pinned by **digest** in 138 places. Repin with the helper,
not with a find-and-replace:

```bash
python scripts/repin_runtime_image.py --new-digest sha256:<new> --dry-run
python scripts/repin_runtime_image.py --new-digest sha256:<new>
```

A partial rewrite splits the suite across two runtimes. The helper rewrites
only the pins that decide what runs, and prints every other occurrence — build
bases, historical records — for a human call.

### Scoring changes are version boundaries

A change to what a task accepts makes new scores incomparable with published
ones. Say so in the pull request — which tasks, what changed, and the evidence
it is correct — so the boundary can be recorded against the release. Prefer
fixing the task contract (`task.md`, briefs, policies, mock validation) over
loosening a grader to fit whatever an agent produced.

## Verifier changes

Verifier check totals must be stable across success and failure paths. Missing
or invalid outputs should emit the full expected check breakdown with
downstream checks marked failed. Preserve the distinction between:

- binary pass: every required check passed; and
- capacity: the macro mean of each task's
  `checks_passed / checks_total`.

Do not change a published result row without retaining its source run and
protocol provenance.

## Pull requests

Keep changes scoped and explain:

1. the user-visible or evaluation problem;
2. the affected task, harness, or runtime surface;
3. validation performed; and
4. whether existing results remain comparable.

Never commit credentials, login state, production data, or private provider
configuration.

## Licensing of contributions

The repository is dual-licensed: Apache-2.0 ([`LICENSE`](LICENSE)) for the
harness, package, mock services, scripts, and configs; CC BY 4.0
([`LICENSE-DATA`](LICENSE-DATA)) for the task suite under
`datasets_domain_v1/`. By submitting a pull request you agree that your
contribution is licensed under whichever of the two covers the files you
touched, as Apache-2.0 Section 5 provides. No separate CLA is required.

Do not add third-party material — mirrored stylesheets, fonts, icons, captured
API responses, product photography — unless it can be redistributed under
those terms, and record it in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) when you do.
