"""Mock multi-platform shopping API server."""
from __future__ import annotations

import json
import re
from http.server import HTTPServer, BaseHTTPRequestHandler

TOKEN = "mock-shopping-token"
PORT = 3000

PLATFORMS = {
    "JD": {
        "id": "JD",
        "name": "鲸东商城",
        "free_shipping_threshold": 99,
        "shipping_fee": 8,
        "delivery_days": 1,
        "coupon": {"threshold": 199, "discount": 20, "description": "满199减20"},
    },
    "TM": {
        "id": "TM",
        "name": "天猫优选",
        "free_shipping_threshold": 88,
        "shipping_fee": 10,
        "delivery_days": 2,
        "coupon": {"threshold": 149, "discount": 15, "description": "满149减15"},
    },
    "PDD": {
        "id": "PDD",
        "name": "拼夕夕",
        "free_shipping_threshold": 49,
        "shipping_fee": 5,
        "delivery_days": 4,
        "coupon": {"threshold": 79, "discount": 10, "description": "满79减10"},
    },
}

ITEMS = [
    {"id": "item_01", "name": "洗衣液(大瓶装)", "category": "日用清洁", "urgent": False},
    {"id": "item_02", "name": "厨房纸巾(6卷)", "category": "日用清洁", "urgent": False},
    {"id": "item_03", "name": "垃圾袋(3卷装)", "category": "日用清洁", "urgent": False},
    {"id": "item_04", "name": "充电数据线Type-C", "category": "数码配件", "urgent": True},
    {"id": "item_05", "name": "洗碗海绵(5个装)", "category": "厨房用品", "urgent": False},
    {"id": "item_06", "name": "衣架(10只装)", "category": "家居收纳", "urgent": False},
    {"id": "item_07", "name": "LED护眼台灯", "category": "家居照明", "urgent": True},
    {"id": "item_08", "name": "居家拖鞋(2双装)", "category": "家居日用", "urgent": True},
    {"id": "item_09", "name": "纯棉毛巾(4条)", "category": "家纺", "urgent": False},
    {"id": "item_10", "name": "收纳箱(3个装)", "category": "家居收纳", "urgent": False},
    {"id": "item_11", "name": "五孔插排(带USB)", "category": "电工电料", "urgent": True},
    {"id": "item_12", "name": "落地晾衣架", "category": "家居日用", "urgent": False},
]

PRICES = {
    "JD": {
        "item_01": 45, "item_02": 28, "item_03": 15, "item_04": 29,
        "item_05": 12, "item_06": 25, "item_07": 89, "item_08": 35,
        "item_09": 48, "item_10": 65, "item_11": 39, "item_12": 128,
    },
    "TM": {
        "item_01": 42, "item_02": 25, "item_03": 12, "item_04": 35,
        "item_05": 10, "item_06": 22, "item_07": 85, "item_08": 30,
        "item_09": 45, "item_10": 59, "item_11": None,  # 缺货
        "item_12": 119,
    },
    "PDD": {
        "item_01": 38, "item_02": 22, "item_03": 9, "item_04": 19,
        "item_05": 8, "item_06": 18, "item_07": 79, "item_08": 25,
        "item_09": 39, "item_10": 52, "item_11": 32, "item_12": None,  # 缺货
    },
}

WISHLIST = [
    {"item_id": item["id"], "name": item["name"], "quantity": 1, "urgent": item["urgent"]}
    for item in ITEMS
]


class ShoppingHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def check_auth(self) -> bool:
        auth = self.headers.get("Authorization", "")
        if auth != f"Bearer {TOKEN}":
            self.send_error(401, "Unauthorized: invalid or missing token")
            return False
        return True

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?")[0]

        if path == "/health":
            self.send_json({"status": "ok", "service": "cross-platform-shopping-api"})
            return

        if not self.check_auth():
            return

        if path == "/api/platforms":
            self.send_json({"platforms": list(PLATFORMS.values())})
            return

        m = re.match(r"^/api/platform/(JD|TM|PDD)$", path)
        if m:
            pid = m.group(1)
            self.send_json(PLATFORMS[pid])
            return

        if path == "/api/wishlist":
            self.send_json({"items": WISHLIST, "total": len(WISHLIST), "note": "urgent=true 的商品需要2天内到货，建议选择配送快的平台"})
            return

        if path == "/api/items":
            self.send_json({"items": ITEMS})
            return

        m = re.match(r"^/api/prices/(JD|TM|PDD)$", path)
        if m:
            pid = m.group(1)
            platform_prices = []
            for item_id, price in PRICES[pid].items():
                item_info = next(i for i in ITEMS if i["id"] == item_id)
                platform_prices.append({
                    "item_id": item_id,
                    "name": item_info["name"],
                    "price": price,
                    "available": price is not None,
                })
            self.send_json({"platform": pid, "prices": platform_prices})
            return

        if path == "/api/prices/compare":
            comparison = []
            for item in ITEMS:
                item_id = item["id"]
                row = {"item_id": item_id, "name": item["name"], "urgent": item["urgent"], "prices": {}}
                for pid in ["JD", "TM", "PDD"]:
                    p = PRICES[pid].get(item_id)
                    row["prices"][pid] = {"price": p, "available": p is not None}
                comparison.append(row)
            self.send_json({"comparison": comparison})
            return

        if path == "/api/rules":
            rules = [
                {"id": "R1", "name": "单平台购买", "description": "每件商品只能从一个平台购买，不能拆分到多个平台。"},
                {"id": "R2", "name": "包邮门槛", "description": "每个平台有各自的包邮门槛。单平台订单金额 >= 门槛则免运费，否则收取该平台的固定运费。"},
                {"id": "R3", "name": "平台优惠券", "description": "每个平台提供一张优惠券（满减券）。单平台订单金额达到门槛时自动抵扣。每平台最多使用一张。"},
                {"id": "R4", "name": "紧急商品配送", "description": "标记 urgent=true 的商品必须在2天内送达。配送天数 > 2天的平台（如拼夕夕4天）不可用于紧急商品。"},
                {"id": "R5", "name": "商品可用性", "description": "部分商品在某些平台缺货(price=null/available=false)，不可从该平台购买。"},
                {"id": "R6", "name": "优化目标", "description": "最小化总花费 = Σ(各平台商品价格) + Σ(各平台运费) - Σ(各平台优惠券抵扣)。"},
                {"id": "R7", "name": "优惠券门槛计算", "description": "优惠券门槛判定基于该平台的商品原价总额（未扣除优惠券前）。运费不计入门槛。"},
            ]
            self.send_json({"rules": rules})
            return

        self.send_error(404, f"Unknown path: {path}")

    def do_POST(self):
        if not self.check_auth():
            return

        path = self.path.split("?")[0]

        if path == "/api/plan/validate":
            content_len = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_len)
            try:
                data = json.loads(body)
            except json.JSONDecodeError:
                self.send_json({"valid": False, "errors": ["Invalid JSON"]}, 400)
                return

            errors = []
            if "shopping_plan" not in data:
                errors.append("Missing top-level key: shopping_plan")
            else:
                plan = data["shopping_plan"]
                if "assignments" not in plan:
                    errors.append("Missing key: shopping_plan.assignments")

            if errors:
                self.send_json({"valid": False, "errors": errors}, 400)
            else:
                self.send_json({"valid": True, "message": "Structure validated."})
            return

        self.send_error(404, f"Unknown path: {path}")


def main():
    server = HTTPServer(("0.0.0.0", PORT), ShoppingHandler)
    print(f"Cross-platform shopping mock server running on http://127.0.0.1:{PORT}")
    print(f"Auth token: Bearer {TOKEN}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    server.server_close()


if __name__ == "__main__":
    main()
