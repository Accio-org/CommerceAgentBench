//go:build ignore

// gen_tabwriter.go — INDEPENDENT golden generator for `jira issue list` plain table.
//
// This program is the oracle for the Jira CLI mock's plain-table output. It does
// NOT call the mock and does NOT read any of the mock's renderers (lib/output/*).
// Instead it:
//
//   1. Parses the raw seed data straight from seeds/default.sql (the same SQL the
//      mock loads into SQLite), building the issue rows itself.
//   2. Re-implements the REAL upstream rendering path from ankitpokhrel/jira-cli
//      v1.7.0 (commit 396933d) verbatim — see the citations below — feeding the
//      rows through Go's stdlib text/tabwriter with the exact upstream parameters.
//
// Because the alignment is produced by the SAME stdlib text/tabwriter that the
// real binary links against, the bytes are a true reference for what the real
// `jira issue list` would print for this data. The mock is then diff'd against
// THIS output (see smoke_test.sh), never the other way around.
//
// Upstream references (path:line in the clone at /tmp/cli_verify_jira @ 396933d):
//   - internal/view/issues.go:54      tabwriter.NewWriter(os.Stdout, 0, tabWidth, 1, '\t', 0)
//   - internal/view/helper.go:26      tabWidth = 8
//   - internal/view/helper.go:155-171 renderPlain (cell loop + Flush)
//   - internal/view/helper.go:189-192 unescape regex
//   - internal/view/helper.go:100-113 formatDateTime (parse jira.RFC3339, fmt "2006-01-02 15:04:05")
//   - internal/view/issues.go:159-191 header() — no-columns: validColumns[0:4] (plain)
//                                     or all 11 (plain+no-truncate / non-tty)
//   - internal/view/issues.go:207-238 assignColumns (field -> cell mapping)
//   - internal/view/issues.go:233     LABELS = strings.Join(labels, ",")  // NB: no space
//   - internal/view/fields.go:3-21    field name constants
//   - internal/view/helper.go:64-78   ValidIssueColumns() order
//   - pkg/jira/client.go:21           RFC3339 = "2006-01-02T15:04:05-0700"
//   - internal/cmd/issue/list/list.go:239,245  order-by=created (DESC), --delimiter default "\t"
//   - internal/query/issue.go:108-112 default order direction = DESC
//
// Usage:
//   go run gen_tabwriter.go -variant default     > issue_list.table
//   go run gen_tabwriter.go -variant notruncate  > issue_list.notruncate.table
//
// (-seed defaults to ../seeds/default.sql resolved relative to this source file.)
package main

import (
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"text/tabwriter"
	"time"
)

// ── upstream constants (cited above) ───────────────────────────────────────────

const tabWidth = 8 // internal/view/helper.go:26

// jiraRFC3339 is pkg/jira/client.go:21. NOTE the numeric offset (-0700): it does
// NOT accept a trailing "Z", so seed timestamps like "2026-04-20T09:00:00.000Z"
// fail to parse and formatDateTime returns them unchanged — exactly as the real
// binary would for this data.
const jiraRFC3339 = "2006-01-02T15:04:05-0700"

// field constants — internal/view/fields.go
const (
	fieldType       = "TYPE"
	fieldKey        = "KEY"
	fieldSummary    = "SUMMARY"
	fieldStatus     = "STATUS"
	fieldAssignee   = "ASSIGNEE"
	fieldReporter   = "REPORTER"
	fieldPriority   = "PRIORITY"
	fieldResolution = "RESOLUTION"
	fieldCreated    = "CREATED"
	fieldUpdated    = "UPDATED"
	fieldLabels     = "LABELS"
)

// validIssueColumns mirrors internal/view/helper.go:64-78 ValidIssueColumns().
var validIssueColumns = []string{
	fieldType, fieldKey, fieldSummary, fieldStatus, fieldAssignee,
	fieldReporter, fieldPriority, fieldResolution, fieldCreated, fieldUpdated, fieldLabels,
}

// unescapeRe — internal/view/helper.go:190 (identity for the bracket-free seed text).
var unescapeRe = regexp.MustCompile(`(\[[a-zA-Z0-9_,;: \-\."#]+\[*)\[\]`)

