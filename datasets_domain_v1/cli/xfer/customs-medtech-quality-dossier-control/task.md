我们 2026-Q2 的医疗设备出口质量档案该建了。`customs_data/` 下有三份海关出货 CSV（超声和 X 光/CT 两年的数据），需要按 `medtech_quality_policy.md` 里的口径做供应商风险分级，然后把结果同步到三个系统：Google Workspace 的控制表和高管简报、Jira 的跟踪任务、DWS 的质量档案。三个系统之间要用实际返回的 Jira key 和 DWS report id 互相关联，确保团队从任何一个入口都能追溯到另外两边。

具体的筛选标准、字段格式、系统间怎么交叉引用都写在 policy 里了，CLI 用法可以参考 `cli_reference.md`。源 CSV 也要上传到 DWS 存档，Critical 级别里金额最大的那家要导出一份档案备查。
