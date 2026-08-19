// norm.mjs — 归一化 stripe 输出里的易变值（id/时间戳/密钥/账号/req），保留结构与键序。
// 用于真品 vs mock 差分对拍：屏蔽后仍有差异 = 真实不一致。
import { readFileSync } from "node:fs";
let s = readFileSync(0, "utf8");

s = s.replace(/^Checking for new versions\.\.\.\n/m, "");
s = s.replace(/^<claude-code-hint[^\n]*\n/m, "");

// 1) 形如 <prefix>_<alnum> 的对象 id（含 client_secret 的 _secret_ 段）
const PFX =
  "cus|prod|price|pi|ch|re|sub_sched|sub_item|sub|in|ii|pm|plink|cs_test|cs_live|cs|evt|txn|card|src|seti|pmc|po|ba|tok|si|rcpt|py|ipi|pcfg|plan|pl|pst|txr|shr|qt|we|apwc|sub_sched";
s = s.replace(new RegExp(`\\b(${PFX})_[A-Za-z0-9]+`, "g"), "$1_X");
s = s.replace(/_secret_[A-Za-z0-9]+/g, "_secret_X");
// 2) 密钥 / 账号 / 请求 id
s = s.replace(/\b(whsec|sk_test|sk_live|rk_test|rk_live|acct|req)_[A-Za-z0-9]+/g, "$1_X");
// 3) unix 时间戳（10 位，16/17/18 开头）
s = s.replace(/: 1[6-9]\d{8}\b/g, ": 0");
// 4) invoice_prefix（8 位大写字母数字）
s = s.replace(/"invoice_prefix": "[A-Z0-9]{8}"/g, '"invoice_prefix": "X"');
// 5) checkout/url 里的随机 token 残留
s = s.replace(/(buy\.stripe\.com\/test_)[A-Za-z0-9]+/g, "$1X");
// 6) 无前缀 id（coupon/promotion_code），前缀 id 已含 _X 不会命中
s = s.replace(/("id": ")[A-Za-z0-9]{6,12}(")/g, "$1ID$2");
// 7) 真品每次调用即随机、无法（也无需）对齐的装饰字段
s = s.replace(/("risk_score": )\d+/g, "$10");
s = s.replace(/("authorization_code": ")\d+(")/g, "$1X$2");
s = s.replace(/(receipts\/payment\/)[A-Za-z0-9_-]+/g, "$1X");
s = s.replace(/("seller_message": ")[^"]*(")/g, "$1X$2");
// refund 结算引用：reference 随机、reference_status 随结算时机变（真品自身非确定性）
s = s.replace(/("reference": ")[0-9]+(")/g, "$1X$2");
s = s.replace(/("reference_status": ")(available|pending)(")/g, "$1X$3");
s = s.replace(/^\s*"reference": "[^"]*",?\n/gm, ""); // 结算后才出现，删整行
// dry-run 里的 Authorization（真品显示真 key 末4位，mock 显示占位）
s = s.replace(/(Bearer sk_(test|live)_)[^"]*/g, "$1X");
// customer state-evolution（建 invoice/subscription 后递增的计数器）
s = s.replace(/("next_invoice_sequence": )\d+/g, "$10");
// test token 的 exp_month/exp_year 随当前日期变（tok_visa 返回当前月/年+3）
s = s.replace(/("exp_month": )\d+/g, "$10");
s = s.replace(/("exp_year": )\d+/g, "$10");
// ephemeral key id + secret
s = s.replace(/\b(ephkey)_[A-Za-z0-9]+/g, "$1_X");
s = s.replace(/(ek_test)_[A-Za-z0-9_]+/g, "$1_X");

process.stdout.write(s);
