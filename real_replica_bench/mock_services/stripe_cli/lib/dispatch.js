/**
 * dispatch.js — argv 解析 + 路由。复刻 stripe 1.42.1 的命令面（核心子集）。
 */
import {
  getDb,
  insertObject,
  getObject,
  getById,
  updateObject,
  markDeleted,
  listObjects,
  audit,
  setConfig,
  unsetConfig,
  listConfig,
} from "./db.js";
import { REGISTRY, isResource, staticData } from "./resources.js";
import { requireApiKey, resolveApiKey } from "./auth.js";
import { printJson, printError, listEnvelope, deletedEnvelope } from "./output.js";
import { printTopLevelHelp, printResources, printResourceUsage, printOperationHelp, printVersion } from "./help.js";
import {
  errUnknownCommand, errExactlyOneArg, errResourceMissing, errParameterMissing,
  errInvalidCurrency, errInvalidEnum, errInvalidIntFlag, errParameterUnknown,
  CURRENCIES, PAYMENT_METHOD_TYPES, CHECKOUT_MODES, PLAN_INTERVALS,
  COLLECTION_METHODS, SHIPPING_RATE_TYPES,
} from "./errors.js";
import { runTrigger, runFixtureFile } from "./trigger.js";

const HEX = "0123456789abcdef";
function randomHex(n) { let s = ""; for (let i = 0; i < n; i++) s += HEX[Math.floor(Math.random() * 16)]; return s; }

// 全局 flag（取值型），其余 --xxx 视为请求参数
const GLOBAL_VALUE_FLAGS = new Set([
  "api-key", "color", "config", "device-name", "log-level", "project-name",
  "idempotency", "expand", "stripe-account", "stripe-context", "stripe-version",
]);
const GLOBAL_BOOL_FLAGS = new Set([
  "confirm", "dry-run", "live", "show-headers", "dark-style", "help",
  "interactive",
]);

function kebabToSnake(s) {
  return s.replace(/-/g, "_");
}

function accountName() {
  return process.env.STRIPE_MOCK_ACCOUNT || "acct_1MockAccount00000";
}

// --dry-run：打印将发送的请求，不落库（对齐真品 dry_run 结构）
function printDryRun(method, url, params) {
  const sorted = {};
  for (const k of Object.keys(params).sort()) sorted[k] = params[k];
  printJson({
    dry_run: {
      method,
      url,
      params: sorted,
      headers: {
        Authorization: "Bearer sk_test_" + "*".repeat(91) + "MOCK",
        "Content-Type": "application/x-www-form-urlencoded",
      },
    },
  });
}

// 参数校验：整数 flag（CLI 端）+ currency / 枚举闭集（API 端）。
// 返回 true 表示已打印错误（调用方应 return）；null 表示通过。
const INT_FLAGS = ["amount", "unit_amount", "fixed_amount.amount"];
function validateParams(resource, params) {
  for (const f of INT_FLAGS) {
    if (params[f] !== undefined && !/^-?\d+$/.test(String(params[f]))) {
      process.stderr.write(errInvalidIntFlag(f.replace(/[_.]/g, "-"), params[f]));
      process.exit(1);
    }
  }
  if (params.currency !== undefined && !CURRENCIES.has(String(params.currency).toLowerCase())) {
    printError(errInvalidCurrency(params.currency));
    return true;
  }
  if (resource === "coupons" && params.duration !== undefined &&
      !["once", "repeating", "forever"].includes(params.duration)) {
    printError(errInvalidEnum("duration", "once, repeating, or forever"));
    return true;
  }
  if (resource === "payment_methods" && params.type !== undefined &&
      !PAYMENT_METHOD_TYPES.has(params.type)) {
    printError(errInvalidEnum("type", [...PAYMENT_METHOD_TYPES].join(", ")));
    return true;
  }
  if (resource === "checkout_sessions" && params.mode !== undefined &&
      !CHECKOUT_MODES.has(params.mode)) {
    printError(errInvalidEnum("mode", [...CHECKOUT_MODES].join(", ")));
    return true;
  }
  if ((resource === "plans" || resource === "prices") && params.interval !== undefined &&
      !PLAN_INTERVALS.has(params.interval)) {
    printError(errInvalidEnum("interval", [...PLAN_INTERVALS].join(", ")));
    return true;
  }
  if ((resource === "subscriptions" || resource === "invoices") &&
      params.collection_method !== undefined &&
      !COLLECTION_METHODS.has(params.collection_method)) {
    printError(errInvalidEnum("collection_method", [...COLLECTION_METHODS].join(", ")));
    return true;
  }
  if (resource === "shipping_rates" && params.type !== undefined &&
      !SHIPPING_RATE_TYPES.has(params.type)) {
    printError(errInvalidEnum("type", [...SHIPPING_RATE_TYPES].join(", ")));
    return true;
  }
  return null;
}

