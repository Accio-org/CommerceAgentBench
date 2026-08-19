'use strict';

const fs = require('fs');

/**
 * Apply jq-like expression to data.
 * Supports basic path expressions: .key, .key1.key2, .array[], .array[0], pipes |
 */
function applyJq(data, expression) {
  if (!expression) return data;

  // Split by pipe
  const parts = expression.split('|').map(s => s.trim());
  let result = data;

  for (const part of parts) {
    result = applyJqPart(result, part);
  }

  return result;
}

function applyJqPart(data, expr) {
  if (expr === '.') return data;

  // Handle object construction {key: .path, ...}
  const objMatch = expr.match(/^\{(.+)\}$/);
  if (objMatch) {
    return applyJqObject(data, objMatch[1]);
  }

  // Handle array iteration .key[]
  if (expr.endsWith('[]')) {
    const path = expr.slice(0, -2);
    const arr = resolvePath(data, path);
    return Array.isArray(arr) ? arr : [];
  }

  // Handle array index .key[0]
  const idxMatch = expr.match(/^(.+)\[(\d+)\]$/);
  if (idxMatch) {
    const arr = resolvePath(data, idxMatch[1]);
    return Array.isArray(arr) ? arr[parseInt(idxMatch[2])] : undefined;
  }

  // Handle select/filter (basic)
  if (expr.startsWith('select(')) {
    return data; // pass-through for mock
  }

  // Handle length
  if (expr === 'length') {
    if (Array.isArray(data)) return data.length;
    if (typeof data === 'object' && data !== null) return Object.keys(data).length;
    return 0;
  }

  // Simple path resolution
  return resolvePath(data, expr);
}

function resolvePath(data, pathExpr) {
  if (!pathExpr || pathExpr === '.') return data;

  // Remove leading dot
  const path = pathExpr.startsWith('.') ? pathExpr.slice(1) : pathExpr;
  if (!path) return data;

  const keys = path.split('.');
  let current = data;

  for (const key of keys) {
    if (current === null || current === undefined) return undefined;

    // Handle array iteration within path
    if (key.endsWith('[]')) {
      const k = key.slice(0, -2);
      current = k ? current[k] : current;
      if (!Array.isArray(current)) return undefined;
      continue;
    }

    // Handle array index
    const idxMatch = key.match(/^(.+)\[(\d+)\]$/);
    if (idxMatch) {
      current = current[idxMatch[1]];
      if (Array.isArray(current)) {
        current = current[parseInt(idxMatch[2])];
      } else {
        return undefined;
      }
      continue;
    }

    if (typeof current === 'object' && current !== null) {
      current = current[key];
    } else {
      return undefined;
    }
  }

  return current;
}

function applyJqObject(data, fields) {
  // Simple key: .path parsing for object construction
  const result = {};
  // Split by comma but respect nested braces
  const pairs = splitFields(fields);

  for (const pair of pairs) {
    const colonIdx = pair.indexOf(':');
    if (colonIdx === -1) {
      // Shorthand: .key => key: .key
      const key = pair.trim().replace(/^\./, '');
      result[key] = resolvePath(data, pair.trim());
    } else {
      const key = pair.slice(0, colonIdx).trim();
      const valuePath = pair.slice(colonIdx + 1).trim();

      // Handle nested expressions like (.tools | length)
      const parenMatch = valuePath.match(/^\((.+)\)$/);
      if (parenMatch) {
        const inner = parenMatch[1];
        const pipeParts = inner.split('|').map(s => s.trim());
        let val = resolvePath(data, pipeParts[0]);
        for (let i = 1; i < pipeParts.length; i++) {
          val = applyJqPart(val, pipeParts[i]);
        }
        result[key] = val;
      } else {
        result[key] = resolvePath(data, valuePath);
      }
    }
  }

  return result;
}

function splitFields(str) {
  const results = [];
  let depth = 0;
  let current = '';
  for (const ch of str) {
    if (ch === '(' || ch === '{') depth++;
    if (ch === ')' || ch === '}') depth--;
    if (ch === ',' && depth === 0) {
      results.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current) results.push(current);
  return results;
}

/**
 * Apply --fields projection
 */
function applyFieldsFilter(data, fields) {
  if (!fields) return data;

  const fieldList = fields.split(',').map(f => f.trim());

  function filterObj(obj) {
    if (typeof obj !== 'object' || obj === null) return obj;
    const result = {};
    for (const f of fieldList) {
      if (f in obj) result[f] = obj[f];
    }
    return result;
  }

  if (Array.isArray(data)) {
    return data.map(filterObj);
  }
  return filterObj(data);
}

/**
 * Format output based on --format flag
 */
function formatOutput(data, flags) {
  let output = data;

  // Apply jq filter
  if (flags.jq) {
    output = applyJq(output, flags.jq);
  }

  // Apply fields filter
  if (flags.fields) {
    output = applyFieldsFilter(output, flags.fields);
  }

  switch (flags.format) {
    case 'json':
      return JSON.stringify(output, null, 2);
    case 'raw':
      return typeof output === 'string' ? output : JSON.stringify(output);
    case 'table':
      return formatTable(output);
    default:
      return JSON.stringify(output, null, 2);
  }
}

function formatTable(data) {
  if (Array.isArray(data)) {
    if (data.length === 0) return '(empty)';
    const keys = Object.keys(data[0] || {});
    const header = keys.join('\t');
    const rows = data.map(row => keys.map(k => String(row[k] ?? '')).join('\t'));
    return [header, ...rows].join('\n');
  }
  if (typeof data === 'object' && data !== null) {
    return Object.entries(data).map(([k, v]) => `${k}\t${JSON.stringify(v)}`).join('\n');
  }
  return String(data);
}

/**
 * Write output to file or stdout
 */
function writeOutput(formatted, flags) {
  process.stdout.write(formatted + '\n');
}

module.exports = { formatOutput, writeOutput, applyJq, applyFieldsFilter };
