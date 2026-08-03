---
name: dws-doc-cli-mock
description: Use when an agent needs to run against the dws_doc_cli DingTalk Workspace CLI mock for DingTalk Doc workflows with the real command prefix `dws`, without real DingTalk credentials or network access.
metadata:
  category: benchmark-mock
  requires:
    bins:
      - dws
---

# dws_doc_cli Skill

`dws_doc_cli` is a Bun/Node-compatible mock of the DingTalk Workspace CLI. It is scoped to DingTalk Doc behavior and should not be used for real DingTalk data or real enterprise operations.

The mock lives under `ditto_site/mocks/dws_doc_cli/`. The package and service identify as a mock, but the command exposed to agents is exactly `dws`.

## Invocation

From the mock directory:

```bash
DWS_MOCK_HOME=/private/tmp/dws-doc-cli-state dws <command> --format json
```

The formal harness should put this package's npm bin on `PATH`, or `npm link` can be used during setup. Use a writable `DWS_MOCK_HOME` for every isolated agent run; the default is `~/.dws-mock`.

## Service Mode

Use service mode only for `ditto_site` health and verifier checks. Agents should still interact through the `dws` CLI.

```bash
bun server.js
curl http://localhost:3020/health
curl http://localhost:3020/api/verify
```

Verifier endpoints are `/api/state`, `/api/sessions`, `/api/access-log`, and `/api/verify`. Set `MOCK_VERIFIER_TOKEN` to require `X-Mock-Verifier-Token` on those routes.

## Agent Rules

- Always request machine-readable output with `--format json`.
- Use `dws schema --format json` and `dws doc --help` for discovery.
- Treat this as a doc-only mock. Non-doc products are intentionally absent and should be considered unsupported.
- Do not run login or auth setup. The doc mock runs from local state and fixtures without authentication.
- Use `--dry-run` before write/delete operations when validating an invocation shape.
- Add `--yes` only after the user has explicitly approved destructive or externally visible operations. In this mock, writes affect only local state, but keep the same habit as real `dws`.
- Reset state between independent tests with `DWS_MOCK_RESET=1` or `dws mock-reset`.
- Use `--jq` and `--fields` only for simple extraction; the mock implements a small jq-like subset, not full jq.
- Never put real tokens, client secrets, or enterprise data into mock fixtures.

## Discovery

Use these first:

```bash
dws --help
dws schema --format json
dws doc --help
dws doc read --help
```

The real behavior source lives in the upstream `dingtalk-workspace-cli`
repository. In a checkout of that repository, consult:

- `docs/command-index.md`
- `skills/mono/SKILL.md`
- `skills/mono/references/products/doc.md`

When extending the mock, compare against those files first, then update command handlers, fixtures, and schema coverage together.

## Product Coverage

Only the DingTalk Doc product is implemented. It includes search, browse, metadata, read/write, upload/download, file/folder creation, copy/move/rename, block editing, and comments.

Common fixture IDs:

| Purpose | ID |
|---|---|
| Workspace | `Y7kmbeElo8lkqXLq` |
| Default folder | `X6GRezwJlAgaoedehQQ6En2z8dqbropQ` |
| Folder node | `Kx9mRzJWqPpvo939iQQ7vRAyJGXn6lpz` |
| Sample doc | `dxXB52LJqnX4ovLvfMoneyXo8qjMp697` |

Useful commands:

```bash
dws doc search --query "API" --format json
dws doc list --workspace Y7kmbeElo8lkqXLq --format json
dws doc info --node dxXB52LJqnX4ovLvfMoneyXo8qjMp697 --format json
dws doc read --node dxXB52LJqnX4ovLvfMoneyXo8qjMp697 --format json
dws doc create --name "TestDoc" --markdown "# Title" --yes --format json
dws doc update --node dxXB52LJqnX4ovLvfMoneyXo8qjMp697 --content "new text" --mode append --yes --format json
dws doc block list --node dxXB52LJqnX4ovLvfMoneyXo8qjMp697 --format json
dws doc comment list --node dxXB52LJqnX4ovLvfMoneyXo8qjMp697 --format json
```

Doc command notes:

- `doc create` uses `--name`; optional content is `--markdown`.
- `doc update` uses `--node`, `--content` or `--content-file`, and `--mode overwrite|append`. In the current mock, `--content-file` is treated as the literal argument value; use `--content` for behavioral tests unless this gap is being fixed.
- `doc info/read/update/... --node` works with raw node IDs and `/i/nodes/<id>` URLs.
- `doc block insert` and `doc block update` expect `--element` JSON.
- `doc block delete` is irreversible in local mock state; confirm before adding `--yes`.

## Mock State

State is JSON on disk:

- Default state: generated from `src/fixtures/documents.json` plus defaults in `src/state.js`
- Runtime state: `$DWS_MOCK_HOME/state.json`
- Optional config: `$DWS_MOCK_HOME/config.json`

`src/fixtures/documents.json` contains the initial document environment: workspace IDs, folder relationships, document nodes, blocks, comments, and content. `src/state.js` adds the default workspace ID, default folder ID, and mock user metadata used for creator fields.

Supported state controls:

```bash
DWS_MOCK_RESET=1 dws doc list --format json
dws mock-reset
dws mock-inject --file custom-state.json
```

Config options:

```json
{
  "latency": 0,
  "errorRate": 0
}
```

## Extending The Mock

1. Read the real command reference in `../dingtalk-workspace-cli/docs/command-index.md`.
2. Read the real doc product reference in `../dingtalk-workspace-cli/skills/mono/references/products/doc.md`.
3. Register the command in `src/commands/doc.js`.
4. Add or update `src/fixtures/documents.json` if the command needs state.
5. Keep response envelopes close to the real CLI and include stable mock IDs where useful.
6. Update `src/commands/schema.js` when the command should be discoverable through `dws schema`.
7. Verify the CLI and service health paths before publishing the mock.