// 共享参数名（所有资源都接受，不算 unknown）
const GLOBAL_PARAMS = new Set(["expand", "idempotency_key", "metadata", "stripe_account"]);

function validateUnknownParams(spec, params) {
  if (!spec.knownParams) return null;
  for (const key of Object.keys(params)) {
    if (key === "metadata") continue;
    if (key.includes(".") || key.includes("[")) continue;
    if (GLOBAL_PARAMS.has(key)) continue;
    if (!spec.knownParams.has(key)) {
      printError(errParameterUnknown(key));
      return true;
    }
  }
  return null;
}

// derive：把"派生自被引用对象"的字段从引用对象算出来（模板冻结值无法跟随入参）。
// exported: seed.js 的 seedFromFile 也走这条路径，保证种子对象与 CLI create 同构。
export function derive(db, resource, obj, params) {
  if (resource === "invoices" || resource === "invoiceitems") {
    if (params.customer) {
      const c = getById(db, params.customer);
      if (c) {
        if ("customer_email" in obj) obj.customer_email = c.email;
        if ("customer_name" in obj) obj.customer_name = c.name;
      }
    }
  }
  // invoiceitems: real Stripe derives amount from the referenced price
  // (amount = price.unit_amount × quantity) instead of leaving a template
  // default, and rolls the item up into the parent draft invoice's totals.
  // Ref: https://docs.stripe.com/api/invoiceitems (price/quantity/amount)
  //      https://docs.stripe.com/api/invoices/object (draft total/amount_due)
  if (resource === "invoiceitems") {
    const qty = params.quantity !== undefined ? Number(params.quantity) || 1 : Number(obj.quantity) || 1;
    let unitAmount;
    if (params.unit_amount !== undefined) unitAmount = Number(params.unit_amount);
    else if (params.unit_amount_decimal !== undefined) unitAmount = Number(params.unit_amount_decimal);
    if (params.price) {
      const price = getById(db, params.price);
      if (price) {
        if (unitAmount === undefined && typeof price.unit_amount === "number") unitAmount = price.unit_amount;
        if (price.currency && params.currency === undefined) obj.currency = price.currency;
        if (obj.pricing?.price_details) {
          obj.pricing.price_details.price = price.id;
          if (price.product) obj.pricing.price_details.product = price.product;
        }
      }
    }
    if (params.amount !== undefined) {
      obj.amount = Number(params.amount);
      if (unitAmount === undefined && qty) unitAmount = obj.amount / qty;
    } else if (unitAmount !== undefined) {
      obj.amount = unitAmount * qty;
    }
    obj.quantity = qty;
    if ("quantity_decimal" in obj) obj.quantity_decimal = String(qty);
    if (unitAmount !== undefined && Number.isFinite(unitAmount) && obj.pricing && "unit_amount_decimal" in obj.pricing) {
      obj.pricing.unit_amount_decimal = String(unitAmount);
    }
    // Attach to invoice + recompute draft totals (real Stripe rolls up
    // pending invoice items into the draft invoice's amounts).
    const invoiceId = params.invoice || obj.invoice;
    if (invoiceId && typeof obj.amount === "number") {
      const inv = getObject(db, "invoices", invoiceId);
      if (inv) {
        obj.invoice = inv.id;
        for (const f of ["subtotal", "subtotal_excluding_tax", "total", "total_excluding_tax", "amount_due", "amount_remaining"]) {
          if (typeof inv[f] === "number") inv[f] += obj.amount;
        }
        updateObject(db, "invoices", inv.id, inv);
      }
    }
  }
  // refunds: 不传 amount 时退全额（从引用的 charge 取 amount）
  if (resource === "refunds") {
    const chargeId = params.charge || obj.charge;
    if (chargeId && params.amount === undefined) {
      const charge = getById(db, chargeId);
      if (charge && typeof charge.amount === "number") {
        obj.amount = charge.amount;
      }
    }
    if (chargeId) obj.charge = chargeId;
    if (params.amount !== undefined) obj.amount = Number(params.amount);
  }
  // charges: amount_captured 等应跟随入参 amount（模板冻结在采集时的值）
  if (resource === "charges" && params.amount !== undefined) {
    const a = Number(params.amount);
    if ("amount_captured" in obj) obj.amount_captured = a;
    const pmd = obj.payment_method_details;
    if (pmd?.card_present) { pmd.card_present.amount_authorized = a; }
    if (pmd?.card?.amount_authorized !== undefined) pmd.card.amount_authorized = a;
    if (pmd?.card?.overcapture?.maximum_amount_capturable !== undefined) pmd.card.overcapture.maximum_amount_capturable = a;
  }
  if (resource === "subscription_items" && params.price) {
    const price = getById(db, params.price);
    if (price) {
      const ua = price.unit_amount, intv = price.recurring?.interval, cur = price.currency;
      if (obj.price) {
        if (typeof ua === "number") { obj.price.unit_amount = ua; obj.price.unit_amount_decimal = String(ua); }
        if (obj.price.recurring && intv) obj.price.recurring.interval = intv;
        if (cur) obj.price.currency = cur;
      }
      if (obj.plan) {
        if (typeof ua === "number") { obj.plan.amount = ua; obj.plan.amount_decimal = String(ua); }
        if (intv) obj.plan.interval = intv;
        if (cur) obj.plan.currency = cur;
      }
    }
  }
  const priceKey = Object.keys(params).find((k) => /line_items\[\d+\]\[price\]$/.test(k) || /items\[\d+\]\[price\]$/.test(k));
  if (priceKey) {
    const price = getById(db, params[priceKey]);
    if (price && typeof price.unit_amount === "number") {
      const ua = price.unit_amount;
      if (resource === "checkout_sessions") {
        const qk = Object.keys(params).find((k) => /\[quantity\]$/.test(k));
        const qty = qk ? Number(params[qk]) : 1;
        if ("amount_subtotal" in obj) obj.amount_subtotal = ua * qty;
        if ("amount_total" in obj) obj.amount_total = ua * qty;
      }
      if (resource === "subscriptions") {
        const it = obj.items?.data?.[0];
        if (it?.price) {
          it.price.id = price.id;
          it.price.unit_amount = ua; it.price.unit_amount_decimal = String(ua);
          if (price.product) it.price.product = price.product;
          if (it.price.recurring && price.recurring) it.price.recurring.interval = price.recurring.interval;
        }
        if (it?.plan) {
          it.plan.id = price.id;
          it.plan.amount = ua; it.plan.amount_decimal = String(ua);
          if (price.product) it.plan.product = price.product;
          if (price.recurring) it.plan.interval = price.recurring.interval;
        }
        if (obj.plan) {
          obj.plan.id = price.id;
          obj.plan.amount = ua; obj.plan.amount_decimal = String(ua);
          if (price.product) obj.plan.product = price.product;
          if (price.recurring) obj.plan.interval = price.recurring.interval;
        }
      }
    }
  }
}

