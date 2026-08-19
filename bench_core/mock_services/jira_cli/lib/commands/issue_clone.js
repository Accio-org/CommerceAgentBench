/**
 * issue_clone.js — `jira issue clone ISSUE-KEY` command.
 */

import { getDb, nextIssueSeq, genId, auditLog } from "../db.js";
import { currentUser, browseUrl } from "../auth.js";
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

  const source = db.prepare(`
    SELECT i.*, t.name as type_name, s.name as status_name
    FROM issues i
    JOIN issue_types t ON i.type_id = t.id
    JOIN issue_statuses s ON i.status_id = s.id
    WHERE i.key = ? AND i.is_deleted = 0
  `).get(key);

  if (!source) {
    // Real CLI: GetIssue (source) -> 404 -> ExitIfError(ErrUnexpectedResponse).
    process.stderr.write(errUnexpectedResponse());
    process.exit(1);
  }

  // Default status: "To Do"
  const todoStatus = db.prepare("SELECT id FROM issue_statuses WHERE name = 'To Do'").get();
  const statusId = todoStatus?.id || "1";

  const seq = nextIssueSeq(source.project_key);
  const newKey = `${source.project_key}-${seq}`;
  const now = new Date().toISOString();
  const id = genId();

  // Override fields from flags
  const summary = flags.summary || `[Clone] ${source.summary}`;
  const assignee = flags.assignee !== undefined ? flags.assignee : source.assignee;
  const labels = flags.label && flags.label.length > 0
    ? JSON.stringify(flags.label)
    : source.labels_json;

  let priorityId = source.priority_id;
  if (flags.priority) {
    const pRow = db.prepare(
      "SELECT id FROM issue_priorities WHERE LOWER(name) = LOWER(?)"
    ).get(flags.priority);
    if (pRow) priorityId = pRow.id;
  }

  db.prepare(`
    INSERT INTO issues (id, key, project_key, type_id, summary, description,
      status_id, priority_id, assignee, reporter, labels_json, components_json,
      epic_key, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, newKey, source.project_key, source.type_id,
    summary, source.description,
    statusId, priorityId,
    assignee, currentUser(),
    labels, source.components_json,
    source.epic_key || null,
    now, now
  );

  auditLog("issue_clone", "issue", newKey, { source: key });

  // Real CLI: Success("Issue cloned\n%s", GenerateServerBrowseURL(server, clonedKey))
  // (internal/cmd/issue/clone/clone.go:99).
  process.stdout.write(successMsg(`Issue cloned\n${browseUrl(newKey)}`));
}
