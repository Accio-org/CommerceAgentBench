# OpenClaw Harness

The OpenClaw harness runs the agent inside a fresh Linux container, using a
local OpenClaw runtime image. The image published with this release is:

```text
acciolyk/accio_bench@sha256:1e9cf5c72a56794175b7d06ece036b92e296e6b7e9e9a7fa244026f6acea3859
```

It is built on top of the upstream OpenClaw v2026.5.22 distribution and bakes
in the full `datasets_domain_v1` mock-service suite. See
`docs/openclaw-runtime-image.md` for image provenance, customization, and
local rebuild instructions.

The harness keeps RealReplicaBench's task, output, verifier, and report
contracts while using OpenClaw's in-container browser, shell, file, and
media tools. Three model routes are supported, selected by the
`--openclaw-model` prefix:

- `openrouter/<model>` — direct OpenRouter (set `OPENROUTER_API_KEY`).
- `<custom-provider>/<model>` — a custom provider declared via
  `--openclaw-models-config` (e.g. `api: google-generative-ai` pointing at
  Google's public Gemini endpoint or a BYO proxy). OpenClaw speaks that wire
  format natively — no sidecar.
- anything else passes verbatim; bring your own provider plumbing via
  `--openclaw-models-config` and `--openclaw-base-url`.

For the native Gemini path, the simplest batch setup is:

```bash
GEMINI_API_KEY=... real-replica-bench run \
  --config configs/openclaw_native_google_direct.yaml \
  --limit 1
```

See `docs/openclaw-native-gemini.md` for the full walkthrough.
