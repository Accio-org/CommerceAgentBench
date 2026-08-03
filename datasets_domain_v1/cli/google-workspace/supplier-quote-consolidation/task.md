sourcing 组在敲定 Q2 supplier awards。请把 supplier 数据和 quote 交叉核对、按业务规则跑出 award 决策，并把结果直接落在两个 Workspace 文件上：spreadsheet `sheet-supplier-eval-003`（"Supplier Evaluation Matrix"，里面有 supplier profile、quote comparison、audit trail）和 presentation `pres-sourcing-review-303`（"Q2 Sourcing Review"，里面有团队的风险评估和成本笔记）。

用本机的 `gws` CLI 操作 Workspace（服务已经起好，不需要浏览器或外网）。`gws --help` 看可用命令，`workspace/cli-reference.md` 里有更详细的用法说明。不需要写任何输出文件，spreadsheet 和 presentation 的最终状态就是交付物。

具体三件事：

**1. 在 `sheet-supplier-eval-003` 里加一个 "Award Decisions" sheet**。对 "Quote Comparison" 里的每个 SKU 按下面的规则定 winning supplier（按优先级）：

- 在 "Supplier Overview" 里 rating 低于 3.5 的供应商直接 disqualify。
- 在合格的供应商里挑价格最低的。
- 如果两个供应商的价格在 5% 以内，优先选 "Supplier Overview" 里 lead time 更短的。
- 记录 tie 和判定理由。

列从 A1 开始：

- A: SKU
- B: Product
- C: Award Supplier
- D: Award Price (USD)
- E: Runner-Up Supplier
- F: Runner-Up Price (USD)
- G: Savings vs Runner-Up (USD)
- H: Decision Rationale —— 取值之一：`"lowest price"` / `"price tie — shorter lead time"` / `"sole qualified bidder"`

Quote Comparison 里 supplier 是泛指的 "Supplier A/B/C"，要把它们映射成 supplier 实际名字：A = "Supplier Overview" 里第一个匹配该 SKU 产品品类的供应商，B = 第二个匹配，C = 第三个匹配。SKU 的品类从产品名推；产品名看不出品类时，去 workspace 里其他相关的 spreadsheet（比如 inventory tracker）交叉核哪个供应商真的服务这个 SKU。用 "Supplier Overview" 里的 supplier 全名，**原样**（包括中文字符和括号里的翻译）。

**2. 在 `pres-sourcing-review-303` 里加一张新 slide**——放在 "Next Steps" 之后，即第 7 张，layout 用 TITLE_AND_BODY：

- 标题：`Q2 Award Summary`
- 正文：每条 award decision 一条 bullet，格式 `· <SKU>: <Award Supplier> at $<price> (<rationale>)`
- 末尾加上 SKU 总数和总 savings（aggregate savings vs runner-up）

**3. 在 `sheet-supplier-eval-003` 的 "Audit Trail" sheet 末尾加一行**：

- Date：今天的日期（YYYY-MM-DD）
- User：`sourcing-bot@`
- Change：`Award decisions finalized for <N> SKUs`
- Old Value：（留空）
- New Value：`<N> awards, $<total_savings> aggregate savings`
