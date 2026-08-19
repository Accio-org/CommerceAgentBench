// gen_tabwriter.go — INDEPENDENT golden-output oracle for the Todoist CLI mock.
//
// PURPOSE
//   Produce byte-exact "golden" renderings of the `list`, `projects`, `labels`
//   and `sections list` tables WITHOUT executing the mock's own renderers
//   (lib/output/table.js). The authority for table alignment is Go's real
//   text/tabwriter; the authority for cell formatting is upstream
//   sachaos/todoist's format.go / item.go; the data is read (by a human) out of
//   seeds/default.sql and transcribed into the SEED DATA section below.
//
// WHY THIS IS NOT TAUTOLOGICAL
//   The real `todoist list/projects/labels/sections` commands cannot run
//   offline — they require a live Todoist API sync to populate the in-memory
//   Store. So a real-binary capture is impossible here. Instead we reproduce
//   exactly what the real binary WOULD print, by:
//     1. taking the same row values the API/store would hold (the seed rows),
//     2. formatting each cell with the same rules as upstream format.go
//        (PriorityFormat, DueDateFormat, LabelsString, ProjectFormat+SectionFormat)
//        — re-implemented here against the real Go stdlib (time, strings),
//        using upstream's literal format constants, and
//     3. running the resulting tab-joined records through the REAL
//        text/tabwriter.NewWriter(w, 0, 4, 1, ' ', 0) — byte-for-byte the writer
//        upstream builds in utils.go (NewTSVWriter) and feeds in
//        list.go/projects.go/labels.go/sections.go via Writer.Write
//        (strings.Join(record, "\t") then fmt.Fprintln).
//   Nothing in this file imports, runs, or reads the mock. If the mock's
//   table.js drifts from real tabwriter behaviour, smoke_test.sh's diff catches
//   it against THIS output.
//
// COLOR
//   Upstream wraps cells in github.com/fatih/color, but color auto-disables
//   when stdout is not a TTY (main.go also forces color.NoColor=true unless
//   --color). The mock is run piped in the smoke test, so the comparison target
//   is the plain (no-ANSI) form. We therefore emit plain strings, exactly what
//   color.*String() returns under NoColor.
//
// RUN
//   cd bench_core/mock_services/todoist_cli/golden
//   go run gen_tabwriter.go .         # writes list.table projects.table labels.table sections.table
//   (a local go.mod pins this as a standalone stdlib-only module.)

package main

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"text/tabwriter"
	"time"
)

// ---- upstream literal constants (main.go:29-30) ----
const shortDateFormat = "06/01/02(Mon)" // ShortDateFormat (all-day due dates)

// ===========================================================================
// SEED DATA — transcribed by hand from seeds/default.sql. Each field maps 1:1
// to a column in the corresponding INSERT. Verify against the seed by eye; this
// is the ONLY input and it is the seed, not the mock.
// ===========================================================================

type seedProject struct {
	id        string
	name      string
	itemOrder int
	createdAt string
}

type seedSection struct {
	id           string
	name         string
	projectID    string
	sectionOrder int
	isArchived   bool
	isDeleted    bool
}

type seedLabel struct {
	id        string
	name      string
	itemOrder int
}

type seedItem struct {
	id          string
	content     string
	projectID   string
	sectionID   string // "" when none
	priority    int    // API priority 1..4 (0 for out-of-range)
	dueDate     string // "" when none; date-only "YYYY-MM-DD"
	labels      []string
	isCompleted bool
	isDeleted   bool
	itemOrder   int
	createdAt   string
}

// seeds/default.sql lines 9-12
var seedProjects = []seedProject{
	{"2200000001", "Inbox", 0, "2026-01-15T09:00:00Z"},
	{"2200000002", "Work", 1, "2026-01-15T09:01:00Z"},
	{"2200000003", "Shopping", 2, "2026-01-20T14:30:00Z"},
}

// seeds/default.sql lines 15-18
var seedLabels = []seedLabel{
	{"2300000001", "urgent", 0},
	{"2300000002", "follow-up", 1},
	{"2300000003", "waiting", 2},
}

// seeds/default.sql lines 21-23
var seedSections = []seedSection{
	{"2400000001", "Planning", "2200000002", 0, false, false},
	{"2400000002", "In Progress", "2200000002", 1, false, false},
}

// seeds/default.sql lines 31-37
var seedItems = []seedItem{
	{"2500000001", "Review Q2 budget report", "2200000002", "2400000001", 4, "2026-05-30", []string{"urgent"}, false, false, 0, "2026-05-25T10:00:00Z"},
	{"2500000002", "Send weekly status update", "2200000002", "2400000002", 3, "2026-05-29", []string{"follow-up"}, false, false, 1, "2026-05-26T08:30:00Z"},
	{"2500000003", "Buy groceries", "2200000003", "", 1, "2026-05-29", nil, false, false, 0, "2026-05-27T12:00:00Z"},
	{"2500000004", "Schedule dentist appointment", "2200000001", "", 2, "", []string{"waiting"}, false, false, 0, "2026-05-28T09:00:00Z"},
	{"2500000005", "Prepare presentation slides", "2200000002", "2400000002", 3, "2026-06-02", []string{"urgent"}, false, false, 2, "2026-05-20T14:00:00Z"},
	{"2500000006", `Read "Thinking, Fast and Slow"`, "2200000001", "", 1, "", nil, false, false, 1, "2026-05-22T20:00:00Z"},
}

// ===========================================================================
// UPSTREAM CELL FORMATTERS — re-implemented from format.go / item.go.
// ===========================================================================

