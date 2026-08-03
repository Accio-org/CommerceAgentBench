NorthBridge Accessories 是一家从中国代工厂采购的消费电子配饰品牌，所有供应商的入网材料都放在 Box 账户 `Suppliers/` 下面，每家一个子文件夹。该做一次例行的合规复审了——结果要落在 Box 上，方便 QA reviewer 后续跟进。

操作环境装好了 **Box CLI**，已经用合规账号认证好（直接跑 `box`，不需要 `box login`），用法和真实 Box CLI 一样。`box --help` 看可用命令，常会用到 `folders:items`、`folders:get`、`files:get`、`files:download`、`files:move`、`tasks:create`、`collaborations:create`、`shared-links:create`。根目录 id 是 `0`，从根目录或 `Suppliers/` 开始按 ID 往下走；文档要看内容用 `box files:download` 存下来再打开。没有外网，Box 账户和 `workspace/` 里的文件就是全部的事实来源。

合规清单、审计日期、文档命名约定、合规和不合规供应商各自要做什么后续动作都在 `workspace/compliance_policy.md` 里，**动手前认真读一遍**。`workspace/supplier_directory.csv` 是供应商目录，列了每家文件夹名对应的 short token（出现在文件名里）、所在城市、以及 NorthBridge 从他家采购的产品线。

按 policy 跑这次审计：把 `Suppliers/` 下每家文件夹都过一遍，证书要读内容、别只看文件名；把文档室理顺，按 policy 判每家合规不合规，然后做 policy 要求的后续动作。**所有改动直接落在 Box 上（task / collaboration / shared link / 文件挪动），那些 Box 改动就是这次审计的记录**，不另外写总结文件。

几条操作约束：

- 以 Box 当前状态为准，folder 和 file 用 CLI 返回的 live ID 串后续动作，开始挪文件后别再只靠文件夹名定位。
- 中途出错要 resume 时先看 Box 现状再续，不要重复建 task / collaboration / shared link，也不要重新上传或拷贝副本。
- 只挪 filename / body evidence 真的判定为放错位置的文档；不要 trash / delete / 重新上传任何文档。
