/**
 * project_list.js — `jira project list` command.
 */

import { getDb } from "../db.js";
import { ERR_NO_PROJECTS, failMsg } from "../errors.js";
import { renderTable } from "../output/table.js";
import { renderJson } from "../output/json.js";
import { renderCsv } from "../output/csv.js";

/**
 * @param {object} flags
 */
export function run(flags) {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM projects ORDER BY key").all();

  if (rows.length === 0) {
    process.stderr.write(failMsg(ERR_NO_PROJECTS));
    process.exit(1);
  }

  if (flags.raw) {
    const jsonData = rows.map((r) => ({
      key: r.key,
      name: r.name,
      lead: r.lead ? { emailAddress: r.lead } : null,
      type: r.type,
    }));
    process.stdout.write(renderJson(jsonData) + "\n");
    return;
  }

  const headers = ["KEY", "NAME", "LEAD", "TYPE"];
  const displayRows = rows.map((r) => [r.key, r.name, r.lead || "", r.type]);

  if (flags.csv) {
    process.stdout.write(renderCsv(headers, displayRows, { noHeaders: flags.noHeaders }) + "\n");
  } else {
    process.stdout.write(
      renderTable(headers, displayRows, {
        noHeaders: flags.noHeaders,
        delimiter: flags.delimiter,
      }) + "\n"
    );
  }
}
