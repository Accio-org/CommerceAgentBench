// Storefront renderer — composes a Shopify-style page from theme files + state.
//
// Flow:
//   1. Resolve which theme to render against (current, or ?preview_theme_id)
//   2. Build per-request theme FS from `draft.themeFiles[]`
//   3. Load config/settings_data.json + locales/<locale>.default.json
//   4. Build drops (shop/product/collection/...) sized to request route
//   5. Load templates/<name>.json (or templates/<name>.liquid)
//   6. Compose sections from template JSON (read sections/<type>.liquid, strip
//      {% schema %} blocks, run liquidjs against {section: ...} context)
//   7. Wrap output in layout/theme.liquid where {{ content_for_layout }} is
//      replaced by the composed sections
//
// All section schemas are JSON blocks delimited by {% schema %} ... {% endschema %}.
// We extract them server-side and use the schema's defaults to fill in missing
// section.settings values from template JSON.

const { Liquid } = require('liquidjs');
const { ThemeFs } = require('./theme_fs');
const { buildFilters, registerFilters } = require('./filters');
const { buildContextFor } = require('./drops');

const SCHEMA_RE = /\{%-?\s*schema\s*-?%\}([\s\S]*?)\{%-?\s*endschema\s*-?%\}/;

function pickTheme(draft, previewThemeId) {
  const themes = draft.themes || [];
  if (previewThemeId) {
    const found = themes.find((t) => String(t.id) === String(previewThemeId));
    if (found) return found;
  }
  return themes.find((t) => t.role === 'current') || themes[0] || null;
}

function filterThemeFiles(allFiles, themeId, draft) {
  // Per-theme file scoping (Phase C.7):
  //
  // Each themeFile entry may carry an optional `themeId` field. When present,
  // the file belongs to that theme; when absent it belongs to the "current"
  // theme (so `themeFilesUpsert` — the GraphQL mutation that writes the
  // current theme's files — keeps working unchanged).
  //
  // Resolution rules:
  //   * If the rendered themeId matches an entry's themeId → include it.
  //   * If the entry has NO themeId AND the rendered theme is the current
  //     theme → include it.
  //   * Otherwise → exclude (so swapping ?preview_theme_id=N actually serves
  //     that theme's files instead of the current theme's by mistake).
  //
  // Backwards compat: if no themeFile has any `themeId` field at all (the
  // most common case — seed data + legacy upserts), every file falls into
  // the "current theme" bucket and behavior is identical to pre-C.7.
  const files = allFiles || [];
  if (!files.length) return files;
  const currentTheme = (draft && draft.themes || []).find((t) => t.role === 'current');
  const currentId = currentTheme ? String(currentTheme.id) : null;
  const requested = themeId != null ? String(themeId) : null;
  return files.filter((file) => {
    if (file.themeId == null) {
      // Legacy entry — belongs to the current theme. Visible when we're
      // rendering the current theme (or when no current theme exists yet).
      return requested === null || requested === currentId;
    }
    return String(file.themeId) === requested;
  });
}

function parseSettingsData(fs) {
  const raw = fs.get('config/settings_data.json');
  if (!raw) return { current: {}, presets: {} };
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed.current === 'string') {
      // It's a preset name; look up the preset.
      const preset = parsed.presets && parsed.presets[parsed.current];
      return { current: preset || {}, presets: parsed.presets || {} };
    }
    return { current: parsed.current || {}, presets: parsed.presets || {}, sections: parsed.sections, content_for_index: parsed.content_for_index };
  } catch {
    return { current: {}, presets: {} };
  }
}

function parseLocale(fs, locale = 'en') {
  // Prefer `<locale>.default.json`; fall back to en.default.json.
  const candidates = [`locales/${locale}.default.json`, `locales/en.default.json`, `locales/en.json`];
  for (const cand of candidates) {
    const raw = fs.get(cand);
    if (!raw) continue;
    try { return JSON.parse(raw); } catch { /* fall through */ }
  }
  return {};
}

function extractSchema(sectionSource) {
  const m = sectionSource.match(SCHEMA_RE);
  if (!m) return { body: sectionSource, schema: null };
  let schema = null;
  try { schema = JSON.parse(m[1]); } catch { schema = null; }
  const body = sectionSource.replace(SCHEMA_RE, '').trim();
  return { body, schema };
}

