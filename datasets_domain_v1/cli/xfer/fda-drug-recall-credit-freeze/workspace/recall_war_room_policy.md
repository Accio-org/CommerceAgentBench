# FDA Drug Recall Credit-Freeze Policy

Use only `workspace/fda_enforcement_packet/` and `workspace/portfolio_exposure.csv`. The FDA packet is a 2025-2026 window with more than 1,000 records split across CSV pages plus a free-text case-card file; do not work from only the first CSV page or only the first case cards.

## Inclusion

First filter FDA records to `status` exactly `Ongoing`, then group those Ongoing records by exact `recalling_firm`. The CSV pages are the easiest authoritative input, but long fields may contain embedded newlines, so parse them as CSV rather than splitting lines by comma.

A firm is in scope only when:

1. at least one grouped Ongoing FDA record exists;
2. the firm appears exactly in `portfolio_exposure.csv`;
3. `exposure_usd >= 50000`;
4. grouped reason text contains one of these triggers, case-insensitive:
   - `microbial contamination`
   - `lack of assurance of sterility`
   - `particulate matter`
   - `n-nitroso`
   - `label mix-up`
   - `foreign substance`
   - `cGMP`

Firms that fail any one of these criteria must not be written anywhere, even when they appear in the exposure table or have FDA records.

## Derived Severity

- `Critical`: Class I microbial contamination, or sterility-triggered firm with `exposure_usd >= 100000`.
- `High`: N-nitroso, particulate matter, label mix-up, foreign substance, or remaining sterility-triggered firm.
- `Elevated`: cGMP-only quality-system deviations that meet inclusion but do not meet Critical/High.

Severity maps to Jira priority:

- Critical -> Highest
- High -> High
- Elevated -> Medium

Severity maps to Todoist user priority:

- Critical -> 1
- High -> 2
- Elevated -> no Todoist task

## Google Workspace Control Center

Rename spreadsheet `sheet-supplier-eval-003` to:

`FDA Recall Control Center - 2026-05-27`

Create a new sheet named `FDA Recall War Room` in spreadsheet `sheet-supplier-eval-003`.

Headers, exactly:

`Firm | Severity | Recall Count | Recall Numbers | Exposure USD | Owner | Action | Jira Task Key | Todoist Task ID`

Rows must be sorted by severity weight (`Critical`, `High`, `Elevated`), then by `Exposure USD` descending, then by firm name A-Z.

`Recall Numbers` must be comma+space joined in FDA file order within that firm, using all Ongoing recall records for that firm. `Exposure USD` must be a bare integer. `Action` values:

- Critical: `Freeze credit and quarantine inventory`
- High: `Open supplier CAPA and buyer callback`
- Elevated: `Document review and QA monitoring`

`Jira Task Key` must be the actual key returned by the Jira Task created for that firm, such as `PROJ-12`. `Todoist Task ID` must be the actual Todoist item id returned for that firm's callback task. Use `N/A` for `Todoist Task ID` when the firm has no Todoist task.

Also create a second sheet named `FDA Trace Map`.

Trace Map headers, exactly:

`Firm | GWS Row | Jira Epic Key | Jira Task Key | Jira Link Type | Todoist Callback ID | Critical Ack ID`

Trace Map rows must follow the same firm order as `FDA Recall War Room`. `Jira Epic Key` and `Jira Task Key` must be the actual returned Jira keys. `Jira Link Type` must be `relates to`. `Todoist Callback ID` must be the actual callback task id, or `N/A` when there is no callback. `Critical Ack ID` must be the actual completed Critical acknowledgement task id for Critical firms, and `N/A` for all other firms.

Rename presentation `pres-launch-101` to:

`FDA Recall War-Room Brief - 2026-05-27`

Add one new briefing slide. Its visible text must include the war-room Epic key, total in-scope firm count, Critical count, High count, Elevated count, and the exact title `FDA Recall War Room - 2026-05-27`.

## Jira

Create exactly one Epic in `PROJ`:

`FDA Recall War Room - 2026-05-27`

Create exactly one Task per in-scope firm under `PROJ`. Link every firm Task to the war-room Epic with Jira link type `relates to`.

Task summary format:

`[<Severity>] <Firm> - <recall_count> recall(s) - exposure $<exposure_usd> - owner: <owner>`

Task labels must be exactly:

- `fda-recall`
- `severity-<critical/high/elevated>`

Critical tasks must have the comment:

`Quarantine impacted inventory before marketplace relist.`

High and Elevated tasks must not have that comment.

All in-scope Jira Tasks must end in `In Progress`.

After Todoist tasks and the final GWS sheet rows exist, add one trace comment to every in-scope Jira Task:

`Trace: GWS row <row_number>; Todoist task <todoist_task_id_or_N/A>.`

## Todoist

Create exactly one project:

`FDA Recall Callbacks - 2026-05-27`

Create exactly three sections inside that project:

- `Critical callbacks`
- `High callbacks`
- `Completed acknowledgements`

Create Todoist tasks only for Critical and High firms. Content format:

`[<Severity>] <Firm> - Jira <jira_task_key> - recall numbers: <recall_numbers> - owner: <owner>`

Critical Todoist tasks must be placed in `Critical callbacks`; High Todoist tasks must be placed in `High callbacks`.

Labels must be exactly:

- `fda-recall`
- `severity-<critical/high>`

Use user priority 1 for Critical, user priority 2 for High.

For every Critical firm, also create one completed acknowledgement task in `Completed acknowledgements`. Content format:

`ACK [Critical] <Firm> - Jira <jira_task_key> - GWS row <row_number> - freeze confirmed`

Acknowledgement tasks must be completed, must use labels `fda-recall` and `severity-critical`, and must not appear as active callback tasks.
