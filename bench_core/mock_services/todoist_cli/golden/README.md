# Todoist CLI mock — independent golden-output oracle

These golden files are an **independent** oracle for the Todoist CLI mock. Their
authority is the **real upstream** — never this mock:

- **Backend-free fixtures** (`version`, `--help`, `help`, `boguscmd`, `-version`)
  were captured from the **real `todoist` binary** built from
  [sachaos/todoist](https://github.com/sachaos/todoist) @ `5eed237`
  (`/tmp/todoist_real`, prints `todoist (dev build)`).
- **Table fixtures** (`list`, `projects`, `labels`, `sections`) were produced by
  a standalone Go program (`gen_tabwriter.go`) that feeds seed-derived rows
  through Go's **real `text/tabwriter`** with the exact parameters upstream uses
  (`tabwriter.NewWriter(w, 0, 4, 1, ' ', 0)`, see upstream `utils.go`). Cell
  formatting mirrors upstream `format.go` / `item.go`; the row data is read from
  `seeds/default.sql`.

Nothing here imports, runs, or captures the mock (`bin/todoist`, `lib/output/*`).
`smoke_test.sh` runs the **mock** and diffs its output against these goldens, so
any drift in the mock's renderers is caught against a source that is not itself.

## Why the table goldens are not captured from the real binary

The real `todoist list/projects/labels/sections` commands require a live Todoist
API sync to populate the in-memory store, so they cannot run offline. Instead,
`gen_tabwriter.go` reproduces exactly what the real binary *would* print:
the same store rows (the seed), formatted by the same `format.go` rules, aligned
by the same real `text/tabwriter`. This is a faithful reconstruction of the
upstream output path, independent of the mock.

## Regenerating

### Backend-free fixtures (real binary)

Run each with a throwaway `HOME` and a fake token so the binary skips the
interactive no-token prompt (these commands never touch the network):

```bash
REAL=/tmp/todoist_real          # sachaos/todoist @ 5eed237 — `$REAL version` -> "todoist (dev build)"
cap() { local name="$1"; shift; local H; H=$(mktemp -d); \
  HOME="$H" TODOIST_TOKEN=faketoken "$@" >"$name.stdout" 2>"$name.stderr"; \
  echo "$name exit=$?"; rm -rf "$H"; }

cap version      "$REAL" version
cap help-flag    "$REAL" --help
cap help         "$REAL" help
cap boguscmd     "$REAL" boguscmd
cap dash-version "$REAL" -version
```

| fixture | command | stdout | stderr | exit |
|---|---|---|---|---|
| `version` | `todoist version` | `todoist (dev build)\n` (20 B) | empty | **0** |
| `help-flag` | `todoist --help` | full app help (1543 B) | empty | **0** |
| `help` | `todoist help` | full app help (1543 B, byte-identical to `--help`) | empty | **0** |
| `boguscmd` | `todoist boguscmd` | empty | `No help topic for 'boguscmd'\n` (29 B) | **3** |
| `dash-version` | `todoist -version` | `Incorrect Usage: flag provided but not defined: -version\n\n` + full app help (1601 B) | `Error: flag provided but not defined: -version\n` (47 B) | **1** |

### Table fixtures (real Go `text/tabwriter`)

```bash
# from this golden/ directory; uses the local go.mod (stdlib-only, no deps):
go run gen_tabwriter.go .
# -> writes list.table projects.table labels.table sections.table
```

| fixture | mock command compared in smoke | columns (upstream source) | exit |
|---|---|---|---|
| `list.table` | `todoist list` | ID, Priority, DueDate, Project[/Section], Labels, Content (`list.go`) | 0 |
| `projects.table` | `todoist projects` | ID, `#`+Name (`projects.go`) | 0 |
| `labels.table` | `todoist labels` | ID, `@`+Name (`labels.go`) | 0 |
| `sections.table` | `todoist sections list` | ID, Project (raw name), Name (`sections.go`) | 0 |

Cell-formatting rules reproduced in `gen_tabwriter.go` (all from upstream, no
color since output is piped → `color.NoColor`):

- **Priority** (`format.go` `PriorityFormat`): API 4→`p1`, 3→`p2`, 2→`p3`, 1→`p4`
  (no default branch → an out-of-range API priority renders `p0`).
- **DueDate** (`format.go` `DueDateFormat`, `item.go` `DateTime`): all-day,
  date-only due dates formatted with the upstream constant `ShortDateFormat =
  "06/01/02(Mon)"` via the real Go `time` package. Empty due → empty cell.
- **Labels** (`item.go` `LabelsString`): empty → empty; else `@`+`join(names,",@")`.
- **Project/Section** (`format.go` `ProjectFormat`+`SectionFormat`): `#`+name,
  plus `/`+section when the item has a section.
- **Ordering**: rows sorted by the same keys the store/SELECT use — `list` by
  `item_order` then `created_at`; `projects` by `item_order` then `created_at`;
  `labels` by `item_order`; `sections` by `section_order` (active only).

## Smoke wiring

`smoke_test.sh` → "Golden Oracle" section:

1. `todoist-bench reset` to restore the pristine default seed.
2. `golden_backend_free` diffs mock stdout **and** stderr **and** exit code
   against the real-binary goldens for `version`, `help-flag`, `help`,
   `boguscmd` (one counted check each).
3. `golden_table` diffs mock stdout against the Go-tabwriter goldens for `list`,
   `projects`, `labels`, `sections` (one counted check each, exit must be 0).
4. `dash-version` is compared but reported as a **known divergence** (see below).

## Known divergence — `-version`

The mock **cannot** match `golden/dash-version.*`. The real binary parses
`-version` (single-dash long form) as an undefined flag and prints the
urfave/cli "Incorrect Usage" block + help to stdout, an `Error:` line to stderr,
and exits **1**. The mock's `parseArgv` (`lib/commands/_dispatch.js`) only
recognizes `-v` and `--version`, so `-version` is misrouted to the
unknown-command path (`No help topic for '-version'`, exit **3**).

The golden is kept (it is the correct real-binary behavior) and the smoke
comparison is **kept, not deleted** — it is reported as a non-gating "KNOWN
DIVERGENCE" and will auto-upgrade to a counted PASS if the parser is fixed. The
fix belongs in `lib/commands/_dispatch.js`, which is outside this oracle's edit
scope (`golden/**` + `smoke_test.sh`).
