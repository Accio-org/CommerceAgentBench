/**
 * issue_edit.js — `jira issue edit ISSUE-KEY` command.
 */

import { getDb, auditLog } from "../db.js";
import { browseUrl } from "../auth.js";
import { errUnexpectedResponse, successMsg, failMsg } from "../errors.js";

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
    // Real CLI: GetIssue -> 404 -> ExitIfError(ErrUnexpectedResponse) (edit.go).
    process.stderr.write(errUnexpectedResponse());
    process.exit(1);
  }

  const updates = [];
  const params = [];
  const changes = {};

  if (flags.summary !== undefined) {
    updates.push("summary = ?");
    params.push(flags.summary);
    changes.summary = flags.summary;
  }

  // Real jira-cli treats --body and --description as aliases (both write to
  // the issue description field). Mock parity: take whichever the caller set.
  const descriptionValue =
    flags.body !== undefined ? flags.body :
    flags.description !== undefined ? flags.description :
    undefined;
  if (descriptionValue !== undefined) {
    updates.push("description = ?");
    params.push(descriptionValue);
    changes.description = descriptionValue;
  }

  if (flags.priority !== undefined) {
    const pRow = db.prepare(
      "SELECT id FROM issue_priorities WHERE LOWER(name) = LOWER(?)"
    ).get(flags.priority);
    if (!pRow) {
      process.stderr.write(failMsg(`Invalid priority "${flags.priority}"`));
      process.exit(1);
    }
    updates.push("priority_id = ?");
    params.push(pRow.id);
    changes.priority = flags.priority;
  }

  if (flags.assignee !== undefined) {
    updates.push("assignee = ?");
    params.push(flags.assignee);
    changes.assignee = flags.assignee;
  }

  if (flags.label !== undefined && flags.label.length > 0) {
    updates.push("labels_json = ?");
    params.push(JSON.stringify(flags.label));
    changes.labels = flags.label;
  }

  if (flags.component !== undefined && flags.component.length > 0) {
    updates.push("components_json = ?");
    params.push(JSON.stringify(flags.component));
    changes.components = flags.component;
  }

  if (updates.length === 0) {
    process.stderr.write(failMsg("No fields to update"));
    process.exit(1);
  }

  updates.push("updated_at = ?");
  params.push(new Date().toISOString());
  params.push(key);

  db.prepare(`UPDATE issues SET ${updates.join(", ")} WHERE key = ?`).run(...params);

  auditLog("issue_edit", "issue", key, changes);
  // Real CLI: Success("Issue updated\n%s", GenerateServerBrowseURL(server, key))
  // (internal/cmd/issue/edit/edit.go:171).
  process.stdout.write(successMsg(`Issue updated\n${browseUrl(key)}`));
}
