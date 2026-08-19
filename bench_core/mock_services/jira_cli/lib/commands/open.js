/**
 * open.js — `jira open [ISSUE-KEY]` command.
 *
 * Upstream (internal/cmd/open/open.go:39-51) NEVER validates the key against
 * the server — it just builds and prints the browse URL, then tries to launch a
 * browser. There is no "not found" path. With no argument it opens the project
 * page (browse/<project.key>); with an argument it normalizes via
 * cmdutil.GetJiraIssueKey and prints browse/<key>.
 *
 * In mock mode there is no browser, so we only print the URL (equivalent to the
 * deterministic stdout line `fmt.Println(url)`).
 */

import { browseUrl, defaultProject, jiraIssueKey } from "../auth.js";

/**
 * @param {string|null} issueKey
 * @param {object} flags
 */
export function run(issueKey, flags) {
  if (!issueKey) {
    // No args -> project page: GenerateServerBrowseURL(server, project.key).
    process.stdout.write(browseUrl(defaultProject()) + "\n");
    return;
  }
  // Args -> GenerateServerBrowseURL(server, GetJiraIssueKey(project, key)).
  process.stdout.write(browseUrl(jiraIssueKey(issueKey)) + "\n");
}
