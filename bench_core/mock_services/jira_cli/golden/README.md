# Golden fixtures — independent oracle for the Jira CLI mock

Every fixture in this directory is derived from the **real upstream**
`ankitpokhrel/jira-cli` **v1.7.0** (commit `396933d`), **never** from this mock's
renderers (`lib/output/*`). That independence is the whole point: if the golden
were produced by the mock, diffing the mock against it would be tautological and
worthless. The goldens are the *truth*; the mock is diff'd against them
(`smoke_test.sh`, section 26).

There are two kinds of fixture:

| Kind | Files | Source of truth | Wired into smoke? |
|------|-------|-----------------|-------------------|
| **Table format** (the critical one) | `issue_list.table`, `issue_list.notruncate.table` | Real Go stdlib `text/tabwriter` + a verbatim copy of upstream `renderPlain`, fed by rows parsed **directly from `seeds/default.sql`** | `issue_list.table` = **counted** byte-diff; `notruncate` = informational (see below) |
| **Backend-free CLI** | `cli_help.txt`, `cli_unknown_command.txt` | The **real `jira` binary**, run with no Jira server | **No** — reference only (the mock is a hand-written JS CLI on a different framework that gates every command on config; cobra byte-parity is neither expected nor a mock requirement) |

---

## Building / running the real binary

```bash
cd /tmp/cli_verify_jira              # ankitpokhrel/jira-cli @ 396933d (v1.7.0)
go build -o ./jira_real ./cmd/jira   # main package is ./cmd/jira (cmd/jira/main.go)
./jira_real version                  # confirm it runs
```

**Build status in this environment: SUCCEEDED.** `go build` produced a working
`darwin/arm64` binary and it executes (`jira version` →
`(Version="v0.0.0-…396933d…", GoVersion="go1.25.6", …)`).

> Environment note (not part of the fixtures): a host EDR agent SIGKILLs freshly
> built binaries executed from `/tmp`. The binary runs normally from any path
> under the user's home, and `go run` works anywhere. This is a local quirk, not
> a build failure — no `tabwriter` fallback was needed; the table goldens use the
> real stdlib `text/tabwriter` (see `gen_tabwriter.go`).

---

## Table fixtures (the critical format)

The default `jira issue list` plain table is rendered upstream by:

```
internal/view/issues.go:54   tabwriter.NewWriter(os.Stdout, 0, tabWidth, 1, '\t', 0)
internal/view/helper.go:26   tabWidth = 8
internal/view/helper.go:155  renderPlain(...)  // cells joined by delimiter, one Fprintln/row, Flush
```

so `tabwriter.NewWriter(out, 0, 8, 1, '\t', 0)` — minwidth 0, tabwidth 8,
padding 1, **padchar `'\t'`** (alignment is padded with literal TAB bytes), flags 0.

`gen_tabwriter.go` is a standalone, **stdlib-only** Go program that:

1. **reads `../seeds/default.sql`** and parses the `issues`, `issue_types`,
   `issue_statuses`, `issue_priorities`, and `config` INSERTs with a small
   quote-aware SQL scanner — it builds the rows itself, **not** from mock output;
2. selects the configured project (`config.default_project` = `PROJ`), orders by
   `created` **DESC** (upstream JQL default — `internal/cmd/issue/list/list.go:239`
   + `internal/query/issue.go:108-112`; the mock's `ORDER BY i.created_at DESC`
   matches), and maps each field exactly as upstream `assignColumns`
   (`internal/view/issues.go:207-238`) does;
3. feeds the rows through the **real stdlib `text/tabwriter`** with the params
   above, using a verbatim copy of `renderPlain`.

### Generation commands

```bash
# run from this golden/ directory; -seed defaults to ../seeds/default.sql
go run gen_tabwriter.go -variant default     > issue_list.table
go run gen_tabwriter.go -variant notruncate  > issue_list.notruncate.table
```

### `issue_list.table` — default 4 columns `TYPE/KEY/SUMMARY/STATUS`

Mirrors real `jira issue list --plain` (upstream `header()` returns
`ValidIssueColumns()[0:4]` in plain mode — `internal/view/issues.go:159-166`).
**Diffed in `smoke_test.sh` against the mock's `issue list`; currently
byte-identical (0-byte diff).**

### `issue_list.notruncate.table` — all 11 columns

