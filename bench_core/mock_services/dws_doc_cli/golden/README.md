# DWS Doc CLI mock — golden-output oracle

These golden files are fixtures for `smoke_test.sh`. They verify the mock's
help text and error output matches a captured baseline.

## Derivation

The real `dws` CLI (https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli
@ `4ebc8d0`) is a Go/Cobra CLI whose doc subcommands are dynamically generated
from MCP server descriptors. The real binary requires a live DingTalk backend
for any data command, so golden fixtures for data commands are not feasible
offline.

**Backend-free fixtures** (`version`, `help`, `doc-help`, `boguscmd`) were
captured from the **mock itself** (not the real binary), since the mock's help
text was manually aligned against the upstream reference at
`skills/mono/references/products/doc.md` (verified 2026-06-02). This is weaker
than a real-binary capture (see todoist_cli/golden/) but the mock's help text
is the best offline proxy — the real CLI generates help dynamically from
`config.json` and cannot be captured without a network-connected environment.

Each fixture has three files:
- `<name>.stdout` — captured stdout
- `<name>.stderr` — captured stderr
- `<name>.exit` — exit code

## Fixtures

| fixture | command | stdout | stderr | exit |
|---|---|---|---|---|
| `version` | `dws --version` | `dws version 1.0.28 (mock)\n` | empty | **0** |
| `help` | `dws --help` | full app help (1503 B) | empty | **0** |
| `doc-help` | `dws doc --help` | doc product help (1465 B) | empty | **0** |
| `boguscmd` | `dws boguscmd` | empty | error + hint (70 B) | **1** |

## Regenerating

```bash
cd bench_core/mock_services/dws_doc_cli
TMPH=$(mktemp -d)
DWS_MOCK_HOME="$TMPH" node bin/dws.js --version > golden/version.stdout 2> golden/version.stderr; echo $? > golden/version.exit
DWS_MOCK_HOME="$TMPH" node bin/dws.js --help > golden/help.stdout 2> golden/help.stderr; echo $? > golden/help.exit
DWS_MOCK_HOME="$TMPH" node bin/dws.js doc --help > golden/doc-help.stdout 2> golden/doc-help.stderr; echo $? > golden/doc-help.exit
DWS_MOCK_HOME="$TMPH" node bin/dws.js boguscmd > golden/boguscmd.stdout 2> golden/boguscmd.stderr; echo $? > golden/boguscmd.exit
rm -rf "$TMPH"
```

## Smoke wiring

`smoke_test.sh` → "Golden Oracle" section diffs mock output against these
fixtures for each command (one counted check per fixture). Any drift in the
mock's help renderers or error messages is caught.
