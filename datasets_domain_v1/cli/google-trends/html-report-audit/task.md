我是 senior analyst，要在初级同事的 HTML sourcing dashboard 报送 VP 之前 review 一遍。这份 brief 在 drill / earbuds / coffee / speaker / vacuum / mattress 六个 commerce 品类的 Google Trends 数据上做了好多定量结论——**有一些是错的**。请把每条错的 claim 都找出来，按错误类型分类、定位到 HTML 的具体 section，并给出正确值。

报告放在 `workspace/analyst_report.html`，是一份多 section 的 HTML dashboard，结构上像真实分析报告：内嵌表格、可折叠 `<details>`、两张内嵌图表（`workspace/charts/*.png`）、底部 `<aside id="appendix">` 附录表、还有用 `<a href="#…">` 链到 appendix 详条的脚注 marker。有些 section 把原始周度数据放在 `<script type="application/json" id="…">…</script>` 里（机器可读，section 里的可见文本理应是从 JSON 推出来的）。要审得到位，可能要结构化解析 HTML、**打开内嵌 PNG 图看里面的柱子**、解 JSON 块、追脚注和附录。

trend snapshot 真值大部分品类可以从 `http://127.0.0.1:4500/api` 拿到（用 `/api/help` 和 `/api/datasets` 自发现，过滤器有 `type` / `channel` / `date_range` / query list）——和初级同事本应该用的是同一份。**例外**：earbuds 和 mattress 两个品类的原始数据 API 没暴露（`/api/datasets` 不会列 `set_earbuds*` / `set_mattress*`），针对这两个品类的任何排名 claim，唯一真值是 `workspace/charts/earbuds_leaderboard.png` 和 `workspace/charts/mattress_leaderboard.png`，靠眼睛读柱子和标签来核。

错误类型 5 类：

| `error_type` | 含义 |
|---|---|
| `arithmetic_error` | 某个具体数字算错（偏差超出 rounding 解释范围） |
| `channel_confusion` | claim 写的是 shopping channel 但展示的值实际匹配 web channel，或反之 |
| `rank_error` | 品牌排名错（#1 错、顺序错、leader 错） |
| `regional_count_error` | 关于某个品牌领先多少个 region/state 的 claim 错 |
| `partial_data_unfiltered` | 计算的聚合值把本该过滤掉的 `partial_data:true` 周也算了进去 |

每条 error 只对应 HTML 中一个 `section`（HTML section 都有 `id` 属性，原样使用）。

**别把可疑当错**：有些看起来怪的 claim 在你把 HTML、内嵌数据、附录、图表对完之后其实是对的。`findings` 只放你**能支持是真错**的 claim，过报和漏报都不要。

把结果写到 `outputs/audit_findings.json`：

```json
{
  "findings": [
    {
      "finding_id": 1,
      "error_type": "<上面 5 个 enum 之一>",
      "section_id": "<section 的 id 属性，例如 'exec-summary'>",
      "claim_excerpt": "<从 HTML 里抄一小段，标识这条错 claim 是哪一句，便于追溯>",
      "correct_value": "<类型见下>"
    },
    {"finding_id": 2, "...": "..."}
  ]
}
```

每条 `correct_value` 的类型取决于 error_type：

- `arithmetic_error` / `regional_count_error` / `partial_data_unfiltered` / `channel_confusion`：数字（正确数值）
- `rank_error`：字符串（正确的品牌名，原样、小写）

`finding_id` 是信息性的（任意唯一整数）。`error_type` 和 `section_id` 一起把这条审到的 claim 清楚定位即可。
