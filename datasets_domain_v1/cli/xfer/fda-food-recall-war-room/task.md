我们刚把 2025-2026 窗口的 FDA food enforcement 运营附件包下载到本地，需要把会影响我们电商供货组合的召回做成一个三系统 war-room：Google Workspace 里留汇总表（用 `sheet-supplier-eval-003` 当 FDA 控制中心，含 war-room 主表、trace map，并在 `pres-launch-101` 留一页管理层 briefing），Jira 在 `PROJ` 项目下拉一个 war-room issue graph（一个 Epic + 每个 in-scope firm 一条 Task + Task 到 Epic 的关系边），Todoist 新建项目 `FDA Recall Callbacks - 2026-05-27` 按 severity 建回访队列、并为 Critical firm 留下已完成的合规确认记录。

三个 CLI 都在本地：`gws`、`jira`、`todoist`，FDA 快照文件已经在 workspace 里。FDA 附件包在 `workspace/fda_enforcement_packet/`（两千多条记录被拆成多个 CSV 分页加一个 case-card 文本文件；不能只看开头几十条，也没有单个 JSON 快捷入口），内部 exposure/owner 表在 `workspace/portfolio_exposure.csv`，规则在 `workspace/recall_war_room_policy.md`，CLI 备忘在 `workspace/cli_reference.md`。

请先在 FDA 附件包里筛出 `status = Ongoing` 的相关记录，按 `recalling_firm` 聚合，再和 `portfolio_exposure.csv` 按 firm 精确匹配。内部 exposure 表包含多种干扰项：有些 firm 只在后面的 CSV 分页出现，有些 exposure 达标但不命中 policy 风险触发词，有些命中触发词但 exposure 不达标。只纳入 policy 规定的 firm，并按完整附件包里的全部 Ongoing recall 重新计算严重级别、Jira 优先级、Todoist 范围和汇总行。

硬性约束：不要修改 FDA 附件包和 workspace CSV；同一个 firm 的多条 recall 不要拆成多条 Jira/表格/Todoist 记录；Jira Task 全部流转到 `In Progress`；Todoist 任务不要落到 Inbox / Work / Shopping 等默认项目，也不要落在项目根部，必须在对应 severity section 中；GWS trace map 要把 GWS row、Jira Epic key、Jira Task key、Todoist callback id 和 Critical acknowledgement id 串起来；误建的非业务对象在结束前删掉。三个 CLI 系统的终态就是交付物，不需要写磁盘输出文件。
