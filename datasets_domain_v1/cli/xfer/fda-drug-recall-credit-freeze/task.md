我们有一份 2025-2026 窗口的 FDA drug enforcement 运营附件包，里面有供应商药品召回、无菌保证、杂质和标签混淆等风险。请把会影响我们健康品/药房渠道的 firm 聚合后同步到三个本地 CLI 系统：Google Workspace 做冻结台账（用 `sheet-supplier-eval-003` 当 FDA 控制中心，含冻结主表和 trace map，并在 `pres-launch-101` 留一页管理层 briefing），Jira 在 `PROJ` 项目下拉一个 war-room issue graph（一个 Epic + 每个 in-scope firm 一条 Task + Task 到 Epic 的关系边），Todoist 新建项目 `FDA Recall Callbacks - 2026-05-27` 按 severity 建回访队列、并为 Critical firm 留下已完成的信用冻结确认记录。

三个 CLI 都在本地：`gws`、`jira`、`todoist`，FDA 快照已经在 workspace 里。FDA 附件包在 `workspace/fda_enforcement_packet/`（一千多条记录被拆成多个 CSV 分页加一个 case-card 文本文件；不能只看开头几十条，也没有单个 JSON 快捷入口），内部 exposure/owner 表在 `workspace/portfolio_exposure.csv`，规则在 `workspace/recall_war_room_policy.md`，CLI 备忘在 `workspace/cli_reference.md`。

请先在 FDA 附件包里筛出 `status = Ongoing` 的相关记录，按 `recalling_firm` 聚合，再和内部 exposure 表按 firm 精确匹配。内部 exposure 表包含多种边界项：有些 firm 有 FDA 记录但不命中 policy 风险触发词，有些命中触发词但 exposure 不达标，有些只有 cGMP 质量体系问题，需要按 policy 判 severity 和 Todoist 范围。只处理 policy 规定的 in-scope firm。多记录 firm 必须聚合成 firm 级别，**不要逐条召回拆工单**。

硬性约束：不要修改 FDA 附件包和 workspace CSV；同一个 firm 的多条 recall 不要拆成多条记录；Jira Task 全部流转到 `In Progress`；Todoist 任务不能落到默认项目也不能落在项目根部，必须在对应 severity section 中；GWS trace map 要把 GWS row、Jira Epic key、Jira Task key、Todoist callback id 和 Critical acknowledgement id 串起来；误建的非业务对象在结束前删掉。CLI 系统终态就是交付物，不需要产出磁盘文件。
