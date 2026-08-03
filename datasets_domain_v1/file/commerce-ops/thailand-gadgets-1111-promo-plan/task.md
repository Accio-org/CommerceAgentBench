帮泰国市场的跨境电商卖家做一份 11.11 大促方案：在 Shopee Thailand、Lazada Thailand、TikTok Shop Thailand 三个平台上，对 6 个 3C 配件 SKU 做统一定价、促销层级选择和库存分配。完全离线作业——不要访问网页、不调用外部 API、不用实时汇率或物流报价，只用 `workspace/` 下的输入文件，也别改写这些输入。

输入都在 `workspace/` 下：`product_catalog.csv`、`platform_fees.json`、`logistics_costs.csv`、`warehouse_inventory.json`、`sales_velocity.csv`、`promotion_rules.json`、`competitor_ceiling.csv`，外加 `promotion_brief.md`（促销说明）和 `state_manifest.md`（场景背景）。最终四份产物写到 `outputs/` 下。

计算分五步走：

### Part 1：落地成本与仓库选择

1. 对每个 SKU 分别计算 **两个仓库** 的落地成本（THB）：
   - **跨境仓 (cn_warehouse)**：`landed_cost_thb = (cost_cny + cross_border_standard_shipping_cny) × exchange_rate`。运费按 `logistics_costs.csv` 中 `cross_border_standard` 渠道的重量阶梯取值。
   - **泰国本地仓 (th_warehouse)**：`landed_cost_thb = (cost_cny × exchange_rate) × (1 + import_duty_rate) × (1 + vat_rate) × (1 + warehousing_surcharge_rate) + local_handling_thb`。各费率见 `warehouse_inventory.json`。
2. 对每个 SKU 选择落地成本更低的仓库作为 **最优来源 (optimal_source)**。

### Part 2：定价矩阵（18 行）

3. 对每个 SKU × 平台组合（6 × 3 = 18 行），计算：
   - `platform_fee_rate` = commission_rate + transaction_fee（见 `platform_fees.json`）。
   - `regular_price_thb` = `landed_cost_thb / (1 - platform_fee_rate - target_margin_rate)`。
   - 如果 `regular_price_thb > competitor_ceiling_thb`，则 `final_regular_price_thb = competitor_ceiling_thb`（封顶）；否则 `final_regular_price_thb = regular_price_thb`。
4. 对每行计算三种促销价（基于 `final_regular_price_thb`）：
   - `flash_sale_price_thb` = `final_regular × (1 - 0.15)`
   - `voucher_price_thb` = `final_regular × (1 - 0.10)`
   - `normal_promo_price_thb` = `final_regular × (1 - 0.05)`
5. 对每行做 **地板价检查**（floor_price_check）：
   - Flash Sale：`flash_price × (1 - platform_fee_rate - flash_sale_extra_fee) ≥ landed_cost × (1 + floor_margin_rate)`
   - Platform Voucher：`voucher_price × (1 - platform_fee_rate) ≥ landed_cost × (1 + floor_margin_rate)`
   - Normal Promo：`normal_price × (1 - platform_fee_rate) ≥ landed_cost × (1 + floor_margin_rate)`
6. 确定 **最佳促销层级 (best_promo_tier)**：
   - Flash Sale 需同时满足：① 日均销量 ≥ `min_flash_sale_velocity`（20）② floor check 通过。
   - 如不满足 Flash Sale，检查 Platform Voucher floor check。
   - 如不满足 Voucher，检查 Normal Promo floor check。
   - 如全部不满足，`best_promo_tier = "none"`，价格 = `final_regular_price_thb`。

### Part 3：库存分配

7. 对每个 SKU × 平台：
   - `required_units = ceil(daily_velocity × promo_period_days × safety_buffer_multiplier)`（7 天 × 1.3）。
   - 如果 `required_units < 50`，跳过该组合（标记 skipped）。
   - 从最优仓库优先分配，受上限约束：单个 SKU 从单个仓库的总分配量（跨所有平台）不得超过该仓库该 SKU 库存 × `max_allocation_pct`（70%）。
   - 最优仓库不够时，从另一仓库补充（同样受 70% 上限约束）。
   - **跨平台分配顺序**：当一个 SKU 的目标库存超过单仓上限时，按平台 CSV 中的行顺序依次分配（shopee → lazada → tiktok），不要按速度或销量排序。
