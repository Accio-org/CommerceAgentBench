# Running OpenClaw on native Qwen (Alibaba DashScope) or OpenRouter

This guide shows two ways to point the **OpenClaw** harness at **Qwen 3.7 Plus**
without relying on a private proxy path (the release fork does not ship one):

- **Scenario A — native DashScope**: OpenClaw speaks the OpenAI-compatible
  chat/completions wire format directly at Alibaba Model Studio, using the
  bundled `qwen` extension's native streaming + thinking wrappers.
- **Scenario B — OpenRouter**: single-file config, no models_config JSON, uses
  the release fork's built-in OpenRouter shim so `thinking` is preserved or
  supplied when absent.

The release config declares Qwen 3.7 Plus as a text-and-image model with a
1,048,576-token context window. Actual model availability, limits, and
capabilities are controlled by the selected provider account.

---

## TL;DR

### Scenario A — DashScope native

Two files: a **models_config JSON** (declares the provider) and a **run YAML**
(selects it). Two "keys" make it native:

1. **`"api": "openai-completions"`** on the provider + a **`qwen/...` model
   prefix** → OpenClaw uses its bundled qwen extension's native client, no
   sidecar.
2. **`"reasoning": true`** on the model + **`thinking: high`** → the Qwen
   provider path enables DashScope-native thinking.

```bash
DASHSCOPE_API_KEY=sk-... real-replica-bench run <task> \
  --config configs/realreplicabench_openclaw_qwen37plus_native.yaml
```

### Scenario B — OpenRouter

```bash
OPENROUTER_API_KEY=sk-or-... real-replica-bench run <task> \
  --config configs/realreplicabench_openclaw_qwen37plus_openrouter.yaml
```

---

## Scenario A — Native Alibaba DashScope

Ready-made:
- `configs/realreplicabench_openclaw_qwen37plus_native.yaml`
- `configs/realreplicabench_qwen37plus_native_models.json`

**models_config**:

```json
{
  "providers": {
    "qwen": {
      "baseUrl": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
      "apiKey": "${DASHSCOPE_API_KEY}",
      "api": "openai-completions",
      "timeoutSeconds": 600,
      "models": [
        {"id": "qwen3.7-plus", "reasoning": true,
         "input": ["text","image"], "contextWindow": 1048576, "maxTokens": 65536}
      ]
    }
  }
}
```

**run config** (relevant block):

```yaml
openclaw:
  models_config: configs/realreplicabench_qwen37plus_native_models.json
  model: qwen/qwen3.7-plus
  image_model: qwen/qwen3.7-plus
  thinking: high        # -> native enable_thinking (needs reasoning:true)
```

- `${DASHSCOPE_API_KEY}` is expanded from your shell env at injection time and sent
  as `Authorization: Bearer …`.
- The container must be able to reach `dashscope-intl.aliyuncs.com` (pass
  `-e HTTPS_PROXY=http://host.docker.internal:<port>` if your network needs it).

### Endpoint matrix

Pick the standard compatible-mode base URL for the region where the API key
was created:

| region | endpoint | notes |
|---|---|---|
| Global / Intl | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` | API keys are region-specific |
| China | `https://dashscope.aliyuncs.com/compatible-mode/v1` | API keys are region-specific |

Manage keys at <https://bailian.console.aliyun.com/#/api-key>. Docs:
<https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-dashscope>.
Confirm that the exact model is enabled for the selected account before a full
benchmark run.

---

## Scenario B — OpenRouter route

Ready-made:
- `configs/realreplicabench_openclaw_qwen37plus_openrouter.yaml`

```yaml
openclaw:
  model: openrouter/qwen/qwen3.7-plus
  image_model: openrouter/qwen/qwen3.7-plus
  base_url: https://openrouter.ai/api/v1
  thinking: medium      # preserved or supplied by the shim
```

```bash
OPENROUTER_API_KEY=sk-or-... real-replica-bench run <task> \
  --config configs/realreplicabench_openclaw_qwen37plus_openrouter.yaml
```

The `openrouter/` prefix is the ONLY prefix that triggers the auto-sidecar path.
The shim (`docker/openclaw/proxy/openrouter_shim.py`) starts on port 19501,
preserves an existing reasoning field or supplies one when absent, and forwards
to the configured OpenRouter-compatible base URL
(`https://openrouter.ai/api/v1` by default).

---

## models_config schema — provider entry (native path)

| field | meaning |
|---|---|
| **provider key** (`"qwen"`) | the prefix you put on the model id (`model: qwen/<id>`). Aliases the qwen plugin also matches: `modelstudio`, `qwencloud`, `dashscope`. |
| `baseUrl` | OpenClaw POSTs to `{baseUrl}/chat/completions` |
| `apiKey` | sent as `Authorization: Bearer …`; supports `${ENV}` placeholders |
| `api` | **must be `openai-completions`** (Qwen native uses DashScope's compatible-mode surface, not a bespoke enum) |
| `timeoutSeconds` | per-request timeout — set `600`; OpenClaw's default 120 s aborts slow reasoning turns |
| `models[]` | `{id, name, reasoning, input?, contextWindow?, maxTokens?}` — set **`reasoning: true`** for thinking support and `input: ["text","image"]` for multimodal. `name` is required by OpenClaw's config validator and must be a non-empty string (omitted, `""`, or `null` all fail with `models.0.name: Invalid input`); any characters are allowed |
| `headers` (optional) | extra request headers, e.g. custom proxy auth |

The JSON is injected into `~/.openclaw/openclaw.json['models']` via
`--openclaw-models-config` (or `openclaw.models_config` in the YAML). At run
time the release fork also patches the provider's `timeoutSeconds` to 600 (see
`OPENCLAW_PROVIDER_REQUEST_TIMEOUT_SECONDS` in `constants.py`).

