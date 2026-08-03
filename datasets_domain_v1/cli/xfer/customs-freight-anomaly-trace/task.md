物流对账组年度审计发现 5 个供应商的国际运费出现显著年同比异常波动，详见 `freight_anomaly_alerts.json`。需要你逐个排查每条异常，交叉比对海关数据（`customs_data/`）、运输清单（`shipping_manifests/`）和运费费率表（`freight_rate_schedule.md`），定位每家供应商运费波动的真实原因。

调查完成后，按 `investigation_template.md` 的模板在 DWS 里为每个供应商写一份调查报告；把运输清单整理到 Box 做证据归档——每家供应商单独建一个证据文件夹（文件夹名包含供应商名称），对应清单归档到各自文件夹里，需要更正的清单在文件上留更正备注；并对确属计费错误的供应商在 Stripe 创建运费调整发票。各系统 CLI 用法参考 `cli_reference.md`。
