# Running OpenClaw on a bring-your-own API endpoint

This guide shows how to point the **OpenClaw** harness at any API endpoint
you control, speaking one of the four common LLM wire formats:

- OpenAI `/v1/chat/completions` (`api: openai-completions`)
- OpenAI `/v1/responses` (`api: openai-responses`)
- Anthropic `/v1/messages` (`api: anthropic-messages`)
- Google Gemini native `generateContent` (`api: google-generative-ai`)

The pinned OpenClaw runtime image
(`acciolyk/accio_bench@sha256:c358…`) already contains native clients for
all four formats. Commerce Agent Bench sends **one JSON object** into the
container that declares your provider, and OpenClaw takes it from there —
no proxy, no sidecar, no request-conversion hop.

Two ways in:

1. **Preset files** — commit a JSON + YAML pair to `configs/`. Best for
   repeatable benchmark runs.
2. **CLI shortcut** — pass `--openclaw-api` + a few `--openclaw-provider-*`
   flags, no files. Best for one-off probes.

---

## TL;DR — four presets

Each preset is a `configs/<slug>_models.json` file
declaring one provider entry, plus a `configs/openclaw_<slug>.yaml`
that selects it.

| Wire format | Preset slug | Default baseUrl | Env var | Auth header OpenClaw sends |
|---|---|---|---|---|
| `openai-completions` | `openai_chat` | `https://api.openai.com/v1` | `OPENAI_API_KEY` | `Authorization: Bearer …` |
| `openai-responses`   | `openai_responses` | `https://api.openai.com/v1` | `OPENAI_API_KEY` | `Authorization: Bearer …` |
| `anthropic-messages` | `anthropic_messages` | `https://api.anthropic.com/v1` | `ANTHROPIC_API_KEY` | `x-api-key: …` + `anthropic-version` header |
| `google-generative-ai` | `custom_gemini` | `${CUSTOM_GEMINI_BASE_URL}` | `CUSTOM_GEMINI_API_KEY` | `x-goog-api-key: …` |

The provider key in each JSON (`openai`, `anthropic`, `custom`) is the
prefix you put on the model id (`openai/gpt-4o`, `anthropic/claude-sonnet-4.6`,
`custom/gemini-3.5-flash`). Any prefix other than `openrouter/` is
auto-detected as native, so no sidecar starts.

The public Google API and the public Alibaba DashScope endpoint have
dedicated presets (`openclaw_native_google_direct.yaml` and
`openclaw_qwen37plus_native.yaml`) — the four presets above are for
**other** endpoints you point OpenClaw at.

---

## Scenario A — commit a preset

Every preset works the same way: edit the JSON, export the referenced
env var, run.

### OpenAI `/v1/chat/completions` (vendor-neutral)

```bash
OPENAI_API_KEY=sk-... real-replica-bench run <task> \
  --config configs/openclaw_openai_chat.yaml
```

`configs/openai_chat_models.json`:

```json
{
  "providers": {
    "openai": {
      "baseUrl": "https://api.openai.com/v1",
      "apiKey": "${OPENAI_API_KEY}",
      "api": "openai-completions",
      "timeoutSeconds": 600,
      "models": [
        {"id": "gpt-4o", "reasoning": false, "input": ["text","image"]}
      ]
    }
  }
}
```

To retarget a vLLM / LiteLLM / Together / Fireworks / DeepSeek endpoint,
edit `baseUrl` and `models[].id` in the JSON — do NOT pass
`--openclaw-base-url` (it is OpenRouter-scoped and silently ignored on
native paths).

### OpenAI `/v1/responses`

```bash
OPENAI_API_KEY=sk-... real-replica-bench run <task> \
  --config configs/openclaw_openai_responses.yaml
```

Distinct wire format from chat/completions — uses `input`, not `messages`;
`text.format.json_schema`, not `response_format`. Set `reasoning: true`
on the model entry + `thinking: <tier>` in the YAML to get native
reasoning fields.

### Anthropic `/v1/messages`

```bash
ANTHROPIC_API_KEY=sk-ant-... real-replica-bench run <task> \
  --config configs/openclaw_anthropic_messages.yaml
```

`configs/anthropic_messages_models.json`:

```json
{
  "providers": {
    "anthropic": {
      "baseUrl": "https://api.anthropic.com/v1",
      "apiKey": "${ANTHROPIC_API_KEY}",
      "api": "anthropic-messages",
      "timeoutSeconds": 600,
      "headers": {"anthropic-version": "2023-06-01"},
      "models": [
        {"id": "claude-sonnet-4.6", "reasoning": true, "input": ["text","image"]}
      ]
    }
  }
}
```

The `headers` block is where custom static request headers go — put
`anthropic-version` there; put a shared proxy auth token there if your
gateway requires one.

### Custom Gemini `generateContent` proxy

```bash
export CUSTOM_GEMINI_BASE_URL="http://host.docker.internal:8080/v1beta"
export CUSTOM_GEMINI_API_KEY="..."
real-replica-bench run <task> \
  --config configs/openclaw_custom_gemini.yaml
```

Same wire format as the shipped Google presets, but the URL comes from
your env. Use this when your endpoint is NOT
`generativelanguage.googleapis.com`.

---

## Scenario B — CLI shortcut, no files

For a one-off probe you can synthesize the same provider JSON in memory
by passing five flags. This is exactly equivalent to writing a preset
file with one provider entry and one model.

```bash
OPENCLAW_PROVIDER_API_KEY=sk-ant-... real-replica-bench run <task> \
  --openclaw-api anthropic-messages \
  --openclaw-provider-base-url https://api.anthropic.com/v1 \
  --openclaw-provider-header "anthropic-version:2023-06-01" \
  --openclaw-model anthropic/claude-sonnet-4.6 \
  --openclaw-image-model anthropic/claude-sonnet-4.6
```