// --expand：把顶层引用 id 字段展开成内嵌对象（基础版，仅顶层路径）
function expandObject(db, obj, expand) {
  if (!expand) return obj;
  const out = { ...obj };
  for (const path of String(expand).split(",").map((s) => s.trim())) {
    const ref = out[path];
    if (typeof ref === "string" && /^[a-z]+_/.test(ref)) {
      const sub = getById(db, ref);
      if (sub) out[path] = sub;
    }
  }
  return out;
}

// destructive 命令确认。总打横幅；无 -c 则读 stdin，需输入 "yes"。
function confirmDestructive(flags, verb) {
  process.stdout.write(
    `This command will be executed on the account with the following details:\n` +
      `> Mode: Test\n> Account Name: ${accountName()}\n`,
  );
  if (flags.confirm) return true;
  process.stdout.write(`Are you sure you want to perform the command: ${verb}?\nEnter 'yes' to confirm: `);
  let answer = "";
  try {
    const buf = Buffer.alloc(256);
    const n = require("node:fs").readSync(0, buf, 0, 256);
    answer = buf.toString("utf8", 0, n).trim();
  } catch {}
  if (answer === "yes") return true;
  process.stdout.write("Exiting without execution. User did not confirm the command.\n");
  return false;
}

// 把 "metadata[key]=value" / "recurring[interval]=month" / "enabled_events[]=val" 写进 params
function applyNested(params, raw) {
  const eq = raw.indexOf("=");
  if (eq < 0) return;
  const lhs = raw.slice(0, eq);
  const val = raw.slice(eq + 1);
  // Normalize hyphen to underscore in the entire lhs before matching
  const lhsNorm = lhs.replace(/-/g, "_");
  // Array append: "enabled_events[]=val" or "enabled_events[0]=val" or "enabled-events[0]=val"
  const mArr = lhsNorm.match(/^(\w+)\[(\d*)\]$/);
  if (mArr) {
    const top = mArr[1];
    if (top !== "metadata") {
      if (!Array.isArray(params[top])) params[top] = params[top] !== undefined ? [params[top]] : [];
      params[top].push(val);
      return;
    }
  }
  const m = lhsNorm.match(/^(\w+)\[(\w+)\]$/);
  if (m) {
    const [, top, sub] = m;
    if (top === "metadata") {
      params.metadata = params.metadata || {};
      params.metadata[sub] = val;
    } else {
      params[`${top}.${sub}`] = val;
    }
  } else {
    params[lhs] = val;
  }
}

