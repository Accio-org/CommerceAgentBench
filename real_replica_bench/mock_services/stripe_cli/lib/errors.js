/**
 * errors.js — 逐字复刻真品 stripe 1.42.1 的错误输出。
 * 字符串采自真品 stripe 1.42.1（NO_COLOR=1）。改动前先用 _capture/verify_matrix.sh 对拍。
 */

// 未配置 API key（未登录且没传 --api-key）。真品打到 stderr，exit 1，前置一个空行。
export const ERR_NO_API_KEY =
  "You have not configured API keys yet\n" +
  "  If you have an API key: set STRIPE_API_KEY or pass --api-key <key>.\n" +
  "  To start a browser login (requires user action): run `stripe login` and follow the printed instructions.\n";

// 未知顶层命令 / 未知资源。真品打到 stdout，exit 1。
export function errUnknownCommand(name) {
  return (
    `Unknown command "${name}" for "stripe".\n` +
    `See "stripe --help" for a list of available commands.\n`
  );
}

// 操作缺少必需的位置参数（如 retrieve 缺 id）。stderr，exit 1，前后各一空行。
export function errExactlyOneArg(resource, operation) {
  return (
    `\`stripe ${resource} ${operation}\` requires exactly 1 positional argument. ` +
    `See \`stripe ${resource} ${operation} --help\` for supported flags and usage\n`
  );
}

// API 错误体。真品打到 **stdout**、exit 0，键序为字母序，含 request_log_url。
// request_log_url 含 acct + req_ 随机 id（易变，golden/smoke 需掩码）。
function reqLogUrl() {
  const acct = process.env.STRIPE_MOCK_ACCOUNT || "acct_mock00000000000";
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let req = "";
  for (let i = 0; i < 16; i++) req += A[Math.floor(Math.random() * A.length)];
  return `https://dashboard.stripe.com/${acct}/test/workbench/logs?object=req_${req}`;
}

export function apiError({ code, message, param, docSlug }) {
  return {
    error: {
      code,
      doc_url: `https://stripe.com/docs/error-codes/${docSlug || code.replace(/_/g, "-")}`,
      message,
      param,
      request_log_url: reqLogUrl(),
      type: "invalid_request_error",
    },
  };
}

export function errResourceMissing(object, id) {
  return apiError({
    code: "resource_missing",
    message: `No such ${object}: '${id}'`,
    param: "id",
  });
}

export function errParameterMissing(param) {
  return apiError({
    code: "parameter_missing",
    message: `Missing required param: ${param}.`,
    param,
  });
}

// enum/currency 类错误：真品错误体**没有 code/doc_url**，只 message/param/request_log_url/type
function apiErrorPlain({ message, param }) {
  return { error: { message, param, request_log_url: reqLogUrl(), type: "invalid_request_error" } };
}

// 精确复刻真品 1.42.1 的 currency 列表（151 个，顺序原样）
const CURRENCY_LIST =
  "usd, aed, afn, all, amd, ang, aoa, ars, aud, awg, azn, bam, bbd, bdt, bgn, bhd, bif, bmd, bnd, bob, brl, bsd, bwp, byn, bzd, cad, cdf, chf, clp, cny, cop, crc, cve, czk, djf, dkk, dop, dzd, egp, etb, eur, fjd, fkp, gbp, gel, gip, gmd, gnf, gtq, gyd, hkd, hnl, hrk, htg, huf, idr, ils, inr, isk, jmd, jod, jpy, kes, kgs, khr, kmf, krw, kwd, kyd, kzt, lak, lbp, lkr, lrd, lsl, mad, mdl, mga, mkd, mmk, mnt, mop, mur, mvr, mwk, mxn, myr, mzn, nad, ngn, nio, nok, npr, nzd, omr, pab, pen, pgk, php, pkr, pln, pyg, qar, ron, rsd, rub, rwf, sar, sbd, scr, sek, sgd, shp, sle, sos, srd, std, szl, thb, tjs, tnd, top, try, ttd, twd, tzs, uah, ugx, uyu, uzs, vnd, vuv, wst, xaf, xcd, xcg, xof, xpf, yer, zar, zmw, usdc, btn, ghs, eek, lvl, svc, vef, ltl, sll, mro";
export const CURRENCIES = new Set(CURRENCY_LIST.split(", "));

export function errInvalidCurrency(cur) {
  return apiErrorPlain({
    message: `Invalid currency: ${cur}. Stripe currently supports these currencies: ${CURRENCY_LIST}`,
    param: "currency",
  });
}

export function errInvalidEnum(param, allowedPhrase) {
  return apiErrorPlain({ message: `Invalid ${param}: must be one of ${allowedPhrase}`, param });
}

// unknown parameter（真品 API 端，stdout，exit 0）
export function errParameterUnknown(param) {
  return apiError({
    code: "parameter_unknown",
    message: `Received unknown parameter: ${param}`,
    param,
  });
}

// --- 闭集枚举（值集从 stripe openapi spec 取） ---

export const PAYMENT_METHOD_TYPES = new Set([
  "acss_debit", "affirm", "afterpay_clearpay", "alipay", "amazon_pay",
  "au_becs_debit", "bacs_debit", "bancontact", "blik", "boleto",
  "card", "card_present", "cashapp", "customer_balance", "eps",
  "fpx", "giropay", "grabpay", "ideal", "interac_present",
  "klarna", "konbini", "link", "mobilepay", "multibanco",
  "oxxo", "p24", "paynow", "paypal", "pix",
  "promptpay", "revolut_pay", "sepa_debit", "sofort", "swish",
  "twint", "us_bank_account", "wechat_pay", "zip",
]);

export const CHECKOUT_MODES = new Set(["payment", "setup", "subscription"]);

export const PLAN_INTERVALS = new Set(["day", "week", "month", "year"]);

export const COLLECTION_METHODS = new Set(["charge_automatically", "send_invoice"]);

export const SHIPPING_RATE_TYPES = new Set(["fixed_amount"]);

// CLI 端整数 flag 解析失败（Go 风格，stderr，exit 1）
export function errInvalidIntFlag(flag, val) {
  return `invalid argument "${val}" for "--${flag}" flag: strconv.ParseInt: parsing "${val}": invalid syntax\n`;
}
