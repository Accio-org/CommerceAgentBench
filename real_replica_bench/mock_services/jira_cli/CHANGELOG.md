# jira_cli mock — changelog

## 2026-06-13 — `--description` parity with real jira-cli

`issue create` and `issue edit` now accept `--description <text>` as an alias
for `--body <text>`. Previously only `flags.body` (-b short) was written to
the issue description column, so agents that called the mock with
`jira issue edit PROJ-9 --description '…'` saw no error (CLI returned
`Issue updated` because summary/priority/labels still applied) but ended up
with an **empty** `description` field in `jira_final_state.json`.

Bug surfaced in the 2026-06-12 GPT-5.5 release on
`cli-xfer-subscription-anomaly-jira-followup` (triage case 99 / #57):
PROJ-9..PROJ-14 all had empty `description` despite the agent writing
multi-line traceability text. Real jira-cli (ankitpokhrel/jira-cli) treats
the two flags as synonyms; this restores parity.

Files: `lib/commands/issue_create.js`, `lib/commands/issue_edit.js`.
