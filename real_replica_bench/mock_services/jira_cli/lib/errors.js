/**
 * errors.js — Error/success message constants for the Jira CLI mock.
 *
 * Every string here is copied verbatim from the upstream source
 * github.com/ankitpokhrel/jira-cli (Go, Cobra) @ commit 396933d (upstream
 * v1.7.0). The output STREAM and PREFIX matter for byte-identity, so the
 * helpers below mirror the three distinct upstream emission paths:
 *
 *   1. cmdutil.Fail / cmdutil.Failed   -> red "✗ " prefix, stderr
 *      internal/cmdutil/utils.go:83-91
 *   2. cmdutil.Success                 -> "\n✓ " prefix + trailing "\n", stdout
 *      internal/cmdutil/utils.go:73-75
 *   3. cmdutil.ExitIfError             -> NO ✗ marker, stderr
 *      internal/cmdutil/utils.go:23-54
 *        - generic error  -> "Error: %s"
 *        - ErrUnexpectedResponse (e.g. 404 on a missing issue) ->
 *          "\njira: Received unexpected response '%s'.\n
 *           Please check the parameters you supplied and try again."
 */

// ─── ANSI markers ──────────────────────────────────────────────────────────
// cmdutil.Success: fmt.Fprintf(os.Stdout, "\n[0;32m✓[0m %s\n", ...)
//   internal/cmdutil/utils.go:74
export function successMsg(msg) {
  return `\n\x1b[0;32m✓\x1b[0m ${msg}\n`;
}

// cmdutil.Fail: fmt.Fprintf(os.Stderr, "[0;31m✗[0m %s\n", ...)
//   internal/cmdutil/utils.go:84  (cmdutil.Failed = Fail + os.Exit(1))
export function failMsg(msg) {
  return `\x1b[0;31m✗\x1b[0m ${msg}\n`;
}

// cmdutil.ExitIfError default branch: msg = "Error: %s"; then Fprintf(stderr,"%s\n")
//   internal/cmdutil/utils.go:48,52
export function exitError(msg) {
  return `Error: ${msg}\n`;
}

// cmdutil.ExitIfError ErrUnexpectedResponse branch (no ✗, no "Error:" prefix).
//   internal/cmdutil/utils.go:30-40,52  +  pkg/jira/client.go:317-321 (Status)
// Surfaced whenever an SDK call hits a non-expected HTTP status — notably a GET
// on a non-existent issue (getIssueRaw -> formatUnexpectedResponse, 404):
//   pkg/jira/issue.go:102-103.
// `e.Body.String()` (the server error body) is empty here because it is
// server-controlled and not present in the CLI source, so the message reduces
// to the deterministic CLI wrapper `dm` (utils.go:31-34).
export function errUnexpectedResponse(status = "404 Not Found") {
  return `\njira: Received unexpected response '${status}'.\nPlease check the parameters you supplied and try again.\n`;
}

// ─── Go fmt %q emulation ───────────────────────────────────────────────────
// Several upstream messages quote a value with Go's %q verb (a double-quoted Go
// string literal). For ordinary ASCII inputs this is just `"value"`; control
// chars and quotes are backslash-escaped. (Full Go \u/octal escaping of
// non-printable runes is not reproduced — not needed for realistic inputs.)
export function goQuote(value) {
  const s = String(value ?? "");
  let out = '"';
  for (const ch of s) {
    const code = ch.codePointAt(0);
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\t") out += "\\t";
    else if (ch === "\r") out += "\\r";
    else if (code < 0x20) out += "\\x" + code.toString(16).padStart(2, "0");
    else out += ch;
  }
  return out + '"';
}

// ─── Confirmed-verbatim message strings ────────────────────────────────────

// Config missing — cmdutil.Failed(...) at internal/cmd/root/root.go:94 (✗, stderr)
export const ERR_CONFIG_MISSING =
  "Missing configuration file.\nRun 'jira init' to configure the tool.";

// No results — cmdutil.Failed("No result found for given query in project %q", project)
//   internal/cmd/issue/list/list.go:132  (✗, stderr; preceded by a blank stdout line)
export function errNoResults(project) {
  return `No result found for given query in project ${goQuote(project)}`;
}

// Create missing flags — cmdutil.Failed(...) at internal/cmd/issue/create/create.go:90-92 (✗)
export const ERR_CREATE_MISSING_FLAGS =
  "Params `--summary` and `--type` is mandatory when using a non-interactive mode";

// Invalid transition — returned error -> ExitIfError "Error:" branch (NO ✗).
//   internal/cmd/issue/move/move.go:258-261 (verifyTransition).
//   Available states are each wrapped in single quotes: 'State1', 'State2'
//   (fmt.Sprintf("'%s'", t.Name); strings.Join(..., ", ")) — move.go:257.
export function errInvalidTransition(state, issueKey, availableNames) {
  const avail = (availableNames || []).map((n) => `'${n}'`).join(", ");
  return `invalid transition state ${goQuote(state)}\nAvailable states for issue ${issueKey}: ${avail}`;
}

// Invalid assignee — returned error -> ExitIfError "Error:" branch (NO ✗).
//   internal/cmd/issue/assign/assign.go:333 (setAssignee).
export function errInvalidAssignee(assignee) {
  return `invalid assignee ${goQuote(assignee)}`;
}

// No projects — cmdutil.Failed("No projects found.") at
//   internal/cmd/project/list/list.go:41 (✗, stderr; no leading blank line).
export const ERR_NO_PROJECTS = "No projects found.";
