# gws CLI Reference

The `gws` command-line tool interacts with Google Workspace (Sheets and Slides).

## Connection

The mock service runs on `http://127.0.0.1:3081`. All commands require `--remote http://127.0.0.1:3081`.

## Sheets Commands

```bash
# Read spreadsheet metadata
gws sheets get-metadata --spreadsheet-id <id> --remote http://127.0.0.1:3081 --json --pretty

# Read a range of cells
gws sheets get-range --spreadsheet-id <id> --range "SheetName!A1:D10" --remote http://127.0.0.1:3081 --json

# Get full text content
gws sheets get-text --spreadsheet-id <id> --remote http://127.0.0.1:3081

# Write cells
gws sheets set-cells --spreadsheet-id <id> --sheet-title "SheetName" --updates '[{"a1":"A1","value":"hello"},{"a1":"B1","value":"42"}]' --remote http://127.0.0.1:3081

# Add a new sheet tab
gws sheets add-sheet --spreadsheet-id <id> --title "New Sheet" --remote http://127.0.0.1:3081

# List all documents
gws list --remote http://127.0.0.1:3081 --json --pretty
```

## Slides Commands

```bash
# Read presentation text
gws slides get-text --presentation-id <id> --remote http://127.0.0.1:3081

# Read presentation metadata
gws slides get-metadata --presentation-id <id> --remote http://127.0.0.1:3081 --json --pretty

# Add or remove slides
gws slides add-slide --presentation-id <id> --layout TITLE_AND_BODY --remote http://127.0.0.1:3081
gws slides delete-slide --presentation-id <id> --slide-object-id <slideId> --remote http://127.0.0.1:3081

# Update text on a slide. Use slides get-metadata to find slide object IDs and text element object IDs.
gws slides set-text --presentation-id <id> --slide-object-id <slideId> --element-object-id <elementId> --text "New text" --remote http://127.0.0.1:3081
```

## Available Documents

| Type | ID | Title |
|------|-----|-------|
| Spreadsheet | sheet-inventory-004 | Cross-Border Inventory Tracker |
| Spreadsheet | sheet-supplier-eval-003 | Supplier Evaluation Matrix |
| Presentation | pres-sourcing-review-303 | Q2 Sourcing Review |