function parseArgs(argv) {
  const flags = {}; // 全局/控制 flag
  const params = {}; // 请求参数
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "-d" || arg === "--data") {
      applyNested(params, argv[++i] ?? "");
      continue;
    }
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      let key = eq >= 0 ? arg.slice(2, eq) : arg.slice(2);
      let val = eq >= 0 ? arg.slice(eq + 1) : undefined;

      if (GLOBAL_BOOL_FLAGS.has(key)) {
        flags[key] = true;
        continue;
      }
      if (GLOBAL_VALUE_FLAGS.has(key)) {
        if (val === undefined) val = argv[++i];
        flags[key] = val;
        continue;
      }
      // 否则是请求参数（支持点号嵌套 --address.city；重复 flag 收集成数组）
      if (val === undefined) val = argv[++i];
      // --key[subkey]=value (e.g. --metadata[collection]=summer) → delegate to applyNested
      if (key.includes("[") && key.includes("]")) {
        applyNested(params, `${key}=${val}`);
        continue;
      }
      const norm = key.includes(".") ? key.split(".").map(kebabToSnake).join(".") : kebabToSnake(key);
      // --metadata key=value [key=value …] → treat as multiple metadata[key]=value
      // pairs (matches real stripe CLI, which accepts `--metadata k1=v1 k2=v2 …`
      // as a greedy varargs flag terminated by the next `-`/`--` flag or EOL).
      // Previously we only consumed the immediately-following token, which
      // silently dropped every k=v after the first; agents that wrote
      // `--metadata priority=A region=us total=12345` got only `priority=A`.
      if (norm === "metadata" && val && val.includes("=")) {
        applyNested(params, `metadata[${val.split("=")[0]}]=${val.slice(val.indexOf("=") + 1)}`);
        while (i + 1 < argv.length) {
          const next = argv[i + 1];
          if (typeof next !== "string") break;
          if (next.startsWith("-")) break;          // next flag
          if (!next.includes("=")) break;           // not a k=v pair
          applyNested(params, `metadata[${next.split("=")[0]}]=${next.slice(next.indexOf("=") + 1)}`);
          i += 1;
        }
        continue;
      }
      if (norm in params) params[norm] = (Array.isArray(params[norm]) ? params[norm] : [params[norm]]).concat(val);
      else params[norm] = val;
      continue;
    }
    if (arg.startsWith("-") && arg.length === 2) {
      const short = { p: "project-name", e: "expand", i: "idempotency", s: "show-headers", c: "confirm", v: "stripe-version", h: "help" }[arg[1]];
      if (short) {
        if (GLOBAL_BOOL_FLAGS.has(short)) flags[short] = true;
        else flags[short] = argv[++i];
        continue;
      }
      positional.push(arg);
      continue;
    }
    positional.push(arg);
  }
  return { flags, params, positional };
}

function isAuthed() {
  try { return !!resolveApiKey(getDb(), {}, "default"); } catch { return false; }
}

