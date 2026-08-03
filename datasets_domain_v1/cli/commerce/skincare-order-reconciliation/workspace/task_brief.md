# LuminaCare 2026年6月 月度对账任务

## 背景

你是 LuminaCare（露美蔻）品牌的运营数据分析师。LuminaCare 是一个国产护肤品品牌，目前在天猫、京东、拼多多三个平台开设旗舰店，共销售 5 款核心产品。

每月初需要对上月的订单数据进行对账，包括：
- 统一各平台订单数据格式
- 核对仓库发货记录
- 核对财务结算金额
- 计算各 SKU 的利润表现
- 核对库存变动

## 本月数据

### 数据文件清单

| 文件 | 位置 | 说明 |
|------|------|------|
| 天猫订单 | `platform_exports/tmall_orders_202506.csv` | 30 条记录，中文表头，日期格式 yyyy-mm-dd HH:MM:SS |
| 京东订单 | `platform_exports/jd_orders_202506.csv` | 25 条记录，英文表头，日期格式 mm/dd/yyyy |
| 拼多多订单 | `platform_exports/pdd_orders_202506.csv` | 22 条记录（含重复），中文商品名，日期格式 yyyymmdd，状态为数字编码 |
| 发货记录 | `warehouse/shipment_log.csv` | 仓库发货流水 |
| 期初库存 | `warehouse/inventory_20260601.csv` | 6月1日期初盘点 |
| 入库记录 | `warehouse/inbound_receipts.csv` | 6月采购入库 |
| 期末库存 | `warehouse/inventory_20260630.csv` | 6月30日期末盘点 |
| 佣金费率 | `finance/commission_rates.csv` | 各平台标称费率 |
| 结算汇总 | `finance/settlements_summary.csv` | 各平台实际结算金额 |
| SKU主数据 | `reference/sku_master.csv` | 内部编码、平台编码映射、成本价 |
| 业务规则 | `reference/business_rules.md` | 对账规则、异常判定标准、特殊情况说明 |

### 注意事项

1. 三个平台的订单数据格式**完全不同**（表头、日期、状态编码），需参照业务规则统一标准化
2. 平台导出中可能存在重复行、历史编码、费率口径差异或结算时间差，需按业务规则处理并在异常报告中说明

## 交付要求

在 `outputs/` 目录下生成以下 4 个文件：

1. **`outputs/unified_orders.csv`** — 标准化合并订单表
2. **`outputs/exceptions.json`** — 异常报告（履约异常 + 结算差异 + 数据质量问题）
3. **`outputs/sku_performance.csv`** — 按 SKU × 平台的利润分析表
4. **`outputs/monthly_summary.json`** — 月度经营概览

各文件的具体格式和字段要求详见 `task.md`。
