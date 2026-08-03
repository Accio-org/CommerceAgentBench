帮我把一套硅胶厨具发上线。发品系统在 http://127.0.0.1:3000，但这次**只暴露 HTTP API、没有页面**，请按 `workspace/api_reference.md` 里给的 `/api/cli/*` 端点（带 `Authorization: Bearer local-mock-token`）调用完成发品，闭集字段服务端会做枚举校验，非法值直接 400；填完 `POST /api/cli/submit` 让 session 翻到 `submitted` 就算交付。

发品信息分散在三个文件里，综合着填：listing_brief.md 是运营给的发品说明（类目、销售模式、目标销售国家、标题、关键词、商品分组、商品描述要点、私域品服务、协议确认），product_specs.csv 是商品属性（用途、产品类型、使用说明、品牌、型号、材质、直径、形状），pricing_sheet.csv 是销售方式、计量单位、价格类型与阶梯价、最小起订量、可售数量、发货期阶梯。

商品图在 images/ 里，文件名是相机原始编号，自己一张张看，把适合做正式商品图的产品照挑出来传上去，拍得不行的或不是商品图的别传。

商品标题、关键词、商品描述都用英文写。
