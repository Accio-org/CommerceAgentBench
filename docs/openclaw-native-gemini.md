# Running OpenClaw on native Gemini `generateContent`

This guide shows how to run the **OpenClaw** harness against a **native Google
Gemini `generateContent`** endpoint — OpenClaw speaks Gemini's own wire format
directly to a base URL you choose (the public Google API, or a proxy in front of
a compatible model). **No OpenAI chat-completions sidecar, no request-conversion
hop.**

> Release validation on 2026-07-28 exercised the public runtime against a
> local protocol recorder: OpenClaw emitted the versioned
> `/v1beta/models/…:streamGenerateContent?alt=sse` path, `x-goog-api-key`,
> Gemini `contents`, and `thinkingConfig`, then consumed a successful SSE
> response. The validator does not make a paid request to Google.

---

## TL;DR

Two files — a **models_config JSON** (declares the provider) and a **run config
YAML** (selects it). Two "keys" make it native:

1. **`"api": "google-generative-ai"`** on the provider + a **non-`openrouter/`
   model prefix** → OpenClaw uses its native generateContent client, no sidecar.
2. **`"reasoning": true`** on the model + **`thinking: high`** → OpenClaw
   natively emits `generationConfig.thinkingConfig.thinkingLevel` (Gemini 3.x+).

```bash
GEMINI_API_KEY=AIza... real-replica-bench run api-amazon-margin-floor-audit \
  --config configs/realreplicabench_openclaw_native_google_direct.yaml
```

---

## Scenario A — Direct to the public Google API (bring your own key)

Ready-made: `configs/realreplicabench_openclaw_native_google_direct.yaml` +
`configs/realreplicabench_native_google_direct_models.json`.

**models_config** (`configs/realreplicabench_native_google_direct_models.json`):

```json
{
  "providers": {
    "google": {
      "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
      "apiKey": "${GEMINI_API_KEY}",
      "api": "google-generative-ai",
      "timeoutSeconds": 600,
      "models": [
        {"id": "gemini-3-flash-preview", "reasoning": true},
        {"id": "gemini-3.5-flash", "reasoning": true}
      ]
    }
  }
}
```

**run config** (`...native_google_direct.yaml`, relevant block):

```yaml
openclaw:
  models_config: configs/realreplicabench_native_google_direct_models.json
  model: google/gemini-3.5-flash
  image_model: google/gemini-3.5-flash
  thinking: high            # -> native thinkingLevel HIGH (needs reasoning:true on the model)
```

```bash
GEMINI_API_KEY=AIza... real-replica-bench run <task> \
  --config configs/realreplicabench_openclaw_native_google_direct.yaml
```

- `${GEMINI_API_KEY}` is expanded from your shell env at injection time and sent
  as the standard `x-goog-api-key` header.
- The container must be able to reach `generativelanguage.googleapis.com` (pass
  `-e HTTPS_PROXY=http://host.docker.internal:<port>` if your network needs it).

---

## Scenario B — Route through a local proxy (own baseUrl)

Identical shape; by default `baseUrl` is the official Google endpoint. To route
the same native Gemini wire format through a compatible local proxy, **edit the
provider `baseUrl` in the models_config JSON** — a native provider reads its
`baseUrl` (and `apiKey`) ONLY from that JSON.

> ⚠️ `--openclaw-base-url` and `--openclaw-api-key` are **ignored on the native
> path** — they only configure the OpenRouter provider (they set
> `OPENROUTER_BASE_URL` / the openrouter auth profile). They will **not**
> redirect a native Gemini provider. The single source of truth for a native
> endpoint is the models_config `baseUrl`.

Copy `configs/realreplicabench_native_google_models.json`, repoint `baseUrl`,
and reference the copy from the run config's `openclaw.models_config` (or via
`--openclaw-models-config`). The proxy must be reachable from inside the
container (`host.docker.internal` on Docker Desktop).

```json
"google": {
  "baseUrl": "http://host.docker.internal:8080/v1beta",
  "apiKey": "dummy-local",
  "api": "google-generative-ai",
  "timeoutSeconds": 600,
  "models": [{"id": "gemini-3.5-flash", "reasoning": true}],
  "headers": {"x-your-auth": "..."}
}
```

Your proxy receives standard `POST /v1beta/models/<model>:generateContent` (and
`:streamGenerateContent?alt=sse`) requests in Gemini wire format and forwards
them while preserving that contract. If the proxy ignores the inbound
`x-goog-api-key`, any placeholder `apiKey` works — the proxy supplies the real
upstream auth itself.

```bash
real-replica-bench run <task> \
  --config configs/realreplicabench_openclaw_native_google.yaml \
  --openclaw-models-config configs/my_native_google_models.json
```

---

## models_config schema — provider entry

