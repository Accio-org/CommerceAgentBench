# CLI Quick Reference

## gws (Google Workspace)
```
gws list                                          # list spreadsheets/presentations
gws sheets add-sheet --spreadsheet-id <id> --title <name>
gws sheets set-cells --spreadsheet-id <id> --sheet-title <name> --updates '[{"a1":"A1","value":"..."}]'
gws sheets get-text --spreadsheet-id <id>
gws slides get-metadata --presentation-id <id>
gws slides add-slide --presentation-id <id> [--layout TITLE_AND_BODY]
gws slides set-text --presentation-id <id> --slide-object-id <id> --element-object-id <id> --text "..."
gws slides get-text --presentation-id <id>
```

## stripe
```
stripe customers create --name <N> --email <E> [--metadata key=val]
stripe customers list
stripe products create --name <N> [--description <D>]
stripe prices create --product <ID> --unit-amount <N> --currency usd
stripe invoices create --customer <ID>
stripe invoiceitems create --customer <ID> --price <ID> --invoice <ID>
stripe invoices update <ID> --description <D>
stripe payment_intents create --amount <N> --currency usd --customer <ID>
```

## box
```
box login
box folders:get <folder-id>
box folders:items <folder-id>
box folders:create <parentID> <name>
box files:upload <path> --parent-id <folderID>
box tasks:create <fileID> --message <M>
box collaborations:create <itemID> <itemType> --role editor [--user-id <U> | --login <email>]
box users
```
