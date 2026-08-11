# google-sheets-slides-mock

Local, zero-dependency mock of **Google Sheets** and **Google Slides**,
aligned 1:1 with the tool surface published by the
[`gemini-cli-extensions/workspace`](https://github.com/gemini-cli-extensions/workspace)
MCP server (referenced from [`google/mcp`](https://github.com/google/mcp)).

The agent interacts through the `gws` CLI; a separate HTTP server provides
verifier-only state inspection endpoints (protected by token).

```
google-sheets-slides-mock/
├── cli.mjs              # gws CLI — one subcommand per tool
├── server.mjs           # HTTP server (verifier endpoints + --remote backend)
├── state.mjs            # in-memory DB + tool implementations
├── seed.mjs             # seed spreadsheets and presentations
├── smoke.mjs            # end-to-end smoke test
└── package.json
```

## Quick start

```bash
cd google-sheets-slides-mock

# CLI (in-process, no server needed)
./cli.mjs sheets get-metadata --spreadsheet-id sheet-q3-budget-001 --json --pretty
./cli.mjs sheets get-text --spreadsheet-id sheet-q3-budget-001 --format csv
./cli.mjs sheets get-range --spreadsheet-id sheet-q3-budget-001 --range "Summary!A1:D6" --json --pretty
./cli.mjs slides get-text --presentation-id pres-launch-101
./cli.mjs slides get-metadata --presentation-id pres-launch-101 --json --pretty

# List all seeded documents
./cli.mjs list --pretty

# Mutations
./cli.mjs sheets set-cells --spreadsheet-id sheet-q3-budget-001 \
  --sheet-title Summary --updates '[{"a1":"A8","value":"Test"},{"a1":"B8","value":"42"}]'
./cli.mjs slides add-slide --presentation-id pres-launch-101 --layout TITLE

# Reset to seed
./cli.mjs reset
```

## CLI reference

```
Usage: gws <group> <command> [options]

Sheets commands:
  sheets get-text       --spreadsheet-id <id|url> [--format text|csv|json]
  sheets get-range      --spreadsheet-id <id|url> --range "Sheet1!A1:C10"
  sheets get-metadata   --spreadsheet-id <id|url>
  sheets set-cells      --spreadsheet-id <id> --sheet-title <name> --updates '<json>'
  sheets add-sheet      --spreadsheet-id <id> --title <name>
  sheets delete-sheet   --spreadsheet-id <id> --sheet-title <name>
  sheets rename         --spreadsheet-id <id> --title <name>

Slides commands:
  slides get-text       --presentation-id <id|url>
  slides get-metadata   --presentation-id <id|url>
  slides get-images     --presentation-id <id|url> [--local-path /dir]
  slides get-thumbnail  --presentation-id <id|url> --slide-object-id <id> [--local-path /file]
  slides add-slide      --presentation-id <id> [--layout TITLE|TITLE_AND_BODY|BLANK]
  slides delete-slide   --presentation-id <id> --slide-object-id <id>
  slides duplicate-slide --presentation-id <id> --slide-object-id <id>
  slides set-text       --presentation-id <id> --slide-object-id <id> --element-object-id <id> --text "..."
  slides rename         --presentation-id <id> --title <name>

Utility:
  list                  List all seeded documents
  reset                 Reset mock state to seed

Flags:
  --remote <url>        Call a running server instead of in-process
  --json                Parse JSON from content[0].text before printing
  --pretty              Pretty-print JSON output
```

`spreadsheet-id` and `presentation-id` accept either the raw id (e.g.
`sheet-q3-budget-001`) or a `https://.../d/<ID>/edit` URL — same
`extractDocId` behavior as `workspace-server`.

## Seeded documents

| Type | ID | Title |
| --- | --- | --- |
| Spreadsheet | `sheet-q3-budget-001` | Q3 Marketing Budget (3 sheets) |
| Spreadsheet | `sheet-roadmap-002`   | 2026 Product Roadmap |
| Presentation | `pres-launch-101`    | AcmeCloud Launch Plan (4 slides) |
| Presentation | `pres-allhands-202`  | March All-Hands |

## HTTP server (verifier + remote mode)

```bash
# Start server (for verifier access or CLI --remote mode)
MOCK_VERIFIER_TOKEN=secret npm start   # → http://127.0.0.1:3081

# Verifier reads state (requires token)
curl -s -H 'X-Mock-Verifier-Token: secret' http://127.0.0.1:3081/api/state | jq '.db.spreadsheets | keys'
curl -s -H 'X-Mock-Verifier-Token: secret' http://127.0.0.1:3081/api/audit | jq

# CLI talks to running server (shares state)
./cli.mjs sheets get-metadata --spreadsheet-id sheet-q3-budget-001 --remote http://127.0.0.1:3081 --json --pretty
```

### Verifier endpoints (token-protected)

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/state` | Full DB snapshot |
| GET | `/api/audit` | Audit log |
| POST | `/api/reset` | Reset to seed |

### Tool / mutation endpoints (no token)

| Method | Path | Description |
| --- | --- | --- |
| POST | `/api/tools/call` | Invoke an official tool by name |
| POST | `/api/sheets/setCells` | Write cells |
| POST | `/api/sheets/addSheet` | Add sheet tab |
| POST | `/api/sheets/deleteSheet` | Delete sheet tab |
| POST | `/api/sheets/rename` | Rename spreadsheet |
| POST | `/api/slides/addSlide` | Add slide |
| POST | `/api/slides/deleteSlide` | Delete slide |
| POST | `/api/slides/duplicateSlide` | Duplicate slide |
| POST | `/api/slides/setText` | Set text element |
| POST | `/api/slides/rename` | Rename presentation |

## Mapping to upstream source

| Real MCP (`workspace-server/src`) | Mock |
| --- | --- |
| `services/SheetsService.ts` getText/getRange/getMetadata | `state.mjs` sheetsTools.* |
| `services/SlidesService.ts` getText/getMetadata/getImages/getSlideThumbnail | `state.mjs` slidesTools.* |
| `features/feature-config.ts` tool registration | `cli.mjs` TOOL_MAP + `server.mjs` /api/tools/call |
| `utils/IdUtils.extractDocId` | `state.mjs` extractDocId |

## Verification

```bash
npm run check    # syntax check all .mjs files
npm run smoke    # CLI + HTTP + verifier token end-to-end tests
```

## Scoped boundaries (not implemented)

- Formula evaluation (`=SUM(...)` stored as text)
- Italic/font controls, undo/redo
- Slide element drag/resize/z-order
- `slides.getImages` / `slides.getSlideThumbnail` return descriptors only (no PNGs)
- Drive search, Docs, Calendar, Gmail, Chat, People, Time tools