export function dispatch(argv) {
  // 顶层无参 → help
  if (argv.length === 0) {
    printTopLevelHelp(isAuthed());
    return;
  }

  const head = argv[0];

  // 顶层 version / help
  if (head === "version" || head === "--version" || head === "-v") return printVersion();
  if (head === "--help" || head === "-h" || head === "help") {
    if (head === "help" && argv[1] && isResource(argv[1])) {
      if (argv[2]) {
        printOperationHelp(argv[1], argv[2]);
      } else {
        printResourceUsage(argv[1]);
      }
      return;
    }
    printTopLevelHelp(isAuthed());
    return;
  }
  if (head === "resources") return printResources();

  const db = getDb();
  const { flags, params, positional } = parseArgs(argv.slice(1));
  const profile = flags["project-name"] || "default";

  // 流式/外部命令：边界桩（不真转发/不联网；评测自动化下不挂起）。详见 README "scoped boundary"。
  const BOUNDARY = {
    listen: "Ready! Your webhook signing secret is whsec_mockSigningSecret0123456789 (^C to quit)\n",
    logs: "Ready! You're now waiting to receive API request logs (^C to quit)\n",
    samples: "[mock boundary] `stripe samples` clones official sample repos (network); not supported in the mock.\n",
    serve: "[mock boundary] `stripe serve` serves static files locally; not supported in the mock.\n",
    open: "[mock boundary] `stripe open` opens dashboard pages in a browser; not supported in the mock.\n",
    daemon: "[mock boundary] `stripe daemon` runs a gRPC server; not supported in the mock.\n",
    sandbox: "[mock boundary] `stripe sandbox` manages sandboxes; not supported in the mock.\n",
    plugin: "[mock boundary] `stripe plugin` manages plugins; not supported in the mock.\n",
    community: "[mock boundary] `stripe community` opens chat; not supported in the mock.\n",
    feedback: "[mock boundary] `stripe feedback` collects feedback; not supported in the mock.\n",
  };
  if (BOUNDARY[head]) { process.stdout.write(BOUNDARY[head]); return; }

  // 元命令
  if (head === "config") return cmdConfig(db, argv.slice(1));
  if (head === "whoami") return cmdWhoami(db, flags, profile);
  if (head === "login") {
    if (flags.help) { printOperationHelp("login", null); return; }
    return cmdLogin(db, flags, profile);
  }
  if (head === "logout") return cmdLogout(db, profile);
  if (head === "completion") {
    process.stdout.write("# completion script (mock placeholder)\n");
    return;
  }
  if (head === "trigger") {
    const event = positional[0];
    if (!event) { process.stderr.write("Error: trigger requires an event name\n"); process.exit(1); }
    requireApiKey(db, flags, profile);
    return runTrigger(db, event);
  }
  if (head === "fixtures") {
    const file = positional[0];
    if (!file) { process.stderr.write("Error: fixtures requires a file path\n"); process.exit(1); }
    requireApiKey(db, flags, profile);
    return runFixtureFile(db, file);
  }

  // 通用命名空间资源：billing meters list → billing_meters list, checkout sessions create, etc.
  const NS = ["billing","billing_portal","checkout","climate","entitlements","financial_connections","forwarding","identity","issuing","radar","reporting","terminal","treasury","tax","test_helpers"];
  if (NS.includes(head)) {
    if (positional[0]) {
      const compound = `${head}_${positional[0]}`;
      if (isResource(compound)) return cmdResource(db, compound, flags, params, positional.slice(1));
    }
    printResourceUsage(head);
    return;
  }

  // 资源命令
  if (isResource(head)) {
    return cmdResource(db, head, flags, params, positional);
  }

  // 通用 HTTP：get/post/delete /v1/<resource>[/<id>]
  if (head === "get" || head === "post" || head === "delete") {
    return cmdHttp(db, head, flags, params, positional, profile);
  }

  // 未知顶层命令 → 真品行为：stdout，exit 1
  process.stdout.write(errUnknownCommand(head));
  process.exit(1);
}

