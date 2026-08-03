我们采购团队刚拿到三个区域（东营、淄博、广州）的美国出口海关数据，总共八千多条发货记录，在 `workspace/customs_data/` 下面三个 CSV 文件里。现在需要按公司贸易融资管理政策（`workspace/trade_finance_policy.md`）把达标供应商筛出来，然后在 DWS、Stripe、Todoist 三个系统里把完整的 pipeline 搭好——DWS 做分析报告和文档管理，Stripe 建支付基础设施，Todoist 建跟进任务队列，三个系统之间要能互相追溯。

三个 CLI 工具（`dws`、`stripe`、`todoist`）都在本地可用，命令格式见 `workspace/cli_reference.md`，团队名册在 `workspace/team_roster.csv`。所有数据和政策文件已经在 workspace 里了。请严格按政策文件里的要求执行，导出产物放 `outputs/`。