func unescape(s string) string { return unescapeRe.ReplaceAllString(s, "$1]") }

// formatDateTime — internal/view/helper.go:100-113 (tz always "" here).
func formatDateTime(dt, format string) string {
	t, err := time.Parse(format, dt)
	if err != nil {
		return dt
	}
	return t.Format("2006-01-02 15:04:05")
}

// prepareTitle — internal/view/helper.go:115-118. tview.Escape is identity for
// bracket-free text, so TrimSpace alone is faithful for this seed (documented in
// golden/README.md). No external tview dependency → builds offline forever.
func prepareTitle(text string) string { return strings.TrimSpace(text) }

// ── seed parsing (independent of the mock) ─────────────────────────────────────

type issue struct {
	cols map[string]string
}

func main() {
	_, self, _, _ := runtime.Caller(0)
	defaultSeed := filepath.Join(filepath.Dir(self), "..", "seeds", "default.sql")

	variant := flag.String("variant", "default", "default (4 cols) | notruncate (11 cols)")
	seedPath := flag.String("seed", defaultSeed, "path to seeds/default.sql")
	flag.Parse()

	raw, err := os.ReadFile(*seedPath)
	if err != nil {
		fatal("read seed: %v", err)
	}
	sql := string(raw)

	typeNames := idNameMap(sql, "issue_types")
	statusNames := idNameMap(sql, "issue_statuses")
	priorityNames := idNameMap(sql, "issue_priorities")
	defaultProject := configValue(sql, "default_project")
	if defaultProject == "" {
		fatal("could not find default_project in seed")
	}

	issues := parseIssues(sql)
	if len(issues) == 0 {
		fatal("parsed 0 issues from seed")
	}

	// `jira issue list` lists the configured/default project only.
	var rows []issue
	for _, is := range issues {
		if is.cols["project_key"] == defaultProject {
			rows = append(rows, is)
		}
	}
	if len(rows) == 0 {
		fatal("no issues for default project %q", defaultProject)
	}

	// ORDER BY created DESC. created_at is a TEXT column; SQLite sorts it
	// lexicographically (BINARY collation). All seed timestamps share one
	// fixed-width ISO-8601/Z format, so lexicographic DESC == chronological DESC,
	// matching both the real JQL default and the mock's SQL.
	sort.SliceStable(rows, func(i, j int) bool {
		return rows[i].cols["created_at"] > rows[j].cols["created_at"]
	})

	// header() — internal/view/issues.go:159-166.
	var headers []string
	switch *variant {
	case "default":
		headers = validIssueColumns[0:4]
	case "notruncate":
		headers = validIssueColumns
	default:
		fatal("unknown -variant %q (want default|notruncate)", *variant)
	}

	// data() — internal/view/issues.go:193-205 (headers shown; --no-headers off).
	data := [][]string{headers}
	for _, is := range rows {
		data = append(data, assignColumns(headers, is, typeNames, statusNames, priorityNames))
	}

	// Render through the REAL stdlib text/tabwriter with upstream params, via a
	// verbatim copy of renderPlain. delimiter "\t" = --delimiter default.
	w := tabwriter.NewWriter(os.Stdout, 0, tabWidth, 1, '\t', 0)
	renderPlain(w, data, "\t")
	if err := w.Flush(); err != nil {
		fatal("tabwriter flush: %v", err)
	}
}

// assignColumns — internal/view/issues.go:207-238.
func assignColumns(columns []string, is issue, typeNames, statusNames, priorityNames map[string]string) []string {
	c := is.cols
	var bucket []string
	for _, column := range columns {
		switch column {
		case fieldType:
			bucket = append(bucket, typeNames[c["type_id"]])
		case fieldKey:
			bucket = append(bucket, c["key"])
		case fieldSummary:
			bucket = append(bucket, prepareTitle(c["summary"]))
		case fieldStatus:
			bucket = append(bucket, statusNames[c["status_id"]])
		case fieldAssignee:
			bucket = append(bucket, c["assignee"])
		case fieldReporter:
			bucket = append(bucket, c["reporter"])
		case fieldPriority:
			bucket = append(bucket, priorityNames[c["priority_id"]])
		case fieldResolution:
			bucket = append(bucket, c["resolution"])
		case fieldCreated:
			bucket = append(bucket, formatDateTime(c["created_at"], jiraRFC3339))
		case fieldUpdated:
			bucket = append(bucket, formatDateTime(c["updated_at"], jiraRFC3339))
		case fieldLabels:
			bucket = append(bucket, strings.Join(parseJSONArray(c["labels_json"]), ",")) // issues.go:233 — no space
		}
	}
	return bucket
}

