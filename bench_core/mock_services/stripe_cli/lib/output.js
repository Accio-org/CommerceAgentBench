/**
 * output.js — 输出格式化。
 * 真品在 NO_COLOR=1 下打印 2 空格缩进的 JSON（带颜色时是 ANSI 着色版，本 mock 先做无色版）。
 * 键顺序由对象构造时的插入顺序决定（已对齐官方文档样例）。
 */
// 真品把这些字段渲染为浮点（如 percent_off: 25.0），JS 默认序列化成整数，需补 ".0"
const FLOAT_FIELDS = ["percent_off", "percentage", "effective_percentage"];
function serialize(obj) {
  let s = JSON.stringify(obj, null, 2);
  for (const f of FLOAT_FIELDS) {
    s = s.replace(new RegExp(`("${f}": )(\\d+)(?=[,\\n}])`, "g"), "$1$2.0");
  }
  return s;
}

export function printJson(obj) {
  process.stdout.write(serialize(obj) + "\n");
}

// 真品 API 错误体结尾是 "}\n\n"（比成功输出多一个空行）
export function printError(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + "\n\n");
}

// Stripe list 对象包装。键序对齐真品：object, data, has_more, url（非字母序）
export function listEnvelope(resource, data, hasMore = false) {
  return {
    object: "list",
    data,
    has_more: hasMore,
    url: `/v1/${resource}`,
  };
}

export function deletedEnvelope(object, id) {
  return { id, object, deleted: true };
}