8. 计算每行 `allocation_cost_thb`：各仓库分配量 × 对应仓库落地成本之和。

### Part 4：预算约束

9. 汇总所有非跳过组合的 `allocation_cost_thb`。如超过 **800,000 THB**，按照 **有效促销毛利率** 从低到高逐个移除整行组合，直至总成本 ≤ 预算。
   - 有效促销毛利率 = `(best_promo_price × (1 - tier_total_fee) - row_landed_cost) / best_promo_price`。
   - `row_landed_cost` 使用定价矩阵中的 `landed_cost_thb`（即最优仓库的单位落地成本）。
   - Flash Sale 的 tier_total_fee = `platform_fee_rate + flash_sale_extra_fee`；其他层级 = `platform_fee_rate`。
   - 被移除的组合标记为 `skipped = true, skip_reason = "removed_for_budget"`。

### Part 5：Flash Sale 名额分配

10. 每个平台最多 4 个 Flash Sale 名额。优先级：TikTok > Shopee > Lazada。
11. 在每个平台中，选取 `best_promo_tier == "flash_sale"` 且未被 skipped 的 SKU，按日均销量降序排列，取前 4 个。

需要写出四份文件。

**`outputs/pricing_matrix.csv`** —— 定价矩阵，**18 行 + 1 表头 = 19 行**，6 SKU × 3 平台。表头必须**包含**这些字段（顺序与额外列允许）：`sku_id` / `platform` / `category`；`source_warehouse`（enum：`cn_warehouse` / `th_warehouse`）；`landed_cost_thb` / `platform_fee_rate`；`regular_price_thb` / `final_regular_price_thb`；`flash_sale_price_thb` / `voucher_price_thb` / `normal_promo_price_thb`；`competitor_ceiling_thb`；`flash_eligible`（boolean）/ `flash_floor_ok`（boolean）/ `voucher_floor_ok`（boolean）/ `normal_floor_ok`（boolean）；`best_promo_tier`（enum：`flash_sale` / `platform_voucher` / `normal_promo` / `none`）；`best_promo_price_thb`。金额字段保留 2 位小数、容差 ±1.0 THB；费率字段保留 4 位小数；boolean 字段用 `true`/`false`（不区分大小写）。

**`outputs/inventory_allocation.csv`** —— 库存分配表，**18 行 + 1 表头 = 19 行**（含 skipped 的行）。表头必须包含：`sku_id` / `platform`；`daily_velocity` / `required_units`；`optimal_source`；`th_warehouse_alloc` / `cn_warehouse_alloc` / `total_alloc`；`allocation_cost_thb`；`skipped`（boolean）/ `skip_reason`。`allocation_cost_thb` 容差 ±10.0 THB；被 skipped 的行 alloc 字段均为 0、cost 为 0。

**`outputs/promotion_plan.json`** —— 结构化促销计划，exact shape：

```json
{
  "campaign_name": "11.11 Big Sale 2026",
  "promo_period_days": 7,
  "exchange_rate": 4.80,
  "flash_sale_assignments": {
    "shopee_th": ["<sku_id>", ...],
    "lazada_th": ["<sku_id>", ...],
    "tiktok_th": ["<sku_id>", ...]
  },
  "budget_summary": {
    "budget_cap_thb": 800000,
    "total_allocation_cost_thb": <number>,
    "within_budget": <boolean>,
    "active_combo_count": <integer>,
    "removed_combos": ["<sku_id/platform>", ...]
  },
  "tier_summary": {
    "flash_sale_count": <integer>,
    "platform_voucher_count": <integer>,
    "normal_promo_count": <integer>,
    "none_count": <integer>
  },
  "warnings": ["<string: 风险提示或注意事项>"]
}
```

`warnings` 至少 2 条（如预算紧张、某平台无 Flash Sale 等）；`removed_combos` 格式为 `"SKU_ID/platform"`，如 `"A01/tiktok_th"`。

**`outputs/campaign_report.md`** —— 人类可读的报价说明，涵盖定价逻辑、仓库选择依据、Flash Sale 分配原因、预算分析和风险提示。无字数要求，但以上几个方面都要写到。
