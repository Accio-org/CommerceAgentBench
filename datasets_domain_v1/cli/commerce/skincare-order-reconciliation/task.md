我是 LuminaCare（露美蔻）的运营数据分析师，品牌在天猫、京东、拼多多三个平台开旗舰店，卖 5 款核心护肤品。月初要做 6 月份的月度对账，所有数据已经导到 `workspace/` 下了。先看 `workspace/task_brief.md` 了解数据文件清单和整体工作，对账业务规则（状态映射、历史编码、佣金口径、结算时间差、异常判定）写在 `workspace/reference/business_rules.md` 里，动手前认真读一遍。

把对账结果写到 `outputs/` 下 4 个文件：

### `outputs/unified_orders.csv`

三个平台的订单数据标准化合并成一张表，列严格按这个顺序：

```
order_id,platform,internal_sku,product_name,qty,paid_amount,order_date,status
```

- `platform` 取值 `tmall` / `jd` / `pdd`
- `internal_sku` 通过 `reference/sku_master.csv` 映射，天猫的遗留编码按 `business_rules.md` 第 1.3 节的历史编码对照表处理
- `product_name` 用 `sku_master.csv` 的 `product_name`
- `order_date` 统一为 `yyyy-mm-dd`
- `status` 统一为英文 `completed` / `cancelled` / `refunded` / `pending` / `paid` / `shipped`，映射见 `business_rules.md`
- 拼多多的数据先按 `trade_id` 去重
- `paid_amount` 保留 2 位小数
- 不要表头

### `outputs/exceptions.json`

异常报告，三个部分：

```json
{
  "fulfillment_exceptions": [...],
  "settlement_discrepancies": [...],
  "data_quality_issues": [...]
}
```

**fulfillment_exceptions**：只检查状态 `completed` 的订单，把 `qty` 和 `shipment_log.csv` 里对应 `platform_order_id` 的 `qty_shipped` 合计比对。每条：

- `order_id` / `platform`
- `type`: `unshipped`（无发货记录）/ `partial`（发货量 < 订购量）/ `over_shipped`（发货量 > 订购量）
- `ordered_qty` / `shipped_qty`

**settlement_discrepancies**：把按 `business_rules.md` 实际费率算出来的预期结算金额（已完成订单总额 - 佣金）和 `settlements_summary.csv` 的实际结算金额比对。只输出有非零差异或需要业务说明的平台，差异为 0 的平台不要凑数。每条：

- `platform`
- `expected_settlement`：字符串，2 位小数
- `actual_settlement`：字符串，2 位小数
- `difference`：字符串，带正负号、2 位小数（例 `"+234.60"`）

**data_quality_issues**：处理过程中发现的数据质量问题。重复订单：`{"type": "duplicate_order", "order_ids": [...], "resolution": "deduplicated"}`；遗留编码：`{"type": "legacy_sku", "order_id": "...", "old_sku": "...", "new_sku": "...", "internal_sku": "...", "resolution": "remapped"}`。库存盘点差异可以补充进来，但不强制。

### `outputs/sku_performance.csv`

按 SKU × 平台维度的利润分析表，只统计 `completed` 订单。列严格按这个顺序：

```
internal_sku,product_name,platform,units_sold,gross_revenue,cogs,commission,net_profit,margin_pct
```

- `cogs` = `units_sold` × `cost_price`（`sku_master.csv` 的 `cost_price`）
- `commission` = `gross_revenue` × 实际佣金费率（按 `business_rules.md` 的实际费率，不是标称费率）
- `net_profit` = `gross_revenue` - `cogs` - `commission`
- `margin_pct` = `net_profit` / `gross_revenue` × 100
- 金额保留 2 位小数，利润率保留 1 位小数
- 按 `internal_sku` 升序、`platform` 升序排列

### `outputs/monthly_summary.json`

月度经营概览：

```json
{
  "period": "2026-06",
  "total_orders": 0,
  "completed_orders": ...,
  "cancelled_orders": ...,
  "refunded_orders": ...,
  "total_revenue": "...",
  "total_cogs": "...",
  "total_commission": "...",
  "net_profit": "...",
  "overall_margin_pct": "...",
  "best_sku": {"sku": "...", "net_profit": "..."},
  "worst_sku": {"sku": "...", "net_profit": "..."},
  "platform_breakdown": {
    "tmall": {"orders": ..., "revenue": "...", "commission": "..."},
    "jd":    {"orders": ..., "revenue": "...", "commission": "..."},
    "pdd":   {"orders": ..., "revenue": "...", "commission": "..."}
  },
  "fulfillment_exception_count": ...,
  "settlement_discrepancy_count": ...
}
```

`best_sku` / `worst_sku` 按全平台汇总的 `net_profit` 排；金额字符串 2 位小数、利润率 1 位小数；订单数量字段是整数。

仓库 4 份文件（`warehouse/`）用来辅助理解发货和库存口径，本次不要求单独输出库存对账表。三个平台的原始表头、状态编码、费率口径差异要按 `business_rules.md` 统一处理，不要把标称费率、原始平台状态、未清洗编码直接带进最终分析。