// renderPlain — verbatim copy of internal/view/helper.go:155-171.
func renderPlain(w io.Writer, data [][]string, delimiter string) {
	for _, items := range data {
		n := len(items)
		for j, v := range items {
			_, _ = fmt.Fprintf(w, "%s", unescape(v))
			if j != n-1 {
				_, _ = fmt.Fprintf(w, "%s", delimiter)
			}
		}
		_, _ = fmt.Fprintln(w)
	}
}

// ── minimal, quote-aware SQL helpers ───────────────────────────────────────────

// idNameMap parses every `INSERT ... INTO <table> (cols) VALUES (...)` block and
// returns map[id]name using the table's own column list (id, name).
func idNameMap(sql, table string) map[string]string {
	out := map[string]string{}
	for _, blk := range insertBlocks(sql, table) {
		idi, namei := indexOf(blk.cols, "id"), indexOf(blk.cols, "name")
		if idi < 0 || namei < 0 {
			continue
		}
		for _, t := range blk.tuples {
			if idi < len(t) && namei < len(t) {
				out[t[idi]] = t[namei]
			}
		}
	}
	return out
}

func configValue(sql, key string) string {
	for _, blk := range insertBlocks(sql, "config") {
		ki, vi := indexOf(blk.cols, "key"), indexOf(blk.cols, "value")
		for _, t := range blk.tuples {
			if ki < len(t) && vi < len(t) && t[ki] == key {
				return t[vi]
			}
		}
	}
	return ""
}

func parseIssues(sql string) []issue {
	var out []issue
	for _, blk := range insertBlocks(sql, "issues") {
		for _, t := range blk.tuples {
			cols := map[string]string{}
			for i, name := range blk.cols {
				if i < len(t) {
					cols[name] = t[i]
				}
			}
			out = append(out, issue{cols: cols})
		}
	}
	return out
}

type insertBlock struct {
	cols   []string
	tuples [][]string
}

// insertBlocks finds all INSERT statements targeting <table> and returns their
// column lists + value tuples. Quote-aware: handles commas/brackets/semicolons
// inside single-quoted strings and '' escapes.
func insertBlocks(sql, table string) []insertBlock {
	re := regexp.MustCompile(`(?is)INSERT\s+(?:OR\s+\w+\s+)?INTO\s+` + regexp.QuoteMeta(table) + `\s*\(`)
	var blocks []insertBlock
	for _, loc := range re.FindAllStringIndex(sql, -1) {
		i := loc[1] // just past the '(' of the column list
		colsText, i := readParenList(sql, i)
		cols := splitTopLevel(colsText)
		for k := range cols {
			cols[k] = strings.Trim(strings.TrimSpace(cols[k]), "`\"")
		}
		// skip to VALUES
		vi := regexp.MustCompile(`(?is)\bVALUES\b`).FindStringIndex(sql[i:])
		if vi == nil {
			continue
		}
		j := i + vi[1]
		tuples := scanTuples(sql, j)
		blocks = append(blocks, insertBlock{cols: cols, tuples: tuples})
	}
	return blocks
}

// readParenList returns the text inside a parenthesised list starting at i
// (i points just AFTER the opening '('), and the index just AFTER the matching
// ')'. Quote-aware. Used only for column lists (no nested parens there).
func readParenList(s string, i int) (string, int) {
	start := i
	for i < len(s) {
		switch s[i] {
		case '\'':
			i = skipString(s, i)
			continue
		case ')':
			return s[start:i], i + 1
		}
		i++
	}
	return s[start:], i
}