function schemaDefaults(schema) {
  if (!schema || !Array.isArray(schema.settings)) return {};
  const out = {};
  for (const s of schema.settings) {
    if (!s || !s.id) continue;
    if ('default' in s) out[s.id] = s.default;
  }
  return out;
}

function blockSchemaDefaults(schema, blockType) {
  if (!schema || !Array.isArray(schema.blocks)) return {};
  const bs = schema.blocks.find((b) => b.type === blockType);
  if (!bs || !Array.isArray(bs.settings)) return {};
  const out = {};
  for (const s of bs.settings) {
    if (!s || !s.id) continue;
    if ('default' in s) out[s.id] = s.default;
  }
  return out;
}

async function renderSection({ engine, fs, sectionId, sectionDef, ctx, settingsData }) {
  const type = sectionDef.type || sectionId;
  const filePath = `sections/${type}.liquid`;
  const raw = fs.get(filePath);
  if (raw == null) {
    return `<!-- section missing: ${type} -->`;
  }
  const { body, schema } = extractSchema(raw);
  // Settings precedence: settings_data.sections[sectionId] > template-defined > schema defaults
  const fromData = (settingsData.sections && settingsData.sections[sectionId] && settingsData.sections[sectionId].settings) || {};
  const settings = { ...schemaDefaults(schema), ...(sectionDef.settings || {}), ...fromData };
  // Blocks
  let blocks = [];
  let blockOrder = [];
  if (sectionDef.blocks && typeof sectionDef.blocks === 'object') {
    blockOrder = sectionDef.block_order || Object.keys(sectionDef.blocks);
    blocks = blockOrder.map((bid) => {
      const b = sectionDef.blocks[bid];
      if (!b) return null;
      const bs = { ...blockSchemaDefaults(schema, b.type), ...(b.settings || {}) };
      return { id: bid, type: b.type, settings: bs, shopify_attributes: '' };
    }).filter(Boolean);
  } else if (schema && Array.isArray(schema.presets) && schema.presets[0] && Array.isArray(schema.presets[0].blocks)) {
    blocks = schema.presets[0].blocks.map((b, i) => ({
      id: `preset-${i}`,
      type: b.type,
      settings: { ...blockSchemaDefaults(schema, b.type), ...(b.settings || {}) },
      shopify_attributes: '',
    }));
  }
  const sectionCtx = {
    ...ctx,
    section: {
      id: sectionId,
      settings,
      blocks,
      blocks_count: blocks.length,
    },
  };
  try {
    const rendered = await engine.parseAndRender(body, sectionCtx);
    return `<div id="shopify-section-${sectionId}" class="shopify-section shopify-section-${type}">${rendered}</div>`;
  } catch (err) {
    return `<!-- section ${sectionId} (${type}) failed: ${escapeAttr(err.message || String(err))} -->`;
  }
}