function cmdResource(db, resource, flags, params, positional) {
  const spec = REGISTRY[resource];
  const operation = positional[0];

  // 裸资源（无操作）→ 打印 usage，exit 0（真品行为）
  if (!operation) {
    printResourceUsage(resource);
    return;
  }
  // <res> <op> --help → per-operation help (falls back to resource usage)
  if (flags.help) {
    printOperationHelp(resource, operation);
    return;
  }

  if (!spec.operations.includes(operation)) {
    // 真品：未知/未实现操作 → 打印资源 usage
    printResourceUsage(resource);
    return;
  }

  const profile = flags["project-name"] || "default";

  // 静态参考资源（balance/country_specs/tax_codes）：serve 采集数据
  if (spec._static) {
    requireApiKey(db, flags, profile);
    const data = staticData(spec._static);
    if (operation === "retrieve") {
      if (spec._singleton) return printJson(data);       // balance 单例
      const id = positional[1];
      if (!id) { process.stderr.write(errExactlyOneArg(resource, operation)); process.exit(1); }
      const hit = (data.data || []).find((o) => o.id === id);
      return hit ? printJson(hit) : printError(errResourceMissing(spec.object, id));
    }
    if (operation === "list") return printJson(data);     // 已是 list 信封
  }

  switch (operation) {
    case "create": {
      requireApiKey(db, flags, profile);
      { const ve = validateParams(resource, params); if (ve) return ve; }
      { const ve = validateUnknownParams(spec, params); if (ve) return ve; }
      for (const req of spec.required || []) {
        if (params[req] === undefined) return printError(errParameterMissing(req));
      }
      // refunds: require charge or payment_intent (real Stripe behavior)
      if (resource === "refunds" && !params.charge && !params["payment-intent"] && !params.payment_intent) {
        return printError({
          error: { message: "One of the following params should be provided for this request: payment_intent or charge.", type: "invalid_request_error" }
        });
      }
      // Validate referenced charge exists (refunds only — real Stripe rejects unknown charges)
      if (params.charge && resource === "refunds") {
        const ref = getById(db, params.charge);
        if (!ref) return printError({ error: { code: "resource_missing", message: `No such charge: '${params.charge}'`, param: "charge", type: "invalid_request_error" } });
      }
      if (flags["dry-run"]) return printDryRun("POST", `https://api.stripe.com/v1/${resource}`, params);
      const obj = spec.build(params);
      derive(db, resource, obj, params);
      insertObject(db, { id: obj.id, object: spec.object, resource, created: obj.created ?? Math.floor(Date.now() / 1000), data: obj });
      audit(db, { resource, operation, objectId: obj.id, details: params });
      return printJson(obj);
    }
    case "list": {
      requireApiKey(db, flags, profile);
      const limit = params.limit ? Number(params.limit) : 10;
      const filter = spec.parentParam && params[spec.parentParam] ? { [spec.parentParam]: params[spec.parentParam] } : undefined;
      const data = listObjects(db, resource, limit + 1, filter);
      const hasMore = data.length > limit;
      if (hasMore) data.pop();
      return printJson(listEnvelope(resource, data, hasMore));
    }
    case "retrieve": {
      const id = positional[1];
      if (!id) {
        process.stderr.write(errExactlyOneArg(resource, operation));
        process.exit(1);
      }
      requireApiKey(db, flags, profile);
      const obj = getObject(db, resource, id);
      if (!obj) {
        // 真品：API 错误体打到 stdout，exit 0
        return printError(errResourceMissing(spec.object, id));
      }
      for (const f of spec.createOnly || []) delete obj[f]; // 仅 create 返回的字段
      return printJson(expandObject(db, obj, flags.expand));
    }
    case "update": {
      const id = positional[1];
      if (!id) {
        process.stderr.write(errExactlyOneArg(resource, operation));
        process.exit(1);
      }
      requireApiKey(db, flags, profile);
      const obj = getObject(db, resource, id);
      if (!obj) {
        // 真品：API 错误体打到 stdout，exit 0
        return printError(errResourceMissing(spec.object, id));
      }
      if (flags["dry-run"]) return printDryRun("POST", `https://api.stripe.com/v1/${resource}/${id}`, params);
      mergeParams(obj, params);
      if ("updated" in obj) obj.updated = Math.floor(Date.now() / 1000);
      updateObject(db, resource, id, obj);
      audit(db, { resource, operation, objectId: id, details: params });
      return printJson(obj);
    }
    case "delete": {
      const id = positional[1];
      if (!id) {
        process.stderr.write(errExactlyOneArg(resource, operation));
        process.exit(1);
      }
      requireApiKey(db, flags, profile);
      const obj = getObject(db, resource, id);
      if (!obj) {
        // 真品：API 错误体打到 stdout，exit 0
        return printError(errResourceMissing(spec.object, id));
      }
      if (flags["dry-run"]) return printDryRun("DELETE", `https://api.stripe.com/v1/${resource}/${id}`, {});
      // destructive：总打横幅，无 -c 则需确认 'yes'
      if (!confirmDestructive(flags, "DELETE")) return;
      markDeleted(db, resource, id);
      audit(db, { resource, operation, objectId: id, details: {} });
      return printJson(deletedEnvelope(spec.object, id));
    }
    case "cancel": {
      // subscriptions cancel → DELETE /v1/subscriptions/:id（真品：返回 status=canceled 的订阅对象，非 deleted 信封）
      const id = positional[1];
      if (!id) {
        process.stderr.write(errExactlyOneArg(resource, operation));
        process.exit(1);
      }
      requireApiKey(db, flags, profile);
      const obj = getObject(db, resource, id);
      if (!obj) {
        return printError(errResourceMissing(spec.object, id));
      }
      if (flags["dry-run"]) return printDryRun("DELETE", `https://api.stripe.com/v1/${resource}/${id}`, {});
      if (!confirmDestructive(flags, "DELETE")) return;
      const now = Math.floor(Date.now() / 1000);
      obj.status = "canceled";
      obj.canceled_at = now;
      obj.ended_at = now;
      if ("cancel_at_period_end" in obj) obj.cancel_at_period_end = false;
      updateObject(db, resource, id, obj);
      audit(db, { resource, operation, objectId: id, details: {} });
      return printJson(obj);
    }
    case "attach": {
      // payment_methods attach → POST /v1/payment_methods/:id/attach（需 --customer）
      const id = positional[1];
      if (!id) {
        process.stderr.write(errExactlyOneArg(resource, operation));
        process.exit(1);
      }
      requireApiKey(db, flags, profile);
      const obj = getObject(db, resource, id);
      if (!obj) {
        return printError(errResourceMissing(spec.object, id));
      }
      const customer = params.customer;
      if (customer === undefined) return printError(errParameterMissing("customer"));
      const cust = getById(db, customer);
      if (!cust) {
        return printError({ error: { code: "resource_missing", message: `No such customer: '${customer}'`, param: "customer", type: "invalid_request_error" } });
      }
      if (flags["dry-run"]) return printDryRun("POST", `https://api.stripe.com/v1/${resource}/${id}/attach`, params);
      obj.customer = customer;
      updateObject(db, resource, id, obj);
      audit(db, { resource, operation, objectId: id, details: params });
      return printJson(obj);
    }
    case "detach": {
      // payment_methods detach → POST /v1/payment_methods/:id/detach
      const id = positional[1];
      if (!id) {
        process.stderr.write(errExactlyOneArg(resource, operation));
        process.exit(1);
      }
      requireApiKey(db, flags, profile);
      const obj = getObject(db, resource, id);
      if (!obj) {
        return printError(errResourceMissing(spec.object, id));
      }
      if (flags["dry-run"]) return printDryRun("POST", `https://api.stripe.com/v1/${resource}/${id}/detach`, {});
      obj.customer = null;
      updateObject(db, resource, id, obj);
      audit(db, { resource, operation, objectId: id, details: {} });
      return printJson(obj);
    }
  }
}

