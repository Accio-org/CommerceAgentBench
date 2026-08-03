NorthBridge Accessories 在给一款新的 **Smart Desk Charging Station** 找零部件供应商，整个 component backlog 都在一个 Todoist 项目里——**`Sourcing: Smart Desk Charging Station`**。同事把所有 open sourcing 项都倒到了 **`Backlog (to triage)`** 这个 section 下：每张 card 写了一个 component 的具体 manufacturing requirement 加一个 candidate vendor 的 capability statement。请把 backlog 过一遍，对每张 card 判定 candidate vendor 到底能不能做这个件，能做的进 PO，不能做的进 re-source。

操作环境装好了 **Todoist CLI**，已认证（直接跑 `todoist`，不需要 login），用法和真实 Todoist CLI 一样。`todoist --help` 看可用命令。项目、section、card 都已经存在，没有外网。常用：

```
todoist projects                 # the sourcing project
todoist sections list            # its sections (Backlog + the routing targets)
todoist --header list            # every card: ID, project/section, labels, title
todoist show <id>                # one card in FULL, including its note (the "Description")
```

`todoist --header list` 给的 **ID** 是后续修改 card 必须的。**每张 card 的 note（description）`todoist list` 不会显示，要用 `todoist show <id>` 看**——manufacturing requirement 和 vendor capability statement 就在 note 里。

triage 规则——什么叫 vendor capability "覆盖" requirement（process、material/grade、tolerance、size、class）、每种结果该把 card 移到哪个 section、加什么 label——都写在 `workspace/vendor_triage_policy.md` 里，**动手前认真读完**，里面的判定相当精细，card 的措辞容易误导。

按 policy 把当前 `Backlog (to triage)` 里的每张 card 都做完 triage：读 title 和 note，判断 vendor 的 stated capability 是不是真的覆盖 requirement（看能不能做到，不是看两段文本是否共享词汇），然后一次性 modify 把 card 移到 policy 指定的 section 并加好对应的 label。`todoist modify --label-names ...` 是**替换**整组 label，逗号分隔、不带 `@` 前缀，名字带空格或连字符的 section 要用引号包起来。

Todoist 是 stateful 系统，用 `todoist --header list` 返回的 ID 串后续动作；中途出错 resume 时先看现状再续，不要重复创建 card，也不要把已经对的 card 再改一遍。不要新建、关闭、删除或复制 card，最终项目应该和原 backlog 是同一组 card 全部 active、`Backlog (to triage)` 已经清空。triage 结果直接落在 Todoist 上，没有单独的报告文件。