---

## Thinking (Qwen `enable_thinking`)

- Set **`"reasoning": true`** on the model entry **and** **`thinking: <tier>`**
  (`low|medium|high`) in the YAML.
- The bundled Qwen provider path sends DashScope's native
  `enable_thinking: true`. Provider versions may additionally choose a
  thinking budget. This differs from OpenRouter's `reasoning.effort` shape.
- **Gotcha:** WITHOUT `reasoning: true`, OpenClaw marks the model
  `reasoning:false` and sends no thinking directives. `thinking: <tier>` then
  becomes a no-op on the native Qwen path.

---

## How it works (under the hood)

- OpenClaw ships **no built-in provider slots** — `models.providers` is empty on
  a fresh container. The models_config JSON **is** the declaration.
- The bundled `dist/extensions/qwen/openclaw.plugin.json` registers 4 provider
  ids (`qwen`, `qwencloud`, `modelstudio`, `dashscope`) all mapped to the
  `modelstudio` family. Any of them in your models_config picks up the plugin's
  native streaming compat + thinking wrapper.
- `real_replica_bench/harnesses/openclaw/runner.py` auto-detects native
  routing from the **model prefix**: a non-`openrouter/` prefix → native, so
  **no sidecar** is started and the `thinking → OpenRouter-shim` auto-enable is
  scoped to `openrouter/` models only.
- OpenClaw's built-in Qwen model catalog covers 3.5-plus / 3.6-plus / 3-coder /
  MiniMax-M2.5 / glm-5. **`qwen3.7-plus` is not in the built-in catalog but the
  catalog is not a gate** — any `id` listed in your models_config `models[]`
  overrides it and takes effect immediately.

---

## Gotcha: `--openclaw-base-url` and `--openclaw-api-key` do NOT apply on the native path

Those CLI flags only configure the OpenRouter provider (they set
`OPENROUTER_BASE_URL` / the `openrouter:default` auth profile). To redirect a
native Qwen provider — e.g. through a corporate proxy — edit the JSON's
`baseUrl` (and `apiKey`) directly. The models_config is the single source of
truth for a native endpoint.

---

## Quick validation (no benchmark needed)

Confirm your key + endpoint respond to chat/completions:

```bash
curl -sS "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" -H 'Content-Type: application/json' \
  -d '{
        "model": "qwen3.7-plus",
        "messages": [{"role":"user","content":"say hi"}],
        "enable_thinking": true,
        "thinking_budget": 512
      }'
```

A `200` with `usage.completion_tokens_details.reasoning_tokens > 0` (or Qwen's
equivalent field) confirms thinking is active.

Multimodal probe (vision path, only for `input: ["text","image"]` models):

```bash
curl -sS "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" -H 'Content-Type: application/json' \
  -d '{
        "model": "qwen3.7-plus",
        "messages": [{"role":"user","content":[
           {"type":"text","text":"what do you see?"},
           {"type":"image_url","image_url":{"url":"https://example.com/x.png"}}
        ]}]
      }'
```

---

## Operational notes

- **Transient 5xx**: DashScope occasionally returns `503`. OpenClaw does not
  retry, so a single 5xx can end an agent run mid-trajectory. Add a retry layer
  in your proxy, or accept occasional re-runs.
- **Container egress**: the model `baseUrl` must be reachable from **inside**
  the container. Docker Desktop → `host.docker.internal`; Linux → host IP /
  `--add-host` / `HTTPS_PROXY`.
- **Judge**: the LLM judge switches independently via `--llm-judge-*`; keep it
  on Gemini (or any provider you have a key for) for a self-contained run.
- **Rate limits**: DashScope enforces per-account QPM / TPM ceilings; scale
  `parallelism` down if you see `429` bursts.
- **Vision whitelist**: the release fork uses a substring whitelist in
  `real_replica_bench/harnesses/openclaw/runner.py::_OPENCLAW_VISION_MODEL_SUBSTRINGS`
  to short-circuit set-image when the primary model looks non-vision. Since
  2026-07 the tuple includes `"qwen3.7-plus"`; older forks abort at model setup
  until you add it.

---

## Verification record

- **`qwen/qwen3.7-plus` catalog override**: OpenClaw v2026.5.22 accepts an
  `id` that is not in the bundled catalog and honors the `reasoning` /
  `input` hints from the models_config `models[]` entry.
- **Wire contract**: a 2026-07-28 local protocol probe from the pinned public
  runtime reached `/v1/chat/completions` with Bearer authentication,
  `model=qwen3.7-plus`, `stream=true`, and `enable_thinking=true`; OpenClaw
  consumed the protocol-compatible SSE response successfully.
- **Scope**: the probe used a placeholder key and local recorder. It validates
  request construction, not a specific DashScope account, quota, or model
  entitlement.
