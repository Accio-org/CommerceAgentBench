/**
 * issue_assign.js — `jira issue assign ISSUE-KEY ASSIGNEE` command.
 * Special values: "x" = unassign, "default" = default assignee from config.
 */

import { getDb, auditLog } from "../db.js";
import { currentUser, browseUrl } from "../auth.js";
import { errUnexpectedResponse, goQuote, successMsg, failMsg } from "../errors.js";

/**
 * @param {string} issueKey
 * @param {string} assignee
 */
export function run(issueKey, assignee) {
  if (!issueKey) {
    process.stderr.write(failMsg("Issue key is required"));
    process.exit(1);
  }
  if (assignee === undefined || assignee === null) {
    process.stderr.write(failMsg("Assignee is required"));
    process.exit(1);
  }

  const db = getDb();
  const key = issueKey.toUpperCase();

  const issue = db.prepare(
    "SELECT * FROM issues WHERE key = ? AND is_deleted = 0"
  ).get(key);

  if (!issue) {
    // Real CLI: ProxyAssignIssue -> 404 -> ExitIfError(ErrUnexpectedResponse).
    process.stderr.write(errUnexpectedResponse());
    process.exit(1);
  }

  let newAssignee;
  if (assignee === "x") {
    newAssignee = "";
  } else if (assignee === "default") {
    newAssignee = currentUser();
  } else {
    newAssignee = assignee;
  }

  const now = new Date().toISOString();
  db.prepare(
    "UPDATE issues SET assignee = ?, updated_at = ? WHERE key = ?"
  ).run(newAssignee, now, key);

  auditLog("issue_assign", "issue", key, {
    from: issue.assignee,
    to: newAssignee,
  });

  // Real CLI (assign.go:113-118): one of the two Success() lines, then a
  // browse-URL line printed to stdout in both cases.
  if (newAssignee === "") {
    process.stdout.write(successMsg(`User unassigned from the issue ${goQuote(key)}`));
  } else {
    process.stdout.write(successMsg(`User ${goQuote(newAssignee)} assigned to issue ${goQuote(key)}`));
  }
  process.stdout.write(browseUrl(key) + "\n");
}
