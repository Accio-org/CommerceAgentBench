帮我给我们的阿里国际站店铺 yushengxm（https://yushengxm.en.alibaba.com）做一份店铺诊断，再对标 10 家阿里国际站同行 + 5 个独立站同行，最后分析跨境 B2B 的市场机会。

这是公开网络调研，得自己上网查——没有现成的同行候选池，所有同行都必须是你真实访问到、有真实 URL 的店铺，别编。调研过程中不要登录任何账号、不要联系商家、不要提交询盘/表单/聊天等任何写入动作。访问不了的页面，截一张阻断截图存到 evidence/blockers/ 下，并在 manifest 里把对应 access_status 标成 inaccessible、填上 blocker_screenshot。

产物放到 outputs/ 下（相对 `/task/outputs/`），只保留下面这些，别留草稿、临时文件或多余目录：

| 文件 | 内容 |
|---|---|
| `shop_diagnosis_report.md` | 诊断报告（Markdown） |
| `evidence_manifest.json` | 结构化证据（schema 见下） |
| `evidence/target_home.png` | yushengxm 首页 |
| `evidence/target_products.png` | yushengxm 产品列表页 |
| `evidence/target_company_profile.png` | yushengxm 公司主页 / About Us |
| `evidence/alibaba_peer_01.png` ~ `alibaba_peer_10.png` | 10 家阿里同行店铺 |
| `evidence/independent_peer_01.png` ~ `independent_peer_05.png` | 5 个独立站同行 |

截图必须真实显示它所声称的页面（占位图、不相关图都算编造）；报告里每个 peer URL、主营判断、痛点、优化建议，都要能在 `evidence_manifest.json` 里找到对应来源，访问不到的就显式标注「未访问」。

### 报告必含章节

1. **目标店铺访问情况与主营判断**
2. **目标店铺诊断** —— 产品、页面、信任背书、询盘路径、痛点
3. **10 家阿里国际站同行对标表** —— 每行: id / URL / positioning / reference_value / 与目标差异
4. **5 个独立站同行对标表** —— 每行: id / URL / positioning / reference_value / 与目标差异
5. **国内市场机会**
6. **国外市场机会**
7. **7/30/90 天行动清单**
8. **证据索引和访问限制说明**

### `evidence_manifest.json` schema

```json
{
  "target": {
    "url": "<string: https://yushengxm.en.alibaba.com>",
    "access_status": "<string: 'visited' | 'inaccessible' | 'search_result_only'>",
    "screenshots": ["evidence/target_home.png", "evidence/target_products.png", "evidence/target_company_profile.png"],
    "main_category": "<string: 主营判断>",
    "key_observations": ["<string>"],
    "blocker_screenshot": "<string: 若 access_status == 'inaccessible' 指向 evidence/blockers/...; 否则空>"
  },
  "alibaba_peers": [
    {
      "id": "<string: alibaba_peer_01>",
      "url": "<string: 同行真实 URL>",
      "access_status": "<string: 'visited' | 'inaccessible' | 'search_result_only'>",
      "screenshot": "<string: evidence/alibaba_peer_0X.png>",
      "positioning": "<string>",
      "reference_value": "<string: 可借鉴点>",
      "blocker_screenshot": "<string: 若 inaccessible>"
    }
  ],
  "independent_peers": [
    {
      "id": "<string: independent_peer_01>",
      "url": "<string: 独立站真实 URL>",
      "access_status": "<string: 'visited' | 'inaccessible' | 'search_result_only'>",
      "screenshot": "<string: evidence/independent_peer_0X.png>",
      "positioning": "<string>",
      "reference_value": "<string>",
      "blocker_screenshot": "<string: 若 inaccessible>"
    }
  ]
}
```

`alibaba_peers` 长度 = 10，`independent_peers` 长度 = 5。所有 access_status 必须 ∈ {`visited`, `inaccessible`, `search_result_only`}。
