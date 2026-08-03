/**
 * HTTPie-style request item parser for `ntn api`.
 *
 * Patterns:
 *   key=value          → body string field
 *   key:=json          → body JSON-typed field
 *   key==value         → query parameter
 *   Header:Value       → request header
 *   key[nested]=v      → nested body via bracket notation
 *   key.dot.path=v     → nested body via dot notation
 *   key[0]=v           → array index
 *   key[]=v            → array append
 */

const SEPARATORS = [
  { sep: ':=', type: 'json_body' },
  { sep: '==', type: 'query' },
  { sep: '=',  type: 'body' },
];

export function parseRequestItems(items) {
  const body = {};
  const queryParams = {};
  const headers = {};
  let hasBody = false;

  for (const item of items) {
    const headerMatch = item.match(/^([A-Za-z0-9_-]+):(.+)$/);
    if (headerMatch && !item.includes('=') && !item.includes(':=')) {
      headers[headerMatch[1]] = headerMatch[2];
      continue;
    }

    let matched = false;
    for (const { sep, type } of SEPARATORS) {
      const idx = item.indexOf(sep);
      if (idx === -1) continue;
      if (sep === '=' && item.indexOf(':=') !== -1 && item.indexOf(':=') < idx) continue;
      if (sep === '=' && item.indexOf('==') !== -1 && item.indexOf('==') === idx) continue;

      const rawKey = item.slice(0, idx);
      const rawVal = item.slice(idx + sep.length);

      if (type === 'query') {
        queryParams[rawKey] = rawVal;
      } else {
        const value = type === 'json_body' ? parseJsonValue(rawVal) : rawVal;
        const path = parsePath(rawKey);
        setDeep(body, path, value);
        hasBody = true;
      }
      matched = true;
      break;
    }

    if (!matched && headerMatch) {
      headers[headerMatch[1]] = headerMatch[2];
    }
  }

  return { body: hasBody ? body : null, queryParams, headers };
}

function parseJsonValue(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function parsePath(key) {
  const segments = [];
  let current = '';
  let i = 0;

  while (i < key.length) {
    if (key[i] === '[') {
      if (current) { segments.push(current); current = ''; }
      i++;
      let bracket = '';
      while (i < key.length && key[i] !== ']') {
        bracket += key[i];
        i++;
      }
      i++; // skip ']'
      if (bracket === '') {
        segments.push({ append: true });
      } else if (/^\d+$/.test(bracket)) {
        segments.push(parseInt(bracket, 10));
      } else {
        segments.push(bracket);
      }
    } else if (key[i] === '.') {
      if (current) { segments.push(current); current = ''; }
      i++;
    } else {
      current += key[i];
      i++;
    }
  }
  if (current) segments.push(current);
  return segments;
}

function setDeep(obj, path, value) {
  if (path.length === 0) return;

  let target = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i];
    const nextSeg = path[i + 1];

    const key = typeof seg === 'object' && seg.append ? getAppendIndex(target) : seg;
    const nextIsArray = typeof nextSeg === 'number' || (typeof nextSeg === 'object' && nextSeg.append);

    if (target[key] === undefined) {
      target[key] = nextIsArray ? [] : {};
    }
    target = target[key];
  }

  const lastSeg = path[path.length - 1];
  if (typeof lastSeg === 'object' && lastSeg.append) {
    const idx = Array.isArray(target) ? target.length : getAppendIndex(target);
    target[idx] = value;
  } else {
    target[lastSeg] = value;
  }
}

function getAppendIndex(arr) {
  if (Array.isArray(arr)) return arr.length;
  const keys = Object.keys(arr).filter(k => /^\d+$/.test(k));
  return keys.length > 0 ? Math.max(...keys.map(Number)) + 1 : 0;
}
