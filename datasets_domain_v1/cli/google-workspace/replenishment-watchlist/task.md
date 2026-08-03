replenishment standup 之前我需要一份 pre-flight exception watchlist。请用本机的 `gws` 命令（Google Workspace MCP tools 的 CLI 包装器，`gws --help` 看命令）读 inventory spreadsheet 和 sourcing review deck，**不要改** Sheets 或 Slides，也不要直接走 mock raw HTTP / state endpoint。涉及到的文档 URL 在 `workspace/workspace_sources.md` 里。

按**数据最小化**读：先看 metadata，再用 `gws sheets get-range` 定向读相关 A1 范围，不要用 `gws sheets get-text` 把整本 inventory spreadsheet 拉出来。replenishment tracker 分了 stock、reorder、PO-detail 几个 tab，每条 escalation 要带具体的 evidence range 指向触发它的那几行。

光看仓库状态不够，要把**真正要 escalate 的 exception** 和**只该 watch 的**分开。库存、in-transit、safety stock、stockout 天数、PO ETA、PO 状态 / hold 备注从 inventory tracker 读；具名风险上下文和 next steps 从 sourcing review deck 交叉核对。我要的是一份能直接贴到 replenishment 频道的简洁 JSON，不是长篇 narrative。

把结果写到 `outputs/replenishment_watchlist.json`：

```json
{
  "priority_actions": [
    {
      "rank": 1,
      "sku": "<SKU>",
      "warehouse": "<warehouse>",
      "supplier": "<supplier>",
      "recommended_action": "expedite_quality_recovery|expedite_po_and_second_source|protect_air_split",
      "po_number": "<PO number or null>",
      "eta": "<YYYY-MM-DD or null>",
      "stockout_days": <integer>,
      "current_shortfall_units": <integer>,
      "net_after_in_transit_units": <integer>,
      "deck_risk_level": "HIGH|MEDIUM|LOW|NONE",
      "evidence_ranges": ["<Sheet title>!<A1 range>", "..."],
      "reason": "<one sentence>"
    }
  ],
  "monitor_only": [
    {
      "sku": "<SKU>",
      "warehouse": "<warehouse>",
      "why_not_escalated": "<one sentence>"
    }
  ],
  "standup_note": "<short English note>"
}
```

计算：`current_shortfall_units = max(0, safety stock - on hand)`，`net_after_in_transit_units = on hand + in transit - safety stock`。net 计算里的 `In Transit` 取 Warehouse Stock tab 里的值；PO 数量是 ETA / action 上下文，不能替代 in-transit。前 3 个 `priority_actions` 按你在 standup 上会先开口的顺序排。`monitor_only` 至少给 3 条代表性记录——item 偏低或在 watch 列表上、但 inbound coverage 或 PO 上下文足以兜住，所以不 escalate。
