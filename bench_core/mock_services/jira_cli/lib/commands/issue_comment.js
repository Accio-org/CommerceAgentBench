/**
 * issue_comment.js — `jira issue comment add ISSUE-KEY [BODY]` command.
 */

import { getDb, genId, auditLog } from "../db.js";
import { currentUser, browseUrl } from "../auth.js";
import { errUnexpectedResponse, goQuote, successMsg, failMsg } from "../errors.js";

/**
 * @param {string} issueKey
 * @param {string} body
 * @param {object} flags
 */
export function run(issueKey, body, flags) {
  if (!issueKey) {
    process.stderr.write(failMsg("Issue key is required"));
    process.exit(1);
  }
  if (!body) {
    process.stderr.write(failMsg("Comment body is required (use --no-input mode)"));
    process.exit(1);
  }

  const db = getDb();
  const key = issueKey.toUpperCase();

  const issue = db.prepare(
    "SELECT * FROM issues WHERE key = ? AND is_deleted = 0"
  ).get(key);

  if (!issue) {
    // Real CLI: AddIssueComment -> 404 -> ExitIfError(ErrUnexpectedResponse).
    process.stderr.write(errUnexpectedResponse());
    process.exit(1);
  }

  const now = new Date().toISOString();
  const id = genId();
  const author = currentUser();

  db.prepare(
    `INSERT INTO comments (id, issue_key, author, body, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, key, author, body, now, now);

  // Update issue's updated_at
  db.prepare("UPDATE issues SET updated_at = ? WHERE key = ?").run(now, key);

  auditLog("comment_add", "comment", id, {
    issue_key: key,
    author,
    body_length: body.length,
  });

  // Real CLI: Success("Comment added to issue %q", issueKey) then a browse-URL
  // line on stdout (internal/cmd/issue/comment/add/add.go:112-113).
  process.stdout.write(successMsg(`Comment added to issue ${goQuote(key)}`));
  process.stdout.write(browseUrl(key) + "\n");
}
