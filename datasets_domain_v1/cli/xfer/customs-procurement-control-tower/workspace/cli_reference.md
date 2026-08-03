# CLI Reference

## Jira

First-time init:

```bash
jira init --installation local --server http://localhost --login admin@example.com
```

Useful Jira commands:

```bash
jira me
jira project list
jira epic create --project PROJ --summary "..."
jira epic list --project PROJ
jira issue create --project PROJ --type Task --summary "..." --priority Highest --label sourcing-control --label tier-strategic
jira issue list --project PROJ
jira issue view <ISSUE_KEY> --raw
jira issue edit <ISSUE_KEY> --summary "..." --priority High --label sourcing-control --label tier-preferred
jira issue assign <ISSUE_KEY> <USERNAME>
jira issue comment add <ISSUE_KEY> "..."
jira issue link <TASK_KEY> <EPIC_KEY> "relates to"
jira issue move <ISSUE_KEY> "In Progress"
jira issue clone <ISSUE_KEY>
```

Jira notes:

- Capture the Jira Task key returned by each `jira issue create`; later steps need the actual key.
- Capture the Jira Epic key returned by `jira epic create`; Jira links need the actual key.
- Use write commands only for final business objects; clean up any accidental test objects before finishing.

## Box

```bash
box login
box folders:get 0
box folders:items 0
box folders:create --parent-id 0 --name "Procurement Control Tower"
box folders:create --parent-id <FOLDER_ID> --name "Supplier Name"
box folders:update <FOLDER_ID> --name "New Name"
box folders:copy <FOLDER_ID> --parent-id <PARENT_ID>
box folders:delete <FOLDER_ID>
box files:upload <FOLDER_ID> --file /path/to/file.txt
box files:get <FILE_ID>
box files:update <FILE_ID> --name "new_name.txt"
box files:copy <FILE_ID> --parent-id <FOLDER_ID>
box files:move <FILE_ID> --parent-id <FOLDER_ID>
box search "query"
box comments:create --file-id <FILE_ID> --message "Review comment"
box collaborations:create --folder-id <FOLDER_ID> --user-id <USER_ID> --role editor
box tasks:create --file-id <FILE_ID> --message "Review task description"
```

Box notes:

- Capture folder IDs returned by `box folders:create`; needed for file uploads and Jira trace comments.
- Capture file IDs returned by `box files:upload`; needed for comments and review tasks.
- Use `box folders:items` to verify folder contents after uploads.

## Google Workspace (gws)

```bash
gws list
gws sheets get-metadata --spreadsheet-id sheet-supplier-eval-003 --json --pretty
gws sheets add-sheet --spreadsheet-id sheet-supplier-eval-003 --title "Sourcing Dashboard"
gws sheets add-sheet --spreadsheet-id sheet-supplier-eval-003 --title "Category Comparison"
gws sheets set-cells --spreadsheet-id sheet-supplier-eval-003 --sheet-title "Sourcing Dashboard" --updates '[{"a1":"A1","value":"Supplier"},{"a1":"B1","value":"Category"}]'
gws sheets get-text --spreadsheet-id sheet-supplier-eval-003 --format csv
gws sheets get-range --spreadsheet-id sheet-supplier-eval-003 --range "Sourcing Dashboard!A1:I10"
gws sheets rename --spreadsheet-id sheet-supplier-eval-003 --title "Multi-Category Procurement Control Tower"
gws sheets delete-sheet --spreadsheet-id sheet-supplier-eval-003 --sheet-title "Sheet1"
gws slides get-metadata --presentation-id pres-launch-101 --json --pretty
gws slides add-slide --presentation-id pres-launch-101 --layout TITLE_AND_BODY
gws slides set-text --presentation-id pres-launch-101 --slide-object-id <SLIDE_ID> --element-object-id <ELEMENT_ID> --text "..."
gws slides rename --presentation-id pres-launch-101 --title "Procurement Sourcing Strategy Brief Q1 2026"
gws slides duplicate-slide --presentation-id pres-launch-101 --slide-object-id <SLIDE_ID>
gws slides get-text --presentation-id pres-launch-101
```

GWS notes:

- Use `gws slides get-metadata` to discover slide and element object IDs before setting text.
- Use `gws slides add-slide` to create new slides; the response includes the new slide's object ID.
