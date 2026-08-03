帮我把一款不锈钢保温杯发上线，这次只发 TK-750 这一个型号。发品系统在 http://127.0.0.1:3000，但这次**只暴露 HTTP API、没有页面**，请按 `workspace/api_reference.md` 里给的 `/api/cli/*` 端点（带 `Authorization: Bearer local-mock-token`）调用完成发品，闭集字段服务端会做枚举校验，非法值直接 400；数字字段要传字符串（比如 `"1.20"` 别传 `1.2`），list 字段（selectedCountries / deliveryPeriod 等）要传 JSON 序列化字符串。填完 `POST /api/cli/submit` 让 session 翻到 `submitted` 就算交付。

怎么发以运营笔记 workspace/ops_notes.md 为准——类目、销售模式、目标销售国家和差异定价规则、标题/关键词/商品分组、定价加价公式、销售方式与计量单位、最小起订量、可售数量、发货期阶梯、商品描述要点、协议确认都在里面。品牌、型号、规格、性能、材质、尺寸、包装这些商品属性看 supplier_docs/product_manual.md。出厂价在 supplier_docs/cost_quote.csv，里面有 TK-350/500/750/1000 四个型号的阶梯报价，只取 TK-750 的，定价按 ops_notes 的公式自己算。

商品图在 product_photos/ 里，传上去就行。

商品标题、关键词、商品描述都用英文写。
