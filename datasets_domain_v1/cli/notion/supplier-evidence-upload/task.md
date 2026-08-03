review 一批 supplier 证书 packet，**只**对需要 legal hold 的那一份做后续处理。用本机的 `ntn` CLI 操作 Notion（workspace 已经接好，不需要浏览器或外网）。完整说明看 `workspace/evidence_upload_brief.md`，原始 packet 文件在 `workspace/supplier_packets/` 下。

具体步骤：

1. 按 brief 里的 policy 和 queue 文件判断哪家 supplier 需要标 `HOLD_FOR_LEGAL_REVIEW`。
2. 通过 `ntn files create` 上传**恰好一个**纯文本 evidence 文件——文件名遵循 brief 里给的命名规范，不要用外部 URL 占位。文件内容要写清楚：supplier、被审的证书、purchase / order reference、legal-hold 决定、owner、以及具体的 hold 理由。
3. 在 workspace 根目录下建**恰好一个**新的 handoff page——H1 遵循 brief 给的标题规范，正文要引用上传的 evidence 文件、hold 决定、owner 和理由。
4. 对那些 pass policy 的 supplier，不要传 packet，也不要建 handoff page。

Notion workspace 的最终状态就是交付物，不需要写额外的输出文件。
