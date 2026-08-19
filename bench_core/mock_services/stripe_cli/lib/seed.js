/**
 * seed.js — 预置默认数据（复用 REGISTRY.build，保证种子对象与真品同构）。
 * 由 stripe-bench seed 调用，或 STRIPE_MOCK_SEED=1 时在 db 初始化后自动注入。
 */
import { REGISTRY } from "./resources.js";
import { insertObject } from "./db.js";
import { derive } from "./dispatch.js";
import { nowTs } from "./ids.js";
import { readFileSync } from "node:fs";

export function seedDefaults(db) {
  const mk = (resource, params) => {
    const spec = REGISTRY[resource];
    const obj = spec.build(params);
    insertObject(db, { id: obj.id, object: spec.object, resource, created: obj.created ?? nowTs(), data: obj });
    return obj;
  };
  mk("customers", { name: "Acme Inc", email: "billing@acme.com" });
  mk("customers", { name: "Globex Corp", email: "ap@globex.com" });
  const prod = mk("products", { name: "Pro Plan" });
  mk("prices", { currency: "usd", unit_amount: "2000", product: prod.id, "recurring.interval": "month" });
  mk("coupons", { percent_off: "25", duration: "once" });
  return { customers: 2, products: 1, prices: 1, coupons: 1 };
}

/**
 * seedFromFile — 从 JSON 文件加载种子数据。
 * 格式: [{resource, params}, ...]
 * params 中 "$ref:<resource>:<index>" 会解析为该 resource 第 index 个已创建对象的 id。
 */
export function seedFromFile(db, filePath) {
  const entries = JSON.parse(readFileSync(filePath, "utf8"));
  const created = {}; // resource -> [obj, obj, ...]
  const counts = {};

  for (const entry of entries) {
    if (!entry.resource || entry._comment) continue;
    const { resource, params } = entry;
    const spec = REGISTRY[resource];
    if (!spec) {
      process.stderr.write(`seed: unknown resource "${resource}", skipping\n`);
      continue;
    }

    // Resolve $ref:resource:index references in params
    const resolved = {};
    for (const [k, v] of Object.entries(params)) {
      if (typeof v === "string" && v.startsWith("$ref:")) {
        const [, refRes, refIdx] = v.split(":");
        const pool = created[refRes];
        if (pool && pool[Number(refIdx)]) {
          resolved[k] = pool[Number(refIdx)].id;
        } else {
          process.stderr.write(`seed: unresolved ref "${v}" in ${resource}, using as-is\n`);
          resolved[k] = v;
        }
      } else {
        resolved[k] = v;
      }
    }

    const obj = spec.build(resolved);
    derive(db, resource, obj, resolved);
    insertObject(db, { id: obj.id, object: spec.object, resource, created: obj.created ?? nowTs(), data: obj });
    if (!created[resource]) created[resource] = [];
    created[resource].push(obj);
    counts[resource] = (counts[resource] || 0) + 1;
  }

  return counts;
}
