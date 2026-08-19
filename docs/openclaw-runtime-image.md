# OpenClaw 2026.5.22 runtime image

Commerce Agent Bench v1.3.1 runs on a project-published May 2026 OpenClaw runtime.

## Release identity

| Property | v1.3.1 value |
|---|---|
| Public image | `acciolyk/accio_bench@sha256:1e9cf5c72a56794175b7d06ece036b92e296e6b7e9e9a7fa244026f6acea3859` |
| Docker Hub tag | `acciolyk/accio_bench:rrb-v1.3.1-openclaw-2026.5.22` |
| Platform | `linux/amd64` |
| OpenClaw package | `openclaw@2026.5.22` |
| OpenClaw commit reported by CLI | `a374c3a` |
| Root filesystem layers | 23 |
| OCI source label | `commerce-craft-bench` |
| Bundled benchmark surface | Commerce Agent Bench domain mocks, browser stack, media-root patch, and `mocksvc` isolation |

The public digest was pulled afresh and compared with the managed evaluation
image used by the supplied OpenClaw results. The complete root-filesystem layer
list, image `Config`, and `/opt/mock_services` tree match. Both images report
OpenClaw `2026.5.22`, run as `amd64`, and have empty persisted proxy variables.

The registry image history shows a flattened release-fork filesystem followed
by the June 2026 Jira/Stripe mock patch. A flattened OCI layer does not preserve
the pre-flatten builder history, so this repository does not infer a third-party
March-image ancestry from old migration recipes.

**Pin the digest, not the image ID.** `docker push` rewrote the image config,
so the local image ID (`sha256:fb6e392b0718…`) and the registry manifest digest
differ. The manifest digest is what the registry resolves and the only one
worth pinning; the two identifiers name the same filesystem, and all 23 rootfs
`diff_ids` of the pushed image match the locally built one exactly.

## What v1.3.1 changed

One mock fix lives inside the image rather than in this repository:
`/opt/mock_services/alibaba_publish/` rejects a non-numeric
`deliveryPeriod[].days` server-side. Because that validator is baked into the
image, editing
`bench_core/mock_services/alibaba_publish/validation.js` in this
checkout has no effect on a run until the image is rebuilt — see
[Source and customization boundary](#source-and-customization-boundary).

All 107 task manifests, the run configs, the service launchers, and
`constants.py` carry the digest above. When a new image is published, move
every pin together with `scripts/repin_runtime_image.py` — a partial rewrite
silently splits the suite across two runtimes.

## Pull the release image

```bash
docker pull --platform linux/amd64 \
  acciolyk/accio_bench@sha256:1e9cf5c72a56794175b7d06ece036b92e296e6b7e9e9a7fa244026f6acea3859
```

Or use the helper, which pulls the same digest and applies a convenient local
tag:

```bash
scripts/import_openclaw_image.sh
# local tag: realreplicabench/openclaw:v1.3.1
```

The human-readable Docker Hub tag is mutable. Use the digest, not the tag, when
recording or comparing benchmark results.

## Offline handoff

On a connected host:

```bash
docker tag \
  acciolyk/accio_bench@sha256:1e9cf5c72a56794175b7d06ece036b92e296e6b7e9e9a7fa244026f6acea3859 \
  realreplicabench/openclaw:v1.3.1

docker save realreplicabench/openclaw:v1.3.1 \
  | gzip > realreplicabench-openclaw-v1.3.1.tar.gz
```

On the receiving host:

```bash
OPENCLAW_IMPORT_SOURCE=tarball \
TARBALL_PATH=realreplicabench-openclaw-v1.3.1.tar.gz \
scripts/import_openclaw_image.sh
```

## Source and customization boundary

This repository contains:

- the OpenClaw harness and provider configuration;
- the full Commerce Agent Bench mock-service source;
- the all-mocks overlay recipe and build-context helper;
- optional provider sidecars; and
- the exact immutable runtime artifact reference.

The exact flattened base filesystem is distributed as the pinned Docker image.
This checkout does not claim to reconstruct that base byte-for-byte from a
third-party tarball.

To rebuild the benchmark mock overlay from the checked-out source, use the
pinned release image as the compatible OpenClaw 2026.5.22 base:

```bash
BASE_OPENCLAW_IMAGE='acciolyk/accio_bench@sha256:1e9cf5c72a56794175b7d06ece036b92e296e6b7e9e9a7fa244026f6acea3859' \
OPENCLAW_ALL_MOCKS_IMAGE='realreplicabench/openclaw:local-mocks' \
scripts/build_shopify_admin_image.sh openclaw
```

`docker/openclaw/Dockerfile.all-mocks` removes the existing mock tree and
re-bakes it from the current checkout, including the media-root allowlist and
`mocksvc` ownership boundary.

`docker/openclaw/Dockerfile` and
`docker/openclaw/Dockerfile.v2026.5.22` are retained only as legacy migration
recipes. They are not the release lineage and must not be used to claim
that the public May runtime is an older March runtime.

## Provider routing

Model routing is injected at run time and does not require an image rebuild.
See:

- [`openclaw-native-gemini.md`](openclaw-native-gemini.md)
- [`openclaw-native-qwen.md`](openclaw-native-qwen.md)
- [`openclaw-byo-endpoint.md`](openclaw-byo-endpoint.md) — bring-your-own
  endpoint across the four common LLM wire formats (OpenAI chat/completions,
  OpenAI /v1/responses, Anthropic /v1/messages, custom Gemini
  generateContent), by preset file or CLI shortcut
- the provider configuration table in the project [README](../README.md)

## Verification commands

```bash
IMAGE='acciolyk/accio_bench@sha256:1e9cf5c72a56794175b7d06ece036b92e296e6b7e9e9a7fa244026f6acea3859'

docker image inspect "$IMAGE" \
  --format 'arch={{.Architecture}} layers={{len .RootFS.Layers}} env={{json .Config.Env}}'

docker run --rm --platform linux/amd64 --entrypoint openclaw \
  "$IMAGE" --version
```

Expected runtime identity: `linux/amd64`, 23 filesystem layers, empty persisted
HTTP proxy variables, and OpenClaw `2026.5.22`.
