我想在 Amazon US 上线 3 款差异化的耳机 SKU，避开已经卷成血海的入耳式主流段。帮我从当前 Amazon US 市场数据里挑出 3 个 ASIN，写一份简短的 sourcing brief：解释为什么选这 3 个，以及哪些看起来诱人但被你筛掉了。

我们这边已经接好的 Amazon US 数据 API base URL 是 `http://127.0.0.1:4500/api`。从 `GET /api/help` 开始探索，每个端点都有自己的 `/help` 子路由说明参数和返回格式，把它当一个陌生的第三方 SDK 摸清楚就行。注意 search 列表和 product detail 是两套后端——search 的 review 数会做聚合和取整，detail 返回的是精确整数，所以 `rating` 和 `reviews` 一律以 detail 端点的 `product_details.rating` / `product_details.reviews` 为准。

入选的每个 ASIN 都要满足：价格在 $30–$80 之间、评分 ≥ 4.0、review 数 ≥ 1000。并且 3 个 ASIN 必须分属不同的 subcategory，从 `bone_conduction` / `open_ear` / `clip_on` / `in_ear` / `over_ear` 五类里挑——每个 ASIN 的 subcategory 自己从 product detail 的 `item_specifications` / `product_details` 里推断（看 `audio_driver_type` / `earpiece_shape` / `ear_placement` / `form_factor` 这几个字段）。

我们团队内部用这套打分公式给候选排序：`opportunity = log10(max(reviews, 1)) × rating × (80 - price) / 50`，3 个 ASIN 的 opportunity 加起来就是这次的 `portfolio_score`。在所有满足上面硬约束、subcategory 互异的组合里，挑那个让 portfolio_score 最大的。

把结果写成**一个文件** `outputs/sourcing_decision.json`，字段名严格按下面这个 schema（这是和后续审批流对接用的，名字不能改）：

```json
{
  "selected_asins": ["B0XXXXXXXX", "B0YYYYYYYY", "B0ZZZZZZZZ"],
  "rationale": [
    {
      "asin": "B0XXXXXXXX",
      "subcategory": "bone_conduction",
      "brand": "SHOKZ",
      "price": 54.95,
      "rating": 4.4,
      "reviews": 23316,
      "opportunity_score": 9.6276,
      "selection_reason": "两三句话的具体买手理由——电池续航、耐用度、差异化、评论主题之类的具体属性。"
    },
    { "asin": "B0YYYYYYYY", "subcategory": "open_ear", "...": "..." },
    { "asin": "B0ZZZZZZZZ", "subcategory": "clip_on",  "...": "..." }
  ],
  "portfolio_score": 28.8345,
  "portfolio_avg_rating": 4.4,
  "portfolio_total_reviews": 70549,
  "excluded_candidates": [
    {
      "asin": "B0AAAAAAAA",
      "reason_code": "PRICE_OUT_OF_RANGE",
      "brief": "为什么这条 candidate 不符合要求。"
    },
    {
      "asin": "B0BBBBBBBB",
      "reason_code": "OPPORTUNITY_SCORE_LOWER",
      "brief": "为什么这条看起来合理但没被选中。"
    },
    { "...": "..." }
  ]
}
```

`rationale` 的顺序要和 `selected_asins` 对齐；里面的 `brand` / `price` / `rating` / `reviews` 用 API 返回的真值，`opportunity_score` 按上面那个公式算。`excluded_candidates` 至少给 3 条你认真考虑过又筛掉的候选，每条的 `reason_code` 只能是 `PRICE_OUT_OF_RANGE` / `RATING_BELOW_FLOOR` / `REVIEWS_INSUFFICIENT` / `OPPORTUNITY_SCORE_LOWER` / `SUBCATEGORY_DUPLICATE` / `MISSING_DETAIL` 之一。`outputs/` 下只放这一个文件。