| field | meaning |
|---|---|
| **provider key** (`"google"`) | the prefix you put on the model id (`model: google/<id>`) |
| `baseUrl` | OpenClaw POSTs to `{baseUrl}/v1beta/models/<model>:generateContent` |
| `apiKey` | sent as `x-goog-api-key`; supports `${ENV}` placeholders |
| `api` | **must be `google-generative-ai`** (see gotcha below) |
| `timeoutSeconds` | per-request timeout — set `600`; OpenClaw's default 120s aborts slow reasoning turns |
| `models[]` | `{id, name, reasoning}` — set **`reasoning: true`** for thinking support. `name` is required by OpenClaw's config validator and must be a non-empty string (omitted, `""`, or `null` all fail with `models.0.name: Invalid input`); any characters are allowed, including the parentheses used in the shipped presets |
| `headers` (optional) | extra request headers, e.g. custom proxy auth |

The JSON is injected into `~/.openclaw/openclaw.json['models']` via
`--openclaw-models-config` (or `openclaw.models_config` in the YAML).

---

## thinkingLevel (Gemini 3.x+)

- Set **`"reasoning": true`** on the model entry **and** **`thinking: <tier>`**
  (`low|medium|high`) in the YAML.
- OpenClaw then emits `generationConfig.thinkingConfig.thinkingLevel` =
  `LOW|MEDIUM|HIGH` in every generateContent call.
- **Gotcha:** WITHOUT `reasoning: true`, OpenClaw auto-marks the model
  `reasoning:false` and sends **no** `thinkingConfig` at all — the endpoint then
  uses its own default thinking. (This is why `--openclaw-thinking` alone looks
  like a no-op on the native path.)
- Only Gemini **3.x+** (`thinkingLevel`) is covered; the 2.x `thinkingBudget`
  form is not used here.

Raw wire format (what OpenClaw produces):

```json
{
  "contents": [{"role": "user", "parts": [{"text": "..."}]}],
  "generationConfig": {"thinkingConfig": {"thinkingLevel": "HIGH"}}
}
```

---

## How it works (under the hood)

- OpenClaw ships **no built-in provider slots** — `models.providers` is empty on
  a fresh container. The models_config JSON **is** the declaration.
- `cli.py` auto-detects native routing from the **model prefix**: a
  non-`openrouter/` prefix → native, so **no sidecar** is started and the
  `thinking → OpenRouter-shim` auto-enable is scoped to `openrouter/` models only.
  No separate provider flag is needed.
- `api: google-generative-ai` makes OpenClaw use its native Gemini client:
  `POST {baseUrl}/v1beta/models/<model>:streamGenerateContent?alt=sse` with the
  `x-goog-api-key` header.

This is the same provider surface the sidecar paths write to for `openrouter`;
here it points straight at a Gemini-native endpoint instead.

---

## Gotcha: the `api` enum value

The valid value is **`google-generative-ai`**, **not** `google-genai`. The wrong
value is rejected by `openclaw config validate` and fails the run at model setup:

```
models.providers.<name>.api: Invalid input (allowed: "openai-completions",
"openai-responses", "openai-codex-responses", "anthropic-messages",
"google-generative-ai", "github-copilot", "bedrock-converse-stream", "ollama",
"azure-openai-responses")
```

---

## Quick validation (no benchmark needed)

Confirm a key/endpoint speaks generateContent + thinking in one curl:

```bash
curl -sS "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent" \
  -H "x-goog-api-key: $GEMINI_API_KEY" -H 'Content-Type: application/json' -X POST \
  -d '{"contents":[{"parts":[{"text":"Prove that the square root of 2 is irrational."}]}],
       "generationConfig":{"thinkingConfig":{"thinkingLevel":"HIGH"}}}'
```

A `200` with `usageMetadata.thoughtsTokenCount > 0` confirms thinking is active.
List the models a key can serve with
`curl .../v1beta/models -H "x-goog-api-key: $GEMINI_API_KEY"`.

---

## Operational notes

- **Transient 5xx:** real upstreams occasionally return `503`. OpenClaw does not
  retry, so a single 5xx can end an agent run mid-trajectory. Add a retry layer
  in your proxy, or accept occasional re-runs.
- **Container egress:** the model `baseUrl` must be reachable from **inside** the
  container. Docker Desktop → `host.docker.internal`; Linux → host IP /
  `--add-host` / `HTTPS_PROXY`.
- **Judge:** the LLM judge switches independently via `--llm-judge-*`; point it at
  the same endpoint for a fully self-contained run.

---

## Verification record

Validated on 2026-07-28 with the pinned public runtime image:

- `openclaw config validate` accepted the release models JSON.
- An embedded agent turn reached
  `/v1beta/models/gemini-3.5-flash:streamGenerateContent?alt=sse`.
- The request carried `x-goog-api-key`, Gemini `contents`, and
  `generationConfig.thinkingConfig`.
- OpenClaw consumed the protocol-compatible SSE response and completed the
  turn successfully.

This is a wire-contract test with a placeholder key and local recorder, not a
claim that a particular Google account, quota, or model entitlement was tested.
