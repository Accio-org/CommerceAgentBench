帮我在货代订舱平台上订一票从深圳到纽约的整柜（FCL）海运。平台开在 http://127.0.0.1:3003/login，浏览器打开登录进去操作，账号密码在 workspace/portal_credentials.txt。

路线、货物这些按 workspace/shipping_requirements.md 填搜索表单。附加服务要保留 insurance、customs brokerage 和 single entry bond。这次报价分两步选：先把结果页相关报价的 total all-in price 都算出来，挑出最低的 3 条；再从这 3 条里选 seller rating 最高的一条下单，评分一样的话选 reviews 更多的那条。下单后完成 shipment verification，pickup / delivery 的公司和联系人信息填 workspace/company_details.md。

订完把结果写到 outputs/booking_confirmation.md：记下 shipment ID、选中的 quote ID、carrier/seller、费用明细、seller rating / reviews、最低价前 3 条报价的排序，以及最终选择理由。
