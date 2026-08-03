帮我在货代订舱平台上订一票从杭州到洛杉矶的整柜（FCL）海运。平台开在 http://127.0.0.1:3003/login，浏览器打开登录进去操作，账号密码在 workspace/portal_credentials.txt。

路线、货物这些按 workspace/shipping_requirements.md 填搜索表单。附加服务要保留 insurance、customs brokerage 和 single entry bond。这次不是图便宜，而是要快：把结果页所有相关报价比一遍，先把总 all-in cost 超过 $7,000 的过滤掉，在预算内的报价里选 transit time 最短的那条下单；如果有几条 transit 下限相同，选上限（最坏到港时间）更早的那条。下单后完成 shipment verification，pickup / delivery 的公司和联系人信息填 workspace/company_details.md。

订完把结果写到 outputs/booking_confirmation.md：记下 shipment ID、选中的 quote ID、carrier/seller、费用明细、transit/ETA、预算内候选报价对比，以及为什么这条是预算内最快的。
