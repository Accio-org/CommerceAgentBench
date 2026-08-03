我同事 Sarah 在做季度 portfolio rebalance memo，做了一半周中休 PTO 了，留了一个工作空间在 `workspace/` 里。VP 明早就要终版数字。请接她的活，把干净的终版交付出来。

先看 `workspace/README.md` 了解 layout，从那里入手。Sarah 的方法论、她那份 QoQ 计算脚本、她最后一次跑的结果、以及她在 `drafts/draft_rebalance.md` 里写的草稿都在 workspace 下。她的 draft 是起点不是真值——她在 `handoff.md` 里留了几条自己也没把握的 caveat，跟 PM 的 Slack 对话（`slack_excerpt.txt`）里也有几条她后来撤回的意见。趋势数据的真值在 `http://127.0.0.1:4500/api`，怎么按 dataset ID 拼请求看 `analysis/qoq.py`。

把终版写到 `outputs/rebalance.json`，9 个 cell（3 个季度 × 3 个 slot）：

```json
{
  "decisions": [
    {"quarter": "Q2", "slot": "earbuds", "starting_brand": "jbl live",     "action": "<enum>", "qoq_growth": 0.0},
    {"quarter": "Q2", "slot": "drill",   "starting_brand": "ryobi",        "action": "<enum>", "qoq_growth": 0.0},
    {"quarter": "Q2", "slot": "speaker", "starting_brand": "homepod mini", "action": "<enum>", "qoq_growth": 0.0},
    {"quarter": "Q3", "slot": "earbuds", "starting_brand": "...",          "action": "<enum>", "qoq_growth": 0.0},
    {"quarter": "Q3", "slot": "drill",   "starting_brand": "...",          "action": "<enum>", "qoq_growth": 0.0},
    {"quarter": "Q3", "slot": "speaker", "starting_brand": "...",          "action": "<enum>", "qoq_growth": 0.0},
    {"quarter": "Q4", "slot": "earbuds", "starting_brand": "...",          "action": "<enum>", "qoq_growth": 0.0},
    {"quarter": "Q4", "slot": "drill",   "starting_brand": "...",          "action": "<enum>", "qoq_growth": 0.0},
    {"quarter": "Q4", "slot": "speaker", "starting_brand": "...",          "action": "<enum>", "qoq_growth": 0.0}
  ]
}
```

`action` 取值之一：`keep` / `hold_watch` / `swap_out` / `swap_in:<brand>`。每个 (quarter, slot) 的 `starting_brand` 在 `workspace/handoff.md` 里有，直接抄过来，让 rebalance 决策可追溯到规划上下文。
