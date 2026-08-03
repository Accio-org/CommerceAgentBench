/**
 * issue_list.js — `jira issue list` command.
 * Supports filtering by type, status, priority, assignee, label, JQL.
 * Output: plain table (default), --raw JSON, --csv.
 */

import { getDb } from "../db.js";
import { defaultProject } from "../auth.js";
import { errNoResults } from "../errors.js";
import { renderTable } from "../output/table.js";
import { renderJson } from "../output/json.js";
import { renderCsv } from "../output/csv.js";

const ALL_COLUMNS = [
  "TYPE", "KEY", "SUMMARY", "STATUS", "ASSIGNEE", "REPORTER",
  "PRIORITY", "RESOLUTION", "CREATED", "UPDATED", "LABELS",
];

const DEFAULT_COLUMNS = ["TYPE", "KEY", "SUMMARY", "STATUS"];

/**
 * @param {object} flags
 */
export function run(flags) {
  const db = getDb();
  const project = flags.project || defaultProject();

  // Verify project exists
  const projRow = db.prepare("SELECT key FROM projects WHERE key = ?").get(project);
  if (!projRow) {
    process.stderr.write(errNoResults(project) + "\n");
    process.exit(1);
  }

  // Build query
  let where = ["i.is_deleted = 0", "i.project_key = ?"];
  const params = [project];

  if (flags.type) {
    where.push("t.name = ?");
    params.push(flags.type);
  }
  if (flags.status && flags.status.length > 0) {
    const placeholders = flags.status.map(() => "?").join(", ");
    where.push(`s.name IN (${placeholders})`);
    params.push(...flags.status);
  }
  if (flags.priority) {
    where.push("p.name = ?");
    params.push(flags.priority);
  }
  if (flags.assignee) {
    where.push("i.assignee = ?");
    params.push(flags.assignee);
  }
  if (flags.label && flags.label.length > 0) {
    // SQLite JSON: check if any label matches
    for (const lbl of flags.label) {
      where.push("i.labels_json LIKE ?");
      params.push(`%"${lbl}"%`);
    }
  }

  const orderBy = flags.orderBy || "created";
  const orderDir = flags.reverse ? "ASC" : "DESC";

  // Map orderBy to column
  const orderMap = {
    created: "i.created_at",
    updated: "i.updated_at",
    summary: "i.summary",
    status: "s.name",
    priority: "pr.sort_order",
    assignee: "i.assignee",
    key: "i.key",
    type: "t.name",
  };
  const orderCol = orderMap[orderBy.toLowerCase()] || "i.created_at";

  // Pagination
  let offset = 0;
  let limit = 100;
  if (flags.paginate) {
    const parts = flags.paginate.split(":");
    if (parts.length === 2) {
      offset = parseInt(parts[0], 10) || 0;
      limit = parseInt(parts[1], 10) || 100;
    }
  }

  const sql = `
    SELECT
      t.name AS type_name,
      i.key,
      i.summary,
      s.name AS status_name,
      i.assignee,
      i.reporter,
      COALESCE(p.name, '') AS priority_name,
      i.resolution,
      i.created_at,
      i.updated_at,
      i.labels_json,
      i.description,
      i.id,
      i.project_key,
      i.epic_key,
      i.parent_key,
      i.components_json,
      i.fix_versions_json,
      t.id AS type_id,
      s.id AS status_id,
      p.id AS priority_id
    FROM issues i
    JOIN issue_types t ON i.type_id = t.id
    JOIN issue_statuses s ON i.status_id = s.id
    LEFT JOIN issue_priorities p ON i.priority_id = p.id
    WHERE ${where.join(" AND ")}
    ORDER BY ${orderCol} ${orderDir}
    LIMIT ? OFFSET ?
  `;
  params.push(limit, offset);

  const rows = db.prepare(sql).all(...params);

  if (rows.length === 0) {
    process.stderr.write(errNoResults(project) + "\n");
    process.exit(1);
  }

  // Determine columns to show
  let columns = DEFAULT_COLUMNS;
  if (flags.columns) {
    columns = flags.columns.split(",").map((c) => c.trim().toUpperCase());
  } else if (flags.noTruncate) {
    columns = ALL_COLUMNS;
  }

  // Build display rows
  const displayRows = rows.map((r) => rowToColumns(r, columns));

  // Output
  if (flags.raw) {
    const jsonData = rows.map((r) => issueToJson(r));
    process.stdout.write(renderJson(jsonData) + "\n");
  } else if (flags.csv) {
    process.stdout.write(renderCsv(columns, displayRows, { noHeaders: flags.noHeaders }) + "\n");
  } else {
    process.stdout.write(
      renderTable(columns, displayRows, {
        noHeaders: flags.noHeaders,
        delimiter: flags.delimiter,
      }) + "\n"
    );
  }
}

function rowToColumns(r, columns) {
  const map = {
    TYPE: r.type_name,
    KEY: r.key,
    SUMMARY: r.summary,
    STATUS: r.status_name,
    ASSIGNEE: r.assignee || "",
    REPORTER: r.reporter || "",
    PRIORITY: r.priority_name || "",
    RESOLUTION: r.resolution || "",
    CREATED: r.created_at,
    UPDATED: r.updated_at,
    LABELS: labelsStr(r.labels_json),
  };
  return columns.map((c) => map[c] ?? "");
}

function labelsStr(json) {
  try {
    const arr = JSON.parse(json || "[]");
    // Upstream joins labels with no space: strings.Join(labels, ",")
    // (internal/view/issues.go). Caught by the golden 11-col oracle.
    return arr.join(",");
  } catch {
    return "";
  }
}

function issueToJson(r) {
  return {
    key: r.key,
    fields: {
      issuetype: { name: r.type_name },
      summary: r.summary,
      description: r.description || "",
      status: { name: r.status_name },
      assignee: r.assignee ? { emailAddress: r.assignee } : null,
      reporter: r.reporter ? { emailAddress: r.reporter } : null,
      priority: r.priority_name ? { name: r.priority_name } : null,
      resolution: r.resolution ? { name: r.resolution } : null,
      labels: safeJsonParse(r.labels_json),
      components: safeJsonParse(r.components_json).map((c) => ({ name: c })),
      fixVersions: safeJsonParse(r.fix_versions_json).map((v) => ({ name: v })),
      created: r.created_at,
      updated: r.updated_at,
      parent: r.parent_key ? { key: r.parent_key } : undefined,
      epic: r.epic_key ? { key: r.epic_key } : undefined,
    },
  };
}

function safeJsonParse(s) {
  try { return JSON.parse(s || "[]"); } catch { return []; }
}
