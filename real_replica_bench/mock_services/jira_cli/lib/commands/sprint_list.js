/**
 * sprint_list.js — `jira sprint list [SPRINT_ID]` command.
 */

import { getDb } from "../db.js";
import { failMsg } from "../errors.js";
import { renderTable } from "../output/table.js";
import { renderJson } from "../output/json.js";

/**
 * @param {string|null} sprintId
 * @param {object} flags
 */
export function run(sprintId, flags) {
  const db = getDb();

  if (sprintId) {
    // Show issues in a specific sprint
    return showSprintIssues(db, sprintId, flags);
  }

  // List sprints
  let where = [];
  const params = [];

  if (flags.state) {
    where.push("s.state = ?");
    params.push(flags.state);
  }
  if (flags.current) {
    where.push("s.state = 'active'");
  }
  if (flags.prev) {
    where.push("s.state = 'closed'");
  }
  if (flags.next) {
    where.push("s.state = 'future'");
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const rows = db.prepare(
    `SELECT s.*, b.name as board_name FROM sprints s
     LEFT JOIN boards b ON s.board_id = b.id
     ${whereClause}
     ORDER BY s.start_date DESC`
  ).all(...params);

  if (rows.length === 0) {
    process.stderr.write(failMsg("No sprints found."));
    process.exit(1);
  }

  if (flags.raw) {
    const jsonData = rows.map((r) => ({
      id: parseInt(r.id, 10),
      name: r.name,
      state: r.state,
      startDate: r.start_date,
      endDate: r.end_date,
      completeDate: r.complete_date,
      board: r.board_id ? { id: parseInt(r.board_id, 10), name: r.board_name } : null,
    }));
    process.stdout.write(renderJson(jsonData) + "\n");
    return;
  }

  const headers = ["ID", "NAME", "STATE", "START DATE", "END DATE"];
  const displayRows = rows.map((r) => [
    r.id, r.name, r.state, r.start_date || "", r.end_date || "",
  ]);

  process.stdout.write(
    renderTable(headers, displayRows, {
      noHeaders: flags.noHeaders,
      delimiter: flags.delimiter,
    }) + "\n"
  );
}

function showSprintIssues(db, sprintId, flags) {
  const sprint = db.prepare("SELECT * FROM sprints WHERE id = ?").get(sprintId);
  if (!sprint) {
    process.stderr.write(failMsg(`Sprint ${sprintId} not found.`));
    process.exit(1);
  }

  const rows = db.prepare(`
    SELECT t.name AS type_name, i.key, i.summary, s.name AS status_name,
           i.assignee, COALESCE(p.name, '') AS priority_name
    FROM sprint_issues si
    JOIN issues i ON si.issue_key = i.key AND i.is_deleted = 0
    JOIN issue_types t ON i.type_id = t.id
    JOIN issue_statuses s ON i.status_id = s.id
    LEFT JOIN issue_priorities p ON i.priority_id = p.id
    WHERE si.sprint_id = ?
    ORDER BY i.created_at DESC
  `).all(sprintId);

  if (rows.length === 0) {
    process.stderr.write(failMsg(`No issues found in sprint "${sprint.name}".`));
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

  const headers = ["TYPE", "KEY", "SUMMARY", "STATUS", "ASSIGNEE", "PRIORITY"];
  const displayRows = rows.map((r) => [
    r.type_name, r.key, r.summary, r.status_name, r.assignee || "", r.priority_name,
  ]);

  process.stdout.write(
    renderTable(headers, displayRows, {
      noHeaders: flags.noHeaders,
      delimiter: flags.delimiter,
    }) + "\n"
  );
}
