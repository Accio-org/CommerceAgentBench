/**
 * trigger.js — 复刻 `stripe trigger <event>` 与 `stripe fixtures <file>`。
 * 按事件的 fixture 步骤顺序：打印 Setting up/Running fixture for + 真实建对象 + 写 events 表。
 */
import { readFileSync } from "node:fs";
import { REGISTRY } from "./resources.js";
import { insertObject } from "./db.js";
import { nowTs } from "./ids.js";

function genEvt() {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = ""; for (let i = 0; i < 14; i++) s += A[Math.floor(Math.random() * A.length)];
  return "evt_" + s;
}

// 事件 → fixture 步骤。step.resource 有则真实建对象；无（如 payment_page）只打印。
const C = { description: "(created by Stripe CLI)" };
const PI = { amount: "2000", currency: "usd" };
const TRIGGERS = {
  "customer.created": [{ name: "customer", resource: "customers", params: C }],
  "customer.updated": [{ name: "customer", resource: "customers", params: C }, { name: "customer_updated" }],
  "customer.deleted": [{ name: "customer", resource: "customers", params: C }, { name: "customer_deleted" }],
  "product.created": [{ name: "product", resource: "products", params: { name: "myproduct" } }],
  "price.created": [
    { name: "product", resource: "products", params: { name: "myproduct" } },
    { name: "price", resource: "prices", params: { currency: "usd", unit_amount: "1000" } },
  ],
  "payment_intent.created": [{ name: "payment_intent", resource: "payment_intents", params: PI }],
  "payment_intent.succeeded": [{ name: "payment_intent", resource: "payment_intents", params: PI }],
  "payment_intent.payment_failed": [{ name: "payment_intent", resource: "payment_intents", params: PI }],
  "payment_intent.canceled": [{ name: "payment_intent", resource: "payment_intents", params: PI }, { name: "payment_intent_canceled" }],
  "charge.succeeded": [{ name: "payment_intent", resource: "payment_intents", params: PI }],
  "charge.refunded": [
    { name: "payment_intent", resource: "payment_intents", params: PI },
    { name: "refund", resource: "refunds", params: {} },
  ],
  "invoice.created": [
    { name: "customer", resource: "customers", params: C },
    { name: "invoiceitem", resource: "invoiceitems", params: { amount: "2000", currency: "usd" } },
    { name: "invoice", resource: "invoices", params: {} },
  ],
  "invoice.paid": [
    { name: "customer", resource: "customers", params: C },
    { name: "payment_method", resource: "payment_methods", params: { type: "card" } },
    { name: "invoiceitem", resource: "invoiceitems", params: { amount: "2000", currency: "usd" } },
    { name: "invoice", resource: "invoices", params: {} },
    { name: "invoice_pay" },
  ],
  "checkout.session.completed": [
    { name: "product", resource: "products", params: { name: "myproduct" } },
    { name: "price", resource: "prices", params: { currency: "usd", unit_amount: "1000" } },
    { name: "checkout_session", resource: "checkout_sessions", params: { mode: "payment" } },
    { name: "payment_page" }, // 无对应资源，仅打印（对齐真品步骤）
    { name: "payment_method", resource: "payment_methods", params: { type: "card" } },
    { name: "payment_page_confirm" },
  ],
};

export function eventNames() {
  return Object.keys(TRIGGERS);
}

const UNSUPPORTED = (event) =>
  `The event \`${event}\` is not supported by Stripe CLI. To trigger unsupported events, ` +
  `use the Stripe API or Dashboard to perform actions that lead to the event you want to ` +
  `trigger (for example, create a Customer to generate a \`customer.created\` event). ` +
  `You can also create a custom fixture: https://docs.stripe.com/cli/fixtures\n`;

export function runTrigger(db, event) {
  const steps = TRIGGERS[event];
  if (!steps) {
    process.stdout.write("\n" + UNSUPPORTED(event));
    process.exit(1);
  }
  process.stdout.write("\n");
  let last = null;
  for (const step of steps) {
    process.stdout.write(`Setting up fixture for: ${step.name}\nRunning fixture for: ${step.name}\n`);
    if (step.resource && REGISTRY[step.resource] && REGISTRY[step.resource].build) {
      const spec = REGISTRY[step.resource];
      const obj = spec.build(step.params || {});
      insertObject(db, { id: obj.id, object: spec.object, resource: step.resource, created: obj.created ?? nowTs(), data: obj });
      last = obj;
    }
  }
  recordEvent(db, event, last);
  process.stdout.write("Trigger succeeded! Check dashboard for event details.\n");
}

function recordEvent(db, type, dataObject) {
  const ts = nowTs();
  const evt = {
    id: genEvt(),
    object: "event",
    api_version: "2026-05-27.dahlia",
    created: ts,
    data: { object: dataObject || {} },
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    type,
  };
  insertObject(db, { id: evt.id, object: "event", resource: "events", created: ts, data: evt });
}

// stripe fixtures <file>：跑自定义 fixture JSON
export function runFixtureFile(db, path) {
  let data;
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    process.stderr.write(`Error reading fixture: ${e.message}\n`);
    process.exit(1);
  }
  process.stdout.write("\n");
  for (const fx of data.fixtures || []) {
    process.stdout.write(`Setting up fixture for: ${fx.name}\nRunning fixture for: ${fx.name}\n`);
    const m = (fx.path || "").match(/\/v1\/([a-z_]+)/);
    if (m && REGISTRY[m[1]] && REGISTRY[m[1]].build && (fx.method || "post") === "post") {
      const spec = REGISTRY[m[1]];
      const flat = {};
      for (const [k, v] of Object.entries(fx.params || {})) if (typeof v !== "object") flat[k] = String(v);
      const obj = spec.build(flat);
      insertObject(db, { id: obj.id, object: spec.object, resource: m[1], created: obj.created ?? nowTs(), data: obj });
    }
  }
  process.stdout.write("Trigger succeeded! Check dashboard for event details.\n");
}
