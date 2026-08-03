# CLI Quick Reference

## Jira CLI (`jira`)

```bash
jira init                                          # 初始化连接
jira me                                            # 查看当前用户
jira project list                                  # 列出项目
jira epic create --project <P> --summary "..."     # 创建 Epic
jira epic list --project <P>                       # 列出 Epic
jira issue create --project <P> --type Task \
  -s "..." [-y <priority>] [-l <label>]            # 创建 Issue
jira issue view <KEY> [--raw]                      # 查看 Issue
jira issue edit <KEY> [-s "..."] [-y <priority>]   # 编辑 Issue
jira issue assign <KEY> <ASSIGNEE>                 # 指派
jira issue comment add <KEY> "..."                 # 添加评论
jira issue link <INWARD> <OUTWARD> <TYPE>          # 链接 Issue
jira issue move <KEY> <STATE>                      # 转移状态
jira issue list [--project <P>] [--type <T>]       # 列出 Issue
jira issue delete <KEY>                            # 删除 Issue
```

## Todoist CLI (`todoist`)

```bash
todoist projects                                   # 列出项目
todoist add-project <name>                         # 创建项目
todoist sections add <name> --project-name <P>     # 创建分区
todoist sections list                              # 列出分区
todoist add <content> --project-name <P> \
  --section-name <S> --priority <N> \
  --label-names <L>                                # 创建任务
todoist list --project-name <P>                    # 列出任务
todoist show <ID>                                  # 查看任务
todoist modify <ID> -c <content> -p <priority>     # 修改任务
todoist close <ID>                                 # 完成任务
todoist labels                                     # 列出标签
```

## Notion CLI (`ntn`)

```bash
ntn pages create --parent <ref> --content <md>     # 创建页面
ntn pages get <page-id>                            # 读取页面
ntn pages update <page-id> --content <md>          # 更新页面
ntn pages trash <page-id>                          # 删除页面
ntn api /v1/databases -X POST -d '{...}'           # 创建数据库
ntn api /v1/databases/<id>/query -X POST           # 查询数据库
ntn api /v1/pages -X POST -d '{...}'               # 创建页面（带属性）
ntn api /v1/pages/<id> -X PATCH -d '{...}'         # 更新页面属性
```
