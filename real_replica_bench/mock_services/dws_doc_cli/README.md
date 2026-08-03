# dws_doc_cli

DingTalk Workspace CLI doc-product mock for benchmark agents. The package is a mock service, but the executable command exposed to agents is exactly `dws`.

This mock is intentionally scoped to DingTalk Doc workflows. Other DingTalk products are not included in this upload.

## Installation

```bash
cd mocks/dws_doc_cli
npm link
dws <command>
```

The `bin/dws` wrapper uses Bun when available and falls back to Node.js.

## Service Mode

For ditto-style health and verifier integration:

```bash
bun server.js
curl http://localhost:3020/health
curl http://localhost:3020/api/verify
```

Verifier endpoints:

| Endpoint | Purpose |
|---|---|
| `GET /health` | Open liveness check: `{ok:true, service:"dws_doc_cli"}` |
| `GET /api/state` | Summary of seeded doc mock state |
| `GET /api/sessions` | Synthetic CLI session metadata |
| `GET /api/access-log` | Health/verifier access events |
| `GET /api/verify` | Deterministic fixture sanity checks |

Set `MOCK_VERIFIER_TOKEN` to require `X-Mock-Verifier-Token` on `/api/*` verifier routes.

`dws doc export` persists an export record (`{id, node_id, name, format, exported_at}`) into the
`exports` table, surfaced as a top-level `exports` array in the dumped state — verifiers should
read that array to assert an export actually happened (2026-06-10; older states without the key
need a fallback).

## Quick Start

```bash
dws --version
dws schema --format json
dws doc --help
dws doc search --query "API" --format json
dws doc list --workspace Y7kmbeElo8lkqXLq --format json
dws doc read --node dxXB52LJqnX4ovLvfMoneyXo8qjMp697 --format json
```

## Supported Scope

The mock supports only the `doc` product plus basic CLI support commands.

| Area | Commands |
|---|---|
| Discovery | `dws --help`, `dws schema`, `dws doc --help` |
| Doc browse | `dws doc search`, `dws doc list`, `dws doc info`, `dws doc read` |
| Doc write | `dws doc create`, `dws doc update`, `dws doc upload`, `dws doc download` |
| Node management | `dws doc copy`, `dws doc move`, `dws doc rename`, `dws doc folder create`, `dws doc file create` |
| Blocks | `dws doc block list`, `dws doc block insert`, `dws doc block update`, `dws doc block delete` |
| Comments | `dws doc comment list`, `dws doc comment create`, `dws doc comment create-inline`, `dws doc comment reply` |
| Mock admin | `dws mock-reset`, `dws mock-inject` |

Non-doc product commands and login commands are intentionally absent and should fail as unknown commands. The doc mock runs entirely from local state and fixtures.

## State Management

State is stored on disk and seeded from `src/fixtures/documents.json` plus defaults from `src/state.js`.

`src/fixtures/documents.json` contains the initial document tree, including seeded node IDs, workspace IDs, folder relationships, blocks, comments, and document content. `src/state.js` adds the default workspace ID, default folder ID, and mock user metadata used by document creator fields.

```bash
dws mock-reset
DWS_MOCK_RESET=1 dws doc list --format json
dws mock-inject --file custom-state.json
```

Create `$DWS_MOCK_HOME/config.json` to configure mock behavior:

```json
{
  "latency": 200,
  "errorRate": 0.1
}
```

## Environment Variables

| Variable | Description |
|---|---|
| `DWS_MOCK_HOME` | State directory, default `~/.dws-mock` |
| `DWS_MOCK_FIXTURES` | Custom fixtures directory |
| `DWS_MOCK_RESET` | Set to `"1"` to reset state on next run |
| `DWS_MOCK_RESPONSE_FILE` | Override all responses with file content |

## Global Flags

| Flag | Purpose |
|---|---|
| `-f, --format` | Output format: `json`, `table`, or `raw` |
| `--jq` | jq-like expression for JSON filtering |
| `--fields` | Comma-separated field projection |
| `--dry-run` | Preview request without executing |
| `-y, --yes` | Skip confirmation prompts |
| `-o, --output` | Write output to file |
| `--timeout` | HTTP timeout in seconds |
| `--client-id` | Accepted for CLI compatibility; ignored by the doc mock |
| `--client-secret` | Accepted for CLI compatibility; ignored by the doc mock |

## License

MIT
