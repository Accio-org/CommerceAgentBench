'use strict';

const crypto = require('crypto');
const schemaRaw = require('./jsonml-schema-v2.json');

// ── Schema V2 ────────────────────────────────────────────

const schemaV2 = loadSchemaV2(schemaRaw);

function loadSchemaV2(raw) {
  const tags = raw.tags || {};
  const knownTags = new Set(Object.keys(tags));
  for (const ts of Object.values(tags)) {
    ts._allowedChildrenSet = new Set(ts.allowed_children || []);
  }
  return {
    isKnownTag(tag) { return knownTags.has(tag); },
    tagSchemaFor(tag) { return tags[tag] || null; },
    tags,
    knownTags
  };
}

const inlineTags = new Set(['span', 'text', 'leaf']);
const validBlockTags = new Set(
  [...schemaV2.knownTags].filter(t => !inlineTags.has(t))
);

function childStartIndex(arr) {
  if (arr.length > 1 && typeof arr[1] === 'object' && arr[1] !== null && !Array.isArray(arr[1])) {
    return 2;
  }
  return 1;
}

// ── Deep Clone ───────────────────────────────────────────

function deepClone(v) {
  if (Array.isArray(v)) return v.map(deepClone);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) out[k] = deepClone(v[k]);
    return out;
  }
  return v;
}

// ── Normalize ────────────────────────────────────────────

function newUUID() {
  return crypto.randomUUID();
}

function wrapTextLeaf(s) {
  return ['span', { 'data-type': 'text' }, ['span', { 'data-type': 'leaf' }, s]];
}

function isTextBearingBlock(tag) {
  return tag === 'p' || (tag.length === 2 && tag[0] === 'h' && tag[1] >= '1' && tag[1] <= '6');
}

function normalizeBlock(node, path) {
  if (!Array.isArray(node) || node.length === 0) return { fixed: node, notes: [] };
  const tag = node[0];
  if (typeof tag !== 'string') return { fixed: node, notes: [] };

  let arr = [...node];
  const notes = [];

  // Fix #2 — inject uuid when attrs slot is completely missing
  if (validBlockTags.has(tag) && arr.length > 1) {
    if (typeof arr[1] !== 'object' || arr[1] === null || Array.isArray(arr[1])) {
      const attrs = { uuid: newUUID() };
      arr = [arr[0], attrs, ...arr.slice(1)];
      notes.push(`${path}: insert attrs slot with generated uuid "${attrs.uuid}"`);
    }
  }

  const start = childStartIndex(arr);

  // Fix #3 — text-bearing blocks: wrap raw-string children
  if (isTextBearingBlock(tag)) {
    for (let i = start; i < arr.length; i++) {
      if (typeof arr[i] === 'string') {
        arr[i] = wrapTextLeaf(arr[i]);
        notes.push(`${path}[${i}]: wrap raw string into span/text/leaf`);
      }
    }
  }

  // Recurse into block children
  for (let i = start; i < arr.length; i++) {
    if (!Array.isArray(arr[i]) || arr[i].length === 0) continue;
    const childTag = arr[i][0];
    if (typeof childTag !== 'string') continue;
    if (validBlockTags.has(childTag)) {
      const { fixed, notes: childNotes } = normalizeBlock(arr[i], `${path}[${i}]`);
      arr[i] = fixed;
      notes.push(...childNotes);
    }
  }
  return { fixed: arr, notes };
}

function normalizeJsonMLBody(body) {
  let working = deepClone(body);
  if (!Array.isArray(working) || working.length === 0) return { fixed: working, notes: [] };

  const notes = [];

  // Fix #1 — single block passed as body
  if (typeof working[0] === 'string' && working[0] !== 'root' && validBlockTags.has(working[0])) {
    notes.push(`$: wrap single "${working[0]}" block as body array`);
    working = [working];
  }

  let startIdx = 0;
  if (typeof working[0] === 'string' && working[0] === 'root') {
    startIdx = 1;
    if (working.length > 1 && typeof working[1] === 'object' && working[1] !== null && !Array.isArray(working[1])) {
      startIdx = 2;
    }
  }

  for (let i = startIdx; i < working.length; i++) {
    const { fixed, notes: childNotes } = normalizeBlock(working[i], `$[${i}]`);
    working[i] = fixed;
    notes.push(...childNotes);
  }
  return { fixed: working, notes };
}

