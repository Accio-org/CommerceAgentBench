// Standalone module so `go run gen_tabwriter.go` works without touching the
// rest of the repo. Stdlib-only (text/tabwriter, time, strings) — no deps.
module todoist-golden-gen

go 1.24
