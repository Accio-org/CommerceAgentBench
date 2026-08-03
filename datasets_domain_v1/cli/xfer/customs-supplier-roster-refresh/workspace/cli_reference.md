# CLI Quick Reference

## jira — Project & Issue Tracking

```bash
jira init                                    # initialize connection
jira me                                      # current user info
jira project list                            # list all projects
jira epic create --project <P> --summary "..." # create epic
jira epic list --project <P>                 # list epics
jira issue create --project <P> --type Task -s "..." [-y <priority>] [-l <label>]
jira issue view <KEY> [--raw]                # view issue details
jira issue edit <KEY> [-s "..."] [-y <priority>] [-l <label>]
jira issue assign <KEY> <ASSIGNEE>           # assign to user
jira issue comment add <KEY> "..."           # add comment
jira issue link <INWARD> <OUTWARD> <TYPE>    # link issues
jira issue move <KEY> <STATE>                # transition state
jira issue list [--project <P>] [--type <T>] # list issues
```

## ntn — Notion Databases & Pages

```bash
ntn pages create --parent <ref> --content <md>    # create page
ntn pages get <page-id>                           # read page
ntn pages update <page-id> --content <md>         # update page
ntn api /v1/databases -X POST -d '{...}'          # create database
ntn api /v1/databases/<id>/query -X POST          # query database
ntn api /v1/pages -X POST -d '{...}'              # create page with properties
ntn api /v1/pages/<id> -X PATCH -d '{...}'        # update page properties
```

## box — File Storage & Collaboration

```bash
box login                                    # authenticate
box folders:get <id>                         # inspect folder
box folders:items <id>                       # list folder contents
box folders:create --parent-id <id> --name <N> # create folder
box files:upload <folder-id> --file <path>   # upload file
box files:get <id>                           # file info
box files:update <id> --name <N>             # rename file
box comments:create --file-id <id> --message <M>  # add comment
box collaborations:create --folder-id <id> --user-id <U> --role editor
box tasks:create --file-id <id> --message <M>     # create review task
box users                                    # list users
```
