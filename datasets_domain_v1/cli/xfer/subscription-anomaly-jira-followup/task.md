帮我把 Stripe 里有续费风险的订阅整理到 Jira PROJ 项目里做本周的 triage。具体哪些订阅算"有风险"、优先级怎么定、issue 格式怎么写，都按 `workspace/` 下面的三份参考文件来——`renewal_policy.md` 是纳入标准和优先级口径，`triage_brief.md` 是 epic/issue 的格式规范，`customer_accounts_master_2026Q2_v3.xlsx` 是客户主数据（含 Tier 映射表）。

Stripe 只读不要动，Jira 里原有的 issue 也别碰。Jira CLI 第一次用需要先 `jira init --installation local --server http://localhost --login admin@example.com`。
