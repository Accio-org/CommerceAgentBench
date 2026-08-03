# 各平台内容合规限制

## 1. 抖音电商 — 广告法合规

根据《中华人民共和国广告法》第九条，以下词汇**严禁**出现在商品标题和描述中：

| 类别 | 违规词汇 |
|------|---------|
| 绝对化用语 | 最好、最轻、最强、最佳、最优 |
| 排他性用语 | 第一、唯一、首选、独家 |
| 极端化用语 | 顶级、极致、绝对、完美 |

如发现以上词汇，须替换为合规表述。例如：
- ~~最轻~~ → 轻量化设计
- ~~第一~~ → 领先
- ~~极致~~ → 出色

## 2. Amazon Japan — 安全警告要求

对于燃气类便携炊具，日本 PSE 法规要求必须在商品详情中包含以下内容：

1. **PSE 认证编号**：从 `compliance/certifications.json` 中获取
2. **安全警告文本**（原文照搬，不得修改）：从 `compliance/certifications.json` 中的 `required_warning_text` 字段获取

这些信息必须放在 listing YAML 的 `compliance` 节点下。

## 3. Shopify — CE 认证

欧盟销售需提供 CE 认证编号，放在 metafields 的 `compliance.ce_cert` 中。认证编号从 `compliance/certifications.json` 获取。

## 4. 抖音电商 — CCC 认证

中国境内销售便携式燃气炉具属于 CCC 认证强制目录，必须在商品配置中包含 CCC 认证信息。认证编号从 `compliance/certifications.json` 获取。