Flag semantics:

| Flag | Meaning |
|---|---|
| `--openclaw-api` | The provider wire format. Values match the OpenClaw `api` enum below. Setting this triggers the shortcut path. |
| `--openclaw-provider-base-url` | Required. Base URL OpenClaw POSTs to. Must be reachable from INSIDE the container. |
| `--openclaw-provider-key` | Optional. Provider key inside the synthesised JSON. Default: head of `--openclaw-model` (e.g. `openai/gpt-4o` → `openai`). |
| `--openclaw-provider-api-key-env` | Optional. Env-var name to read the API key from. Default `OPENCLAW_PROVIDER_API_KEY`. Errors if the variable is empty. |
| `--openclaw-provider-header` | Optional, repeatable. Extra request header, formatted `Key:Value`. |

`--openclaw-api` and `--openclaw-models-config` are mutually exclusive —
pass one or the other, not both, otherwise the runner errors on ambiguity.

### Every `api` enum value

OpenClaw's config validator accepts nine values. The shortcut accepts
all of them.

```
openai-completions        openai-responses        openai-codex-responses
anthropic-messages        google-generative-ai    github-copilot
bedrock-converse-stream   ollama                  azure-openai-responses
```

Pass any of these to `--openclaw-api`. The four in this document are the
common ones; the others work if OpenClaw's underlying client does.

---

## models_config schema — provider entry

Whether you commit a preset or use the CLI shortcut, the injected shape
is the same:

| field | meaning |
|---|---|
| **provider key** (e.g. `"openai"`) | prefix on the model id (`model: openai/<id>`) |
| `baseUrl` | endpoint root; OpenClaw appends the wire-format-specific path |
| `apiKey` | value sent as the wire format's auth header (`Authorization: Bearer …`, `x-api-key: …`, or `x-goog-api-key: …`); supports `${ENV}` placeholders on the preset path (expanded at inject time) |
| `api` | one of the enum values above; picks the client |
| `timeoutSeconds` | per-request timeout; set to `600` (OpenClaw's default 120 s aborts slow reasoning turns). The release fork also enforces this via `OPENCLAW_PROVIDER_REQUEST_TIMEOUT_SECONDS` |
| `models[]` | `{id, name, reasoning?, input?, contextWindow?, maxTokens?}` — set `reasoning: true` for thinking support and `input: ["text","image"]` for multimodal. `id` and `name` are both **required by the OpenClaw config validator**: omitting `name`, or setting it to `""` or `null`, rejects the injected config with `models.<i>.name: Invalid input`. Any non-empty string is accepted — punctuation such as `/` and parentheses is fine. The CLI shortcut defaults `name = id` for you; the preset JSON path requires you to set it explicitly. |
| `headers` (optional) | extra request headers, e.g. `anthropic-version` or a shared-proxy auth token |

The JSON is injected into `~/.openclaw/openclaw.json['models']`. See
`bench_core/harnesses/openclaw/runner.py::inject_openclaw_models_config`.

---

## Gotchas

- **`--openclaw-base-url` and `--openclaw-api-key` are OpenRouter-scoped.**
  They configure the OpenRouter provider slot (`OPENROUTER_BASE_URL` /
  the `openrouter:default` auth profile) and are ignored on every native
  path. To retarget a native endpoint, edit the JSON's `baseUrl` /
  `apiKey`, or use the `--openclaw-provider-*` flags.
- **Model prefix must match the provider key.** OpenClaw looks up the
  provider by splitting the model id on `/`. `openai/gpt-4o` finds
  provider `openai`; a JSON keyed `oai` will not match.
- **Vision precheck.** The primary and image models must appear in the
  vision-model whitelist at
  `bench_core/harnesses/openclaw/runner.py:70-88` — otherwise the
  run aborts before starting. The four preset defaults (`gpt-4o`,
  `gpt-5.5`, `claude-sonnet-4.6`, `gemini-3.5-flash`) all match. If you
  substitute a non-vision id, pass `--openclaw-image-model
  <vision-capable-id>`.
- **`${ENV}` expansion is JSON-only.** The runner expands `${VAR}` in the
  preset JSON at inject time and errors if any variable is unresolved.
  The CLI shortcut does NOT do string expansion — it reads
  `os.environ[--openclaw-provider-api-key-env]` directly.
- **Judge is independent.** The LLM judge has its own `--llm-judge-*`
  flags and does not share a wire-format enum with the agent. For a
  fully self-contained run, point both sides at your endpoint separately.
- **Container egress.** The `baseUrl` must be reachable from inside the
  container: `host.docker.internal` on Docker Desktop; a host IP or
  `--add-host` on Linux; or `HTTPS_PROXY`.
- **`models[].name` is mandatory.** Every entry in `models[]` needs a
  non-empty `name` alongside `id`. Dropping it while hand-editing a
  preset — or setting it to `""`/`null` — aborts the run at injection
  time with `models.0.name: Invalid input`, before any request is sent.
  There is no character restriction: descriptive labels such as
  `"Gemini 3.5 Flash (public Google API)"` validate fine. The
  `--openclaw-api` shortcut fills `name` in for you from the model id.

---

## Related presets and docs

- Public Google Gemini (native generateContent, bring your `GEMINI_API_KEY`)
  → [`openclaw-native-gemini.md`](openclaw-native-gemini.md).
- Public Alibaba Qwen / DashScope (openai-completions on
  DashScope's compatible-mode surface) →
  [`openclaw-native-qwen.md`](openclaw-native-qwen.md).
- Runtime image details → [`openclaw-runtime-image.md`](openclaw-runtime-image.md).
