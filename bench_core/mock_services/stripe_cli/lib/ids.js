/**
 * ids.js — 生成 Stripe 风格对象 id。
 * 真品 id 形如 cus_NffrFeUfNV2Hib / prod_NWjs8kKbJWmuuc / price_1MoBy5Lkd...
 * 我们按前缀 + 随机 base62 串复刻形状（不追求与真品同一空间，只求格式一致）。
 */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function randStr(n) {
  let s = "";
  for (let i = 0; i < n; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

export function genId(prefix) {
  // price 用更长的带时间味的串，其余 14 位，贴近真品观感
  if (prefix === "price_") return `price_1${randStr(24)}`;
  return `${prefix}${randStr(14)}`;
}

export function nowTs() {
  return Math.floor(Date.now() / 1000);
}
