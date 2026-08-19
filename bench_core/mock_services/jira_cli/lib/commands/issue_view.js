/**
 * issue_view.js — `jira issue view ISSUE-KEY` command.
 */

import { getDb } from "../db.js";
import { errUnexpectedResponse, failMsg } from "../errors.js";
import { renderJson } from "../output/json.js";

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
  const issue = db.prepare(`
    SELECT i.*, t.name as type_name, s.name as status_name,
           COALESCE(p.name, '') as priority_name
    FROM issues i
    JOIN issue_types t ON i.type_id = t.id
    JOIN issue_statuses s ON i.status_id = s.id
    LEFT JOIN issue_priorities p ON i.priority_id = p.id
    WHERE i.key = ? AND i.is_deleted = 0
  `).get(issueKey.toUpperCase());

  if (!issue) {
    // Real CLI: GetIssue -> 404 -> cmdutil.ExitIfError(ErrUnexpectedResponse)
    // (pkg/jira/issue.go:102-103, internal/cmdutil/utils.go:30-40).
    process.stderr.write(errUnexpectedResponse());
    process.exit(1);
  }

  // Fetch comments
  const commentsLimit = flags.comments ?? 1;
  const comments = db.prepare(
    `SELECT * FROM comments WHERE issue_key = ? ORDER BY created_at DESC LIMIT ?`
  ).all(issueKey.toUpperCase(), commentsLimit);

  if (flags.raw) {
    process.stdout.write(renderJson(issueToJsonFull(issue, comments)) + "\n");
    return;
  }

  // Plain text view
  const labels = safeJsonParse(issue.labels_json);
  const components = safeJsonParse(issue.components_json);

  const lines = [];
  lines.push(`${issue.key}  ${issue.summary}`);
  lines.push("");
  lines.push(`  Type:        ${issue.type_name}`);
  lines.push(`  Status:      ${issue.status_name}`);
  lines.push(`  Priority:    ${issue.priority_name || "None"}`);
  lines.push(`  Assignee:    ${issue.assignee || "Unassigned"}`);
  lines.push(`  Reporter:    ${issue.reporter || ""}`);
  lines.push(`  Labels:      ${labels.length > 0 ? labels.join(", ") : "None"}`);
  lines.push(`  Components:  ${components.length > 0 ? components.join(", ") : "None"}`);
  if (issue.resolution) {
    lines.push(`  Resolution:  ${issue.resolution}`);
  }
  if (issue.epic_key) {
    lines.push(`  Epic:        ${issue.epic_key}`);
  }
  if (issue.parent_key) {
    lines.push(`  Parent:      ${issue.parent_key}`);
  }
  lines.push(`  Created:     ${issue.created_at}`);
  lines.push(`  Updated:     ${issue.updated_at}`);

  if (issue.description) {
    lines.push("");
    lines.push("  Description:");
    for (const dline of issue.description.split("\n")) {
      lines.push(`    ${dline}`);
    }
  }

  if (comments.length > 0) {
    lines.push("");
    lines.push("  Comments:");
    for (const c of comments) {
      lines.push(`    ${c.author} - ${c.created_at}`);
      for (const cline of c.body.split("\n")) {
        lines.push(`      ${cline}`);
      }
      lines.push("");
    }
  }

  process.stdout.write(lines.join("\n") + "\n");
}

function issueToJsonFull(issue, comments) {
  return {
    key: issue.key,
    self: `https://jira.example.com/rest/api/2/issue/${issue.key}`,
    fields: {
      issuetype: { name: issue.type_name },
      summary: issue.summary,
      description: issue.description || "",
      status: { name: issue.status_name },
      assignee: issue.assignee ? { emailAddress: issue.assignee, displayName: issue.assignee } : null,
      reporter: issue.reporter ? { emailAddress: issue.reporter, displayName: issue.reporter } : null,
      priority: issue.priority_name ? { name: issue.priority_name } : null,
      resolution: issue.resolution ? { name: issue.resolution } : null,
      labels: safeJsonParse(issue.labels_json),
      components: safeJsonParse(issue.components_json).map((c) => ({ name: c })),
      fixVersions: safeJsonParse(issue.fix_versions_json).map((v) => ({ name: v })),
      created: issue.created_at,
      updated: issue.updated_at,
      parent: issue.parent_key ? { key: issue.parent_key } : undefined,
      epic: issue.epic_key ? { key: issue.epic_key } : undefined,
      comment: {
        total: comments.length,
        comments: comments.map((c) => ({
          id: c.id,
          author: { emailAddress: c.author, displayName: c.author },
          body: c.body,
          created: c.created_at,
          updated: c.updated_at,
        })),
      },
    },
  };
}

function safeJsonParse(s) {
  try { return JSON.parse(s || "[]"); } catch { return []; }
}
