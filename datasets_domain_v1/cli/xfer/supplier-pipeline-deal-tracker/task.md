Notion 里有供应商尽调和采购单两个库，请把本季度符合 deal pipeline 条件的供应商录进 Jira 的 `PROJ` 项目，形成一个可以直接给 deal team 使用的 Q3 deal room：一个 pipeline Epic，并为每家供应商创建与该 Epic 关联的 Task。

判定要以 Notion 的 live 数据为准，并按公司层面聚合。只有同时满足以下条件的供应商才进入 Jira：

- 该公司没有任何一条 `CertificationStatus=Hold` 的尽调记录。
- 该公司的正常采购单总额达到 Q3 policy 的 material-volume 门槛；`Status=Exception` 的 PO 不计入总额。

每家供应商的 Deal Size、Jira 优先级、采购 owner、category label 都要从附件中的 policy 和 workbook 得出。Jira 终态需要能说明每个供应商为什么入选、对应的 Notion 来源、正常 PO 总额、Deal Size 和 owner；这些交接信息要写在 Jira issue/epic 的 body/description 字段中。同一 Deal Size 的供应商之间要在 Jira 图上能互相发现。所有新建 Task 的工作流状态应进入 `In Review`，并遵守 workbook 和 kickoff 邮件中的 Jira workflow 限制。

参考资料在 `workspace/`：

- `procurement_pipeline_workbook_2026Q3_v3.xlsx` —— 供应商主数据、Deal Size 分桶、采购 owner 花名册、工作流流转规则。
- `Q3_pipeline_kickoff.eml` —— 采购总监本季度 kickoff 邮件，列了几条强制要求。
- `pipeline_policy.md` —— 判定逻辑、分桶口径、owner 取数规则。
- `pipeline_brief.md` —— Jira deal room 的交接要求。

约束：

- Notion 只读，别动。
- 只在 `PROJ` 新建 epic 和 Task，不要碰原有的 backlog。
- 不要给不符合条件的供应商建 Task。
- 每家 in-scope 供应商一个 Task，不重不漏。
- 每个 in-scope Task 都要留下 source trace comment，写清公司名、正常采购单总额、Deal Size、owner。
- 同一 Deal Size cohort 内的 Task 要用 Jira issue link 关联成可遍历的一组，方便 deal team 从任一同组供应商跳到其它同组供应商。
- deal team 工作语言是英文，Jira 里的 summary、description、comment 一律用英文写。

Jira CLI 第一次用要先 `jira init --installation local --server http://localhost --login admin@example.com`。
