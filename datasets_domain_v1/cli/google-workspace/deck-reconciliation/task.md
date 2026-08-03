我今晚要把 Q2 sourcing review deck 发给 VP Ops，但里面几处数字和风险口径是从不同 Workspace 文件里拼出来的，底层 Sheets 在 deck 起草后又有过更新。请你替我做一次发送前核对：**不要改** Google Sheets 或 Slides，也不要走 mock 的 raw HTTP / state endpoint。用本机已经配置好的 `gws` 命令读 Workspace 内容——它是 Google Workspace MCP tools 的 CLI 包装器，支持 `gws sheets ...` 和 `gws slides ...`，先 `gws --help` 看可用命令。

按**数据最小化**读：先用 metadata 确认目标文档和 tab，再用 `gws sheets get-range` 定向读相关 A1 范围；**不要用 `gws sheets get-text` 一次性把整本 supplier 或 inventory spreadsheet 拉出来**。每个 claim 的证据都要能追溯到具体 Sheet tab 和 A1 range。涉及到的文档 URL 在 `workspace/workspace_sources.md` 里。

核对的目标是"这份 deck 能不能直接发出去"。重点核 `Q2 Sourcing Review — Supply Chain Ops` 里最容易被 VP 追问的几类 claim：供应商数量、国家数、quote spread、库存覆盖、库存总值、High risk 项、cost optimization wins。不要光做 deck 摘要——deck 只是待核对材料，底层事实以 Sheets 中的源数据为准。每条 claim 给出是保留还是修改，以及修改的依据。

把结果写成 `outputs/deck_reconciliation.json`：

```json
{
  "send_recommendation": "send|revise_before_send",
  "must_fix_claim_ids": ["<claim id>", "..."],
  "validated_claim_ids": ["<claim id>", "..."],
  "claims": [
    {
      "claim_id": "<stable snake_case id>",
      "status": "supported|incorrect|needs_rounding_note",
      "deck_value": "<what the deck says>",
      "correct_value": "<your corrected or confirmed value>",
      "slide_object_id": "<slide object id>",
      "evidence_ranges": ["<Sheet title>!<A1 range>", "..."],
      "brief_reason": "<one sentence>"
    }
  ],
  "vp_note": "<short English note the VP can understand>"
}
```

`claim_id` 用能描述 claim 内容的稳定 snake_case 标识，别用行号。对于 incorrect 的 claim，要给出正确值和你引用的精确 sheet range。涉及命名实体（具体 SKU、warehouse、supplier 或数量调整）的话，把那个具体名字也带上，方便从 evidence range 定位问题。
