我同事 Devin 跑了一遍 trend-snapshot 目录的 data-quality sweep，做了一半休息周末了，工作空间留在 `workspace/`。analyst 团队要拿这个 audit 喂他们的 competitive model，今天要终版。请接她的活，把干净的 JSON 交付出来。

先看 `workspace/README.md` 了解 layout。Devin 的 audit 脚本、最后一次跑出的结果、以及她在 `drafts/draft_audit.md` 里写的四个 issue class 草稿都在 workspace 下。她的 draft 是起点不是真值——她在 `handoff.md` 里留了笔记，Slack 对话（`slack_excerpt.txt`）是和 PM 关于 audit 范围的讨论。趋势数据的真值在 `http://127.0.0.1:4500/api`（用 `/api/help` 和 `/api/datasets` 自发现），目录是怎么拼出来的看 `analysis/audit.py`。

audit 要报四个类的 data-quality 问题：

1. **In-progress weeks** —— 当前还在更新（`partial_data`）的周次还存在的 dataset，按 dataset 报这种周次的个数。
2. **Empty-query datasets** —— 完全没可用 signal 的 dataset。
3. **Sub-floor brand presence** —— 品牌曝光度低到不该进 competitive model 的。
4. **Monopoly categories** —— 单一品牌主导到 competitive analysis 已经没意义的品类。

`audit.py` 里写了 Devin 对每个类的工作定义和她挑的 in-scope dataset。这些阈值、empty 的判定、in-scope 过滤的选择都是 sign off 前要对着目录和原始 payload 再核一遍的——目录里 channels、date range、payload shape 都不一样，scope 错一点四个 list 都会安静地变。

这个 audit JSON 是 analyst 团队拿来训 competitive model 的客观数据质量记录，必须反映数据实际状况：对每个 issue class，**所有**符合该类定义的 dataset 都要报。后续 triage 决策（某品类要 sunset、降优先级、本季度不动）属于另外的 artifact（action queue、ops digest），**不能**把一个本来应该入选的 row 从这份客观记录里删掉——"问题会不会被处理"和"数据里有没有这个问题"是两件事。

把结果写到 `outputs/quality_audit.json`：

```json
{
  "partial_data_datasets": [
    {"dataset_id": "set_<slug>", "partial_data_week_count": 0}
  ],
  "empty_query_datasets": ["<id>", "..."],
  "sub_floor_brand_presences": [
    {"slug": "<category>", "brand": "<brand string>", "twelve_month_avg": 0.0}
  ],
  "monopoly_datasets": [
    {"slug": "<category>", "leader": "<brand string>", "leader_share": 0.0}
  ]
}
```
