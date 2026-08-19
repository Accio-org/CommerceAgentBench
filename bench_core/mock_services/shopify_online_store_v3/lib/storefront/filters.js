// Liquid filters mirrored against Shopify's storefront filter library.
// We implement the subset used by the seed theme + common third-party themes:
// money / asset_url / image_url / link_to / stylesheet_tag / script_tag / t /
// default / handleize / truncate / truncatewords / strip_html / json / etc.
//
// Where Shopify's exact format depends on shop locale/currency, we read from
// the `shop` drop's currency + locale (default USD + en).

const NUMERIC_RE = /^-?\d+(\.\d+)?$/;

function parseNumber(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/[$,]/g, '').trim();
  if (NUMERIC_RE.test(s)) return Number(s);
  // Try to extract leading numeric portion ("$24.00 USD" → 24.00).
  const m = s.match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : 0;
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function handleize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

// Build Liquid filter functions bound to the current request context. Some
// filters need access to globals (shop currency, asset base URL, locale
// translations) — those are passed in via the `ctx` arg.
function buildFilters({ assetBase, shop, translations }) {
  const currencyCode = (shop && shop.currency) || 'USD';
  const symbol = { USD: '$', CNY: '¥', EUR: '€', GBP: '£', JPY: '¥' }[currencyCode] || '$';

  const money = (input) => {
    const n = parseNumber(input);
    return `${symbol}${n.toFixed(2)}${currencyCode === 'USD' ? '' : ''}`;
  };
  const money_with_currency = (input) => {
    const n = parseNumber(input);
    return `${symbol}${n.toFixed(2)} ${currencyCode}`;
  };
  const money_without_currency = (input) => {
    const n = parseNumber(input);
    return n.toFixed(2);
  };
  const asset_url = (file) => `${assetBase}/${String(file || '').replace(/^\/+/, '')}`;
  const image_url = (input, _opts) => {
    // Shopify's image_url accepts an Image object or string. We accept both
    // and pass through as-is when it's a URL; otherwise prefix asset_url.
    if (!input) return '';
    if (typeof input === 'object' && input.src) return String(input.src);
    if (typeof input === 'object' && input.url) return String(input.url);
    const s = String(input);
    if (/^https?:\/\//i.test(s) || s.startsWith('/')) return s;
    return asset_url(s);
  };
  const img_url = image_url;
  const link_to = (text, url, title) => {
    const t = title ? ` title="${escapeHtml(title)}"` : '';
    return `<a href="${escapeHtml(url || '#')}"${t}>${escapeHtml(text || '')}</a>`;
  };
  const stylesheet_tag = (input) => {
    return `<link rel="stylesheet" href="${escapeHtml(input)}" media="all">`;
  };
  const script_tag = (input) => {
    return `<script src="${escapeHtml(input)}" defer="defer"></script>`;
  };
  // `| t` translates locale keys; falls back to the key itself.
  const t = (key, opts) => {
    const trans = translations || {};
    const parts = String(key).split('.');
    let cur = trans;
    for (const p of parts) {
      if (cur && typeof cur === 'object' && p in cur) cur = cur[p];
      else return interpolate(String(key), opts);
    }
    return interpolate(String(cur), opts);
  };
  function interpolate(str, opts) {
    if (!opts || typeof opts !== 'object') return str;
    return str.replace(/\{\{\s*([\w-]+)\s*\}\}/g, (_, k) => (k in opts ? String(opts[k]) : ''));
  }
  const default_ = (input, fallback) => {
    if (input === null || input === undefined) return fallback;
    if (input === '' || input === false || (Array.isArray(input) && input.length === 0)) return fallback;
    return input;
  };
  const json = (input) => JSON.stringify(input == null ? '' : input);
  const url_encode = (input) => encodeURIComponent(String(input == null ? '' : input));
  const url_decode = (input) => {
    try { return decodeURIComponent(String(input == null ? '' : input)); } catch { return String(input || ''); }
  };
  const truncate = (input, len = 50, mark = '...') => {
    const s = String(input == null ? '' : input);
    if (s.length <= len) return s;
    return s.slice(0, Math.max(0, len - mark.length)) + mark;
  };
  const truncatewords = (input, count = 15, mark = '...') => {
    const words = String(input == null ? '' : input).split(/\s+/);
    if (words.length <= count) return words.join(' ');
    return words.slice(0, count).join(' ') + mark;
  };
  const strip_html = (input) => String(input == null ? '' : input).replace(/<[^>]+>/g, '');
  const capitalize = (input) => {
    const s = String(input == null ? '' : input);
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
  const upcase = (input) => String(input == null ? '' : input).toUpperCase();
  const downcase = (input) => String(input == null ? '' : input).toLowerCase();
  const escape = escapeHtml;
  const escape_once = escapeHtml; // close enough for mock purposes
  const replace = (input, from, to) => String(input == null ? '' : input).split(from).join(to == null ? '' : to);
  const remove = (input, from) => replace(input, from, '');
  const remove_first = (input, from) => String(input == null ? '' : input).replace(from, '');
  const append = (input, suffix) => String(input == null ? '' : input) + String(suffix == null ? '' : suffix);
  const prepend = (input, prefix) => String(prefix == null ? '' : prefix) + String(input == null ? '' : input);
  const split = (input, sep) => String(input == null ? '' : input).split(sep);
  const join = (input, sep) => Array.isArray(input) ? input.join(sep || '') : '';
  const size = (input) => (input == null ? 0 : (Array.isArray(input) || typeof input === 'string' ? input.length : Object.keys(input).length));
  const first = (input) => (Array.isArray(input) ? input[0] : (input && typeof input === 'string' ? input.charAt(0) : undefined));
  const last = (input) => (Array.isArray(input) ? input[input.length - 1] : (input && typeof input === 'string' ? input.charAt(input.length - 1) : undefined));
  const reverse = (input) => (Array.isArray(input) ? [...input].reverse() : String(input == null ? '' : input).split('').reverse().join(''));
  const sort = (input, key) => {
    if (!Array.isArray(input)) return input;
    const copy = [...input];
    if (key == null) copy.sort();
    else copy.sort((a, b) => (a && a[key] > b[key] ? 1 : a && a[key] < b[key] ? -1 : 0));
    return copy;
  };
  const map = (input, key) => (Array.isArray(input) ? input.map((it) => (it == null ? undefined : it[key])) : []);
  const where = (input, key, value) => {
    if (!Array.isArray(input)) return [];
    if (value === undefined) return input.filter((it) => it && it[key]);
    return input.filter((it) => it && String(it[key]) === String(value));
  };
  const uniq = (input) => (Array.isArray(input) ? [...new Set(input)] : input);
  const compact = (input) => (Array.isArray(input) ? input.filter((it) => it != null && it !== '') : input);
  const concat = (a, b) => [...(a || []), ...(b || [])];
  const slice = (input, from, len) => {
    if (input == null) return '';
    if (Array.isArray(input)) return input.slice(from, from + (len == null ? 1 : len));
    const s = String(input);
    return s.substring(from, from + (len == null ? 1 : len));
  };
  const date = (input, fmt) => {
    if (!input) return '';
    let d;
    if (input === 'now' || input === 'today') d = new Date();
    else d = new Date(input);
    if (isNaN(d.getTime())) return String(input);
    return formatDate(d, fmt || '%Y-%m-%d');
  };
  function formatDate(d, fmt) {
    const pad = (n) => String(n).padStart(2, '0');
    return String(fmt)
      .replace(/%Y/g, d.getFullYear())
      .replace(/%m/g, pad(d.getMonth() + 1))
      .replace(/%d/g, pad(d.getDate()))
      .replace(/%H/g, pad(d.getHours()))
      .replace(/%M/g, pad(d.getMinutes()))
      .replace(/%S/g, pad(d.getSeconds()))
      .replace(/%B/g, ['January','February','March','April','May','June','July','August','September','October','November','December'][d.getMonth()])
      .replace(/%b/g, ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()])
      .replace(/%A/g, ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getDay()])
      .replace(/%a/g, ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()]);
  }
  const plus = (a, b) => parseNumber(a) + parseNumber(b);
  const minus = (a, b) => parseNumber(a) - parseNumber(b);
  const times = (a, b) => parseNumber(a) * parseNumber(b);
  const divided_by = (a, b) => parseNumber(a) / (parseNumber(b) || 1);
  const modulo = (a, b) => parseNumber(a) % (parseNumber(b) || 1);
  const round = (a, prec = 0) => {
    const f = Math.pow(10, prec);
    return Math.round(parseNumber(a) * f) / f;
  };
  const ceil = (a) => Math.ceil(parseNumber(a));
  const floor = (a) => Math.floor(parseNumber(a));
  const abs = (a) => Math.abs(parseNumber(a));
  const at_most = (a, b) => Math.min(parseNumber(a), parseNumber(b));
  const at_least = (a, b) => Math.max(parseNumber(a), parseNumber(b));
  const handle = handleize;
  const newline_to_br = (input) => String(input == null ? '' : input).replace(/\n/g, '<br>');
  const strip = (input) => String(input == null ? '' : input).trim();
  const lstrip = (input) => String(input == null ? '' : input).replace(/^\s+/, '');
  const rstrip = (input) => String(input == null ? '' : input).replace(/\s+$/, '');
  const escape_javascript = (input) => String(input == null ? '' : input).replace(/['"\\\n\r]/g, (c) => ({"'":"\\'", '"':'\\"','\\':'\\\\','\n':'\\n','\r':'\\r'})[c] || c);

  // Shopify-specific URL helpers.
  const within = (input, _collection) => input; // no-op
  const article_img_url = image_url;
  const product_img_url = image_url;
  const collection_img_url = image_url;
  const variant_img_url = image_url;
  const file_url = (input) => `${assetBase}/${String(input || '').replace(/^\/+/, '')}`;
  const global_asset_url = file_url;
  const shopify_asset_url = file_url;
  const payment_type_img_url = (input) => `/assets/payment-${String(input || 'card')}.svg`;
  const payment_type_svg_tag = (input) => `<svg class="payment-icon payment-icon-${String(input || 'card')}"></svg>`;

  return {
    money, money_with_currency, money_without_currency, money_with_currency_no_decimal: money_without_currency,
    asset_url, image_url, img_url, file_url, global_asset_url, shopify_asset_url,
    link_to, stylesheet_tag, script_tag,
    t, default: default_, json, url_encode, url_decode,
    truncate, truncatewords, strip_html, capitalize, upcase, downcase, escape, escape_once, replace, remove, remove_first,
    append, prepend, split, join, size, first, last, reverse, sort, map, where, uniq, compact, concat, slice,
    date, plus, minus, times, divided_by, modulo, round, ceil, floor, abs, at_most, at_least,
    handle, handleize, newline_to_br, strip, lstrip, rstrip, escape_javascript,
    within, article_img_url, product_img_url, collection_img_url, variant_img_url,
    payment_type_img_url, payment_type_svg_tag,
  };
}

function registerFilters(engine, filters) {
  for (const [name, fn] of Object.entries(filters)) {
    engine.registerFilter(name, fn);
  }
}

module.exports = { buildFilters, registerFilters, handleize, escapeHtml, parseNumber };
