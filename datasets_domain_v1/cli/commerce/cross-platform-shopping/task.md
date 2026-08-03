我刚搬了新家，列了一份 12 件生活用品的购物清单，想在 3 个电商平台（鲸东商城 JD / 天猫优选 TM / 拼夕夕 PDD）之间比价凑单，做一个总花费最低的跨平台分配方案。

各平台的商品价格、可用性、包邮门槛、运费、配送时效、优惠券都在我们这边接好的购物 API 里查（base URL `http://127.0.0.1:3000`，调用时带 `Authorization: Bearer mock-shopping-token`），完整端点和返回结构看 `workspace/api_reference.md`，常用的就是 `/api/platforms` / `/api/wishlist` / `/api/prices/compare` 几个。完整购物规则（包邮、优惠券、紧急商品配送时效、缺货约束、总花费公式 R1–R7）写在 `workspace/shopping_rules.md` 里，动手前认真读一遍。`workspace/communications/` 里还有室友建议和比价邮件可以参考。

要点是：每件商品只能从一个平台买，紧急商品要满足配送时效，平台运费和优惠券按各自规则结算；总花费 = 各平台商品价格之和 + 运费之和 - 优惠券抵扣之和，目标是让它最小。直觉上"每件选最便宜"通常不是最优——包邮门槛和优惠券门槛会让平台间联动，要全局算。

把方案写到 `outputs/shopping_plan.json`，结构如下（字段名严格按这个写）：

```json
{
  "shopping_plan": {
    "assignments": [
      {"item_id": "item_01", "item_name": "商品名称", "platform": "JD", "price": 0}
    ],
    "platform_summary": {
      "JD":  {"items": ["item_01"], "subtotal": 0, "shipping": 0, "coupon_applied": false, "coupon_discount": 0, "platform_total": 0},
      "TM":  {"items": [],          "subtotal": 0, "shipping": 0, "coupon_applied": false, "coupon_discount": 0, "platform_total": 0},
      "PDD": {"items": [],          "subtotal": 0, "shipping": 0, "coupon_applied": false, "coupon_discount": 0, "platform_total": 0}
    },
    "total_cost": 0,
    "total_savings": 0
  }
}
```

`assignments` 共 12 条，每件商品一条；`platform_summary` 三个平台都给（哪怕没分配商品也保留空壳）；`platform_total = subtotal + shipping - coupon_discount`，`total_cost` = 三个 `platform_total` 之和，`total_savings` = 三个 `coupon_discount` 之和。
