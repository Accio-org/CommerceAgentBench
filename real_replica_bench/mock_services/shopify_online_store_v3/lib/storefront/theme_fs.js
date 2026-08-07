// Virtual filesystem adapter that lets liquidjs resolve {% render %}, {% include %},
// {% section %}, {% sections %}, {% layout %} against an in-memory list of theme
// files stored in `state.draft.themeFiles[]`. Each file has { path, content }.
//
// liquidjs's FS interface:
//   resolve(root, file, ext) → string path
//   readFile(path) → Promise<string>
//   readFileSync(path) → string
//   exists(path) → Promise<boolean>
//   existsSync(path) → boolean
//   fallback(file) → string | undefined  (used to swallow missing files gracefully)
//
// Resolution rules (mirror real Shopify):
//   * snippets/X.liquid   for {% render 'X' %} / {% include 'X' %}
//   * sections/X.liquid   for {% section 'X' %}
//   * sections/<group>.json + each section.type → sections/<type>.liquid for {% sections 'group' %}
//   * layout/X.liquid     for {% layout 'X' %}
//
// We resolve against an indexed Map<path, content> built once per request and
// keyed by exact theme path. Paths used in liquidjs's `resolve` start as bare
// names like "header" — we map those to "snippets/header.liquid" /
// "sections/header.liquid" / "layout/header.liquid" depending on context, which
// liquidjs signals via the `partials` / `layouts` config knobs.

class ThemeFs {
  constructor(themeFiles) {
    this.map = new Map();
    for (const file of themeFiles || []) {
      if (!file || !file.path) continue;
      // Binary assets are stored as base64 strings (see
      // lib/admin/themes_graphql.js::themeFilesUpsert — JSON cloning
      // can't survive a Buffer). Decode on the way in so `get()`
      // (used by `readThemeAsset` for GET /assets/<name>) returns the
      // original bytes. liquidjs only resolves text theme files via
      // readFileSync, so binary entries are safe to keep as Buffer.
      if (file.contentEncoding === 'base64' && typeof file.content === 'string') {
        try { this.map.set(file.path, Buffer.from(file.content, 'base64')); }
        catch { this.map.set(file.path, file.content); }
        continue;
      }
      if (Buffer.isBuffer(file.content)) {
        this.map.set(file.path, file.content);
      } else if (file.content && typeof file.content === 'object' && file.content.type === 'Buffer' && Array.isArray(file.content.data)) {
        // JSON-round-tripped Buffer — rehydrate.
        this.map.set(file.path, Buffer.from(file.content.data));
      } else {
        this.map.set(file.path, file.content == null ? '' : String(file.content));
      }
    }
  }

  // Used by liquidjs's parseFile / readFile path resolution. We treat any
  // already-suffixed `.liquid`/`.json` lookup as canonical theme paths; bare
  // names get a `.liquid` suffix appended. `root` is the dir context (passed
  // in liquidjs config, see engine.js) — we honor it as a prefix when the
  // file isn't already absolute-looking.
  resolve(root, file, ext) {
    let f = String(file);
    if (!f.endsWith('.liquid') && !f.endsWith('.json')) {
      f = f + (ext || '.liquid');
    }
    // If root is supplied and the file doesn't already include a top dir,
    // prefix root.
    if (root && !f.includes('/')) {
      const clean = String(root).replace(/^\/+|\/+$/g, '');
      if (clean) f = `${clean}/${f}`;
    }
    return f.replace(/^\/+/, '');
  }

  exists(file) {
    return Promise.resolve(this.existsSync(file));
  }
  existsSync(file) {
    return this.map.has(String(file).replace(/^\/+/, ''));
  }
  readFile(file) {
    return Promise.resolve(this.readFileSync(file));
  }
  readFileSync(file) {
    const k = String(file).replace(/^\/+/, '');
    if (!this.map.has(k)) {
      throw new Error(`Theme file not found: ${k}`);
    }
    return this.map.get(k);
  }
  contains(root, file) {
    return file.startsWith(root);
  }
  dirname(file) {
    const idx = String(file).lastIndexOf('/');
    return idx === -1 ? '' : String(file).slice(0, idx);
  }
  sep() {
    return '/';
  }

  // Convenience for non-liquidjs callers: fetch a file or return undefined.
  get(filePath) {
    return this.map.get(String(filePath).replace(/^\/+/, ''));
  }
}

module.exports = { ThemeFs };
