NorthBridge Accessories（消费电子配件品牌，从代工厂采购）的 Supplier Quality 团队把每一份供应商质量缺陷报告都登记成 Jira 工单，放在 `PROJ`（"Supplier Quality"）项目里。一批新报告刚落到 **To Do** 列没分诊，需要把这个 backlog 做完 triage、查重并排进下一个 delivery cycle，让对应 owner 开始干。

操作环境装好了 **Jira CLI**，已经配置好 `PROJ` 项目（直接跑 `jira`，不需要 `jira init`），用法和真实 `jira` CLI 一样。`jira --help`（以及 `jira <command> --help`）看可用命令，常会用到：

- `jira issue list` —— 列 backlog（加 `--raw` 拿包含 description 的完整 JSON）
- `jira issue view <KEY>` —— 看一条工单的完整内容
- `jira issue edit <KEY>` —— `--priority` / `--component` / `--label`
- `jira issue assign <KEY> <assignee>` —— 指派负责人
- `jira issue link <INWARD> <OUTWARD> <TYPE>` —— 关联两条工单
- `jira issue move <KEY> <STATE>` —— 状态流转

没有外网，Jira 里的 `PROJ` 项目和 `workspace/` 下的文件就是全部的事实来源。

triage 规则——怎么定 priority、怎么挑 component 和 assignee、duplicate 怎么处理、下一个 cycle 怎么选——都写在 `workspace/triage_policy.md` 里，**动手前认真读一遍**。`workspace/component_owners.csv` 是 policy 里引用的 component → owner 映射表。

按 policy 把 `PROJ` 当前 **To Do** 列里的每一条工单都做完 triage。大致流程：

1. 读每条 description（里面写了 SKU、严重程度、影响数量、合规状态、缺陷症状、root cause、story point 估算，少数还有 "Blocked by" 行）。`jira issue list --raw` 一次能拿到所有 description。
2. 按 policy 给每条设 **priority** / **component** / **assignee**。
3. 按 policy 识别 **duplicate**，每对按 policy 规定的方向 link 并关闭 duplicate，保留 canonical。注意有些工单长得像但**不是** duplicate。
4. 按 policy 的容量和阻塞规则选出该排进 **Cycle 7** 的工单，打 cycle-7 标签。

所有 triage 结果直接落在 Jira 工单上，没有单独的报告文件。Jira 是 stateful 系统，用 CLI 输出的 issue key 串后续动作；中途出错 resume 时先看现状再续，不要重复 link 或 label。
