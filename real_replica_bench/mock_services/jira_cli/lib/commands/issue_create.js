/**
 * issue_create.js — `jira issue create` command.
 */

import { getDb, nextIssueSeq, genId, auditLog } from "../db.js";
import { defaultProject, currentUser, browseUrl } from "../auth.js";
import { ERR_CREATE_MISSING_FLAGS, successMsg, failMsg } from "../errors.js";
import { renderJson } from "../output/json.js";

/**
 * @param {object} flags
 */
export function run(flags) {
  if (!flags.summary || !flags.type) {
    process.stderr.write(failMsg(ERR_CREATE_MISSING_FLAGS));
    process.exit(1);
  }

  const db = getDb();
  const project = flags.project || defaultProject();

  // Verify project
  const projRow = db.prepare("SELECT key FROM projects WHERE key = ?").get(project);
  if (!projRow) {
    process.stderr.write(failMsg(`Project "${project}" does not exist`));
    process.exit(1);
  }

  // Resolve issue type
  const typeRow = db.prepare(
    "SELECT id, name FROM issue_types WHERE LOWER(name) = LOWER(?)"
  ).get(flags.type);
  if (!typeRow) {
    process.stderr.write(failMsg(`Invalid issue type "${flags.type}"`));
    process.exit(1);
  }

  // Resolve priority (default: Medium)
  let priorityId = null;
  if (flags.priority) {
    const pRow = db.prepare(
      "SELECT id FROM issue_priorities WHERE LOWER(name) = LOWER(?)"
    ).get(flags.priority);
    if (!pRow) {
      process.stderr.write(failMsg(`Invalid priority "${flags.priority}"`));
      process.exit(1);
    }
    priorityId = pRow.id;
  } else {
    const pRow = db.prepare("SELECT id FROM issue_priorities WHERE name = 'Medium'").get();
    priorityId = pRow?.id || null;
  }

  // Default status: "To Do"
  const statusRow = db.prepare("SELECT id FROM issue_statuses WHERE name = 'To Do'").get();
  const statusId = statusRow?.id || "1";

  const seq = nextIssueSeq(project);
  const issueKey = `${project}-${seq}`;
  const now = new Date().toISOString();
  const id = genId();
  const reporter = currentUser();

  const labels = flags.label && flags.label.length > 0 ? JSON.stringify(flags.label) : "[]";
  const components = flags.component && flags.component.length > 0 ? JSON.stringify(flags.component) : "[]";

  db.prepare(`
    INSERT INTO issues (id, key, project_key, type_id, summary, description,
      status_id, priority_id, assignee, reporter, labels_json, components_json,
      created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, issueKey, project, typeRow.id,
    // Accept --body (short -b, real jira-cli convention) and --description
    // (also widely typed; real jira-cli alias). Mock parity with both flags
    // so agents that write `--description ...` actually populate the field.
    flags.summary, flags.body || flags.description || "",
    statusId, priorityId,
    flags.assignee || "", reporter,
    labels, components,
    now, now
  );

  auditLog("issue_create", "issue", issueKey, {
    type: typeRow.name,
    summary: flags.summary,
    assignee: flags.assignee || "",
    priority: flags.priority || "Medium",
  });

  if (flags.raw) {
    const issue = db.prepare(`
      SELECT i.*, t.name as type_name, s.name as status_name,
             COALESCE(p.name, '') as priority_name
      FROM issues i
      JOIN issue_types t ON i.type_id = t.id
      JOIN issue_statuses s ON i.status_id = s.id
      LEFT JOIN issue_priorities p ON i.priority_id = p.id
      WHERE i.key = ?
    `).get(issueKey);
    process.stdout.write(renderJson(issueToJsonFull(issue)) + "\n");
  } else {
    // Real CLI: Success("Issue created\n%s", GenerateServerBrowseURL(server, key))
    // (internal/cmd/issue/create/create.go:153).
    process.stdout.write(successMsg(`Issue created\n${browseUrl(issueKey)}`));
  }
}

function issueToJsonFull(r) {
  return {
    key: r.key,
    self: `https://jira.example.com/rest/api/2/issue/${r.key}`,
    fields: {
      issuetype: { name: r.type_name },
      summary: r.summary,
      description: r.description || "",
      status: { name: r.status_name },
      assignee: r.assignee ? { emailAddress: r.assignee } : null,
      reporter: r.reporter ? { emailAddress: r.reporter } : null,
      priority: r.priority_name ? { name: r.priority_name } : null,
      labels: safeJsonParse(r.labels_json),
      components: safeJsonParse(r.components_json).map((c) => ({ name: c })),
      created: r.created_at,
      updated: r.updated_at,
    },
  };
}

function safeJsonParse(s) {
  try { return JSON.parse(s || "[]"); } catch { return []; }
}
