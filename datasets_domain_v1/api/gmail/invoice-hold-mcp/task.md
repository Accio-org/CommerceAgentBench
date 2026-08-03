我是 Nora 的助理，要为 `INV-440` 准备付款暂缓的 Gmail/Calendar 工作状态。

只能通过 `http://127.0.0.1:3071/mcp` 访问 Gmail Workspace/MCP，用 JSON-RPC `tools/list` 和 `tools/call` 调用 `gmail.search`、`gmail.get`、`gmail.createLabel`、`gmail.batchModify`、`gmail.createDraft` 这些工具。当前业务日期固定为 `2025-06-21`。所有线索都得通过 MCP 工具自己查，没有额外附件。

请先用 MCP 把 INV-440 相关邮件读清楚，区分**当前仍有效**的发票风险线程和**过时或无关**的旧线索。

创建顶层标签 `INV-440`，把当前有效的 INV-440 工作线程全部打上这个标签并标记已读——只标记仍与本次 hold 相关的邮件，过时的别动。与该发票风险**直接相关**的证据和处理邮件加星标，其余不加。

再保存两封未发送的草稿：
- 一封给 `ap-hold@auroraretail.test`，抄送 Nora，通知 AP 暂缓付款。正文要概括发票异常的核心事实——金额、行项、采购单号、税务问题。
- 一封给 `billing@northstar-supplies.test`，抄送 Nora，要求供应商更正并重新提交。正文要引用具体的异常行项、金额、采购单号和税务问题。

按邮件里确认的时间安排建一个 `INV-440 AP review` 日历事件，邀请 Nora、AP Audit 和 Tax Desk，说明中概括待审核的关键异常点。

引用邮件原文中的数据、编号、术语时不要改写。**任何邮件都不要发送**。完成后直接结束，无需另外写文件。
