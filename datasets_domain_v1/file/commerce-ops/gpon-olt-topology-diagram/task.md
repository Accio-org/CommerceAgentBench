我们在给客户做一套 GPON 宽带接入的售前方案，需要你出一张 OLT 网络拓扑效果图的初稿，给客户讲架构用。设备长什么样参考 `workspace/gpon_reference.jpg` 那台就行——这是离线任务，别去访问任何远程图片 / CDN / 外部字体，只能拿这张本地图当外观参考。

架构是 1 个 PON 口经两级分光接 128 台 ONU：先一级 1:4 分光，每路再接一台 1:32 二级分光（4×1:32），合起来 1 × 4 × 32 = 128。两级分光要显式画出来，别拿一个笼统的 `1:128` 气泡糊弄过去。也别编性能、容量、品牌承诺这类没依据的话。

成品都写到 `outputs/` 下，最后这个目录里只留下面这 4 个文件：

| 文件 | 内容 |
|---|---|
| `topology_diagram.html` | 离线 HTML 内嵌 SVG（无外链） |
| `topology_spec.json` | 结构化拓扑说明（schema 见下） |
| `topology_plan.csv` | 设备 + 链路计划表 |
| `design_notes.md` | 简要说明 |

`topology_diagram.html` 是一份内嵌 SVG 的离线 HTML 拓扑图（不得引用任何远程资源），以"GPON OLT 连接效果图"为标题。图的左侧为机房，放置 mini GPON OLT 设备，标注 PON-1 端口及红色指示灯；OLT 通过高速光纤连接至一级分光器（1:4），再由馈线光纤接入 4 台二级分光器（4×1:32），最终通过配线光纤连接至住宅区的 ×128 台 ONU/光猫，为住户提供上网/WiFi、电视/TV、电话三网融合业务。右侧住宅区至少展示 3 栋楼或住宅剪影，并标注"1 PON × 4 × 32 = 128 ONU"容量。售前方案全套材料使用统一术语，图中需出现以下可见标注：

- 标题：`GPON OLT 连接效果图`
- 左侧机房：`机房`、`mini GPON OLT`、`PON-1`、`红色指示灯`
- 中间 ODN：`一级分光器 1:4`、`二级分光器 1:32`、`4×1:32`
- 光纤链路：`高速光纤`、`馈线光纤`、`配线光纤`、`×128`
- 右侧住宅区：`住宅区`、`ONU` 或 `光猫`
- 三类终端：`上网/WiFi`、`电视/TV`、`电话`

`topology_spec.json` 是结构化拓扑规格文件，schema 如下（`capacity_math` 需体现 1 × 4 × 32 = 128 的推导过程）：

```json
{
  "layout_direction": "left_to_right",
  "reference_used": "workspace/gpon_reference.jpg",
  "split_architecture": "1:4 + 4x1:32 = 1:128",
  "pon_ports_used": 1,
  "split_ratio": "1:128",
  "splitter_stages": ["primary_1_4", "secondary_1_32_x4"],
  "capacity_math": "<string: 解释 1 × 4 × 32 = 128>",
  "components": ["equipment_room", "mini_gpon_olt", "pon_1", "primary_splitter_1_4",
                 "secondary_splitter_1_32_x4", "residential_area", "onu_nodes",
                 "wifi_service", "tv_service", "phone_service"],
  "links": [
    {"from": "OLT PON-1", "to": "primary splitter", "kind": "high-speed fiber"},
    {"from": "primary splitter", "to": "four secondary splitters", "kind": "feeder fiber"},
    {"from": "secondary splitters", "to": "ONU/residential area", "kind": "distribution fiber"}
  ]
}
```

`topology_plan.csv` 是设备与链路计划表，列为 `layer,component,count,ratio_or_capacity,upstream,downstream,visual_label,note`，至少包含这些行：机房 OLT / PON-1 / 馈线光纤 / 一级 1:4 分光器 / 4 × 二级 1:32 分光器 / 128 ONU/光猫 / 三类业务场景。

`design_notes.md` 是简要设计说明：交代本图作为 schematic / 示意稿的定位（不是真实施工图）与适用范围，以及如何参考了 `workspace/gpon_reference.jpg`。
