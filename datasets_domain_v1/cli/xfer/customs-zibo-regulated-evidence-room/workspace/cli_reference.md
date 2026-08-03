# CLI Reference

## Google Workspace

```bash
gws list
gws sheets get-metadata --spreadsheet-id sheet-supplier-eval-003 --json --pretty
gws sheets rename --spreadsheet-id sheet-supplier-eval-003 --title "Zibo Regulated Evidence Control - 2026-Q2"
gws sheets add-sheet --spreadsheet-id sheet-supplier-eval-003 --title "Evidence Control"
gws sheets add-sheet --spreadsheet-id sheet-supplier-eval-003 --title "Trace Matrix"
gws sheets add-sheet --spreadsheet-id sheet-supplier-eval-003 --title "HS Review Summary"
gws sheets set-cells --spreadsheet-id sheet-supplier-eval-003 --sheet-title "Evidence Control" --updates '[{"a1":"A1","value":"Supplier"}]'
gws sheets get-range --spreadsheet-id sheet-supplier-eval-003 --range "Evidence Control!A1:L20"
gws sheets get-text --spreadsheet-id sheet-supplier-eval-003 --format csv
gws sheets delete-sheet --spreadsheet-id sheet-supplier-eval-003 --sheet-title "Sheet1"
gws slides get-metadata --presentation-id pres-launch-101 --json --pretty
gws slides rename --presentation-id pres-launch-101 --title "Zibo Regulated Evidence Brief - 2026-Q2"
gws slides add-slide --presentation-id pres-launch-101 --layout TITLE_AND_BODY
gws slides set-text --presentation-id pres-launch-101 --slide-object-id <SLIDE_ID> --element-object-id <ELEMENT_ID> --text "..."
gws slides duplicate-slide --presentation-id pres-launch-101 --slide-object-id <SLIDE_ID>
gws slides get-text --presentation-id pres-launch-101
```

## Jira

```bash
jira init --installation local --server http://localhost --login admin@example.com
jira me
jira project list
jira epic create --project PROJ --summary "Zibo Regulated Export Evidence Room - 2026-Q2"
jira epic list --project PROJ
jira issue create --project PROJ --type Task --summary "[Critical] Supplier evidence review" --priority Highest --assignee owner@example.com --label zibo-evidence --label severity-critical
jira issue list --project PROJ
jira issue view <ISSUE_KEY> --raw
jira issue edit <ISSUE_KEY> --priority High --label zibo-evidence --label severity-high
jira issue assign <ISSUE_KEY> owner@example.com
jira issue comment add <ISSUE_KEY> "Trace text"
jira issue link <TASK_KEY> <EPIC_KEY> "relates to"
jira issue move <ISSUE_KEY> "In Progress"
jira issue clone <ISSUE_KEY>
```

## Box

```bash
box login
box folders:get 0
box folders:items 0
box folders:create 0 "Zibo Regulated Evidence Room - 2026-Q2"
box folders:create <ROOT_ID> "Supplier Name"
box folders:update <FOLDER_ID> --name "Supplier Name - Evidence"
box files:upload /path/to/evidence_summary_supplier.md --parent-id <FOLDER_ID> --name evidence_summary_supplier.md
box files:get <FILE_ID>
box files:update <FILE_ID> --name evidence_summary_supplier.md
box search "Supplier Name"
box comments:create <FILE_ID> --message "Evidence linked to PROJ-123 and dws_xxx"
box collaborations:create <FOLDER_ID> folder --role viewer --user-id 10003
box tasks:create <FILE_ID> --message "Reviewer check for Supplier Name"
```

## DWS

```bash
dws auth status
dws doc folder create --name "Zibo Regulated Dossiers - 2026-Q2"
dws doc create --name "[Critical] Supplier Evidence Dossier" --content "..." --folder <FOLDER_ID>
dws doc update --node <DOC_ID> --mode append --content "..."
dws doc block insert --node <DOC_ID> --type paragraph --text "Trace Summary: Supplier / PROJ-123 / Box folder / total"
dws doc comment create --node <DOC_ID> --content "..."
dws doc permission add --node <DOC_ID> --user compliance-reviewer@example.com --role EDITOR
dws doc upload --file customs_data/zibo_us_exports.csv
dws doc export --node <DOC_ID> --output /task/outputs/dossier.md
dws doc list
dws doc search --query "Zibo"
dws doc info --node <DOC_ID>
dws doc read --node <DOC_ID>
```

Capture the actual Jira key, Box folder id, Box file id, and DWS document id. The Google Sheets rows and trace matrix must use returned ids, not placeholders.
