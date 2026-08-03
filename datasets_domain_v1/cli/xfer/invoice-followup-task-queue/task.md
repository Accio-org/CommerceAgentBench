Stripe 里有些发票还没付清，帮我把本周真正需要催收的项目整理成一个 Todoist 收款控制台。这个控制台给 AR 同事接手用，所以最终状态要能看出哪些客户需要立即跟进、哪些进入常规跟进、哪些 Tier A 项目已经完成回执确认。

本周只处理 Stripe 中 `status = open` 且 `amount_due >= 30000` 的发票；低于阈值，或 draft / paid / void 状态的发票都不要进入 Todoist 队列。

客户 Tier 和 collections lead 以 Stripe customer description 为准。优先级规则、tier label 和行业 label 口径在本地资料里；请根据资料和 Stripe live state 自己完成推导，最终 Todoist 任务需要保留足够的追踪信息，方便 AR 同事回到 Stripe 核对同一张发票、客户、订阅和 plan/price。

参考资料在 `workspace/`：

- `ar_collections_handbook_2026Q3_v3.xlsx` —— 客户总账、催收规则表、催收负责人花名册。
- `weekly_collections_brief.txt` —— AR 主管周一发的本周提醒。
- `collections_policy.md` —— 判定逻辑、优先级口径。
- `queue_brief.md` —— AR 团队对 Todoist 交接队列的使用习惯和可追踪性要求。

约束：

- Stripe 只读，别动。
- 在 Todoist 新建一个专用 project，名称使用 `Invoice Collections Q3`；不要把本次任务混进 Inbox / Work / Shopping。
- 不要为 out-of-scope 发票创建最终任务，也不要留下重复的催收任务。
- Todoist 队列要区分主动催收、常规跟进和已确认回执，并包含一条已完成的团队交接摘要。
- 每条主动催收任务要有基于对应 Stripe invoice 的 due date；金额使用 Stripe `amount_due` 的原始整数值，不换算单位。
- Tier A 的 in-scope 发票需要有已完成的 acknowledgement 记录；其他 Tier 不需要。
- Todoist 优先级是反着存的（用户看到的 1=urgent 在 API 里存成 4），用 CLI 传值时按用户视角传 1/2/3 就行。
