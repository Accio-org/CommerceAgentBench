/**
 * issue_delete.js — `jira issue delete ISSUE-KEY` command.
 */

import { getDb, auditLog } from "../db.js";
import { errUnexpectedResponse, goQuote, successMsg, failMsg } from "../errors.js";

/**
 * @param {string} issueKey
 * @param {object} flags
 */
export function run(issueKey, flags) {
  if (!issueKey) {
    process.stderr.write(failMsg("Issue key is required"));
    process.exit(1);
  }

  const db = getDb();
  const key = issueKey.toUpperCase();

  const issue = db.prepare(
    "SELECT * FROM issues WHERE key = ? AND is_deleted = 0"
  ).get(key);

  if (!issue) {
    // Real CLI: DeleteIssue -> 404 -> ExitIfError(ErrUnexpectedResponse).
    process.stderr.write(errUnexpectedResponse());
    process.exit(1);
  }

  const now = new Date().toISOString();

  // Cascade: also delete sub-tasks
  if (flags.cascade) {
    const subtasks = db.prepare(
      "SELECT key FROM issues WHERE parent_key = ? AND is_deleted = 0"
    ).all(key);
    for (const st of subtasks) {
      db.prepare(
        "UPDATE issues SET is_deleted = 1, updated_at = ? WHERE key = ?"
      ).run(now, st.key);
      auditLog("issue_delete", "issue", st.key, { cascade_parent: key });
    }
  }

  db.prepare(
    "UPDATE issues SET is_deleted = 1, updated_at = ? WHERE key = ?"
  ).run(now, key);

  // Remove from sprints
  db.prepare("DELETE FROM sprint_issues WHERE issue_key = ?").run(key);

  auditLog("issue_delete", "issue", key, { cascade: !!flags.cascade });
  // Real CLI: Success("Issue %q removed successfully", key)
  // (internal/cmd/issue/delete/delete.go:63).
  process.stdout.write(successMsg(`Issue ${goQuote(key)} removed successfully`));
}
