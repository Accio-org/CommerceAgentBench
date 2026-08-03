我是 Accio 里的采购运营代理。COO 需要 `Project Atlas` 的综合状态报告，用于明天的大客户采购评审会。`#project-atlas` 里各部门消息存在版本更新、互相矛盾和旧信息，请汇总真实状态、找对当前 COO、把执行摘要做成 Slack 草稿（**不要发送给真实客户或 board**）。

Slack API 只能通过 `http://127.0.0.1:9110` 访问，Contacts API 只能通过 `http://127.0.0.1:9103` 访问；端点列表、分页约定和示例请求都在 `workspace/api_reference.md`。所有 POST 请求都要带 `Authorization: Bearer local-mock-token`。workspace 里可能有旧缓存，以 API 返回的最新消息为准。

把 `#project-atlas` 的消息全部读出来，对缺口或矛盾**主动通过 Slack DM 联系对应内部负责人**确认（每条缺口/矛盾都要落到具体职能 owner），通过 Contacts API 查到当前 COO handle，把执行摘要通过 `/slack/drafts/save` 保存为 COO 草稿——**不要**直接发送，**不要**联系 board。最终把结论写进 `outputs/answer.json` 和 `outputs/atlas_status_report.md`。

## `outputs/answer.json` —— 结构化状态结论

```json
{
  "overall_health_status": "<string: 整体健康度，必须在闭集 {green,yellow,amber,red} 内，例如 'green'>",
  "coo_current_slack_handle": "<string: 当前 COO 的 slack handle，必须以 '@' 开头，例如 '@example-coo'>",
  "coo_stale_slack_handle": "<string: 已过期的 COO handle，必须以 '@' 开头，例如 '@example-coo-old'>",
  "valid_sample_id": "<string: 当前真正通过测试的样品代号（单字母），例如 'X'>",
  "invalid_sample_id": "<string: 第一版未通过的样品代号（单字母），例如 'Y'>",
  "new_supplier_unit_price_usd": <number: 供应商最新报价 USD/pc，bare number，无单位、无 $，例如 1.99>,
  "new_supplier_moq_units": <integer: 对应该新报价的 MOQ 件数，例如 40000>,
  "margin_normal_pct": <number: 正常海运下的项目毛利率 %，bare number，无 % 符号，例如 25.0>,
  "margin_with_airfreight_pct": <number: 触发空运补货后的毛利率 %，bare number，无 % 符号，例如 20.0>,
  "margin_red_line_pct": <number: COO 关心的毛利率红线 %，bare number，无 % 符号，例如 15>,
  "airfreight_surcharge_usd": <number: 空运补货带来的额外金额 USD，bare number，无单位，例如 10000>,
  "supplier_first_batch_capacity_units": <integer: 供应商第一批可保证产能 件，例如 30000>,
  "supplier_first_batch_etd_iso": "<string: 第一批宁波 ETD 日期，严格 ISO 'YYYY-MM-DD'，例如 '2026-05-01'>",
  "compliance_rohs_status": "<string: RoHS 状态，必须在闭集 {ok,pending,not_required} 内，例如 'ok'>",
  "compliance_reach_status": "<string: REACH 状态，必须在闭集 {ok,pending,not_required} 内，例如 'pending'>",
  "reach_2026_report_deadline_iso": "<string: 法务给的 REACH 2026 版报告最晚拿到日期，严格 ISO 'YYYY-MM-DD'，例如 '2026-05-01'>",
  "qa_replacement_name": "<string: 临时驻厂 QA 人员姓名，与法务/HR 沟通时的称呼一致，例如 'Example Q'>",
  "qa_replacement_arrive_iso": "<string: 该 QA 到厂日期，严格 ISO 'YYYY-MM-DD'，例如 '2026-05-01'>",
  "qa_replacement_travel_decision_deadline_time": "<string: HR 给的当日差旅决策截止时间，严格 'HH:MM' 24h 时制，例如 '15:30'>"
}
```

## `outputs/atlas_status_report.md`

中文执行摘要：整体健康度、关键进展、冲突修正、阻塞项、未来两周计划、预算/毛利风险。无字数要求。

`outputs/mock_audit/` 是系统自动生成的运行记录，请保留——不要删除或改写。`outputs/` 下也不要放其它临时脚本或日志。
