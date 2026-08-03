# 本地状态：泰国站 3C 配件双十一多平台定价与库存分配

## 输入文件

- `product_catalog.csv`：6 个 SKU 的基本信息（成本、重量、品类）。
- `platform_fees.json`：三个平台的佣金率、交易费、物流补贴和 Flash Sale 附加费。
- `logistics_costs.csv`：跨境物流分重量阶梯报价（标准/快递），本地仓物流成本。
- `warehouse_inventory.json`：两个仓库的库存量、分配上限、泰国本地仓的关税/VAT/仓储附加费率和落地成本公式。
- `sales_velocity.csv`：各 SKU 在各平台的近 30 天日均销量和趋势。
- `promotion_rules.json`：促销规则（三档折扣率、地板价检查、预算上限、分配公式）。
- `competitor_ceiling.csv`：各 SKU 各平台的竞品天花板价。
- `promotion_brief.md`：运营 Brief（背景、仓储架构、决策偏好）。

## 核算口径

- 汇率：1 CNY = 4.80 THB（固定报价汇率）。
- 跨境仓落地成本 = (产品成本 + 跨境运费) × 汇率。跨境运费按 `cross_border_standard` 渠道、对应重量阶梯取值。
- 泰国本地仓落地成本 = (产品成本 × 汇率) × (1 + 关税率) × (1 + VAT率) × (1 + 仓储附加费率) + 本地处理费。
- 常规价 = 落地成本 / (1 - 平台费率 - 目标毛利率)。
- 平台费率 = 佣金率 + 交易费率（Flash Sale 时额外加 flash_sale_extra_fee）。
- 促销价 = 常规价 × (1 - 折扣率)。
- 地板价检查：促销价 × (1 - 含附加费率的总平台费) ≥ 落地成本 × (1 + 地板毛利率)。
- 每个 SKU 选择落地成本更低的仓库作为最优来源；如最优仓库不够则从另一仓库补充。
- 分配量 = ceil(日均销量 × 促销天数 × 安全系数)。

## 最终输出

- `outputs/pricing_matrix.csv`
- `outputs/inventory_allocation.csv`
- `outputs/promotion_plan.json`
- `outputs/campaign_report.md`
