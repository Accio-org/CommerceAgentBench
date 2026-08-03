我们要给 ChronoVibe Pulse S2 智能手表配一个夏季大促活动。活动配置平台在 http://127.0.0.1:3000，但这次**只开了 HTTP API、没有页面**，请按 `workspace/api_reference.md` 里给的 `/api/cli/*` 端点（带 `Authorization: Bearer local-mock-token`）调用完成配置，闭集字段（campaignType / discountType / stockReserveMode / category 等）服务端会做枚举校验，非法值直接 400；数字字段要传字符串（比如 `"399.00"` 别传 `399`），list / object 字段（targetRegions / discountTiers / regionSurcharge / warehouseAllocation 等）要传 JSON 序列化字符串。填完 `POST /api/cli/campaign/submit` 让 session 翻到 `submitted` 就算交付。

资料堆在 workspace/ 里有点乱：营销总监的活动策略邮件、CFO 利润保护覆盖邮件、运营经理 Slack 调仓库分配、CEO 临时追加目标市场和区域加价、几版活动方案、几版仓库分配快照、几款产品的规格书、还有一批 banner 设计图。先看 workspace/task_brief.md 了解这次要配什么，里面也指了各份资料的位置。

折扣阶梯以**最新有效**的活动方案为基础，再叠加 CFO 邮件的覆盖；折扣价 = basePrice × (1 - discount_pct/100)，保留两位小数。仓库分配以**最新有效**的仓库方案为基础，再应用运营经理 Slack 的调整，总预留量口径要保持一致。目标市场和区域加价以营销总监邮件为基础，再纳入 CEO Slack 的临时更新。

Banner 图在 assets/ 里，是一批自动编号的导出图，自己一张张看，把属于 ChronoVibe Pulse S2、适合大促用、设计质量合格的挑出来传上去；不属于这款手表的、用途不合适的、质量不合格的别传。
