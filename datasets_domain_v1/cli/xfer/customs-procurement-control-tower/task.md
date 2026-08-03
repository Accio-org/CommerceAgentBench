我们采购团队管理三个品类——汽车轴承、工业化工品（淄博出口）、电池，需要把散落在海关出口数据里的供应商信息整合成一个跨系统的管控塔。最终产出分布在三个系统：Google Workspace 做数据仪表板和管理层简报，Box 做供应商文档仓库，Jira 做采购工作流。

所有系统都在本地，通过 CLI 操作：`gws`、`box`、`jira`。海关数据已经在 workspace 里（`workspace/customs_data/` 下 `auto_bearings.csv` / `zibo_us_exports.csv` / `battery_export_002.csv` 三份）。采购政策——供应商筛选规则、分级标准、交付要求、Jira/GWS/Box 各自的目标对象（包括 `sheet-supplier-eval-003`、`pres-launch-101`、`PROJ` 项目下 Epic `Multi-Category Sourcing Q1 2026`、Box 根文件夹 `Procurement Control Tower` 等命名）——都写在 `workspace/sourcing_policy.md`，**动手前认真读一遍**。品类负责人和系统 ID 在 `workspace/procurement_team.csv`，CLI 用法见 `workspace/cli_reference.md`。

请先读取三个 CSV，按 `supplier` 字段在每个品类**内**聚合（同一品类内同名供应商合并，**不**跨品类合并），计算总金额和出货次数。然后按 policy 筛出合格供应商和最终入围名单，**每个品类（auto_bearings / industrial_chemicals / batteries）独立筛选和排名**。最终名单中的每家供应商要同时出现在三个系统中并建立跨系统引用关系——GWS 的 `Sourcing Dashboard` 行要带动态获取的 Jira Task Key 和 Box Folder ID，每条 Jira Task 都要有跨系统追溯评论（GWS 行号 + Box 文件夹 ID）。Jira Task 全部流转到 `In Progress`，按品类负责人分配。

不要修改原始 CSV，不要把同一品类内的多条出货拆成多条记录，不要给探路/测试留下额外 Jira 对象，误建的非业务对象在结束前删掉。三个 CLI 系统的终态就是交付物，不需要写磁盘输出文件。
