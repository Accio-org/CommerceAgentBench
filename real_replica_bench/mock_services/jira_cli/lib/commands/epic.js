/**
 * epic.js — `jira epic list` and `jira epic create` commands.
 */

import { getDb, nextIssueSeq, genId, auditLog } from "../db.js";
import { defaultProject, currentUser, browseUrl } from "../auth.js";
import { errNoResults, successMsg, failMsg } from "../errors.js";
import { renderTable } from "../output/table.js";
import { renderJson } from "../output/json.js";

/**
 * `jira epic list [EPIC-KEY]`
 * Without EPIC-KEY: list all epics in the project.
 * With EPIC-KEY: list issues belonging to that epic.
 */
export function runList(epicKey, flags) {
  const db = getDb();
  const project = flags.project || defaultProject();

  if (epicKey) {
    // List issues in the epic
    return listEpicIssues(db, epicKey.toUpperCase(), flags);
  }

  // List all epics
  const epicType = db.prepare("SELECT id FROM issue_types WHERE name = 'Epic'").get();
  if (!epicType) {
    // Real CLI prints a blank line (stdout) then cmdutil.Failed (✗, stderr).
    process.stdout.write("\n");
    process.stderr.write(failMsg(errNoResults(project)));
    process.exit(1);
  }

  const rows = db.prepare(`
    SELECT i.key, i.summary, s.name AS status_name,
           i.assignee, COALESCE(p.name, '') AS priority_name,
           i.created_at, i.updated_at
    FROM issues i
    JOIN issue_statuses s ON i.status_id = s.id
    LEFT JOIN issue_priorities p ON i.priority_id = p.id
    WHERE i.type_id = ? AND i.project_key = ? AND i.is_deleted = 0
    ORDER BY i.created_at DESC
  `).all(epicType.id, project);

  if (rows.length === 0) {
    process.stdout.write("\n");
    process.stderr.write(failMsg(errNoResults(project)));
    process.exit(1);
  }

  if (flags.raw) {
    process.stdout.write(renderJson(rows.map((r) => ({
      key: r.key,
      fields: {
        summary: r.summary,
        status: { name: r.status_name },
        assignee: r.assignee ? { emailAddress: r.assignee } : null,
        priority: r.priority_name ? { name: r.priority_name } : null,
      },
    }))) + "\n");
    return;
  }

  const headers = ["KEY", "SUMMARY", "STATUS", "ASSIGNEE"];
  const displayRows = rows.map((r) => [
    r.key, r.summary, r.status_name, r.assignee || "",
  ]);

  process.stdout.write(
    renderTable(headers, displayRows, {
      noHeaders: flags.noHeaders,
      delimiter: flags.delimiter,
    }) + "\n"
  );
}

function listEpicIssues(db, epicKey, flags) {
  const project = flags.project || defaultProject();
  const epic = db.prepare(
    "SELECT * FROM issues WHERE key = ? AND is_deleted = 0"
  ).get(epicKey);
  if (!epic) {
    // Real CLI: `epic list <KEY>` runs a JQL/epic-issues query; a missing epic
    // or one with no children both yield "No result found for given query in
    // project %q" (singleEpicView, internal/cmd/epic/list/list.go:121-124).
    process.stdout.write("\n");
    process.stderr.write(failMsg(errNoResults(project)));
    process.exit(1);
  }

  const rows = db.prepare(`
    SELECT t.name AS type_name, i.key, i.summary, s.name AS status_name,
           i.assignee, COALESCE(p.name, '') AS priority_name
    FROM issues i
    JOIN issue_types t ON i.type_id = t.id
    JOIN issue_statuses s ON i.status_id = s.id
    LEFT JOIN issue_priorities p ON i.priority_id = p.id
    WHERE i.epic_key = ? AND i.is_deleted = 0
    ORDER BY i.created_at DESC
  `).all(epicKey);

  if (rows.length === 0) {
    process.stdout.write("\n");
    process.stderr.write(failMsg(errNoResults(project)));
    process.exit(1);
  }

  if (flags.raw) {
    process.stdout.write(renderJson(rows.map((r) => ({
      key: r.key,
      fields: {
        issuetype: { name: r.type_name },
        summary: r.summary,
        status: { name: r.status_name },
        assignee: r.assignee ? { emailAddress: r.assignee } : null,
        priority: r.priority_name ? { name: r.priority_name } : null,
      },
    }))) + "\n");
    return;
  }

  const headers = ["TYPE", "KEY", "SUMMARY", "STATUS"];
  const displayRows = rows.map((r) => [r.type_name, r.key, r.summary, r.status_name]);

  process.stdout.write(
    renderTable(headers, displayRows, {
      noHeaders: flags.noHeaders,
      delimiter: flags.delimiter,
    }) + "\n"
  );
}

/**
 * `jira epic create`
 */
export function runCreate(flags) {
  if (!flags.summary) {
    process.stderr.write(failMsg("Params `--summary` is mandatory when using a non-interactive mode"));
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

  // Epic type
  const epicType = db.prepare("SELECT id FROM issue_types WHERE name = 'Epic'").get();
  if (!epicType) {
    process.stderr.write(failMsg("Epic issue type not found"));
    process.exit(1);
  }

  // Priority
  let priorityId = null;
  if (flags.priority) {
    const pRow = db.prepare(
      "SELECT id FROM issue_priorities WHERE LOWER(name) = LOWER(?)"
    ).get(flags.priority);
    if (pRow) priorityId = pRow.id;
  } else {
    const pRow = db.prepare("SELECT id FROM issue_priorities WHERE name = 'Medium'").get();
    priorityId = pRow?.id || null;
  }

  const statusRow = db.prepare("SELECT id FROM issue_statuses WHERE name = 'To Do'").get();
  const statusId = statusRow?.id || "1";

  const seq = nextIssueSeq(project);
  const issueKey = `${project}-${seq}`;
  const now = new Date().toISOString();
  const id = genId();
  const reporter = currentUser();

  db.prepare(`
    INSERT INTO issues (id, key, project_key, type_id, summary, description,
      status_id, priority_id, assignee, reporter, labels_json, components_json,
      created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', '[]', ?, ?)
  `).run(
    id, issueKey, project, epicType.id,
    flags.summary, flags.body || "",
    statusId, priorityId,
    flags.assignee || "", reporter,
    now, now
  );

  auditLog("epic_create", "issue", issueKey, {
    name: flags.name || flags.summary,
    summary: flags.summary,
  });

  // Real CLI: Success("Epic created\n%s", GenerateServerBrowseURL(server, key))
  // (internal/cmd/epic/create/create.go:133).
  process.stdout.write(successMsg(`Epic created\n${browseUrl(issueKey)}`));
}
