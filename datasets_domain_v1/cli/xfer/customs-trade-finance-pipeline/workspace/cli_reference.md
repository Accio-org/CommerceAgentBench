# CLI Quick Reference

## DWS (dws)

```bash
# Authentication
dws auth login
dws auth status

# Document operations
dws doc list [--workspace <W>]
dws doc search --query <Q>
dws doc info --node <ID>
dws doc read --node <ID>
dws doc create --name <N> [--content <md>] [--folder <F>]
dws doc update --node <ID> --mode append --content <md>
dws doc rename --node <ID> --name <N>
dws doc copy --node <ID> [--folder <F>]
dws doc move --node <ID> [--folder <F>]
dws doc delete --node <ID>

# Folders
dws doc folder create --name <N>

# File operations
dws doc upload --file <path>
dws doc download --node <ID> --output <path>
dws doc export --node <ID> --output <path>

# Block operations
dws doc block insert --node <ID> --type <T> --text <T>
dws doc block list --node <ID>
dws doc block update --node <ID> --block-id <B> --text <T>
dws doc block delete --node <ID> --block-id <B>

# Collaboration
dws doc comment create --node <ID> --content <C>
dws doc comment list --node <ID>
dws doc permission add --node <ID> --user <U> --role EDITOR
```

## Stripe (stripe)

```bash
# Account
stripe whoami
stripe config --list

# Customers
stripe customers create --name <N> --email <E> [--metadata key=val]
stripe customers retrieve <ID>
stripe customers update <ID> --metadata key=val
stripe customers list

# Products & Pricing
stripe products create --name <N> [--description <D>]
stripe products retrieve <ID>
stripe products update <ID> --metadata key=val
stripe prices create --product <ID> --unit-amount <N> --currency usd

# Tax & Discounts
stripe tax_rates create --display-name <N> --percentage <N>
stripe coupons create --percent-off <N> [--id <ID>]

# Invoices
stripe invoices create --customer <ID>
stripe invoiceitems create --customer <ID> --price <ID> --invoice <ID>
stripe invoices update <ID> --description <D>
stripe invoices retrieve <ID>
stripe invoices list --customer <ID>

# Payment Links
stripe payment_links create --line-items price=<ID>
```

## Todoist (todoist)

```bash
# Projects
todoist projects
todoist add-project <name>

# Sections
todoist sections add <name> --project-name <P>
todoist sections list
todoist sections update <ID> --name <N>

# Tasks
todoist add <content> --project-name <P> --section-name <S> --priority <N> --label-names <L>
todoist list --project-name <P>
todoist show <ID>
todoist modify <ID> -c <content> -p <priority>
todoist labels

# Lifecycle
todoist today
todoist close <ID>
todoist completed-list
todoist reopen <ID>
```