// PriorityFormat (format.go:68-86): API 4->p1, 3->p2, 2->p3, 1->p4. The Go
// switch has no default, so an out-of-range API priority leaves p at zero ->
// "p0".
func priorityFormat(api int) string {
	m := map[int]int{1: 4, 2: 3, 3: 2, 4: 1}
	return fmt.Sprintf("p%d", m[api]) // absent key -> 0
}

// DueDateFormat (format.go:118-143) for an all-day, date-only due date.
// item.DateTime() (item.go:105-123) parses the date; for "YYYY-MM-DD" it falls
// through to RFC3339Date parsed in Local. dueDateString() formats an all-day
// date with ShortDateFormat. Empty due -> zero time -> "".
func dueDateFormat(dueDate string) string {
	if dueDate == "" {
		return ""
	}
	t, err := time.ParseInLocation("2006-01-02", dueDate, time.Local)
	if err != nil {
		return ""
	}
	return t.Local().Format(shortDateFormat)
}

// LabelsString (item.go:243-248): "" for none, else "@" + join(names, ",@").
func labelsString(labels []string) string {
	if len(labels) == 0 {
		return ""
	}
	return "@" + strings.Join(labels, ",@")
}

// projectName resolves an id -> name (store.FindProject in format.go:88-105).
func projectName(id string) string {
	for _, p := range seedProjects {
		if p.id == id {
			return p.name
		}
	}
	return "" // unreachable for seed data
}

// sectionName resolves an id -> name (store.FindSection in format.go:107-116).
func sectionName(id string) string {
	for _, s := range seedSections {
		if s.id == id {
			return s.name
		}
	}
	return ""
}

// ProjectFormat + SectionFormat combined (list.go:78-79). ProjectFormat ->
// "#"+name; SectionFormat -> "/"+name when the item has a section, else "".
func projectAndSection(projectID, sectionID string) string {
	out := "#" + projectName(projectID)
	if sectionID != "" {
		out += "/" + sectionName(sectionID)
	}
	return out
}

// ===========================================================================
// REAL text/tabwriter rendering — identical to utils.go NewTSVWriter +
// Writer.Write (strings.Join(record, "\t") then fmt.Fprintln).
// ===========================================================================

func renderTable(rows [][]string) string {
	var buf bytes.Buffer
	w := tabwriter.NewWriter(&buf, 0, 4, 1, ' ', 0)
	for _, r := range rows {
		fmt.Fprintln(w, strings.Join(r, "\t"))
	}
	w.Flush()
	return buf.String()
}

// ---- row builders mirroring each command's SELECT/ORDER BY ----

// list (list.go + cmdList SELECT): active items, ORDER BY item_order, created_at.
func buildListRows() [][]string {
	items := make([]seedItem, 0, len(seedItems))
	for _, it := range seedItems {
		if it.isDeleted || it.isCompleted {
			continue
		}
		items = append(items, it)
	}
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].itemOrder != items[j].itemOrder {
			return items[i].itemOrder < items[j].itemOrder
		}
		return items[i].createdAt < items[j].createdAt
	})
	rows := make([][]string, 0, len(items))
	for _, it := range items {
		rows = append(rows, []string{
			it.id,
			priorityFormat(it.priority),
			dueDateFormat(it.dueDate),
			projectAndSection(it.projectID, it.sectionID),
			labelsString(it.labels),
			it.content,
		})
	}
	return rows
}

// projects (projects.go): traverse store order. Seed projects are flat (no
// parents) so order == store order == ORDER BY item_order, created_at. Cell =
// [id, "#"+name].
func buildProjectsRows() [][]string {
	ps := append([]seedProject(nil), seedProjects...)
	sort.SliceStable(ps, func(i, j int) bool {
		if ps[i].itemOrder != ps[j].itemOrder {
			return ps[i].itemOrder < ps[j].itemOrder
		}
		return ps[i].createdAt < ps[j].createdAt
	})
	rows := make([][]string, 0, len(ps))
	for _, p := range ps {
		rows = append(rows, []string{p.id, "#" + p.name})
	}
	return rows
}

// labels (labels.go): iterate store labels (ORDER BY item_order). Cell =
// [id, "@"+name].
func buildLabelsRows() [][]string {
	ls := append([]seedLabel(nil), seedLabels...)
	sort.SliceStable(ls, func(i, j int) bool { return ls[i].itemOrder < ls[j].itemOrder })
	rows := make([][]string, 0, len(ls))
	for _, l := range ls {
		rows = append(rows, []string{l.id, "@" + l.name})
	}
	return rows
}

// sections list (sections.go): Sections.Active() (not archived, not deleted),
// store order == ORDER BY section_order. Cell = [id, projectName(raw, no '#'), name].
func buildSectionsRows() [][]string {
	ss := make([]seedSection, 0, len(seedSections))
	for _, s := range seedSections {
		if s.isArchived || s.isDeleted {
			continue
		}
		ss = append(ss, s)
	}
	sort.SliceStable(ss, func(i, j int) bool { return ss[i].sectionOrder < ss[j].sectionOrder })
	rows := make([][]string, 0, len(ss))
	for _, s := range ss {
		rows = append(rows, []string{s.id, projectName(s.projectID), s.name})
	}
	return rows
}

func main() {
	outDir := "."
	if len(os.Args) > 1 {
		outDir = os.Args[1]
	}

	fixtures := map[string][][]string{
		"list.table":     buildListRows(),
		"projects.table": buildProjectsRows(),
		"labels.table":   buildLabelsRows(),
		"sections.table": buildSectionsRows(),
	}

	for name, rows := range fixtures {
		out := renderTable(rows)
		path := filepath.Join(outDir, name)
		if err := os.WriteFile(path, []byte(out), 0644); err != nil {
			fmt.Fprintln(os.Stderr, "write", path, ":", err)
			os.Exit(1)
		}
		fmt.Printf("wrote %s (%d bytes)\n", path, len(out))
	}
}
