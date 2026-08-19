/**
 * resources.js — schema 驱动的资源注册表。
 *
 * 新增一个资源 = 在 REGISTRY 里加一段配置：
 *   - object:     对象类型名（JSON 里的 "object" 字段）
 *   - idPrefix:   id 前缀
 *   - operations: 支持的操作集（来自真品 `stripe <res> --help`）
 *   - build(params, ctx): 用入参 + 默认值构造完整对象，**键顺序须与官方文档样例一致**
 *     （Stripe CLI 输出 id/object 在前，其余字段按官方样例顺序）
 *
 * 默认值与字段取自官方 API Reference 的示例对象（docs.stripe.com/api）。
 */
import { genId, nowTs } from "./ids.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TPL_DIR = join(dirname(fileURLToPath(import.meta.url)), "templates");
const _tplCache = {};
function loadTemplate(name) {
  if (!_tplCache[name]) _tplCache[name] = readFileSync(join(TPL_DIR, `${name}.json`), "utf8");
  return JSON.parse(_tplCache[name]); // 每次返回新副本
}

// 生成无前缀短 id（coupon 用）或长 id（checkout 用）
function genPlain(len) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = ""; for (let i = 0; i < len; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}

/**
 * 模板驱动资源：加载真品对象模板 → 重生成 id/created/updated → 叠加输入回显字段。
 * 巨型对象（pi/charge/invoice/subscription…）用此法，核心字段保真、装饰字段沿用真品默认。
 */
function templateSpec({ name, object, idGen, operations, required = [], extraParams = [] }) {
  const tplKeys = new Set(Object.keys(loadTemplate(name)));
  tplKeys.delete("id"); tplKeys.delete("object"); tplKeys.delete("created"); tplKeys.delete("updated");
  tplKeys.delete("livemode");
  for (const ep of extraParams) tplKeys.add(ep);
  return {
    object,
    idPrefix: "",
    operations,
    required,
    knownParams: tplKeys,
    _template: true,
    build(params) {
      const obj = loadTemplate(name);
      const ts = nowTs();
      obj.id = idGen();
      if ("created" in obj) obj.created = ts;
      if ("updated" in obj) obj.updated = ts;
      // 叠加输入回显：params 里凡是对象顶层已有的标量键，就覆盖
      for (const [k, v] of Object.entries(params)) {
        if (k === "metadata") { obj.metadata = { ...(obj.metadata || {}), ...v }; continue; }
        if (k.includes(".") || k.includes("[")) continue; // 嵌套/数组参数本期不展开
        if (k in obj && Array.isArray(obj[k])) { obj[k] = Array.isArray(v) ? v : [v]; continue; }
        if (k in obj && (typeof obj[k] !== "object" || obj[k] === null)) {
          if (typeof obj[k] === "boolean") { obj[k] = v === "true" || v === true; continue; }
          const n = Number(v);
          obj[k] = v !== "" && !Number.isNaN(n) && /^\d+$/.test(String(v)) ? n : v;
        }
      }
      return obj;
    },
  };
}

// 从扁平 + 嵌套(-d a[b]=c)入参里取值的小工具
function pick(params, key, dflt = null) {
  return params[key] !== undefined ? params[key] : dflt;
}

function buildAddress(params) {
  const a = ["city", "country", "line1", "line2", "postal_code", "state"];
  const has = a.some((k) => params[`address.${k}`] !== undefined || (params.address && params.address[k] !== undefined));
  if (!has) return null;
  const src = params.address || {};
  return {
    city: params["address.city"] ?? src.city ?? null,
    country: params["address.country"] ?? src.country ?? null,
    line1: params["address.line1"] ?? src.line1 ?? null,
    line2: params["address.line2"] ?? src.line2 ?? null,
    postal_code: params["address.postal_code"] ?? src.postal_code ?? null,
    state: params["address.state"] ?? src.state ?? null,
  };
}

