NorthBridge Accessories 准备发 Q3 三个配饰 SKU 的新包装。包装设计组把草稿都堆在 Box 根目录的 `Packaging Artwork/` 下，发布前要把这个 artwork room 清理一遍——通过审的资产挪进 SKU launch packet，有风险的送 Legal Review 并配上工单，过期的归档。

操作环境装好了 **Box CLI**，已认证好；根目录 id 是 `0`，从列出根目录开始按 ID 逐层往下走。`box --help` 看可用命令,常会用到 `folders:items`、`files:download`、`files:move`、`comments:create`、`tasks:create`、`collaborations:create`、`shared-links:create` 几个子命令。没有外网，Box 账户和 `workspace/` 里的文件就是全部的事实来源。

清理动作严格按 `workspace/artwork_policy.md` 来做——具体的 launch / review / archive 去向、reviewer 是谁、task 的 due date、comment 和 task 的措辞都写在里面。大致就是把 `Packaging Artwork/Artwork Intake/` 下每个 active 文件都下载读一遍，按内容判断 SKU 和去向；通过审的在文件上加上 policy 要求的 comment；送 legal 的按 policy 给的 review code 和 due date 建 task；每个有 launch packet 的 SKU 文件夹做一个 shared link；每个有 legal-review 文件夹的 SKU 给 legal reviewer 加一个 viewer collaboration。

注意昨天有人已经处理了一部分，已有的 comment、open task、shared link、collaboration 可能已经满足部分 policy 要求——动手前先看一下 Box 现状，只补缺失的，别造重复的 comment / task / collaboration / shared link。挪文件用 `files:move` 移原文件，不要重新上传或拷贝副本；操作后用 CLI 返回的 live ID 串后续动作，别再靠改完名的文件名定位。Artwork Intake 里 policy 没明确路由的 reference-library 文件留在原处别动。

不用单独写报告，Box 自身的状态就是交付物。
