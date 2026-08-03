帮我把一款工业气动球阀（DN50）发上线。发品系统在 http://127.0.0.1:3000，但这次**只暴露 HTTP API、没有页面**，请按 `workspace/api_reference.md` 里给的 `/api/cli/*` 端点（带 `Authorization: Bearer local-mock-token`）调用完成发品，闭集字段服务端会做枚举校验，非法值直接 400；数字字段要传字符串（比如 `"1.20"` 别传 `1.2`），list 字段（selectedCountries / deliveryPeriod 等）要传 JSON 序列化字符串。填完 `POST /api/cli/submit` 让 session 翻到 `submitted` 就算交付。

资料散在 workspace/ 里，得自己综合一下。商品属性（品牌、型号、尺寸、材质、压力、温度、认证这些）以 technical_specs/valve_datasheet.md 为准，商品描述和使用说明可以参考同目录的 installation_guide.md。定价要自己算：定价公式、汇率、目标利润率、各区域市场差异加价、计量单位、销售方式、最小起订量、发货期阶梯、商品分组、协议等都在 pricing/internal_cost_sheet.csv，工厂出厂价（人民币 EXW，含 5% 返点）在 emails/factory_price_update.txt，拼柜每台运费在 emails/shipping_logistics.txt。

emails/inquiry_from_buyer.txt 是巴西客户的询盘，里面有目标采购量和几个潜在合作市场，发品时参考。old_reference/expired_listing.md 是去年的旧 listing，价格和目标国家都过期了，只能当风格参考，别照搬。

商品图在 product_photos/ 里，文件名是相机原始编号，自己一张张看，把适合做这款球阀商品图的照片挑出来传上去。

商品标题、关键词、商品描述都用英文写。
