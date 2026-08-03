为下一轮 overseas checkout QA review 准备 Notion workspace。用本机的 `ntn` CLI 操作 Notion（workspace 已经接好，不需要浏览器或外网）。相关 page ID 不要从这份说明里猜，自己从 workspace 里发现；详细背景看 `workspace/qa_triage_brief.md`。

要做的事：

1. 找到 brief 里讲的 task database / data source，识别出"B2B buyer SSO 登录"那条 priority-1 overseas checkout blocker（open 状态）。
2. **只更新这一条 blocker 页**——保留它的 H1，把 brief 里写的 QA hold 状态、owner 和 launch-impact 写进去。
3. 在 workspace 根目录下建**一个新的** release handoff page，汇总已经 closed 的 ready 项和剩下的这条 blocker，带上 brief 里的 checkpoint 日期。
4. 把 brief 里提到的那条**陈旧的根目录 documentation page** 移到回收站；但 QA database 里的 checkout API reference page **不要**动。
5. 不要建多余的 page，也不要改其他已关闭或无关的 task page，除非 handoff note 引用了它们。

Notion workspace 的最终状态就是交付物，不需要写额外的输出文件。
