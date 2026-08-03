采购日历要大改版。现在 Q2 的产品列表是纯文本行，太丑了——帮我把 Q3 的产品做成一个**正式的表格**（带表头灰色背景的那种，不是 markdown 竖线拼的伪表格），加到 Q2 行后面、Procurement Contacts section 前面。Q3 数据来源是知识库里的 "Q3 2026 New Products" 文档。

Q3 表格上面加一个**黄色的提示框**（bgcolor `#FFF2CC`，border `#FFE599`），写 "⚠️ Q3 prices are provisional — pending supplier contract renewal"。

然后把 Q1 那堆旧条目（"Q1 Archive (to be moved)" section 下面的）挪到单独一个文档里，叫 "Q1 Archive"，放根目录。保留原始格式结构，别只粘纯文本过去。把归档文档的阅读权限给 `uid-archive-a` 和 `uid-archive-b`。

文档标题改成 "Procurement Calendar — All Markets"（二级标题就行）。

改完之后在 Q3 表格里第一个 JP 产品那行加一条 inline 评论："JP market: confirm pricing with Tokyo office"。

日历文档上原本有些 review 评论（在产品行上和 Procurement Contacts 区域），别弄丢了。

`dws` CLI 认证信息在 `workspace/credentials.txt`，没有外网。
