我是"好居家旗舰店"的广告投放专员。这周店铺日均广告花费已经逼近预算上限，老板让我对当前在投的 20 个关键词做一次全面诊断——识别无效流量、核算真实 ROI、优化出价方案，确保在日预算内把产出做到最大。

输入都在 `workspace/` 下，是离线任务，不需要外部网络，也别改写输入目录里的原始文件。`keyword_performance.csv` 是这 20 个关键词近 7 天的投放数据；`customer_ltv.csv` 是部分关键词对应客群的 LTV 系数表；`competitor_intel.csv` 是竞品出价情报；`account_config.json` 是账户配置（预算、出价上下限等）；`state_manifest.md` 是场景背景说明。最关键的是 `ad_rules.md`——完整的诊断与出价优化规则手册，每一条规则都要读，并严格按规则一步步执行。

请在 `outputs/` 下生成以下 3 个文件。

`keyword_diagnosis.csv`：对 20 个关键词逐一诊断，包含以下字段：

- `keyword_id`：关键词编号
- `ad_group`：所属广告组
- `keyword`：关键词文本
- `match_type`：匹配方式
- `impressions_7d`：7天展现量
- `clicks_7d`：7天点击量
- `ctr`：点击率（保留4位小数，如 0.0800）
- `cost_7d`：7天花费
- `conversions_7d`：7天转化数
- `revenue_7d`：7天收入
- `raw_roi`：原始 ROI（revenue/cost，保留4位小数）
- `ltv_multiplier`：LTV系数（无则填 1.0）
- `adjusted_revenue`：调整后收入
- `adjusted_roi`：调整后 ROI（保留4位小数）
- `diagnosis`：诊断结论代码（见规则文档）
- `action`：操作动作代码（increase/keep/decrease/pause/brand_protect/excluded/insufficient）
- `pre_scale_bid`：缩放前出价
- `final_bid`：最终出价（缩放后）
- `projected_daily_cost`：预估日花费（最终出价 × 日均点击）
- `competitor_avg_bid`：竞品均价（无有效数据填空）
- `competitor_warning`：竞品预警（true/false）

`bid_plan.csv`：仅包含最终出价 > 0 的关键词（排除已暂停和已排除的），按 `final_bid` 降序排列，包含以下字段：

- `keyword_id`：关键词编号
- `keyword`：关键词文本
- `ad_group`：所属广告组
- `current_bid`：当前出价
- `final_bid`：优化后出价
- `bid_change`：出价变动额（final_bid - current_bid，保留2位小数）
- `bid_change_pct`：出价变动百分比（保留1位小数，如 -20.5）
- `projected_daily_cost`：预估日花费
- `action`：操作动作

`optimization_summary.json`：汇总统计，结构如下：

```json
{
  "total_keywords": 0,
  "anomaly_excluded": 0,
  "insufficient_data": 0,
  "paused": 0,
  "brand_protected": 0,
  "ltv_adjusted": 0,
  "active_keywords": 0,
  "budget_status": {
    "daily_budget_cap": 0,
    "projected_before_scale": 0,
    "exceeded": false,
    "scale_factor": 1,
    "projected_after_scale": 0
  },
  "action_distribution": {
    "increase": 0,
    "keep": 0,
    "decrease": 0,
    "pause": 0,
    "brand_protect": 0,
    "excluded": 0,
    "insufficient": 0
  },
  "group_performance": {
    "AG01_家居收纳": {
      "active_count": 0,
      "projected_daily_cost": 0,
      "avg_roi": 0
    },
    "AG02_厨房用品": {
      "active_count": 0,
      "projected_daily_cost": 0,
      "avg_roi": 0
    },
    "AG03_浴室配件": {
      "active_count": 0,
      "projected_daily_cost": 0,
      "avg_roi": 0
    }
  },
  "competitor_warnings": [
    "keyword warning text"
  ],
  "top3_roi_keywords": [],
  "optimization_savings_pct": 0
}
```

精度要求：所有金额保留 2 位小数，ROI 保留 4 位小数，CTR 保留 4 位小数，百分比变动保留 1 位小数，scale_factor 保留 4 位小数。