function escapeAttr(s) {
  return String(s == null ? '' : s).replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

async function composeTemplate({ engine, fs, templateName, ctx, settingsData }) {
  // Try templates/<name>.json first (OS 2.0), then templates/<name>.liquid.
  const jsonPath = `templates/${templateName}.json`;
  const liquidPath = `templates/${templateName}.liquid`;
  const jsonRaw = fs.get(jsonPath);
  if (jsonRaw) {
    let parsed;
    try { parsed = JSON.parse(jsonRaw); } catch (err) {
      return `<!-- template ${templateName}.json parse error: ${escapeAttr(err.message)} -->`;
    }
    const sections = parsed.sections || {};
    const order = parsed.order || Object.keys(sections);
    const rendered = await Promise.all(order.map((sid) => renderSection({
      engine, fs, sectionId: sid, sectionDef: sections[sid] || {}, ctx, settingsData,
    })));
    const wrap = parsed.wrapper || '';
    if (wrap) return `<${wrap}>${rendered.join('\n')}</${wrap}>`;
    return rendered.join('\n');
  }
  const liquidRaw = fs.get(liquidPath);
  if (liquidRaw) {
    try {
      return await engine.parseAndRender(liquidRaw, ctx);
    } catch (err) {
      return `<!-- template ${templateName}.liquid failed: ${escapeAttr(err.message)} -->`;
    }
  }
  // Fall back to a minimal generic page.
  return `<div class="shopify-section shopify-section--missing"><!-- template not found: ${escapeAttr(templateName)} -->\n<main><h1>${escapeAttr(ctx.page_title || templateName)}</h1></main></div>`;
}

async function composeSectionGroup({ engine, fs, groupName, ctx, settingsData }) {
  const jsonPath = `sections/${groupName}.json`;
  const jsonRaw = fs.get(jsonPath);
  if (!jsonRaw) return '';
  let parsed;
  try { parsed = JSON.parse(jsonRaw); } catch { return ''; }
  const sections = parsed.sections || {};
  const order = parsed.order || Object.keys(sections);
  const rendered = await Promise.all(order.map((sid) => renderSection({
    engine, fs, sectionId: sid, sectionDef: sections[sid] || {}, ctx, settingsData,
  })));
  return rendered.join('\n');
}

function createEngine(fs) {
  const engine = new Liquid({
    fs,
    extname: '.liquid',
    partials: 'snippets',
    layouts: 'layout',
    relativeReference: false,
    cache: false,
    strictFilters: false,
    strictVariables: false,
    lenientIf: true,
    // Trim defaults match Shopify (no trim by default).
    trimTagLeft: false,
    trimTagRight: false,
    trimOutputLeft: false,
    trimOutputRight: false,
    greedy: false,
  });
  return engine;
}

function registerCustomTags(engine, { fs, ctx, settingsData }) {
  // {% section 'name' %} renders sections/<name>.liquid with the section
  // context from settings_data (or empty if no template-defined instance).
  engine.registerTag('section', {
    parse(tagToken) {
      this.name = stripQuotes(tagToken.args || '').trim();
    },
    async render(_scope) {
      // Find a sections[<name>] entry in settings_data; otherwise empty def.
      const def = (settingsData.sections && settingsData.sections[this.name]) || { type: this.name };
      return renderSection({
        engine,
        fs,
        sectionId: this.name,
        sectionDef: def,
        ctx,
        settingsData,
      });
    },
  });

  // {% sections 'group' %} renders sections/<group>.json (a section group).
  engine.registerTag('sections', {
    parse(tagToken) {
      this.name = stripQuotes(tagToken.args || '').trim();
    },
    async render(_scope) {
      return composeSectionGroup({ engine, fs, groupName: this.name, ctx, settingsData });
    },
  });

  // {% style %} ... {% endstyle %} → <style>...</style> (preserves liquid output).
  engine.registerTag('style', {
    parse(tagToken, remainTokens) {
      this.tokens = [];
      while (remainTokens.length > 0) {
        const t = remainTokens.shift();
        if (t.name === 'endstyle') return;
        this.tokens.push(t);
      }
      throw new Error('tag {% style %} not closed');
    },
    async render(ctx2) {
      const tpl = engine.parser.parseTokens(this.tokens);
      const inner = await engine.renderer.renderTemplates(tpl, ctx2);
      return `<style>${inner}</style>`;
    },
  });

  // {% javascript %} ... {% endjavascript %} → <script>...</script>
  engine.registerTag('javascript', {
    parse(tagToken, remainTokens) {
      this.tokens = [];
      while (remainTokens.length > 0) {
        const t = remainTokens.shift();
        if (t.name === 'endjavascript') return;
        this.tokens.push(t);
      }
      throw new Error('tag {% javascript %} not closed');
    },
    async render(ctx2) {
      const tpl = engine.parser.parseTokens(this.tokens);
      const inner = await engine.renderer.renderTemplates(tpl, ctx2);
      return `<script>${inner}</script>`;
    },
  });

  // {% schema %} ... {% endschema %} — already stripped from section bodies;
  // register as a no-op so any stray usage outside a section file doesn't blow.
  engine.registerTag('schema', {
    parse(_tagToken, remainTokens) {
      this.tokens = [];
      while (remainTokens.length > 0) {
        const t = remainTokens.shift();
        if (t.name === 'endschema') return;
        this.tokens.push(t);
      }
    },
    render() { return ''; },
  });

  // {% form 'type' %} ... {% endform %} — minimal wrapper used by product/cart forms.
  engine.registerTag('form', {
    parse(tagToken, remainTokens) {
      this.args = (tagToken.args || '').trim();
      this.tokens = [];
      while (remainTokens.length > 0) {
        const t = remainTokens.shift();
        if (t.name === 'endform') return;
        this.tokens.push(t);
      }
      throw new Error('tag {% form %} not closed');
    },
    async render(ctx2) {
      const tpl = engine.parser.parseTokens(this.tokens);
      const inner = await engine.renderer.renderTemplates(tpl, ctx2);
      // Pull a 'product' arg if present so we can wire action="/cart/add".
      const parts = this.args.split(',').map((s) => s.trim());
      const formType = stripQuotes(parts[0] || 'generic');
      const action = formType === 'product' ? '/cart/add' : (formType === 'cart' ? '/cart' : '/' + formType.replace(/_/g, '-'));
      return `<form method="post" action="${action}" data-form-type="${formType}">${inner}</form>`;
    },
  });

  // {% paginate items by N %} ... {% endpaginate %} — minimal (no real paging).
  engine.registerTag('paginate', {
    parse(tagToken, remainTokens) {
      this.args = (tagToken.args || '').trim();
      this.tokens = [];
      while (remainTokens.length > 0) {
        const t = remainTokens.shift();
        if (t.name === 'endpaginate') return;
        this.tokens.push(t);
      }
      throw new Error('tag {% paginate %} not closed');
    },
    async render(ctx2) {
      const tpl = engine.parser.parseTokens(this.tokens);
      // Expose a minimal `paginate` drop.
      const scope = ctx2.environments[0] || {};
      const items = (this.args.match(/^(\S+)/) || [])[1];
      const arr = items ? scope[items] : [];
      ctx2.environments[0] = {
        ...scope,
        paginate: {
          current_page: 1,
          items: Array.isArray(arr) ? arr.length : 0,
          pages: 1,
          page_size: 24,
          parts: [],
          previous: null,
          next: null,
        },
      };
      return engine.renderer.renderTemplates(tpl, ctx2);
    },
  });
}

function stripQuotes(s) {
  return String(s || '').replace(/^['"]/, '').replace(/['"]$/, '');
}

async function wrapInLayout({ engine, fs, body, ctx }) {
  const layoutRaw = fs.get('layout/theme.liquid');
  if (!layoutRaw) {
    return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeAttr(ctx.page_title || '')}</title>${ctx.content_for_header}</head><body>${body}</body></html>`;
  }
  const ctxWithLayout = { ...ctx, content_for_layout: body };
  try {
    return await engine.parseAndRender(layoutRaw, ctxWithLayout);
  } catch (err) {
    return `<!doctype html><html><head><meta charset="utf-8"><title>Layout error</title></head><body><pre>Layout render failed: ${escapeAttr(err.message)}</pre><div>${body}</div></body></html>`;
  }
}

// Public entry point — render a storefront page.
//   draftState  : full backend `state.draft` object
//   url         : URL object for the current request
//   route       : { type: 'index'|'product'|'collection'|'page'|'cart'|'search'|'404', handle?, query? }
//   assetBase   : base URL prefix for /assets requests (usually '/assets')
//   previewThemeId : optional explicit theme id from ?preview_theme_id
async function renderStorefront({ draft, url, route, assetBase = '/assets', previewThemeId = null }) {
  const theme = pickTheme(draft, previewThemeId);
  const themeId = theme ? theme.id : null;
  const files = filterThemeFiles(draft.themeFiles, themeId, draft);
  const fs = new ThemeFs(files);
  const settingsData = parseSettingsData(fs);
  const locale = (draft.locale || 'en').split('-')[0];
  const translations = parseLocale(fs, locale);

  const { ctx, templateName } = buildContextFor({ route, state: draft, settingsData, url });
  ctx.theme = { id: themeId, name: theme?.name || '', role: theme?.role || 'current' };

  const engine = createEngine(fs);
  const shopForFilters = ctx.shop;
  const filters = buildFilters({ assetBase, shop: shopForFilters, translations });
  registerFilters(engine, filters);
  registerCustomTags(engine, { fs, ctx, settingsData });

  // Compose template body, then wrap in layout/theme.liquid.
  const body = await composeTemplate({ engine, fs, templateName, ctx, settingsData });
  const html = await wrapInLayout({ engine, fs, body, ctx });
  return { html, theme, templateName };
}

// Read an asset file from the rendered theme (for GET /assets/:name responses).
function readThemeAsset({ draft, name, previewThemeId = null }) {
  const theme = pickTheme(draft, previewThemeId);
  const themeId = theme ? theme.id : null;
  const files = filterThemeFiles(draft.themeFiles, themeId, draft);
  const fs = new ThemeFs(files);
  const clean = String(name).replace(/^\/+/, '');
  return fs.get(`assets/${clean}`);
}

module.exports = {
  renderStorefront,
  readThemeAsset,
  pickTheme,
  // exported for tests / future composition
  composeSectionGroup,
  composeTemplate,
};
