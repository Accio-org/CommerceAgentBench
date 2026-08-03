VoltGrid Energy 通过 Stripe 卖商用 EV 充电桩订阅。一个 junior dev 上周搭了 billing 基础设施但出了好几处错——finance 团队跑了 audit 把不一致都记下来了。请检查当前 Stripe 状态，按 audit 把每一处问题修掉，让账户回到 spec 一致。

操作环境装好了 **Stripe CLI**（已认证好）。账户里已经有上一轮搭的 product、price、customer、subscription、coupon、charge——有的对、有的错。先用 `stripe products list` / `stripe customers list` / `stripe prices list` / `stripe subscriptions list` / `stripe coupons list` / `stripe charges list` / `stripe webhook_endpoints list` 查现状。

audit 结果和正确 spec 都在 `workspace/audit_report.md` 里——它告诉你**应该**是什么样，你要自己决定**用哪些 CLI 命令**修到那样。几条操作约束：

- 已经对的对象**不要**删了重建，只修坏的。
- 修字段用 `stripe <resource> update <id>`。
- 缺的对象才用 `stripe <resource> create`。
- 只在 audit 明确说要删时才 `stripe <resource> delete <id> -c`。
- 修完后最终状态要和 audit spec **完全一致**。
