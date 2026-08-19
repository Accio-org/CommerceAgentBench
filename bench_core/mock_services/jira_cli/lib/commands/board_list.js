/**
 * board_list.js — `jira board list` command.
 */

import { getDb } from "../db.js";
import { failMsg } from "../errors.js";
import { renderTable } from "../output/table.js";
import { renderJson } from "../output/json.js";

/**
 * @param {object} flags
 */
export function run(flags) {
  const db = getDb();
  const rows = db.prepare(
    "SELECT b.*, p.name as project_name FROM boards b LEFT JOIN projects p ON b.project_key = p.key ORDER BY b.id"
  ).all();

  if (rows.length === 0) {
    process.stderr.write(failMsg("No boards found."));
    process.exit(1);
  }

  if (flags.raw) {
    const jsonData = rows.map((r) => ({
      id: parseInt(r.id, 10),
      name: r.name,
      type: r.type,
      project: r.project_key ? { key: r.project_key, name: r.project_name } : null,
    }));
    process.stdout.write(renderJson(jsonData) + "\n");
    return;
  }

  const headers = ["ID", "NAME", "TYPE", "PROJECT"];
  const displayRows = rows.map((r) => [r.id, r.name, r.type, r.project_key || ""]);

  process.stdout.write(
    renderTable(headers, displayRows, {
      noHeaders: flags.noHeaders,
      delimiter: flags.delimiter,
    }) + "\n"
  );
}
