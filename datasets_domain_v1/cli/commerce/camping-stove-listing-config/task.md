我们越途（TrailBlaze）户外品牌马上要上线新产品线——烈焰（ThermoJet）便携露营炉具系列，需要在 Shopify、Amazon Japan、抖音电商三个平台同时上架。帮我把这三套平台上架配置文件生成出来。

先看 `workspace/task_brief.md` 了解数据有哪些、要交付什么；产品规格在 `product_spec.json`，PM 后期改的口径在 `pm_corrections.json`（PM 修正优先级高于规格书）；每个平台的字段结构和必填项在 `platform_schemas/*` 三份 schema 模板里；命名、定价公式、单位换算、图片分配规则、SEO 关键词都在 `brand_guidelines.md`；CE / PSE / CCC 认证细节在 `compliance/certifications.json`，平台内容合规限制（抖音广告法违禁词、Amazon 安全警告等）在 `compliance/platform_restrictions.md`；可用图片清单在 `assets/image_manifest.csv`；汇率和类目 ID 映射在 `reference/` 下。

按各平台 schema 生成下面三个文件到 `outputs/`：

- **`outputs/shopify_product.json`** — Shopify 产品配置（USD 直接用 MSRP，metafields 里公制英制两份重量/尺寸都给，SEO description 覆盖 brand_guidelines 列的全部关键词，包含 CE 认证编号）。
- **`outputs/amazon_jp_listing.yaml`** — Amazon Japan 商品配置，用 Parent-Child 结构，**Parent SKU 是 `TJ-THERMOJET`**；标题按 brand_guidelines 公式（以 "TrailBlaze" 开头、含 "ThermoJet"）；**恰好 5 条日文 Bullet Points**；图片按 brand_guidelines 的 MAIN / PT01–PT06 共 7 个 slot 分配；compliance 节点带 PSE 认证编号和安全警告文本（**原文照搬**）。
- **`outputs/douyin_product.json`** — 抖音电商配置，所有文本用中文（品牌"越途"、产品线"烈焰"），spec_groups 定义变体轴（型号 × 颜色），价格按 brand_guidelines 抖音规则用 CNY；标题/描述**严禁**广告法违禁词；带 CCC 认证；`category_path` 从 `reference/category_mapping.csv` 取。

版本冲突时以 `pm_corrections.json`、平台 schema、品牌指南和合规文件里的明确规则为准；旧版本规格、不适用产品资料、不适用平台的字段都不要混进来。
