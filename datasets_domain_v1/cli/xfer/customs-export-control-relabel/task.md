新一批电池出口海关数据到了（`workspace/customs_data/` 下 5 个 CSV），需要按最新出口管制政策把所有达标供应商重新分类。政策全文在 `workspace/export_control_policy.md`，里面有分类规则、门槛、优先级划分，请仔细读完再动手。

分类结果要同步到三个系统：Jira 做受限供应商的事项追踪，Todoist 建对应的跟进任务队列，Notion 作为知识库把所有达标供应商（含豁免的）的分类结论和依据都记下来。分析师轮值名单在 `workspace/analyst_assignments.csv`，CLI 用法参考 `workspace/cli_reference.md`。