function invoicePrefix() {
  const A = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let s = "";
  for (let i = 0; i < 8; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}

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

function coerceInt(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  return Number.isInteger(n) ? n : value;
}

function applyShippingRateParams(obj, params) {
  if (!obj.fixed_amount || typeof obj.fixed_amount !== "object") return;
  let fixedAmount = parseObjectParam(params.fixed_amount);
  // CLI 还会产出两种非 JSON 形态：`--fixed-amount amount=599,currency=usd`（逗号串）
  // 和重复 flag（["amount=599","currency=usd"]）；统一解析成对象
  const kvPairs = Array.isArray(fixedAmount)
    ? fixedAmount
    : (typeof fixedAmount === "string" && fixedAmount.includes("=") ? fixedAmount.split(",") : null);
  if (kvPairs) {
    const parsed = {};
    for (const pair of kvPairs) {
      const idx = String(pair).indexOf("=");
      if (idx > 0) parsed[String(pair).slice(0, idx).trim()] = String(pair).slice(idx + 1).trim();
    }
    if (Object.keys(parsed).length) fixedAmount = parsed;
  }
  const amount =
    params["fixed_amount.amount"] ??
    (fixedAmount && typeof fixedAmount === "object" ? fixedAmount.amount : undefined);
  const currency =
    params["fixed_amount.currency"] ??
    (fixedAmount && typeof fixedAmount === "object" ? fixedAmount.currency : undefined);
  if (amount !== undefined) obj.fixed_amount.amount = coerceInt(amount);
  if (currency !== undefined) obj.fixed_amount.currency = String(currency).toLowerCase();
}

export const REGISTRY = {
  customers: {
    object: "customer",
    idPrefix: "cus_",
    operations: ["create", "retrieve", "update", "list", "delete"],
    knownParams: new Set([
      "name", "email", "description", "phone", "balance", "currency",
      "address", "shipping", "tax_exempt", "invoice_prefix", "invoice_settings",
      "preferred_locales", "source", "default_source", "payment_method", "coupon",
      "promotion_code", "tax_id_data", "test_clock", "next_invoice_sequence",
    ]),
    build(params) {
      const ts = nowTs();
      // 字段集 + 键序对齐真品 stripe 1.42.1 (API 2026-05-27.dahlia)：id/object 在前，其余字母序
      return {
        id: genId("cus_"),
        object: "customer",
        address: buildAddress(params),
        balance: Number(pick(params, "balance", 0)),
        created: ts,
        currency: pick(params, "currency"),
        customer_account: null,
        default_source: null,
        delinquent: false,
        description: pick(params, "description"),
        discount: null,
        email: pick(params, "email"),
        invoice_prefix: invoicePrefix(),
        invoice_settings: {
          custom_fields: null,
          default_payment_method: null,
          footer: null,
          rendering_options: null,
        },
        livemode: false,
        metadata: pick(params, "metadata", {}) || {},
        name: pick(params, "name"),
        next_invoice_sequence: 1,
        phone: pick(params, "phone"),
        preferred_locales: [],
        shipping: null,
        tax_exempt: "none",
        test_clock: null,
      };
    },
  },

  products: {
    object: "product",
    idPrefix: "prod_",
    operations: ["create", "retrieve", "update", "list", "delete"],
    knownParams: new Set([
      "name", "description", "active", "attributes", "default_price_data",
      "images", "package_dimensions", "shippable", "statement_descriptor",
      "tax_code", "type", "unit_label", "url", "marketing_features",
    ]),
    build(params) {
      const ts = nowTs();
      return {
        id: genId("prod_"),
        object: "product",
        active: params.active !== undefined ? params.active !== "false" && params.active !== false : true,
        attributes: [],
        created: ts,
        default_price: null,
        description: pick(params, "description"),
        images: [],
        livemode: false,
        marketing_features: [],
        metadata: pick(params, "metadata", {}) || {},
        name: pick(params, "name"),
        package_dimensions: null,
        shippable: null,
        statement_descriptor: pick(params, "statement_descriptor"),
        tax_code: pick(params, "tax_code"),
        tax_details: null,
        type: pick(params, "type", "service"),
        unit_label: pick(params, "unit_label"),
        updated: ts,
        url: pick(params, "url"),
      };
    },
  },

  prices: {
    object: "price",
    idPrefix: "price_",
    operations: ["create", "retrieve", "update", "list"],
    required: ["currency"],
    knownParams: new Set([
      "currency", "unit_amount", "unit_amount_decimal", "product", "product_data",
      "active", "billing_scheme", "lookup_key", "nickname", "recurring",
      "tax_behavior", "tiers", "tiers_mode", "transfer_lookup_key",
      "transform_quantity", "custom_unit_amount",
    ]),
    build(params) {
      const ts = nowTs();
      const recurringInterval =
        params["recurring.interval"] ?? (params.recurring && params.recurring.interval);
      const isRecurring = !!recurringInterval;
      const unitAmount = params.unit_amount !== undefined ? Number(params.unit_amount) : null;
      return {
        id: genId("price_"),
        object: "price",
        active: true,
        billing_scheme: "per_unit",
        created: ts,
        currency: pick(params, "currency"),
        custom_unit_amount: null,
        livemode: false,
        lookup_key: pick(params, "lookup_key"),
        metadata: pick(params, "metadata", {}) || {},
        nickname: pick(params, "nickname"),
        product: pick(params, "product"),
        recurring: isRecurring
          ? {
              interval: recurringInterval,
              interval_count: Number(params["recurring.interval_count"] ?? 1),
              meter: null,
              trial_period_days: null,
              usage_type: "licensed",
            }
          : null,
        tax_behavior: "unspecified",
        tiers_mode: null,
        transform_quantity: null,
        type: isRecurring ? "recurring" : "one_time",
        unit_amount: unitAmount,
        unit_amount_decimal: unitAmount === null ? null : String(unitAmount),
      };
    },
  },
};

// --- 模板驱动资源（巨型/复杂对象，核心字段保真）---
Object.assign(REGISTRY, {
  payment_intents: templateSpec({
    name: "payment_intents", object: "payment_intent", idGen: () => genId("pi_"),
    operations: ["create", "retrieve", "update", "list"], required: ["amount", "currency"],
    extraParams: ["confirm", "error_on_requires_action", "mandate", "off_session", "return_url", "payment_method_data", "radar_options"],
  }),
  charges: templateSpec({
    name: "charges", object: "charge", idGen: () => genId("ch_"),
    operations: ["create", "retrieve", "update", "list"], required: ["amount", "currency"],
    extraParams: ["capture"],
  }),
  refunds: templateSpec({
    name: "refunds", object: "refund", idGen: () => genId("re_"),
    operations: ["create", "retrieve", "update", "list"],
  }),
  subscriptions: templateSpec({
    name: "subscriptions", object: "subscription", idGen: () => genId("sub_"),
    operations: ["create", "retrieve", "update", "list", "cancel"], required: ["customer"],
    extraParams: ["payment_behavior", "proration_behavior", "add_invoice_items", "backdate_start_date", "coupon", "promotion_code"],
  }),
  invoices: templateSpec({
    name: "invoices", object: "invoice", idGen: () => genId("in_"),
    operations: ["create", "retrieve", "update", "list"], required: ["customer"],
    extraParams: ["days_until_due", "pending_invoice_items_behavior"],
  }),
  invoiceitems: templateSpec({
    name: "invoiceitems", object: "invoiceitem", idGen: () => genId("ii_"),
    operations: ["create", "retrieve", "update", "list"], required: ["customer"],
    extraParams: ["price", "price_data", "unit_amount", "unit_amount_decimal"],
  }),
  coupons: templateSpec({
    name: "coupons", object: "coupon", idGen: () => genPlain(8),
    operations: ["create", "retrieve", "update", "list", "delete"],
    extraParams: ["applies_to", "id"],
  }),
  checkout_sessions: templateSpec({
    name: "checkout_sessions", object: "checkout.session", idGen: () => "cs_test_" + genPlain(58),
    operations: ["create", "retrieve", "list"], required: ["mode"],
    extraParams: ["line_items", "return_url", "tax_id_collection"],
  }),
  payment_methods: templateSpec({
    name: "payment_methods", object: "payment_method", idGen: () => genId("pm_"),
    operations: ["create", "retrieve", "update", "list", "attach", "detach"], required: ["type"],
    extraParams: ["card", "acss_debit", "us_bank_account", "sepa_debit", "ideal", "fpx", "bacs_debit", "au_becs_debit", "boleto"],
  }),
  payment_links: templateSpec({
    name: "payment_links", object: "payment_link", idGen: () => genId("plink_"),
    operations: ["create", "retrieve", "update", "list"],
    extraParams: ["line_items"],
  }),
  // events 只读：list/retrieve（由 trigger 写入 events 表）
  events: {
    object: "event", idPrefix: "evt_", operations: ["retrieve", "list"], _readonly: true,
  },
  // --- B8 扩充资源 ---
  setup_intents: templateSpec({
    name: "setup_intents", object: "setup_intent", idGen: () => genId("seti_"),
    operations: ["create", "retrieve", "update", "list"],
    extraParams: ["confirm", "return_url", "payment_method_data"],
  }),
  tax_rates: templateSpec({
    name: "tax_rates", object: "tax_rate", idGen: () => genId("txr_"),
    operations: ["create", "retrieve", "update", "list"], required: ["display_name", "percentage", "inclusive"],
  }),
  shipping_rates: (() => {
    const s = templateSpec({
      name: "shipping_rates", object: "shipping_rate", idGen: () => genId("shr_"),
      operations: ["create", "retrieve", "update", "list"], required: ["display_name"],
    });
    const baseBuild = s.build;
    s.build = (params) => {
      const obj = baseBuild(params);
      applyShippingRateParams(obj, params);
      return obj;
    };
    return s;
  })(),
  quotes: templateSpec({
    name: "quotes", object: "quote", idGen: () => genId("qt_"),
    operations: ["create", "retrieve", "update", "list"],
  }),
  plans: templateSpec({
    name: "plans", object: "plan", idGen: () => genId("plan_"),
    operations: ["create", "retrieve", "update", "list", "delete"], required: ["amount", "currency", "interval"],
    extraParams: ["tiers"],
  }),
  subscription_items: templateSpec({
    name: "subscription_items", object: "subscription_item", idGen: () => genId("si_"),
    operations: ["create", "retrieve", "update", "list", "delete"], required: ["subscription", "price"],
  }),
  // --- B9 可创建 ---
  webhook_endpoints: (() => {
    const s = templateSpec({
      name: "webhook_endpoints", object: "webhook_endpoint", idGen: () => genId("we_"),
      operations: ["create", "retrieve", "update", "list", "delete"], required: ["url"],
      extraParams: ["connect"],
    });
    s.createOnly = ["secret"]; // 真品：secret 仅 create 返回，retrieve/list 不含
    return s;
  })(),
  apple_pay_domains: templateSpec({
    name: "apple_pay_domains", object: "apple_pay_domain", idGen: () => genId("apwc_"),
    operations: ["create", "retrieve", "list", "delete"], required: ["domain_name"],
  }),
  subscription_schedules: templateSpec({
    name: "subscription_schedules", object: "subscription_schedule", idGen: () => "sub_sched_" + genPlain(14),
    operations: ["create", "retrieve", "update", "list"], required: ["customer"],
  }),
  // --- B9 只读（DB 背书，空库起步，同 events）---
  balance_transactions: { object: "balance_transaction", idPrefix: "txn_", operations: ["retrieve", "list"], _readonly: true },
  disputes: { object: "dispute", idPrefix: "dp_", operations: ["retrieve", "list"], _readonly: true },
  payouts: { object: "payout", idPrefix: "po_", operations: ["retrieve", "list"], _readonly: true },
  // --- B9 静态参考数据（serve 真品采集）---
  balance: { object: "balance", operations: ["retrieve"], _static: "balance", _singleton: true },
  country_specs: { object: "country_spec", operations: ["retrieve", "list"], _static: "country_specs" },
  tax_codes: { object: "tax_code", operations: ["retrieve", "list"], _static: "tax_codes" },
  // --- 全覆盖批量扩充（read-only DB 起步）---
  accounts: { object: "account", idPrefix: "acct_", operations: ["retrieve", "list"], _readonly: true },
  application_fees: { object: "application_fee", idPrefix: "fee_", operations: ["retrieve", "list"], _readonly: true },
  credit_notes: { object: "credit_note", idPrefix: "cn_", operations: ["retrieve", "list"], _readonly: true },
  file_links: { object: "file_link", idPrefix: "link_", operations: ["retrieve", "list"], _readonly: true },
  files: { object: "file", idPrefix: "file_", operations: ["retrieve", "list"], _readonly: true },
  invoice_payments: { object: "invoice_payment", idPrefix: "ip_", operations: ["retrieve", "list"], _readonly: true },
  invoice_rendering_templates: { object: "invoice_rendering_template", idPrefix: "tmpl_", operations: ["retrieve", "list"], _readonly: true },
  payment_method_configurations: { object: "payment_method_configuration", idPrefix: "pmc_", operations: ["retrieve", "list"], _readonly: true },
  payment_method_domains: { object: "payment_method_domain", idPrefix: "pmd_", operations: ["retrieve", "list"], _readonly: true },
  promotion_codes: { object: "promotion_code", idPrefix: "promo_", operations: ["retrieve", "list"], _readonly: true },
  reviews: { object: "review", idPrefix: "prv_", operations: ["retrieve", "list"], _readonly: true },
  topups: { object: "topup", idPrefix: "tu_", operations: ["retrieve", "list"], _readonly: true },
  transfers: { object: "transfer", idPrefix: "tr_", operations: ["retrieve", "list"], _readonly: true },
  // --- 子资源（带 parentParam 过滤）---
  bank_accounts: { object: "bank_account", idPrefix: "ba_", operations: ["retrieve", "list"], _readonly: true, parentParam: "customer" },
  cards: { object: "card", idPrefix: "card_", operations: ["retrieve", "list"], _readonly: true, parentParam: "customer" },
  tax_ids: { object: "tax_id", idPrefix: "txi_", operations: ["retrieve", "list"], _readonly: true, parentParam: "customer" },
  customer_balance_transactions: { object: "customer_balance_transaction", idPrefix: "cbtxn_", operations: ["retrieve", "list"], _readonly: true, parentParam: "customer" },
  customer_cash_balance_transactions: { object: "customer_cash_balance_transaction", idPrefix: "ccsbtxn_", operations: ["retrieve", "list"], _readonly: true, parentParam: "customer" },
  payment_sources: { object: "payment_source", idPrefix: "src_", operations: ["retrieve", "list"], _readonly: true, parentParam: "customer" },
  persons: { object: "person", idPrefix: "person_", operations: ["retrieve", "list"], _readonly: true, parentParam: "account" },
  capabilities: { object: "capability", idPrefix: "acap_", operations: ["retrieve", "list"], _readonly: true, parentParam: "account" },
  external_accounts: { object: "external_account", idPrefix: "ba_", operations: ["retrieve", "list"], _readonly: true, parentParam: "account" },
  fee_refunds: { object: "fee_refund", idPrefix: "fr_", operations: ["retrieve", "list"], _readonly: true, parentParam: "fee" },
  transfer_reversals: { object: "transfer_reversal", idPrefix: "trr_", operations: ["retrieve", "list"], _readonly: true, parentParam: "transfer" },
  invoice_line_items: { object: "line_item", idPrefix: "il_", operations: ["retrieve", "list"], _readonly: true, parentParam: "invoice" },
  credit_note_line_items: { object: "credit_note_line_item", idPrefix: "cnli_", operations: ["retrieve", "list"], _readonly: true, parentParam: "credit_note" },
  product_features: { object: "product_feature", idPrefix: "prodft_", operations: ["retrieve", "list"], _readonly: true, parentParam: "product" },
  // --- 特殊：仅 create / 受限 ---
  tokens: { object: "token", idPrefix: "tok_", operations: ["retrieve"], _readonly: true },
  account_links: { object: "account_link", idPrefix: "acctlink_", operations: [], _readonly: true },
  account_sessions: { object: "account_session", idPrefix: "acctsess_", operations: [], _readonly: true },
  ephemeral_keys: templateSpec({
    name: "ephemeral_keys", object: "ephemeral_key", idGen: () => genId("ephkey_"),
    operations: ["create"], required: ["customer"],
  }),
  // --- Issuing（需开通，先注册空资源）---
  issuing_authorizations: { object: "issuing.authorization", idPrefix: "iauth_", operations: ["retrieve", "list"], _readonly: true },
  issuing_cardholders: { object: "issuing.cardholder", idPrefix: "ich_", operations: ["retrieve", "list"], _readonly: true },
  issuing_cards: { object: "issuing.card", idPrefix: "ic_", operations: ["retrieve", "list"], _readonly: true },
  issuing_disputes: { object: "issuing.dispute", idPrefix: "idp_", operations: ["retrieve", "list"], _readonly: true },
  issuing_transactions: { object: "issuing.transaction", idPrefix: "ipi_", operations: ["retrieve", "list"], _readonly: true },
  issuing_tokens: { object: "issuing.token", idPrefix: "intok_", operations: ["retrieve", "list"], _readonly: true },
  issuing_personalization_designs: { object: "issuing.personalization_design", idPrefix: "ipcd_", operations: ["retrieve", "list"], _readonly: true },
  issuing_physical_bundles: { object: "issuing.physical_bundle", idPrefix: "iphb_", operations: ["retrieve", "list"], _readonly: true },
  // --- Treasury（需开通，先注册空资源）---
  treasury_financial_accounts: { object: "treasury.financial_account", idPrefix: "fa_", operations: ["retrieve", "list"], _readonly: true },
  treasury_transactions: { object: "treasury.transaction", idPrefix: "trxn_", operations: ["retrieve", "list"], _readonly: true },
  treasury_credit_reversals: { object: "treasury.credit_reversal", idPrefix: "credrev_", operations: ["retrieve", "list"], _readonly: true },
  treasury_debit_reversals: { object: "treasury.debit_reversal", idPrefix: "debrev_", operations: ["retrieve", "list"], _readonly: true },
  treasury_inbound_transfers: { object: "treasury.inbound_transfer", idPrefix: "ibt_", operations: ["retrieve", "list"], _readonly: true },
  treasury_outbound_payments: { object: "treasury.outbound_payment", idPrefix: "obp_", operations: ["retrieve", "list"], _readonly: true },
  treasury_outbound_transfers: { object: "treasury.outbound_transfer", idPrefix: "obt_", operations: ["retrieve", "list"], _readonly: true },
  treasury_received_credits: { object: "treasury.received_credit", idPrefix: "rc_", operations: ["retrieve", "list"], _readonly: true },
  treasury_received_debits: { object: "treasury.received_debit", idPrefix: "rd_", operations: ["retrieve", "list"], _readonly: true },
  // --- 最终补漏 ---
  balance_settings: { object: "balance.settings", operations: ["retrieve"], _readonly: true },
  cash_balances: { object: "cash_balance", operations: ["retrieve"], _readonly: true, parentParam: "customer" },
  confirmation_tokens: { object: "confirmation_token", idPrefix: "ctoken_", operations: ["retrieve"], _readonly: true },
  customer_sessions: { object: "customer_session", idPrefix: "cuss_", operations: [], _readonly: true },
  login_links: { object: "login_link", operations: [], _readonly: true },
  mandates: { object: "mandate", idPrefix: "mandate_", operations: ["retrieve"], _readonly: true },
  payment_attempt_records: { object: "payment_attempt_record", idPrefix: "par_", operations: ["retrieve", "list"], _readonly: true },
  payment_intent_amount_details_line_items: { object: "line_item", idPrefix: "li_", operations: ["list"], _readonly: true, parentParam: "payment_intent" },
  payment_records: { object: "payment_record", operations: [], _readonly: true },
  preview: { object: "preview", operations: [], _readonly: true },
  sources: { object: "source", idPrefix: "src_", operations: ["retrieve"], _readonly: true },
  test_helpers: { object: "test_helpers", operations: [], _readonly: true },
  // --- 命名空间子资源（read-only DB）---
  billing_meters: { object: "billing.meter", idPrefix: "mtr_", operations: ["retrieve", "list"], _readonly: true },
  billing_credit_grants: { object: "billing.credit_grant", idPrefix: "crgr_", operations: ["retrieve", "list"], _readonly: true },
  billing_alerts: { object: "billing.alert", idPrefix: "alrt_", operations: ["retrieve", "list"], _readonly: true },
  billing_portal_configurations: { object: "billing_portal.configuration", idPrefix: "bpc_", operations: ["retrieve", "list"], _readonly: true },
  climate_orders: { object: "climate.order", idPrefix: "climorder_", operations: ["retrieve", "list"], _readonly: true },
  climate_products: { object: "climate.product", idPrefix: "climproduct_", operations: ["retrieve", "list"], _readonly: true },
  climate_suppliers: { object: "climate.supplier", idPrefix: "climsupplier_", operations: ["retrieve", "list"], _readonly: true },
  entitlements_features: { object: "entitlements.feature", idPrefix: "feat_", operations: ["retrieve", "list"], _readonly: true },
  financial_connections_accounts: { object: "financial_connections.account", idPrefix: "fca_", operations: ["retrieve", "list"], _readonly: true },
  forwarding_requests: { object: "forwarding.request", idPrefix: "fwdreq_", operations: ["retrieve", "list"], _readonly: true },
  identity_verification_reports: { object: "identity.verification_report", idPrefix: "vr_", operations: ["retrieve", "list"], _readonly: true },
  identity_verification_sessions: { object: "identity.verification_session", idPrefix: "vs_", operations: ["retrieve", "list"], _readonly: true },
  radar_early_fraud_warnings: { object: "radar.early_fraud_warning", idPrefix: "issfr_", operations: ["retrieve", "list"], _readonly: true },
  radar_value_lists: { object: "radar.value_list", idPrefix: "rsl_", operations: ["retrieve", "list"], _readonly: true },
  reporting_report_runs: { object: "reporting.report_run", idPrefix: "frr_", operations: ["retrieve", "list"], _readonly: true },
  terminal_configurations: { object: "terminal.configuration", idPrefix: "tmc_", operations: ["retrieve", "list"], _readonly: true },
  terminal_locations: { object: "terminal.location", idPrefix: "tml_", operations: ["retrieve", "list"], _readonly: true },
  terminal_readers: { object: "terminal.reader", idPrefix: "tmr_", operations: ["retrieve", "list"], _readonly: true },
  tax_registrations: { object: "tax.registration", idPrefix: "taxreg_", operations: ["retrieve", "list"], _readonly: true },
});

// 静态参考资源：返回采集自真品的固定数据
export function staticData(name) {
  return loadTemplate(name);
}

// checkout sessions 走 "checkout sessions" 两段命令，注册别名
export const NAMESPACE_ALIAS = { "checkout sessions": "checkout_sessions" };

export function isResource(name) {
  return Object.prototype.hasOwnProperty.call(REGISTRY, name);
}
