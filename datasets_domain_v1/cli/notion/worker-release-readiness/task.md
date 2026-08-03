production 的 supplier portal order-sync worker 要为周一的 cutover window 做好准备。用本机的 `ntn` CLI 操作 Notion（workspace 已经接好，不需要浏览器或外网）。完整步骤看 `workspace/release_readiness_brief.md`——按它来应用 environment 改动、部署、把 sync 调到能干净 cutover 的状态。worker ID 不要从这份说明里猜，自己从 workspace 现状里查。

不要碰本次 release 之外的任何 worker。Notion workspace 的最终状态就是交付物，不需要写额外的输出文件。
