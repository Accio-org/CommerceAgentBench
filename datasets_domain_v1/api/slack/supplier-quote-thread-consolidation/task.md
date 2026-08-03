我是 Accio 里的采购运营代理。`#rfq-stainless-bottle` 频道里聚集了多家供应商的 RFQ 报价、修订与后续 ops/finance/QA 评论。我需要把整条线程读完、把每家供应商的真实 landed cost 计算清楚，给出最终的 shortlist。

目标采购品：**750ml 不锈钢保温杯**，目标数量 **20,000 个**，客户要求 **LFGB 食品接触认证**、**DDP Los Angeles**、**6/15 前到仓**。

Slack API 只能通过 `http://127.0.0.1:9110` 访问；端点列表、分页约定、preview/get 用法都在 `workspace/api_reference.md`。所有 POST 请求都要带 `Authorization: Bearer local-mock-token`。

这是**只读分析任务**——读取 `#rfq-stainless-bottle` 频道的全部消息，汇总每家供应商的最新报价状态，计算 landed DDP LA 单价，输出最终的 shortlist 推荐。**不要**调用 `/slack/send` 或 `/slack/drafts/save`。最终把结论写进 `outputs/answer.json` 和 `outputs/quote_consolidation.md`。

## `outputs/answer.json` —— 结构化分析结论

```json
{
  "primary_supplier_name": "<string: 首选供应商名，大小写不敏感，例如 'ExampleCo'>",
  "primary_supplier_landed_cost_usd": <number: 首选 landed DDP LA 单价 USD，保留 2-4 位小数，例如 3.20>,
  "primary_supplier_fx_rate_rmb_per_usd": <number|null: 若首选供应商为 RMB 报价，填换算 USD 时用的汇率 (RMB/USD)，例如 7.00；否则填 JSON null>,
  "primary_supplier_fx_handling_load_pct": <number|null: 若首选供应商为 RMB 报价，填 bank/FX handling load 百分比，bare number 无 % 符号，例如 1.2；否则填 JSON null>,
  "primary_supplier_extra_logistics_usd_per_pc": <number: LA 仓 appointment + tailgate 等额外物流单价 USD,bare number 无单位,例如 0.10>,
  "primary_supplier_cert_authorization_letter_required": <boolean: 是否需要在 award 前提供 authorization letter 来打通 LFGB 名义实体差异，JSON true / false>,
  "backup_supplier_name": "<string: 备选供应商名，例如 'BackupCo'>",
  "backup_supplier_landed_cost_usd": <number: 备选 landed DDP LA 单价 USD，例如 3.30>,
  "rejected_late_arrival_supplier_name": "<string: 因为到仓晚于 6/15 而被排除的供应商名，例如 'LateCo'>",
  "rejected_quality_risk_supplier_name": "<string: 因为有 QA 质量风险被排除的供应商名，例如 'RiskyCo'>",
  "cost_adjustment_note": "<string: 说明对应供应商，以及是否存在报价看似较低但补齐费用后不可取的情况，例如 'ShinyCo appears low before all accessorial charges are added; after adjustment it is not the best choice.'>",
  "cost_adjusted_landed_cost_usd": <number|null: 对应的 landed DDP LA 单价 USD，bare number 无单位，例如 3.55>,
  "steelpro_latest_unit_price_usd": <number: SteelPro 修订后用于 20k pcs 的 EXW 单价 USD，bare number 无单位、无 $，例如 3.36>,
  "steelpro_lfgb_certificate_covers_target_750ml": <boolean: SteelPro 的 LFGB 证书是否覆盖 750ml 目标规格，JSON true / false>,
  "landed_cost_budget_usd": <number: finance 给的 landed DDP LA 单价上限 USD，bare number 无单位、无 $，例如 3.40>
}
```

## `outputs/quote_consolidation.md`

人类可读版的对比表、推荐理由、风险注释和待确认问题（供采购总监过目）。无字数要求。

`outputs/mock_audit/` 是系统自动生成的运行记录，请保留——不要删除或改写。`outputs/` 下也不要放其它临时脚本或日志。
