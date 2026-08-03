# 搜索广告诊断与出价优化规则手册

数据截止日期：2026-05-20

## 第一节：异常流量识别

对每个关键词计算点击率 CTR = clicks_7d / impressions_7d。

**规则 1.1**：若 CTR > 10%（即 0.10），判定为"疑似无效流量"，诊断代码为 `anomaly_invalid_traffic`，操作动作为 `excluded`，最终出价设为 0。

被排除的关键词不参与后续任何计算（ROI、预算缩放等）。

## 第二节：数据充分性判断

**规则 2.1**：若 impressions_7d < 500，判定为"数据不足"，诊断代码为 `insufficient_data`，操作动作为 `insufficient`，保持当前出价不变（pre_scale_bid = current_bid）。

数据不足的关键词参与预算缩放。

## 第三节：LTV 收入调整

对通过前两步筛选的关键词（非异常、非数据不足），查询 `customer_ltv.csv`：

**规则 3.1**：若该关键词在 LTV 表中存在且 ltv_multiplier > 1.0，则：
- `adjusted_revenue = revenue_7d × ltv_multiplier`
- 使用 adjusted_revenue 计算 ROI

**规则 3.2**：若该关键词不在 LTV 表中，或 ltv_multiplier = 1.0，则：
- `adjusted_revenue = revenue_7d`（不调整）

**注意**：LTV 表中可能包含不属于本账户的关键词条目，应忽略。

## 第四节：ROI 计算与出价策略

**规则 4.1**：ROI = adjusted_revenue / cost_7d

**规则 4.2**：根据 ROI 确定操作动作和出价调整：

| ROI 范围 | 诊断代码 | 操作动作 | 出价调整 |
|----------|----------|----------|----------|
| ROI ≥ 3.0 | `high_roi` | `increase` | current_bid × 1.25 |
| 2.0 ≤ ROI < 3.0 | `healthy_roi` | `keep` | current_bid（不变） |
| 1.0 ≤ ROI < 2.0 | `low_roi` | `decrease` | current_bid × 0.80 |
| ROI < 1.0 | `negative_roi` | `pause` | 0（暂停投放） |

**规则 4.3（边界值）**：ROI = 3.0 属于"≥ 3.0"档；ROI = 2.0 属于"≥ 2.0"档；ROI = 1.0 属于"≥ 1.0"档。

**规则 4.4（出价上限）**：调整后出价不得超过 max_bid（见 account_config.json）。超出则设为 max_bid。

**规则 4.5（出价精度）**：出价金额保留 2 位小数（四舍五入）。

## 第五节：品牌词保护

**规则 5.1**：match_type = "brand" 的关键词无论 ROI 如何，**永远不暂停**。

**规则 5.2**：品牌词 ROI < 1.0 时，诊断代码为 `brand_low_roi`，操作动作为 `brand_protect`，出价设为 brand_min_bid（见 account_config.json）。

**规则 5.3**：品牌词 ROI ≥ 1.0 时，按正常规则处理（increase/keep/decrease），但最终出价不低于 brand_min_bid。

## 第六节：预算缩放

**规则 6.1**：计算所有活跃关键词（final_bid > 0）的预估日花费：
- `projected_daily_cost = pre_scale_bid × daily_avg_clicks`
- `daily_avg_clicks = clicks_7d / 7`

**规则 6.2**：若所有活跃关键词的 projected_daily_cost 之和 > daily_budget_cap：
1. 首先固定品牌词出价为 brand_min_bid（若品牌词动作为 brand_protect），计算其固定花费
2. 可用预算 = daily_budget_cap - 品牌词固定花费
3. 非品牌词活跃关键词预估日花费之和 = remaining_projected
4. scale_factor = 可用预算 / remaining_projected
5. 对所有非品牌活跃关键词：final_bid = pre_scale_bid × scale_factor（保留2位小数）

**规则 6.3**：缩放后如有关键词 final_bid < min_bid，将其设为 min_bid，重新计算 scale_factor（迭代至稳定）。

**规则 6.4**：scale_factor 保留 4 位小数。

**规则 6.5**：若预估日花费之和 ≤ daily_budget_cap，则无需缩放，final_bid = pre_scale_bid。

## 第七节：竞品数据使用

**规则 7.1**：仅采用 reference_date 在数据截止日（2026-05-20）前 7 天内（含当天，即 2026-05-14 至 2026-05-20）的竞品条目。超出范围的标记为过期，不予使用。

**规则 7.2**：竞品数据**不影响出价计算**，仅用于生成竞品预警。

**规则 7.3**：竞品预警条件——对于有有效竞品数据的关键词，若 final_bid > competitor_avg_bid × 2，则 competitor_warning = true，并在 optimization_summary.json 的 warnings 中记录。

## 第八节：汇总指标计算

**规则 8.1**：`optimization_savings_pct = (1 - projected_after_scale / original_daily_cost) × 100`
- `original_daily_cost` = 所有非异常关键词（包含 insufficient、paused、brand 等）的 cost_7d 之和 / 7
- 保留 1 位小数

**规则 8.2**：`avg_roi`（每组）= 该组内所有活跃关键词（excluded 和 paused 除外）的 adjusted_roi 算术平均值，保留 3 位小数。

**规则 8.3**：`top3_roi_keywords` = 所有活跃关键词中 adjusted_roi 最高的前 3 个，按降序排列。

## 第九节：输出格式

- CSV 使用 UTF-8 编码，逗号分隔
- JSON 使用 UTF-8 编码，2 空格缩进
- 数值类型字段不加引号
- 空值用空字符串表示（CSV）或 null（JSON）