// 浅合并可更新字段 — 接受 obj 里存在的任意 top-level scalar/array 字段
const IMMUTABLE = new Set(["id", "object", "created", "livemode"]);
function parseObjectParam(value) {
  if (!value || typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function coerceIntParam(value) {
  const n = Number(value);
  return Number.isInteger(n) ? n : value;
}

function mergeFixedAmount(obj, params) {
  if (!obj.fixed_amount || typeof obj.fixed_amount !== "object") return;
  const fixedAmount = parseObjectParam(params.fixed_amount);
  const amount =
    params["fixed_amount.amount"] ??
    (fixedAmount && typeof fixedAmount === "object" ? fixedAmount.amount : undefined);
  const currency =
    params["fixed_amount.currency"] ??
    (fixedAmount && typeof fixedAmount === "object" ? fixedAmount.currency : undefined);
  if (amount !== undefined) obj.fixed_amount.amount = coerceIntParam(amount);
  if (currency !== undefined) obj.fixed_amount.currency = String(currency).toLowerCase();
}

function mergeParams(obj, params) {
  mergeFixedAmount(obj, params);
  for (const [k, v] of Object.entries(params)) {
    if (IMMUTABLE.has(k)) continue;
    if (k === "metadata") {
      if ("metadata" in obj) obj.metadata = { ...obj.metadata, ...v };
      continue;
    }
    if (k.includes(".") || k.includes("[")) continue;
    if (!(k in obj)) continue;
    if (Array.isArray(obj[k])) { obj[k] = Array.isArray(v) ? v : [v]; continue; }
    if (typeof obj[k] === "object" && obj[k] !== null) continue;
    if (typeof obj[k] === "boolean") { obj[k] = v === "true" || v === true; continue; }
    const n = Number(v);
    obj[k] = v !== "" && !Number.isNaN(n) && /^-?\d+(\.\d+)?$/.test(String(v)) ? n : v;
  }
}

// 通用 HTTP：把 /v1/<resource>[/<id>] 映射到资源操作
function cmdHttp(db, method, flags, params, positional, profile) {
  requireApiKey(db, flags, profile);
  const path = positional[0] || "";
  const m = path.match(/^\/?v1\/([a-z_]+)(?:\/(.+))?$/);
  if (!m) {
    process.stderr.write(`\nUnsupported path: ${path}\n`);
    process.exit(1);
  }
  const [, resource, id] = m;
  if (!isResource(resource)) {
    return printError(errResourceMissing(resource, id || ""));
  }
  if (method === "get") {
    if (id) return cmdResource(db, resource, flags, params, ["retrieve", id]);
    return cmdResource(db, resource, flags, params, ["list"]);
  }
  if (method === "post") {
    if (id) return cmdResource(db, resource, flags, params, ["update", id]);
    return cmdResource(db, resource, flags, params, ["create"]);
  }
  if (method === "delete") return cmdResource(db, resource, flags, params, ["delete", id]);
}

// --- 元命令 ---
function cmdConfig(db, args) {
  const i = args.indexOf("--set");
  if (i >= 0) { setConfig(db, "default", args[i + 1], args[i + 2] ?? ""); return; }
  const u = args.indexOf("--unset");
  if (u >= 0) { unsetConfig(db, "default", args[u + 1]); return; }
  if (args.includes("--list")) {
    const rows = listConfig(db);
    if (rows.length === 0) { process.stdout.write("\n"); return; }
    const byProfile = {};
    for (const r of rows) (byProfile[r.profile] = byProfile[r.profile] || []).push(r);
    let out = "\n";
    for (const [p, items] of Object.entries(byProfile)) {
      out += `[${p}]\n`;
      for (const it of items) out += `  ${it.key} = "${it.value}"\n`;
    }
    process.stdout.write(out);
    return;
  }
  process.stdout.write("Usage: stripe config [--list | --set <k> <v> | --unset <k>]\n");
}

function cmdWhoami(db, flags, profile) {
  const { resolveApiKey } = require("./auth.js");
  const key = resolveApiKey(db, flags, profile);
  if (!key) {
    process.stdout.write(`\nProfile:        ${profile}\nAuthenticated:  false\nRun \`stripe login\` to authenticate.\n`);
    return;
  }
  process.stdout.write(`\nProfile:        ${profile}\nAuthenticated:  true\n`);
}

function cmdLogin(db, flags, profile) {
  if (!flags["interactive"]) {
    process.stderr.write(
      "Error: browser-based login is not available in this environment.\n" +
      "Use `stripe login --interactive` to enter your API key directly.\n"
    );
    process.exit(1);
  }
  return cmdLoginInteractive(db, flags, profile);
}

function cmdLoginInteractive(db, _flags, profile) {
  process.stderr.write("Enter your API key: ");
  const buf = Buffer.alloc(4096);
  const n = require("fs").readSync(0, buf, 0, buf.length);
  const key = buf.slice(0, n).toString().trim();
  if (!key) {
    process.stderr.write("Error: API key is required\n");
    process.exit(1);
  }
  if (!/^(sk_test_|sk_live_|rk_test_|rk_live_)/.test(key)) {
    process.stderr.write(
      "Error: Invalid API key format. Keys start with sk_test_, sk_live_, rk_test_, or rk_live_\n"
    );
    process.exit(1);
  }
  setConfig(db, profile, key.includes("live") ? "live_mode_api_key" : "test_mode_api_key", key);
  process.stdout.write(
    `Done! The Stripe CLI is configured for profile ${profile}\n` +
    `Account: Bench Mock Account (acct_${randomHex(16)})\n`
  );
}

function cmdLogout(db, profile) {
  unsetConfig(db, profile, "test_mode_api_key");
  unsetConfig(db, profile, "live_mode_api_key");
  process.stdout.write("Logged out.\n");
}