`TYPE/KEY/SUMMARY/STATUS/ASSIGNEE/REPORTER/PRIORITY/RESOLUTION/CREATED/UPDATED/LABELS`
(mirrors real `jira issue list --plain --no-truncate`). Two upstream subtleties
are reproduced faithfully:

* **`CREATED`/`UPDATED` stay raw `…Z`.** `formatDateTime` parses with
  `jira.RFC3339 = "2006-01-02T15:04:05-0700"` (`pkg/jira/client.go:21`). That
  layout's numeric `-0700` offset cannot parse a trailing `Z`, so
  `time.Parse` fails and `formatDateTime` returns the input unchanged
  (`internal/view/helper.go:100-113`). The seed timestamps end in `Z`, so the
  real renderer leaves them raw — same bytes the mock emits.
* **`LABELS` joined with `","` (no space)** — `strings.Join(labels, ",")`
  (`internal/view/issues.go:233`).

This fixture is **informational** in the smoke (not counted) because it reveals a
**genuine mock divergence the oracle caught**: the mock joins labels with `", "`
(space) in `lib/commands/issue_list.js` (`labelsStr` → `arr.join(", ")`). Only
multi-label rows differ; every other column (incl. the raw-`Z` dates) matches.
Fixing the mock's join to `","` would make this fixture byte-identical, at which
point the smoke auto-prints a "promote to a counted check" note. (The fix is out
of this task's edit scope, which is limited to `golden/**` and `smoke_test.sh`.)

> `prepareTitle` (`internal/view/helper.go:115-118`) applies `tview.Escape`,
> which is the identity for bracket-free text; every seed summary is bracket-free
> with no leading/trailing whitespace, so the generator's `TrimSpace`-only
> `prepareTitle` is faithful and keeps the generator dependency-free (stdlib only
> → builds offline forever).

---

## Backend-free CLI fixtures (reference only — not wired)

Captured from the real binary with no Jira server. Reproducible on any machine
(`env -i` clears the environment; `XDG_CONFIG_HOME=/CONFIG` pins the one
host-dependent line in the help text — `cmdutil.GetConfigHome()` honours
`XDG_CONFIG_HOME`).

### `cli_help.txt`

```bash
env -i HOME=/nonexistent XDG_CONFIG_HOME=/CONFIG ./jira_real --help > cli_help.txt 2>&1
```

The bold `\x1b[1m…\x1b[0m` section headers are **hardcoded in upstream's help
template** (present even under `NO_COLOR=1` / `TERM=dumb`), so they are a stable
part of the real output. Not wired: the JS mock uses a different CLI framework
and its help is config-gated (`✗ Missing configuration file` before init), so
cobra byte-parity is not a mock requirement.

### `cli_unknown_command.txt`

```bash
env -i HOME=/nonexistent XDG_CONFIG_HOME=/CONFIG ./jira_real frobnicate > cli_unknown_command.txt 2>&1
```

Fully stable (no `$HOME`, no build vars): cobra's usage error
(`Error: unknown command …` + `Run 'jira --help' for usage.`) followed by
`main.go:13` re-printing `err.Error()`. Not wired (the mock config-gates and
emits a different message).

### `version` — intentionally skipped

`jira version` prints `(Version=…, GitCommit=…, CommitDate=…, GoVersion=…,
Compiler=…, Platform=…)` (`internal/cmd/version`). **Every field is
build/host-injected** — `Version` is a VCS stamp (`v0.0.0-<date>-<sha>` for a
plain `go build`, not `v1.7.0`), and `GoVersion`/`Platform` vary by toolchain and
OS. There is no fully stable line, so no version golden is committed (the task
explicitly permits skipping version). The mock's own self-reported `v1.7.0` is a
mock behaviour assertion in `smoke_test.sh`, unrelated to these goldens.

---

## Regenerating everything

```bash
# table goldens (no Jira server needed):
go run gen_tabwriter.go -variant default     > issue_list.table
go run gen_tabwriter.go -variant notruncate  > issue_list.notruncate.table

# backend-free CLI goldens (need the real binary built as above):
env -i HOME=/nonexistent XDG_CONFIG_HOME=/CONFIG ./jira_real --help       > cli_help.txt        2>&1
env -i HOME=/nonexistent XDG_CONFIG_HOME=/CONFIG ./jira_real frobnicate   > cli_unknown_command.txt 2>&1

# verify the mock still matches:
bash ../smoke_test.sh   # section 26, must exit 0
```
