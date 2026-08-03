帮我在货代订舱平台上订一票从杭州到洛杉矶的整柜（FCL）海运。平台开在 http://127.0.0.1:3003/login，浏览器打开登录进去操作，账号密码在 workspace/portal_credentials.txt。

路线、货物、预算和到港期限这些都在 workspace/shipping_requirements.md，按它填搜索表单。附加服务要保留 insurance、customs brokerage 和 single entry bond。报价别只看第一条——把结果页里所有相关报价都比一遍，选同时满足总价预算和 June 12, 2026 到港期限的最低 all-in 报价下单。下单后完成 shipment verification，pickup / delivery 的公司和联系人信息填 workspace/company_details.md 里的。

订完把结果写到 outputs/booking_confirmation.md：记下 shipment ID、选中的 quote ID、carrier/seller、路线、transit/ETA、费用明细，以及为什么选这个报价。