// scanTuples reads a comma-separated sequence of (...) value tuples beginning at
// index i, stopping at the first top-level ';'. Each tuple is returned as its
// unquoted field values.
func scanTuples(s string, i int) [][]string {
	var tuples [][]string
	for i < len(s) {
		// skip whitespace and tuple separators
		for i < len(s) && (s[i] == ' ' || s[i] == '\n' || s[i] == '\r' || s[i] == '\t' || s[i] == ',') {
			i++
		}
		if i >= len(s) || s[i] == ';' {
			break
		}
		if s[i] != '(' {
			// not a tuple start (e.g. trailing clause) — stop.
			break
		}
		var fields []string
		fields, i = readTuple(s, i+1)
		tuples = append(tuples, fields)
	}
	return tuples
}

// readTuple parses one value tuple; i points just after the opening '('. Returns
// the field values and the index just after the closing ')'.
func readTuple(s string, i int) ([]string, int) {
	var fields []string
	for i < len(s) {
		// skip leading whitespace before a field
		for i < len(s) && (s[i] == ' ' || s[i] == '\n' || s[i] == '\r' || s[i] == '\t') {
			i++
		}
		if i >= len(s) {
			break
		}
		if s[i] == ')' {
			return fields, i + 1
		}
		var val string
		if s[i] == '\'' {
			val, i = readQuoted(s, i)
		} else {
			// unquoted token (number / NULL) up to ',' or ')'
			start := i
			for i < len(s) && s[i] != ',' && s[i] != ')' {
				i++
			}
			val = strings.TrimSpace(s[start:i])
		}
		fields = append(fields, val)
		// skip whitespace, then expect ',' or ')'
		for i < len(s) && (s[i] == ' ' || s[i] == '\n' || s[i] == '\r' || s[i] == '\t') {
			i++
		}
		if i < len(s) && s[i] == ',' {
			i++
			continue
		}
		if i < len(s) && s[i] == ')' {
			return fields, i + 1
		}
	}
	return fields, i
}

// readQuoted reads a single-quoted SQL string starting at i (s[i]=='\''), with
// '' treated as an escaped quote. Returns the unquoted value and next index.
func readQuoted(s string, i int) (string, int) {
	i++ // skip opening quote
	var b strings.Builder
	for i < len(s) {
		if s[i] == '\'' {
			if i+1 < len(s) && s[i+1] == '\'' {
				b.WriteByte('\'')
				i += 2
				continue
			}
			i++ // closing quote
			break
		}
		b.WriteByte(s[i])
		i++
	}
	return b.String(), i
}

func skipString(s string, i int) int {
	i++
	for i < len(s) {
		if s[i] == '\'' {
			if i+1 < len(s) && s[i+1] == '\'' {
				i += 2
				continue
			}
			return i + 1
		}
		i++
	}
	return i
}

// splitTopLevel splits a comma-separated list, ignoring commas inside quotes.
func splitTopLevel(s string) []string {
	var out []string
	var b strings.Builder
	for i := 0; i < len(s); {
		c := s[i]
		if c == '\'' {
			j := skipString(s, i)
			b.WriteString(s[i:j])
			i = j
			continue
		}
		if c == ',' {
			out = append(out, b.String())
			b.Reset()
			i++
			continue
		}
		b.WriteByte(c)
		i++
	}
	out = append(out, b.String())
	return out
}

// parseJSONArray turns a seed labels_json string like ["a","b"] into []string{"a","b"}.
func parseJSONArray(s string) []string {
	s = strings.TrimSpace(s)
	if s == "" || s == "[]" {
		return nil
	}
	inner := strings.Trim(s, "[]")
	if strings.TrimSpace(inner) == "" {
		return nil
	}
	var out []string
	for _, part := range splitTopLevel(inner) {
		part = strings.TrimSpace(part)
		part = strings.Trim(part, `"`)
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}

func indexOf(ss []string, want string) int {
	for i, s := range ss {
		if strings.EqualFold(s, want) {
			return i
		}
	}
	return -1
}

func fatal(format string, a ...any) {
	fmt.Fprintf(os.Stderr, "gen_tabwriter: "+format+"\n", a...)
	os.Exit(1)
}
