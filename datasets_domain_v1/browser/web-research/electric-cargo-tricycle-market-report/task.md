为北美 Electric Cargo Tricycle 市场出一份首批选品决策用的多渠道机会报告——一个 Excel、一份决策矩阵 JSON，加上配套的对比表、证据清单和报告说明。手头有一个有点乱的本地研究包，需要你把它清洗成可比较的渠道视图，按 normalization_policy 算归一化得分，给出推荐 / 备选 / 排除项。

主要依据本地研究包；可以打开公开网页核对并截图，但不要登录任何账号。访问不到的页面就写 `未见` 或 `blocked`，不要编造销量、价格、评价。不适合作为 Electric Cargo Tricycle 的记录不要删，要在 normalized_comparison.csv 里标 `exclusion_reason`。最终推荐的记录必须也出现在 Opportunity Matrix 里。

本地研究包：

- `workspace/report_brief.md` — 报告范围
- `workspace/channel_inventory.md` — 渠道接入提示
- `workspace/market_research_dump.json` — 初筛研究记录 + 字段可见性
- `workspace/normalization_policy.json` — 币种 / 单位 / 落地价 / 机会评分口径

渠道范围（固定顺序）：`Alibaba.com` → `Amazon` → `Walmart` → `Brand Sites`

## Deliverables

写入以下文件 (路径相对 `/task/outputs/`):

| 文件 | 内容 |
|---|---|
| `Electric_Cargo_Tricycle_Market_Report.xlsx` | Excel: 6 sheets (4 channel + Normalized Comparison + Opportunity Matrix) |
| `market_report_notes.md` | 数据来源 + 缺失项 + 渠道观察 |
| `evidence_manifest.json` | 渠道 / 来源 / 访问状态 / 字段可见性 / 截图 |
| `normalized_comparison.csv` | 逐条记录的归一化对比 |
| `channel_decision_matrix.json` | 推荐 / 备选 / 排除 / 风险 |
| `evidence/alibaba.png` | Alibaba 访问证据 |
| `evidence/amazon.png` | Amazon 访问证据 |
| `evidence/walmart.png` | Walmart 访问证据 |
| `evidence/brand_site.png` | 品牌独立站访问证据 |

`outputs/` 必须只含上述产物。

### Excel sheet 结构

恰好 6 个 sheet，名称 + 顺序固定：
1. `Alibaba.com` (>=2 行明细)
2. `Amazon` (>=2 行明细)
3. `Walmart` (>=2 行明细)
4. `Brand Sites` (>=2 行明细)
5. `Normalized Comparison` (>=10 行: 涵盖各渠道归一化记录)
6. `Opportunity Matrix` (>=3 行)

各渠道 sheet 列至少包含：`record_id`、`product_name`、`source_url`、`image_link`、`price_raw`、`access_status`、`visible_fields`、`invisible_fields`、`notes`。

### `evidence_manifest.json` schema

```json
{
  "channels": [
    {
      "channel": "Alibaba.com",
      "sources": [{"url": "<>", "accessed_at": "<>", "access_status": "<>"}],
      "access_status": "<string>",
      "invisible_fields": ["<string>"],
      "screenshot": "evidence/alibaba.png",
      "records": [
        {"record_id": "<string from research_dump>", "matched_in_dump": <bool>}
      ]
    },
    ... (顺序固定: Alibaba.com → Amazon → Walmart → Brand Sites)
  ]
}
```

`channels` 长度恰好 4；顺序固定；每个 channel 的 `sources` / `records` 长度 >= 1。

### `normalized_comparison.csv` 列要求

恰好包含以下列 (顺序不限)：
- `record_id`
- `channel`
- `product_name`
- `exclusion_reason` (空字符串表示未排除)
- `payload_lb` (数字或空)
- `motor_w` (数字或空)
- `evidence_confidence` (high/medium/low)
- `opportunity_score` (0-100, 排除项可空)

必须覆盖代表性的可行候选与排除候选，并为每个排除项使用清晰、可复核的 `exclusion_reason`。不要只列最终推荐；也要保留足够证据说明为什么相邻渠道或不合格商品没有入选。

### `channel_decision_matrix.json` 必含字段

```json
{
  "recommended_record_id": "<string>",
  "top_alternatives": [{"record_id": "<>", "channel": "<>", "rationale": "<>"}],
  "excluded_records": [{"record_id": "<>", "reason_code": "<>"}],
  "channel_risks": [{"channel": "<>", "risk": "<>"}]
}
```

JSON 文本应保留推荐记录、主要备选、排除记录和渠道风险的证据来源。

### `market_report_notes.md` 要求

- 至少 500 个字符
- 必须出现：`Alibaba.com`、`Amazon`、`Walmart`、`Brand Sites`、`未见`
