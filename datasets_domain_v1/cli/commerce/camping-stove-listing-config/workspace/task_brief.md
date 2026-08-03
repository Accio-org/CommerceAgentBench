# 任务总览：户外炉具多平台上架配置生成

## 背景

你是越途（TrailBlaze）户外品牌的产品运营专员。公司即将上线新产品线——烈焰（ThermoJet）便携露营炉具系列。你需要根据产品规格书和各平台的上架配置模板，生成三个电商平台的结构化上架配置文件。

## 数据文件清单

| 文件 | 说明 |
|------|------|
| `product_spec.json` | 产品主规格书（所有变体、尺寸、重量、材质、价格） |
| `pm_corrections.json` | 产品经理的最终修正（**优先级高于规格书**） |
| `platform_schemas/shopify_product.schema.yaml` | Shopify 产品 JSON 配置模板 |
| `platform_schemas/amazon_jp_flat.schema.yaml` | Amazon Japan YAML 配置模板 |
| `platform_schemas/douyin_product.schema.yaml` | 抖音电商产品 JSON 配置模板 |
| `brand_guidelines.md` | 品牌命名规范、定价规则、图片分配规则、SEO 关键词 |
| `compliance/certifications.json` | CE / PSE / CCC 认证信息 |
| `compliance/platform_restrictions.md` | 各平台内容合规限制（广告法违规词、安全警告等） |
| `assets/image_manifest.csv` | 可用图片清单及元数据 |
| `reference/exchange_rates.json` | 汇率表（USD → JPY / CNY） |
| `reference/category_mapping.csv` | 各平台类目 ID 映射 |

## 输出

在 `outputs/` 目录下生成 3 个配置文件：

1. `outputs/shopify_product.json` — Shopify 产品上架配置
2. `outputs/amazon_jp_listing.yaml` — Amazon Japan 商品上架配置
3. `outputs/douyin_product.json` — 抖音电商商品上架配置

## 注意事项

1. **PM 修正优先**：`pm_corrections.json` 中的值覆盖 `product_spec.json` 中的对应值。
2. **变体矩阵**：按规格书和 PM 修正共同确定最终变体。
3. **定价公式**：每个平台的定价公式不同，详见 `brand_guidelines.md` 第 3 节。
4. **单位转换**：Shopify 需要同时提供公制和英制单位。
5. **合规要求**：每个平台有不同的认证和内容限制要求。
6. **图片分配**：每个平台的图片数量和排列规则不同。
