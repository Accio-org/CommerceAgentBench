'use strict';

// Online Store channel admin domain — 偏好设置 (preferences) + 主题 (themes).
// These power the embedded pages served at /online_store/preferences and /themes
// (public/_embedded/*.html). Preferences + theme state already live on the shared
// `saved` state (initialThemeState), so UI ⇄ REST ⇄ verifier (/__bench/state,
// /api/state) stay consistent. Closed/typed fields are validated server-side and
// a bad value 400s (CCB anti-cheat convention) — the adapter never writes blind.

const V = require('../validation');

const BOOL_FIELDS = [
  'passwordProtected', 'b2bOnly', 'countryRedirect',
  'languageRedirect', 'contactCaptcha', 'accountCaptcha',
];

function prefsView(s) {
  const p = s.preferences || {};
  return {
    passwordProtected: !!p.passwordProtected,
    b2bOnly: !!p.b2bOnly,
    homepageTitle: p.homepageTitle || '',
    metaDescription: p.metaDescription || '',
    socialImage: p.socialImage || '',
    socialImageName: p.socialImageName || '',
    countryRedirect: p.countryRedirect !== false,
    languageRedirect: !!p.languageRedirect,
    contactCaptcha: p.contactCaptcha !== false,
    accountCaptcha: p.accountCaptcha !== false,
    crawlerSignatures: p.crawlerSignatures || [],
  };
}

function assertBool(v, field) {
  if (typeof v !== 'boolean') throw new V.ValidationError(`${field} must be a boolean.`, field);
  return v;
}

function themesView(s) {
  return {
    currentId: s.themeId,
    currentName: s.themeName,
    themes: (s.themes || []).map((t) => ({
      id: t.id, name: t.name, role: t.role, version: t.version, updatedText: t.updatedText,
    })),
  };
}

const routes = [
  {
    method: 'GET',
    path: '/api/admin/online_store/preferences',
    handler: (ctx) => ({ status: 200, body: { ok: true, preferences: prefsView(ctx.store.saved) } }),
  },
  {
    method: 'PUT',
    path: '/api/admin/online_store/preferences',
    handler: (ctx) => {
      const body = ctx.body || {};
      const prefs = (ctx.store.saved.preferences = ctx.store.saved.preferences || {});
      // Partial update — validate only the fields actually provided.
      for (const f of BOOL_FIELDS) if (body[f] !== undefined) prefs[f] = assertBool(body[f], f);
      if (body.homepageTitle !== undefined) {
        const t = String(body.homepageTitle);
        if (t.length > 70) throw new V.ValidationError('homepageTitle must be ≤ 70 characters.', 'homepageTitle');
        prefs.homepageTitle = t;
      }
      if (body.metaDescription !== undefined) {
        const d = String(body.metaDescription);
        if (d.length > 320) throw new V.ValidationError('metaDescription must be ≤ 320 characters.', 'metaDescription');
        prefs.metaDescription = d;
      }
      ctx.store.commitAdminMutation('preferences_saved', { fields: Object.keys(body) });
      return { status: 200, body: { ok: true, preferences: prefsView(ctx.store.saved) } };
    },
  },
  {
    method: 'GET',
    path: '/api/admin/online_store/themes',
    handler: (ctx) => ({ status: 200, body: { ok: true, ...themesView(ctx.store.saved) } }),
  },
  {
    method: 'POST',
    pattern: /^\/api\/admin\/online_store\/themes\/([^/]+)\/publish$/,
    handler: (ctx, m) => {
      const id = m[1];
      const themes = ctx.store.saved.themes || [];
      const target = themes.find((t) => t.id === id);
      if (!target) return { status: 404, body: { ok: false, error: 'Theme not found' } };
      themes.forEach((t) => { if (t.role === 'current') t.role = 'draft'; });
      target.role = 'current';
      ctx.store.saved.themeId = target.id;
      ctx.store.saved.themeName = target.name;
      ctx.store.commitAdminMutation('theme_published', { themeId: id, themeName: target.name });
      return { status: 200, body: { ok: true, ...themesView(ctx.store.saved) } };
    },
  },
];

// preferences + themes already seeded by initialThemeState(); nothing to add.
function seed() {}

module.exports = { seed, routes, prefsView, themesView };
