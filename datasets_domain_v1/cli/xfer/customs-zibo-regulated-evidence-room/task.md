完成 2026-Q2 Zibo 监管出口证据室：把符合策略阈值的 roster 供应商汇总到 Google Sheets，做一页 Google Slides 管理层简报；在 Jira 中建立证据审查 Epic 和供应商 Task；在 Box 中建立供应商证据文件夹并上传证据摘要；在 DWS 中建立供应商 dossier、评论、权限和导出证据。Google Sheets 的主表和 trace matrix 都要回填实际 Jira task key、Box folder/file id 与 DWS dossier id，便于合规团队从任一系统追踪到另外三个系统。

供应商级别的监管证据范围用 `customs_data/zibo_us_exports.csv` 算，筛选口径和系统间字段约定都在 `evidence_room_policy.md` 里，CLI 用法见 `cli_reference.md`。所有跨系统字段必须使用实际 CLI 返回的 Jira key、Box folder/file id、DWS document id，不能写占位符。最终状态以四个 CLI 系统中的对象为准，不需要额外提交说明文件。
