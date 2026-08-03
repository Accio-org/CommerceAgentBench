帮一款痘痘贴方向的产品做一套 Alibaba 国际站英文 listing 优化包：访问原始产品页，再公开搜索 ≥5 个竞品页面，产出结构化关键词调研、20 个 SEO 标题、完整 listing pack、证据 manifest 和截图。

几点要注意：这是公开网页研究，不要登录真实账号、不要调用真实写入 API。原始产品其实是免缝皮肤闭合胶带（skin closure tape），但最终产物必须切到痘痘贴 / acne patch 方向，别写成 wound closure tape。截图要存成真实图片文件放在 `outputs/evidence/` 下（只在 manifest 里写路径不算）；临时脚本、缓存放工作目录的 `tmp/`，`outputs/` 只放最终交付物 + 截图。

输入在 workspace/ 里：

- `target_product.md` — 原始 Alibaba 产品页信息
- `seo_constraints.md` — 标题字符上限、核心词、标题公式约束
- `state_manifest.md` — 本地状态约束

请这样做：

1. 访问 `target_product.md` 里的原始 Alibaba 商品页，记录可见标题、卖点、规格或应用场景，截图存到 `outputs/evidence/source_product.png`。
2. 公开搜索 acne patch / pimple patch / hydrocolloid patch 相关竞品页面，至少 5 个可访问页面作为关键词来源，每个截图存到 `outputs/evidence/competitor_0X.png`。
3. 公开搜索结果页截图存到 `outputs/evidence/search_results.png`。
4. 对每个竞品来源记录 URL、页面/品牌名、可见关键词、卖点、适用场景，写入 `evidence_manifest.json`。
5. 输出 20 个英文 Alibaba SEO 标题；每个 ≤128 个英文字符；每条必须包含 `acne patch` / `pimple patch` / `hydrocolloid` 中至少一个；不要重复堆词；禁止使用医疗功效词（见下）。
6. 输出完整 listing 优化包：英文短描述、5 个英文 bullet points、10 个英文 search terms、标题 A/B 分组建议。

## Deliverable

产物写到 `/task/outputs/` 下（`outputs/` 只保留交付物 + `evidence/`，不要留临时 JS、缓存、抓取脚本）：

### `outputs/keyword_research.md`

UTF-8 Markdown 文件 (任意结构)，描述原始页观察、5 个竞品来源观察、关键词分组、长尾词、风险词说明。

### `outputs/titles.md`

UTF-8 Markdown 文件，**必须使用 Markdown 表格** (含表头 + 分隔行 + 20 个数据行)，列含义为：

```
| # | Title | Core term | Long-tail intent | Characters |
|---|-------|-----------|------------------|------------|
| 1 | <title> | acne patch | <intent> | <int> |
...
```

**Field constraints**：

| Field | Type | Format |
|---|---|---|
| `Title` | string | ≤128 个英文字符；必须包含 `acne patch` / `pimple patch` / `hydrocolloid` 中至少一个 (case-insensitive) |
| `Core term` | string | 标题里实际命中的核心词 |
| `Characters` | integer | `len(Title)` 的整数计数 |

**禁止词** (case-insensitive，任何标题中都不得出现)：
- `healing`
- `treatment`
- `therapy`
- `scar prevention`
- `inflammation reduction`
- `redness relief`
- `skin repair`
- `skin removal`

### `outputs/listing_pack.md`

UTF-8 Markdown 文件，必须包含：

- 英文短描述 (短描述章节)。
- **恰好 5 个 bullet points** (用 Markdown `-` 或 `*` 起始的列表行，连续 5 个)。
- **恰好 10 个 search terms** (Markdown 列表 / 表格 / 编号格式皆可，search-terms 段下须恰好 10 个条目)。
- 标题 A/B 分组建议 (`A/B`、`Group A`、`Group B`、`Variant A` 等任一表述出现即可)。

### `outputs/evidence_manifest.json`

UTF-8 JSON 对象，**顶层必须含**：

| Key | Type | 说明 |
|---|---|---|
| `source_product` | object | 必含 `url` 字段 |
| `search` | object | 必含 `url` 字段 (公开搜索/检索页 URL) |
| `competitors` | array | **长度 == 5**；每个对象含 `url`、`screenshot`、`status`、`keywords` |
| `keyword_groups` | object 或 array | 任意非空结构 |

### Evidence 截图

`outputs/evidence/` 下必须含 7 张文件 (PNG/JPG/WebP，文件大小 > 0)：

- `source_product.png` (或 jpg/webp)
- `search_results.png`
- `competitor_01.png`
- `competitor_02.png`
- `competitor_03.png`
- `competitor_04.png`
- `competitor_05.png`

(支持 `.png`/`.jpg`/`.jpeg`/`.webp` 格式，但**完整文件名前缀必须与上方列表一致**。)
