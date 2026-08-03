# CLI Reference

Jira first-time init:

```bash
jira init --installation local --server http://localhost --login admin@example.com
```

Useful Jira commands:

```bash
jira epic create --project PROJ --summary "..."
jira issue create --project PROJ --type Task --summary "..." --priority Highest --label fda-recall --label severity-critical
jira issue list --project PROJ
jira epic list --project PROJ
jira issue view <ISSUE_KEY> --raw
jira issue link <TASK_KEY> <EPIC_KEY> "relates to"
jira issue comment <ISSUE_KEY> "..."
jira issue move <ISSUE_KEY> "In Progress"
```

Jira notes:

- Capture the Jira Task key returned by each `jira issue create`; later steps need the actual key.
- Capture the Jira Epic key returned by `jira epic create`; the final trace map and Jira links need the actual key.
- Use write commands only for final business objects; clean up any accidental test objects before finishing.

Useful Todoist commands:

```bash
todoist add-project "FDA Recall Callbacks - 2026-05-27"
todoist sections add --project-name "FDA Recall Callbacks - 2026-05-27" "Critical callbacks"
todoist sections add --project-name "FDA Recall Callbacks - 2026-05-27" "High callbacks"
todoist sections add --project-name "FDA Recall Callbacks - 2026-05-27" "Completed acknowledgements"
todoist add --project-name "FDA Recall Callbacks - 2026-05-27" --section-name "Critical callbacks" --priority 1 --label-names "fda-recall,severity-critical" "..."
todoist list --project-name "FDA Recall Callbacks - 2026-05-27"
todoist show <ITEM_ID>
todoist close <ITEM_ID>
```

Todoist notes:

- Capture the item id returned by each `todoist add`; the final GWS sheet and Jira trace comment need the actual id.

Useful Google Workspace commands:

```bash
gws sheets add-sheet --spreadsheet-id sheet-supplier-eval-003 --title "FDA Recall War Room"
gws sheets add-sheet --spreadsheet-id sheet-supplier-eval-003 --title "FDA Trace Map"
gws sheets rename --spreadsheet-id sheet-supplier-eval-003 --title "FDA Recall Control Center - 2026-05-27"
gws sheets set-cells --spreadsheet-id sheet-supplier-eval-003 --sheet-title "FDA Recall War Room" --updates '[{"a1":"A1","value":"Firm"}]'
gws sheets get-text --spreadsheet-id sheet-supplier-eval-003 --format csv
gws slides rename --presentation-id pres-launch-101 --title "FDA Recall War-Room Brief - 2026-05-27"
gws slides get-metadata --presentation-id pres-launch-101 --json --pretty
gws slides add-slide --presentation-id pres-launch-101 --layout TITLE_AND_BODY
gws slides set-text --presentation-id pres-launch-101 --slide-object-id <SLIDE_ID> --element-object-id <ELEMENT_ID> --text "..."
```
