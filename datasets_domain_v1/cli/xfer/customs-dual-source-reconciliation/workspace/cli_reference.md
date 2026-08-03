# CLI Quick Reference

## DWS (Document Workspace)

```bash
dws auth login                              # authenticate
dws auth status                             # verify auth
dws doc list                                # list documents
dws doc create --name <N> --content <md>    # create doc with markdown content
dws doc create --name <N> --folder <F>      # create doc in folder
dws doc update --node <ID> --mode append --content <md>  # append content
dws doc read --node <ID>                    # read doc
dws doc folder create --name <N>            # create folder
dws doc comment create --node <ID> --content <C>  # add comment
dws doc permission add --node <ID> --user <U> --role EDITOR  # share
dws doc upload --file <path>                # upload file
dws doc export --node <ID> --output <path>  # export as docx
```

## Jira

```bash
jira init                                   # initialize
jira project list                           # list projects
jira epic create --project <P> --summary <S>  # create epic
jira issue create --project <P> --type Task -s <S> -y <priority> -l <label>  # create issue
jira issue view <KEY>                       # view issue
jira issue edit <KEY> -s <S> -y <priority>  # edit issue
jira issue assign <KEY> <ASSIGNEE>          # assign
jira issue comment add <KEY> <comment>      # add comment
jira issue link <INWARD> <OUTWARD> <TYPE>   # link issues
jira issue move <KEY> <STATE>               # transition
jira issue list --project <P>               # list issues
```

## Todoist

```bash
todoist projects                            # list projects
todoist add-project <name>                  # create project
todoist sections add <name> --project-name <P>  # create section
todoist sections list                       # list sections
todoist add <content> --project-name <P> --section-name <S> --priority <N> --label-names <L>  # create task
todoist list --project-name <P>             # list tasks
todoist show <ID>                           # inspect task
todoist modify <ID> -c <content> -p <priority>  # update task
todoist close <ID>                          # complete task
```
