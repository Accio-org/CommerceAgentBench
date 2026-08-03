# TrailBlaze 品牌上架指南

## 1. 品牌命名规范

- 英文品牌名：**TrailBlaze**（首字母大写，一个单词）
- 中文品牌名：**越途**
- 产品线英文名：**ThermoJet**
- 产品线中文名：**烈焰**

## 2. 产品标题公式

### Shopify（英文）

格式：`[Brand] [Product Line] [Category] - [Variant Tier] | [Key Feature]`

示例：`TrailBlaze ThermoJet Portable Camping Stove - Solo | Ultralight 98g`

### Amazon Japan（日文）

格式：`[Brand] [Product Line] [Category JP] [Key Feature JP] [Variant Info]`

示例：`TrailBlaze ThermoJet ポータブルキャンプストーブ 3500W チタン合金バーナー ソロ`

注意：
- 标题必须以 "TrailBlaze" 开头
- 标题必须包含 "ThermoJet"
- 标题必须包含 "ポータブル"（portable）
- Parent listing 标题不含具体变体信息

### 抖音电商（中文）

格式：`[Brand ZH] [Product Line ZH] [Category ZH] [Key Feature]`

示例：`越途烈焰户外便携炉具3500W钛合金炉头`

注意：
- 标题不得超过 60 个字符
- 严禁使用广告法违规词汇（见 `compliance/platform_restrictions.md`）

## 3. 定价规则

每个平台的定价基于产品 MSRP（美元），适用 PM 修正后的价格。

### Shopify

- 币种：USD
- 规则：直接使用 MSRP（PM 修正后的值）
- 格式：保留两位小数（字符串），如 `"19.99"` / `"129.99"`

### Amazon Japan

- 币种：JPY
- 规则：`MSRP_USD × JPY汇率`，然后四舍五入到最接近的以 `90` 结尾的整数
- 汇率来源：`reference/exchange_rates.json`
- 公式说明：`raw = MSRP_USD × JPY_RATE`，然后取所有以 `90` 结尾的整数中
  距 `raw` 最近的那个（同距时向上取）
- 格式：整数，无小数

### 抖音电商

- 币种：CNY
- 规则：`MSRP_USD × CNY汇率`，然后四舍五入到最接近的以 `9` 结尾的整数
- 汇率来源：`reference/exchange_rates.json`
- 公式说明：`raw = MSRP_USD × CNY_RATE`，然后取所有以 `9` 结尾的整数中
  距 `raw` 最近的那个（同距时向上取）
- 格式：整数，无小数

## 4. 单位转换规则（Shopify 专用）

Shopify 面向国际市场，metafields 中的规格数据需同时提供**公制和英制**单位。

- 重量：克 (g) → 盎司 (oz)，换算系数 1 oz = 28.3495 g，结果保留 2 位小数
- 尺寸：毫米 (mm) → 英寸 (in)，换算系数 1 in = 25.4 mm，结果保留 2 位小数
- metafield 中用 `" / "` 分隔各变体数据（按 Solo / Kit / Pro 顺序）

## 5. 图片分配规则

所有可用图片列表见 `assets/image_manifest.csv`。

所有平台共同的硬性规则：第 1 张（position=1 / MAIN slot）**必须**是
type=`main` 且 background=`white` 的白底主图（参见 `assets/image_manifest.csv`
的 `type` / `background` 列）。

### Shopify

- 最多 10 张图片
- 排序优先级：白底 main → lifestyle → detail → infographic（同类内部按
  manifest 出现顺序）

### Amazon Japan

- 恰好 7 张图，使用固定的 slot 名称：MAIN + PT01–PT06
- MAIN 必须是白底主图；PT01–PT06 按各 slot 的内容惯例从 manifest 中挑选
  （lifestyle 优先靠前、detail/infographic 靠后）

### 抖音电商

- 最多 5 张图片
- 第 1 张必须是白底主图；后续按 lifestyle → detail → infographic 顺序选取

## 6. SEO 关键词（Shopify 专用）

SEO description 必须包含以下所有关键词（不分大小写）：

- `camping stove`
- `portable`
- `backpacking`
- `ultralight`

## 7. 标签 / Tags（Shopify 专用）

产品标签应包含：`camping`, `stove`, `portable`, `backpacking`, `ultralight`, `outdoor`, `cooking`, `titanium`