function normalizeJsonMLNode(node) {
  const cloned = deepClone(node);
  return normalizeBlock(cloned, '$');
}

// ── Root Wrap ────────────────────────────────────────────

function ensureRootWrappedBody(body) {
  if (!Array.isArray(body) || body.length === 0) return { fixed: body, notes: [] };
  if (typeof body[0] === 'string' && body[0] === 'root') return { fixed: body, notes: [] };
  const out = ['root', {}, ...body];
  return { fixed: out, notes: ['$: wrap bare body with ["root", {}, ...] to satisfy server writeAsJsonML contract'] };
}

// ── Validate V2 ──────────────────────────────────────────

class JsonMLValidationResult {
  constructor() { this.errors = []; this.warnings = []; }
  hasErrors() { return this.errors.length > 0; }
  addError(path, issue, suggestion) { this.errors.push(formatDiag(path, issue, suggestion)); }
  addWarn(path, issue, suggestion) { this.warnings.push(formatDiag(path, issue, suggestion)); }
  summary() {
    if (!this.hasErrors() && this.warnings.length === 0) return '';
    let sb = '';
    if (this.errors.length > 0) {
      sb += `JSONML 校验失败（${this.errors.length} 个错误）:\n`;
      this.errors.forEach((e, i) => { sb += `  ${i + 1}. ${e}\n`; });
    }
    if (this.warnings.length > 0) {
      sb += `JSONML 校验警告（${this.warnings.length} 个）:\n`;
      this.warnings.forEach((w, i) => { sb += `  ${i + 1}. ${w}\n`; });
    }
    return sb;
  }
}

function formatDiag(path, issue, suggestion) {
  issue = issue.replace(/\.$/, '');
  if (!suggestion) return `${path}: ${issue}.`;
  return `${path}: ${issue}. Suggestion: ${suggestion}`;
}

function toFloat64(v) {
  if (typeof v === 'number') return v;
  return NaN;
}

function matchesUnion(value, types) {
  for (const t of types) {
    switch (t) {
      case 'string': if (typeof value === 'string') return true; break;
      case 'number': if (typeof value === 'number' && !isNaN(value)) return true; break;
      case 'boolean': if (typeof value === 'boolean') return true; break;
      case 'array': if (Array.isArray(value)) return true; break;
      case 'object': if (value && typeof value === 'object' && !Array.isArray(value)) return true; break;
      case 'null': if (value === null) return true; break;
      case 'any': return true;
    }
  }
  return false;
}

function checkTypeV2(value, spec, path, r) {
  switch (spec.type) {
    case 'any': return;
    case 'string':
      if (typeof value !== 'string') r.addError(path, `expected string, got ${typeof value}`, '');
      break;
    case 'number': {
      const num = toFloat64(value);
      if (isNaN(num)) { r.addError(path, `expected number, got ${typeof value}`, ''); return; }
      if (spec.min != null && num < spec.min) r.addError(path, `value ${num} < min ${spec.min}`, '');
      if (spec.max != null && num > spec.max) r.addError(path, `value ${num} > max ${spec.max}`, '');
      break;
    }
    case 'boolean':
      if (typeof value !== 'boolean') r.addError(path, `expected boolean, got ${typeof value}`, '');
      break;
    case 'array':
      if (!Array.isArray(value)) r.addError(path, `expected array, got ${typeof value}`, '');
      break;
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        r.addError(path, `expected object, got ${typeof value}`, ''); return;
      }
      if (spec.fields) {
        for (const [key, val] of Object.entries(value)) {
          const fieldSpec = spec.fields[key];
          if (!fieldSpec) { r.addWarn(`${path}.${key}`, `unknown field "${key}"`, ''); continue; }
          checkTypeV2(val, fieldSpec, `${path}.${key}`, r);
        }
      }
      break;
    }
    case 'enum': {
      if (typeof value !== 'string') { r.addError(path, `enum expects string, got ${typeof value}`, ''); return; }
      const values = spec.values || [];
      if (!values.includes(value)) r.addWarn(path, `value "${value}" not in enum [${values.join(', ')}]`, '');
      break;
    }
    case 'union': {
      const types = spec.types || [];
      if (matchesUnion(value, types)) return;
      const warnTypes = spec.warn_types || [];
      if (warnTypes.length > 0 && matchesUnion(value, warnTypes)) {
        r.addWarn(path, `value (${typeof value}) matches warn_types [${warnTypes.join(', ')}], expected [${types.join(', ')}]`, '');
        return;
      }
      r.addError(path, `value (${typeof value}) doesn't match any of [${types.join(', ')}]`, '');
      break;
    }
  }
}

