我们刚拿到一批新的海关出口贸易数据（在 `workspace/customs_data/` 下面），需要按公司的分级审批政策把合格供应商路由到对应的审批流程里去。

审批政策的完整 SOP 在 `workspace/approval_policy.md`，请严格按里面的规则来——不同级别的供应商走完全不同的系统配置，多做少做都算合规违规。涉及的系统有 GWS（审批跟踪表和演示文稿）、Stripe（财务记录）和 Box（文档管理），CLI 用法可以参考 `workspace/cli_reference.md`。合同模板在 `workspace/contract_template.md`，高管联系人在 `workspace/executive_contacts.csv`。

请把所有 CSV 数据汇总分析后，按政策完成全部供应商的审批路由配置。
