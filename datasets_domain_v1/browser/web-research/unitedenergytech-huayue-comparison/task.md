帮我对我们的阿里国际站店铺 `https://unitedenergytech.en.alibaba.com/`（target）和同行 `https://huayuecorp.en.alibaba.com/`（benchmark）做一次转化率对标，并给出优化建议。

这是公开网络调研，得自己上网查。不要登录任何账号，也不要点最终提交 / 发送询盘 / 提交表单——询盘入口页面可以打开观察并截图，但别点 send / submit。访问不到的页面，在 `evidence/blockers/` 下存阻断截图，并在 manifest 里把对应 access_status 标成 inaccessible。报告里每条具体观察都要能在 `evidence_manifest.json` 里找到对应来源（截图），找不到的就显式标注「未访问」；截图必须真实显示它所声称访问的页面。

## Deliverables

写入以下文件 (路径相对 `/task/outputs/`):

| 文件 | 内容 |
|---|---|
| `optimization_report.md` | 优化报告 Markdown |
| `comparison_table.md` | 对比表 Markdown |
| `evidence_manifest.json` | 结构化证据 (schema 见下) |
| `evidence/target_home.png` | unitedenergytech 首页 |
| `evidence/target_products.png` | unitedenergytech 产品列表 |
| `evidence/target_pdp.png` | unitedenergytech 代表性商详 |
| `evidence/target_company_profile.png` | unitedenergytech 公司主页 |
| `evidence/target_inquiry_path.png` | unitedenergytech 询盘入口 |
| `evidence/benchmark_home.png` | huayuecorp 首页 |
| `evidence/benchmark_products.png` | huayuecorp 产品列表 |
| `evidence/benchmark_pdp.png` | huayuecorp 代表性商详 |
| `evidence/benchmark_company_profile.png` | huayuecorp 公司主页 |
| `evidence/benchmark_inquiry_path.png` | huayuecorp 询盘入口 |

可选：阻断截图存于 `evidence/blockers/`。

`outputs/` 必须只含上述产物 + 可选 `evidence/blockers/`。

### `optimization_report.md` 必含章节

1. **两站访问情况与主营判断**
2. **unitedenergytech 当前运营问题**
3. **huayuecorp 可借鉴点**
4. **店铺结构 / 产品呈现 / 信任背书 / 询盘路径 / 商详页转化设计 对比**
5. **商详到商机转化优化**
6. **商机到订单转化优化**
7. **7/14/30 天保姆级整改清单**
8. **证据索引和访问限制说明**

### `comparison_table.md` 要求

Markdown 表格，至少 5 行 (5 个对比维度)，列至少含：维度 / target 现状 / benchmark 做法 / 差距 / 优化建议。

### `evidence_manifest.json` schema

```json
{
  "target": {
    "url": "https://unitedenergytech.en.alibaba.com/",
    "access_status": "<string: 'visited' | 'inaccessible' | 'search_result_only'>",
    "main_category": "<string>",
    "representative_pdp_url": "<string>",
    "screenshots": {
      "home": "evidence/target_home.png",
      "products": "evidence/target_products.png",
      "pdp": "evidence/target_pdp.png",
      "company_profile": "evidence/target_company_profile.png",
      "inquiry_path": "evidence/target_inquiry_path.png"
    },
    "key_observations": ["<string>"],
    "blocker_screenshots": {"<page_type>": "evidence/blockers/...png"}
  },
  "benchmark": {
    "url": "https://huayuecorp.en.alibaba.com/",
    "access_status": "<string>",
    "main_category": "<string>",
    "representative_pdp_url": "<string>",
    "screenshots": {... 5 screenshots ...},
    "key_observations": ["<string>"],
    "blocker_screenshots": {}
  },
  "comparison_dimensions": [
    {
      "dimension": "<string: e.g. '店铺结构' | '产品呈现' | '信任背书' | '询盘路径' | '商详页转化设计'>",
      "target_observation": "<string: 引用 target.screenshots 的哪张作为证据>",
      "benchmark_observation": "<string: 引用 benchmark.screenshots 的哪张作为证据>",
      "evidence_screenshots": ["<string: 截图路径>"]
    }
  ]
}
```

`comparison_dimensions` 至少 5 项 (覆盖店铺结构 / 产品呈现 / 信任背书 / 询盘路径 / 商详页转化设计)。
所有 `access_status` 必须 ∈ {`visited`, `inaccessible`, `search_result_only`}。
