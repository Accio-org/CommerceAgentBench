// Error messages — verbatim from upstream sachaos/todoist Go source.
// Each constant references the source file:line (verified against commit
// 5eed237) for traceability. Do NOT paraphrase: these strings must match the
// real CLI byte-for-byte.

// main.go:27  IdNotFound = errors.New("specified id not found")
export const ID_NOT_FOUND = 'specified id not found';

// main.go:26  CommandFailed = errors.New("command failed")
export const COMMAND_FAILED = 'command failed';

// main.go:212  fmt.Println("No API token found. A Todoist API token is required for this application.")
export const NO_TOKEN = 'No API token found. A Todoist API token is required for this application.';

// add.go:24  fmt.Errorf("add command requires 1 positional argument for the task title, but got %v.", c.Args().Len())
export function addArgCountError(n) {
  return `add command requires 1 positional argument for the task title, but got ${n}.`;
}

// "Did not find a project named '%v'" — add.go:35, add_section.go:25, move_section.go:27.
// (NOT modify.go: upstream modify silently keeps an empty project on miss.)
export function projectNotFound(name) {
  return `Did not find a project named '${name}'`;
}

// "Did not find a section named '%v'" — add.go:56, modify.go:75.
export function sectionNotFound(name) {
  return `Did not find a section named '${name}'`;
}

// add_section.go:33
export const SECTION_PROJECT_REQUIRED = 'project is required: use --project-name or --project-id (note: flags must come before the section name)';

// update_section.go:24
export const SECTION_UPDATE_NAME_REQUIRED = '--name flag is required';

// move_section.go:32
export const SECTION_MOVE_PROJECT_REQUIRED = '--project-id or --project-name flag is required';

// reorder_sections.go:14
export const REORDER_MIN_IDS = 'sections reorder requires at least 2 section IDs';

// reorder_sections.go:20  fmt.Errorf("section id not found: %s", id)
export function reorderIdNotFound(id) {
  return `section id not found: ${id}`;
}

// list.go:107
export const REMOTE_REQUIRES_FILTER = '--remote requires --filter';

// reopen.go:19-21 (string literal on reopen.go:20)
export const REOPEN_NO_IDS = 'no task IDs provided\nUsage: todoist reopen <Item ID> [<Item ID>...]\nUse `todoist completed-list` to find IDs of recently closed tasks';

// reopen.go:14  fmt.Errorf("failed to reopen task %s: %w", id, err)
// The outer wrapper is verbatim. The inner <err> is whatever ReopenItem
// (lib/item.go:282-284, POST tasks/<id>/reopen) returns — for a bad id that is
// a LIVE Todoist REST error formatted by ParseAPIError (lib/main.go:19-36) as
// "bad request: <HTTP status>: <api error>". That exact text is NOT knowable
// offline, so the mock uses a best-effort approximation of the 404 response.
export function reopenFailed(id, err) {
  return `failed to reopen task ${id}: ${err}`;
}
// Best-effort inner error for a missing item id, shaped like ParseAPIError's
// output for a 404 from the reopen endpoint. See fact sheet: best-effort only.
export const REOPEN_API_ERROR = 'bad request: 404 Not Found';

// list.go:62 (stderr, not an error exit)
export const NO_TASKS_LIST = 'There is no task. You can fetch latest tasks by `todoist sync`.';

// today.go:41,72,128 (stderr, not an error exit)
export const NO_TASKS_TODAY = 'No tasks due today';