function validateNodeV2(node, path, parentSchema, r) {
  if (!Array.isArray(node)) { r.addError(path, `node must be array, got ${typeof node}`, ''); return; }
  if (node.length < 1) { r.addError(path, 'node array must not be empty', ''); return; }

  const tag = node[0];
  if (typeof tag !== 'string') { r.addError(path, `tag must be string, got ${typeof tag}`, ''); return; }

  if (parentSchema && parentSchema._allowedChildrenSet && !parentSchema._allowedChildrenSet.has(tag)) {
    r.addWarn(path, `tag "${tag}" not in parent's allowed_children`, '');
  }

  const tagSchema = schemaV2.tagSchemaFor(tag);
  if (!tagSchema) { r.addWarn(path, `unknown tag "${tag}"`, ''); return; }

  let cs = 1;
  let attrs = null;
  if (node.length > 1 && typeof node[1] === 'object' && node[1] !== null && !Array.isArray(node[1])) {
    attrs = node[1];
    cs = 2;
  }

  if (attrs && tagSchema.attrs) {
    for (const [key, val] of Object.entries(attrs)) {
      const spec = tagSchema.attrs[key];
      if (!spec) { r.addWarn(`${path}.attrs.${key}`, `unknown attr "${key}"`, ''); continue; }
      checkTypeV2(val, spec, `${path}.attrs.${key}`, r);
    }
  }

  for (let i = cs; i < node.length; i++) {
    const child = node[i];
    let childPath = `${path}[${i}]`;
    if (typeof child === 'string') {
      if (!tagSchema._allowedChildrenSet || !tagSchema._allowedChildrenSet.has('#text')) {
        r.addWarn(childPath, `bare text not allowed in "${tag}"`, '');
      }
    } else if (Array.isArray(child)) {
      if (child.length > 0 && typeof child[0] === 'string') {
        childPath = `${path}[${i}:${child[0]}]`;
      }
      validateNodeV2(child, childPath, tagSchema, r);
    }
  }
}

function validateJsonMLBodyV2(body) {
  const r = new JsonMLValidationResult();
  if (!Array.isArray(body) || body.length === 0) return r;

  if (typeof body[0] === 'string' && body[0] === 'root') {
    validateNodeV2(body, '$', null, r);
    return r;
  }
  if (typeof body[0] === 'string' && schemaV2.isKnownTag(body[0])) {
    validateNodeV2(body, '$', null, r);
    return r;
  }
  for (let i = 0; i < body.length; i++) {
    let nodePath = `$[${i}]`;
    if (Array.isArray(body[i]) && body[i].length > 0 && typeof body[i][0] === 'string') {
      nodePath = `$[${i}:${body[i][0]}]`;
    }
    validateNodeV2(body[i], nodePath, null, r);
  }
  return r;
}

function validateJsonMLNodeV2(node) {
  const r = new JsonMLValidationResult();
  validateNodeV2(node, '$', null, r);
  return r;
}

// ── Exports ──────────────────────────────────────────────

module.exports = {
  normalizeJsonMLBody,
  normalizeJsonMLNode,
  ensureRootWrappedBody,
  validateJsonMLBodyV2,
  validateJsonMLNodeV2,
  validBlockTags,
  schemaV2
};
