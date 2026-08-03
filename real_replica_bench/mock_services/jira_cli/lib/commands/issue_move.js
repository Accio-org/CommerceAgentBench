/**
 * issue_move.js — `jira issue move ISSUE-KEY STATE` command.
 * Validates transition against the transitions table.
 */

import { getDb, auditLog, genId } from "../db.js";
import { currentUser, browseUrl } from "../auth.js";
import { errUnexpectedResponse, errInvalidTransition, exitError, goQuote, successMsg, failMsg } from "../errors.js";

/**
 * @param {string} issueKey
 * @param {string} targetState
 * @param {object} flags
 */
export function run(issueKey, targetState, flags) {
  if (!issueKey) {
    process.stderr.write(failMsg("Issue key is required"));
    process.exit(1);
  }
  if (!targetState) {
    process.stderr.write(failMsg("Target state is required"));
    process.exit(1);
  }

  const db = getDb();
  const key = issueKey.toUpperCase();

  // Get issue with current status
  const issue = db.prepare(`
    SELECT i.*, s.name as status_name
    FROM issues i
    JOIN issue_statuses s ON i.status_id = s.id
    WHERE i.key = ? AND i.is_deleted = 0
  `).get(key);

  if (!issue) {
    // Real CLI: setAvailableTransitions -> Transitions(key) -> 404 ->
    // cmdutil.ExitIfError(ErrUnexpectedResponse) (move.go:63).
    process.stderr.write(errUnexpectedResponse());
    process.exit(1);
  }

  // Find target status (case-insensitive)
  const targetStatus = db.prepare(
    "SELECT id, name FROM issue_statuses WHERE LOWER(name) = LOWER(?)"
  ).get(targetState);

  if (!targetStatus) {
    // List available transitions from current status
    const available = db.prepare(
      "SELECT to_status FROM transitions WHERE LOWER(from_status) = LOWER(?)"
    ).all(issue.status_name);
    // Real CLI: verifyTransition returns an error -> ExitIfError "Error:" path
    // (no ✗); available states are single-quoted (move.go:257-261).
    process.stderr.write(exitError(errInvalidTransition(targetState, key, available.map((r) => r.to_status))));
    process.exit(1);
  }

  // Check if transition is valid
  const trans = db.prepare(
    "SELECT 1 FROM transitions WHERE LOWER(from_status) = LOWER(?) AND LOWER(to_status) = LOWER(?)"
  ).get(issue.status_name, targetStatus.name);

  if (!trans) {
    const available = db.prepare(
      "SELECT to_status FROM transitions WHERE LOWER(from_status) = LOWER(?)"
    ).all(issue.status_name);
    process.stderr.write(exitError(errInvalidTransition(targetState, key, available.map((r) => r.to_status))));
    process.exit(1);
  }

  // Perform transition
  const now = new Date().toISOString();
  const resolution = targetStatus.name === "Done" ? "Done" : "";

  db.prepare(
    "UPDATE issues SET status_id = ?, resolution = ?, updated_at = ? WHERE key = ?"
  ).run(targetStatus.id, resolution, now, key);

  // Add transition comment if provided
  if (flags.comment) {
    db.prepare(
      `INSERT INTO comments (id, issue_key, author, body, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(genId(), key, currentUser(), flags.comment, now, now);
  }

  auditLog("issue_move", "issue", key, {
    from: issue.status_name,
    to: targetStatus.name,
  });

  // Real CLI: Success("Issue transitioned to state %q", tr.Name) followed by a
  // browse-URL line printed to stdout (move.go:121-122).
  process.stdout.write(successMsg(`Issue transitioned to state ${goQuote(targetStatus.name)}`));
  process.stdout.write(browseUrl(key) + "\n");
}
