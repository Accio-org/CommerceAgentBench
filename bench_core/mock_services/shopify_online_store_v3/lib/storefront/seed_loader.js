// Walks `seeds/themes/<theme>/` and returns the list of theme files in the
// shape the events-stream backend expects:
//   { path: 'sections/header.liquid', type: 'section', updatedText: '...', content: '...' }
//
// We classify by top-level dir prefix per Shopify's theme structure.

const fs = require('fs');
const path = require('path');

const PREFIX_TYPE = {
  'layout/': 'layout',
  'templates/': 'template',
  'sections/': 'section',
  'snippets/': 'snippet',
  'assets/': 'asset',
  'config/': 'config',
  'locales/': 'locale',
};

function classify(relPath) {
  for (const [prefix, type] of Object.entries(PREFIX_TYPE)) {
    if (relPath.startsWith(prefix)) return type;
  }
  return 'asset';
}

function loadThemeDir(absDir, { updatedText = 'seed' } = {}) {
  if (!fs.existsSync(absDir)) return [];
  const out = [];
  function walk(dir, rel) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const abs = path.join(dir, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(abs, relPath);
      } else {
        const content = fs.readFileSync(abs, 'utf8');
        out.push({ path: relPath, type: classify(relPath), updatedText, content });
      }
    }
  }
  walk(absDir, '');
  // Stable order: by path.
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return out;
}

module.exports = { loadThemeDir };
