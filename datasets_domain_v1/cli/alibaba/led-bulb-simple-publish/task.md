帮我把一款 LED 灯泡发上线。发品系统在 http://127.0.0.1:3000，但这次**只暴露 HTTP API、没有页面**，请按 `workspace/api_reference.md` 里给的 `/api/cli/*` 端点（带 `Authorization: Bearer local-mock-token`）调用完成发品，闭集字段服务端会做枚举校验，非法值直接 400；填完 `POST /api/cli/submit` 让 session 翻到 `submitted` 就算交付。

要填的参数我整理在 workspace/product_info.md 里了——类目、销售模式、目标销售国家、商品标题、关键词、商品属性、价格、发货期、商品描述这些都在，照着把表单字段填全。商品图在 workspace/images/ 里（主图、细节图、包装图各一张），一起传上去。
