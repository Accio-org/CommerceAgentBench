帮我给一票东莞到 Dallas 的 40' FCL 消费电子货物，规划一条 30 天内总成本最低的多段路线，并在货代订舱平台上完成海运段的 booking 和 shipment verification。平台开在 http://127.0.0.1:3003/login，登录进去操作，账号密码在 workspace/portal_credentials.txt。

这是多段运输（国内拖车 + 海运 + 美国尾程），各段之间的中转港口必须衔接得上。货物信息、各段成本的算法和约束都在 workspace/shipping_requirements.md，按它来：枚举所有可行的路线组合（港口能对接、总运输时间 ≤ 30 天），在里面挑总成本最低的那条——总成本要算上 insurance、customs clearance、customs bond、platform fee 这些全部费用。海运段下单后完成 shipment verification，发货方 / 收货方信息填 workspace/company_details.md。

把过程和结果写到 outputs/route_analysis.md：路线分析过程、各组合的可行性判断与成本明细、最优路线的选择理由，以及最终 booking 信息（carrier、quote、shipment ID）。
