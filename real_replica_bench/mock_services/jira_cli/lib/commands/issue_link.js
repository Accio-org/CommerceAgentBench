/**
 * issue_link.js — `jira issue link INWARD OUTWARD LINK_TYPE` command.
 */

import { getDb, genId, auditLog } from "../db.js";
import { browseUrl } from "../auth.js";
import { errUnexpectedResponse, goQuote, successMsg, failMsg } from "../errors.js";

/**
 * @param {string} inwardKey
 * @param {string} outwardKey
 * @param {string} linkType
 */
export function run(inwardKey, outwardKey, linkType) {
  if (!inwardKey || !outwardKey || !linkType) {
    process.stderr.write(failMsg("Usage: jira issue link INWARD OUTWARD LINK_TYPE"));
    process.exit(1);
  }

  const db = getDb();
  const inKey = inwardKey.toUpperCase();
  const outKey = outwardKey.toUpperCase();

  // Verify both issues exist
  const inIssue = db.prepare(
    "SELECT key FROM issues WHERE key = ? AND is_deleted = 0"
  ).get(inKey);
  if (!inIssue) {
    // Real CLI: LinkIssue -> 404 -> ExitIfError(ErrUnexpectedResponse).
    process.stderr.write(errUnexpectedResponse());
    process.exit(1);
  }

  const outIssue = db.prepare(
    "SELECT key FROM issues WHERE key = ? AND is_deleted = 0"
  ).get(outKey);
  if (!outIssue) {
    process.stderr.write(errUnexpectedResponse());
    process.exit(1);
  }

  const now = new Date().toISOString();
  const id = genId();

  db.prepare(
    `INSERT INTO issue_links (id, link_type, inward_key, outward_key, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, linkType, inKey, outKey, now);

  auditLog("issue_link", "issue_link", id, {
    inward: inKey,
    outward: outKey,
    type: linkType,
  });

  // Real CLI: Success("Issues linked as %q", linkType) then a browse-URL line
  // for the inward issue (internal/cmd/issue/link/link.go:84-85).
  process.stdout.write(successMsg(`Issues linked as ${goQuote(linkType)}`));
  process.stdout.write(browseUrl(inKey) + "\n");
}
