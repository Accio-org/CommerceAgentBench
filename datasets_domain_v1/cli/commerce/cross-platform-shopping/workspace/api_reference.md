# 多平台比价 API 参考文档

**Base URL**: `http://127.0.0.1:3000`  
**认证方式**: Bearer Token  
**Token**: `mock-shopping-token`  
**Header**: `Authorization: Bearer mock-shopping-token`

---

## GET /health

健康检查端点（无需认证）。

**Response**:
```json
{"status": "ok", "service": "cross-platform-shopping-api"}
```

---

## GET /api/platforms

获取所有平台信息（含包邮门槛、运费、配送时效、优惠券）。

**Response**:
```json
{
  "platforms": [
    {
      "id": "JD",
      "name": "鲸东商城",
      "free_shipping_threshold": 99,
      "shipping_fee": 8,
      "delivery_days": 1,
      "coupon": {"threshold": 199, "discount": 20, "description": "满199减20"}
    }
  ]
}
```

---

## GET /api/platform/{platform_id}

获取单个平台详情。

**Path Parameter**: `platform_id` — JD / TM / PDD

---

## GET /api/wishlist

获取购物清单（12件商品，含紧急标记）。

**Response**:
```json
{
  "items": [
    {"item_id": "item_01", "name": "洗衣液(大瓶装)", "quantity": 1, "urgent": false}
  ],
  "total": 12,
  "note": "urgent=true 的商品需要2天内到货，建议选择配送快的平台"
}
```

---

## GET /api/items

获取商品详细信息（品类等）。

---

## GET /api/prices/{platform_id}

获取指定平台的商品价格列表。

**Response**:
```json
{
  "platform": "JD",
  "prices": [
    {"item_id": "item_01", "name": "洗衣液(大瓶装)", "price": 45, "available": true},
    {"item_id": "item_11", "name": "五孔插排", "price": null, "available": false}
  ]
}
```

**注意**: `price=null` 且 `available=false` 表示该平台缺货。

---

## GET /api/prices/compare

获取所有商品在三平台的价格对比表。

**Response**:
```json
{
  "comparison": [
    {
      "item_id": "item_01",
      "name": "洗衣液(大瓶装)",
      "urgent": false,
      "prices": {
        "JD": {"price": 45, "available": true},
        "TM": {"price": 42, "available": true},
        "PDD": {"price": 38, "available": true}
      }
    }
  ]
}
```

---

## GET /api/rules

获取购物规则。

**Response**: 规则列表（R1-R7），详见 `shopping_rules.md`。

---

## POST /api/plan/validate

验证购物方案结构。

**Request Body**:
```json
{
  "shopping_plan": {
    "assignments": [
      {"item_id": "item_01", "platform": "PDD", "price": 38}
    ],
    "platform_summary": {...},
    "total_cost": 460
  }
}
```
