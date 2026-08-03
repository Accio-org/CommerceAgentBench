# CLI Quick Reference

## DWS (Document Workspace)

```bash
dws auth login                         # authenticate
dws auth status                        # verify auth
dws doc list                           # list documents
dws doc search --query <Q>             # search docs
dws doc info --node <ID>               # get metadata
dws doc read --node <ID>               # read content
dws doc create --name <N> --content <md>  # create doc
dws doc create --name <N> --content <md> --folder <F>  # create in folder
dws doc update --node <ID> --mode append --content <md>  # append
dws doc folder create --name <N>       # create folder
dws doc upload --file <path>           # upload file
dws doc comment create --node <ID> --content <C>  # add comment
dws doc permission add --node <ID> --user <U> --role EDITOR  # share
```

## Box (File Storage)

```bash
box login                              # authenticate
box folders:get <ID>                   # inspect folder
box folders:items <ID>                 # list contents
box folders:create --parent-id <ID> --name <N>  # create folder
box files:upload <folder-id> --file <path>  # upload file
box files:get <ID>                     # get file info
box files:update <ID> --name <N>       # rename file
box comments:create --file-id <ID> --message <M>  # add comment
box search <query>                     # search files
box tasks:create --file-id <ID> --message <M>  # create task
```

## Stripe (Financial Records)

```bash
stripe whoami                          # verify identity
stripe config --list                   # check config
stripe customers create --name <N> --email <E> --metadata key=val  # create customer
stripe customers list                  # list customers
stripe products create --name <N> --description <D>  # create product
stripe prices create --product <ID> --unit-amount <N> --currency usd  # create price
stripe invoices create --customer <ID>  # create invoice
stripe invoiceitems create --customer <ID> --price <ID> --invoice <ID>  # add line
stripe invoices update <ID> --description <D>  # update invoice
stripe invoices retrieve <ID>          # get invoice details
```
