Pricing 团队敲定了 Q3 rate card，需要在 Stripe 里把对应的 billing 基础设施完整搭起来——product / price / customer / subscription / coupon / setup charge 一套都要，最后把算出来的价格矩阵写到 `outputs/price_matrix.json`。

操作环境装好了 **Stripe CLI**（已认证好）。`workspace/` 下三份资料：

- `base_rates.csv` —— 每个 product 的基准月费 USD。
- `regional_rules.md` —— 完整的 spec：6 个 region 的 multiplier、价格四舍五入和换算成 cents 的规则、Stripe 里 product 命名约定、每个 region 预分配的 customer、subscription / coupon / setup charge 怎么建、以及 output JSON 结构。**动手前认真读它，每节都用得到**。
- `overrides.json` —— 例外条目，按 spec 在标准 subscription 都建完之后再处理。

两个特别要注意的点：

- **APAC region 在 hold**：spec 里说 APAC 的 multiplier 还在 legal review，**不要**给 APAC 建任何 product 或 price，但 APAC 的 customer 记录还是要建（CRM sync 要用）。
- override 不替换原 subscription，是在原 subscription 之外**新增**一条用 override 价的 subscription，两条并行。
