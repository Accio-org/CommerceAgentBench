# CLI Reference

## Google Workspace

```bash
gws list
gws sheets get-metadata --spreadsheet-id sheet-supplier-eval-003 --json --pretty
gws sheets rename --spreadsheet-id sheet-supplier-eval-003 --title "Medtech Quality Dossier Control - 2026-Q2"
gws sheets add-sheet --spreadsheet-id sheet-supplier-eval-003 --title "Medtech Quality Control"
gws sheets add-sheet --spreadsheet-id sheet-supplier-eval-003 --title "Medtech Trace Map"
gws sheets set-cells --spreadsheet-id sheet-supplier-eval-003 --sheet-title "Medtech Quality Control" --updates '[{"a1":"A1","value":"Supplier"}]'
gws sheets get-range --spreadsheet-id sheet-supplier-eval-003 --range "Medtech Quality Control!A1:J25"
gws sheets get-text --spreadsheet-id sheet-supplier-eval-003 --format csv
gws sheets delete-sheet --spreadsheet-id sheet-supplier-eval-003 --sheet-title "Sheet1"
gws slides get-metadata --presentation-id pres-launch-101 --json --pretty
gws slides rename --presentation-id pres-launch-101 --title "Medtech Quality Dossier Control Brief - 2026-Q2"
gws slides add-slide --presentation-id pres-launch-101 --layout TITLE_AND_BODY
gws slides set-text --presentation-id pres-launch-101 --slide-object-id <SLIDE_ID> --element-object-id <ELEMENT_ID> --text "..."
gws slides duplicate-slide --presentation-id pres-launch-101 --slide-object-id <SLIDE_ID>
gws slides get-text --presentation-id pres-launch-101
```

## Jira

```bash
jira init --installation local --server http://localhost --login admin@example.com
jira project list
jira epic create --project PROJ --summary "Medtech Export Quality Dossier - 2026-Q2"
jira epic list --project PROJ
jira issue create --project PROJ --type Task --summary "[Critical] Supplier name" --priority Highest --assignee owner@example.com --label medtech-quality --label severity-critical
jira issue list --project PROJ
jira issue view <ISSUE_KEY> --raw
jira issue edit <ISSUE_KEY> --priority High --label medtech-quality --label severity-high
jira issue assign <ISSUE_KEY> owner@example.com
jira issue comment add <ISSUE_KEY> "Trace text"
jira issue link <TASK_KEY> <EPIC_KEY> "relates to"
jira issue move <ISSUE_KEY> "In Progress"
```

## DWS

```bash
dws auth status
dws doc folder create --name "Medtech Quality Dossiers - 2026-Q2"
dws doc create --name "[Critical] Supplier Quality Dossier" --content "..." --folder <FOLDER_ID>
dws doc update --node <DOC_ID> --mode append --content "..."
dws doc block insert --node <DOC_ID> --type paragraph --text "..."
dws doc comment create --node <DOC_ID> --content "..."
dws doc permission add --node <DOC_ID> --user qa-reviewer@example.com --role EDITOR
dws doc list
dws doc search --query "Medtech"
dws doc info --node <DOC_ID>
dws doc read --node <DOC_ID>
dws doc upload --file customs_data/medical_ultrasound.csv
dws doc export --node <DOC_ID> --output /task/outputs/dossier.md
```

Capture every Jira issue key and DWS node id. The two Google Sheets must contain those actual returned ids, not placeholders.
