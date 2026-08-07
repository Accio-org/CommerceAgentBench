# Shopify Online Store V3 Mock

A high-fidelity Shopify Online Store admin + CLI + **storefront renderer** mock.

**vs `shopify_online_store_v2`**: v3 is a fork of v2 that adds a real Liquid
storefront renderer (via [liquidjs](https://liquidjs.com/)) and a Dawn-subset
seed theme. Routes like `GET /`, `/products/:handle`, `/collections/:handle`
render real HTML from theme files in `seeds/themes/origin/` (and any files an
agent pushes via `shopify theme push`). The v2 admin SPA still lives at
`/admin` and `/store/<name>/*`.

Default port is `3097` (override `PORT`). The CLI binary (`bin/shopify`) and
verifier-only bench (`bin/shopify-bench`) keep the same 1:1-byte-aligned
surface as v2 against `@shopify/cli` 4.1.0.

Registered in `mock_services/registry.py` as `shopify_online_store_v3`
(`bin_names=("shopify",)`, `bench_bin="shopify-bench"`). Not yet baked into a
derived image — runs from the per-task runtime install path.

Set `DISABLE_STOREFRONT=1` to bypass the renderer (useful for admin-only
benchmark tasks that don't need the storefront layer).

## Run

```bash
cd real_replica_bench/mock_services/shopify_online_store_v3
bun install
PORT=3097 bun server.js
```

Open:

```text
http://127.0.0.1:3097/
http://127.0.0.1:3097/store/i415x6-zf
http://127.0.0.1:3097/store/i415x6-zf/themes
http://127.0.0.1:3097/store/i415x6-zf/themes/159103910101/editor
http://127.0.0.1:3097/store/i415x6-zf/themes/159103910101/code
http://127.0.0.1:3097/store/i415x6-zf/themes/159103910101/default-content
http://127.0.0.1:3097/store/i415x6-zf/pages
http://127.0.0.1:3097/store/i415x6-zf/pages/new
http://127.0.0.1:3097/store/i415x6-zf/online_store/preferences
http://127.0.0.1:3097/store/i415x6-zf/content/metaobjects
http://127.0.0.1:3097/store/i415x6-zf/content/files
http://127.0.0.1:3097/store/i415x6-zf/content/menus
http://127.0.0.1:3097/store/i415x6-zf/content/menus/main-menu
http://127.0.0.1:3097/store/i415x6-zf/content/menus/new
http://127.0.0.1:3097/store/i415x6-zf/online_store/menus
http://127.0.0.1:3097/store/i415x6-zf/content/articles
http://127.0.0.1:3097/store/i415x6-zf/content/articles/new
http://127.0.0.1:3097/store/i415x6-zf/online_store/blogs
http://127.0.0.1:3097/store/i415x6-zf/online_store/blogs/new
http://127.0.0.1:3097/store/i415x6-zf/online_store/blog_posts
http://127.0.0.1:3097/store/i415x6-zf/online_store/blog_posts/new
http://127.0.0.1:3097/store/i415x6-zf/content/redirects
http://127.0.0.1:3097/store/i415x6-zf/content/redirects/new
http://127.0.0.1:3097/storefront
http://127.0.0.1:3097/storefront/preview
```

`/` and `/store/i415x6-zf` intentionally render the Shopify Admin home. The
public storefront is scoped to `/storefront`, `/storefront/preview`, and the
public product/page/collection paths.

## Shopify CLI-style shim

Shopify's official `@shopify/cli` 4.1.0 surface includes 19 `theme` subcommands.
The mock implements the 14 most commonly-scripted ones (Phase C, 2026-06-03):

```text
theme list      theme info      theme open      theme duplicate
theme push      theme pull      theme publish   theme rename
theme delete    theme dev       theme init      theme package
theme share     theme preview
```

Examples:

```bash
bun bin/shopify theme list --json
bun bin/shopify theme open --theme 159103910101 --json
bun bin/shopify theme publish --theme 159066751189 --force --json
bun bin/shopify theme rename --theme 159066751189 --name "QA draft"
bun bin/shopify theme duplicate --theme 159066751189 --name "QA copy" --force --json
bun bin/shopify theme delete --theme 159103811797 --force
bun bin/shopify theme pull --theme 159103910101 --path /tmp/shopify-theme-pull
bun bin/shopify theme push --theme 159103910101 --path /tmp/shopify-theme-pull --only sections/custom-promo.liquid --json
bun bin/shopify theme init my-new-theme --path /tmp
bun bin/shopify theme package --path /tmp/my-new-theme
bun bin/shopify theme share --path /tmp/my-new-theme
bun bin/shopify theme preview --theme 159103910101 --overrides /tmp/overrides.json --json
```

Each subcommand accepts the global `-e, --environment <name>` flag and reads
per-environment defaults from `shopify.theme.toml` in the cwd. Explicit CLI
flags win over toml-loaded values.

Set `SHOPIFY_MOCK_URL` or `MOCK_SITE_URL` to point at a non-default mock host.

### Shopify CLI divergences

We intentionally omit 5 `theme` subcommands and 3 root topics from the
upstream surface — none are needed for storefront / admin / theme-editor
workflows and each one would carry significant out-of-scope baggage.

**Theme subcommands skipped (not in `bin/shopify`):**

| Subcommand              | Why skipped                                              |
| ----------------------- | -------------------------------------------------------- |
| `theme check`           | Liquid linter delegates to a separate Rust binary (`theme-check`); duplicating it here adds no signal for any agent task. |
| `theme console`         | Interactive Liquid REPL; needs a TTY and produces no scriptable output. |
| `theme language-server` | Long-running LSP daemon for IDE integrations only.       |
| `theme profile`         | Liquid render profiler; out of scope for behavior parity. |
| `theme metafields pull` | Requires a metafield-definition resolver depth we don't emulate. |

**Root topics absent entirely:** `shopify app`, `shopify hydrogen`,
`shopify organization`. These cover Shopify App Bridge, Hydrogen storefronts,
and developer-org administration — orthogonal to the storefront / admin
mock surface.

**Behavioral divergences within implemented subcommands:**

* `theme init` — clones from the bundled seed theme (`seeds/themes/origin/`)
  instead of fetching from GitHub. `--clone-url` and `--latest` are accepted
  but ignored (the mock has no network egress); a one-line notice is emitted
  to stderr when they're set.
* `theme dev` — does NOT start a watcher / hot-reload server. Prints the
  same boot-time renderSuccess header (keyboard shortcuts + preview links)
  the real CLI emits and exits 0. All other flags accepted but no-op.
* `theme package` — produces a valid stored-only ZIP via the in-tree
  `lib/cli/zip.mjs` writer (no `zip` binary required, no `archiver`
  dependency). Output naming and contents match real CLI.
* `theme preview` — applies overrides into a per-preview-theme file set
  (Phase C.7). Two override shapes are accepted: `{ files: { "<path>":
  "<content>", ... } }` for arbitrary file replacement, and the
  settings_data shape `{ current: {...}, presets: {...} }` for setting-only
  overrides (written as `config/settings_data.json`).

## Shopify Catalog MCP-style shim

Shopify's agent-oriented catalog surface exposes MCP tools for storefront
product discovery. The mock provides a local JSON-RPC compatibility endpoint
that shares the same product state as the storefront, cart, theme editor,
Admin GraphQL API, and CLI shims:

```text
POST /api/ucp/mcp
POST /api/mcp
```

Implemented methods:

- `initialize`
- `tools/list`
- `tools/call` with `search_catalog`
- `tools/call` with `lookup_catalog`
- `tools/call` with `get_product`

Example:

```bash
curl -sS http://127.0.0.1:3097/api/ucp/mcp \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_catalog","arguments":{"catalog":{"query":"red","limit":3}}}}'
```

## Shopify Admin GraphQL-style shim

Shopify apps and integrations use the Admin GraphQL API. The mock exposes a
small local compatibility endpoint at:

```text
POST /admin/api/2026-04/graphql.json
```

Supported operations share state with the UI and `/api/state`:

- `pageCreate(page: PageCreateInput!)`
- `fileCreate(files: [FileCreateInput!]!)`
- `fileUpdate(files: [FileUpdateInput!]!)`
- `fileDelete(fileIds: [ID!]!)`
- `metaobjectDefinitionCreate(definition: MetaobjectDefinitionCreateInput!)`
- `metaobjectCreate(metaobject: MetaobjectCreateInput!)`
- `metaobjectUpdate(id: ID!, metaobject: MetaobjectUpdateInput!)`
- `metaobjectDelete(id: ID!)`
- `shopPolicyUpdate(shopPolicy: ShopPolicyInput!)`
- `articleCreate(article: ArticleCreateInput!, blog: ArticleBlogInput)`
- `blogCreate(blog: BlogCreateInput!)`
- `collectionCreate(input: CollectionInput!)`
- `blogUpdate(id: ID!, blog: BlogUpdateInput!)`
- `blogDelete(id: ID!)`
- `menuCreate(title: String!, handle: String!, items: [MenuItemCreateInput!]!)`
- `menuUpdate(id: ID!, title: String!, handle: String, items: [MenuItemUpdateInput!]!)`
- `menuDelete(id: ID!)`
- `urlRedirectCreate(urlRedirect: UrlRedirectInput!)`
- `urlRedirectDelete(id: ID!)`
- `urlRedirectImportCreate(url: URL!)`
- `urlRedirectImportSubmit(id: ID!)`
- `shop`, `shopPolicies`, `files`, `metaobjectDefinitions`, `metaobjects`,
  `pages`, `blogs`, `articles`, `collections`, `menus`, `urlRedirects`,
  `urlRedirectImports`, and `domains` queries

Example:

```bash
node - <<'JS'
fetch('http://127.0.0.1:3097/admin/api/2026-04/graphql.json', {
  method: 'POST',
  headers: {'content-type': 'application/json'},
  body: JSON.stringify({
    query: 'mutation CreatePage($page: PageCreateInput!) { pageCreate(page: $page) { page { id title handle } userErrors { field message code } } }',
    variables: {page: {title: 'New Page Title', handle: 'new-page-title', body: 'This is the content of the page.', isPublished: true}}
  })
}).then((res) => res.json()).then((json) => console.log(JSON.stringify(json, null, 2)));
JS
```

## Admin back-office — 1:1 real-DOM snapshots (`public/_pages/` + `public/_polaris/`)

The transactional Admin (Products, Orders, Customers, Discounts, Purchase
orders, Settings, Analytics, …) is a **1:1 replica of real Shopify**, built from
real captured DOM + real Polaris CSS, fully offline. (This superseded an
earlier hand-written generic shell.)

- **Frontend = real-DOM snapshots.** Each captured page lives at
  `public/_pages/<name>.html` (rendered DOM, scripts stripped) and is served by
  `server.js` via `adminSnapshotFile()` (route → snapshot, with longest-prefix
  fallback for detail/sub-type URLs). `public/_pages/manifest.json` maps route
  path → page. Theme/content/storefront routes are excluded (`SNAPSHOT_EXCLUDE`)
  so the interactive theme-editor app keeps its own views — except the exact
  在线商店 submenu routes (主题 `/themes`, 页面 `/pages`, 偏好设置
  `/online_store/preferences`) and a few content list pages, which are restored to
  1:1 via `SNAPSHOT_EXCLUDE_OVERRIDE` (clicking 在线商店 used to fall through to the
  old generic shell — that was the bug).
- **在线商店 embedded pages (主题 / 偏好设置).** In real Shopify these render inside a
  cross-origin App-Bridge iframe (`online-store-web.shopifyapps.com`) that the
  top-document serializer can't reach. They're captured by attaching to the iframe
  as its own CDP target after the embedded React settles, rebuilt offline under
  `public/_embedded/<name>.{html,css}` (the app's own CSS bundle, localized), and
  served inside the captured outer shell's iframe (src rewritten to the local
  page). 页面 is native Polaris and captures normally.
- **财务 / Markets 深层子页 + 分析 dashboard (fixed 2026-05-30).** The finance
  sub-tabs (`/credit`, `/payments/payouts`, `/taxes/filing`,
  `/shopify-balance/terms/apyRewards`), Markets `/catalogs`, and `/rollouts` used
  to 404 (no snapshot, no prefix fallback) — now captured 1:1. **`/credit` and
  `/payments/payouts` are Cloudflare-gated** (sensitive finance routes re-challenge
  per navigation; a human Turnstile click was needed during capture). `分析` and
  `财务` were also re-captured: their old snapshots were frozen mid-load — the
  sales-channel nav showed the pre-localization English fallback
  ("Online Store"/"Agentic") and 分析's metric/chart cards were blank. Re-capture
  (with a scroll-through pass to render lazy charts) + appending the analytics lazy
  CSS modules (`MetricsGrid`, `MetricsIndexList`, …) to `polaris.css` restores the
  localized nav + the full dashboard (KPI sparklines, sales-over-time, conversion
  funnel). The 在线商店 embedded-app title bar (`_AppTitleBar`) now lays title +
  公开/查看商店/更多操作 on one row (a scoped flex rule appended to `polaris.css`;
  the online-store-web layout module isn't in the admin bundle).
- **Real Polaris CSS, offline.** `public/_polaris/polaris.css` (~2.6MB, real
  Polaris bundle, url-rewritten to local) + `public/_polaris/assets/` (Inter +
  Geist fonts) + `public/_polaris/img/` (page images). **Zero CDN dependency.**
- **Shadow DOM.** Real Shopify uses Web Components heavily (product/new ≈ 155
  shadow roots). The capture serializer emits open shadow roots as declarative
  shadow DOM (`<template shadowrootmode=open>`) and inlines each shadow's
  `adoptedStyleSheets` as dedup'd `<link>`s under `public/_polaris/shadow/`
  (document CSS does not cross the shadow boundary).
- **Capture pipeline** (re-runnable; needs the debug Chrome, see below):
  `accio_work_user_research/shopify_admin_capture_2026-05-29/`
  — `_serializer.js` (shadow-aware), `batch_capture_v2.mjs` (all routes),
  `capture_one.mjs` (single route), `clean_dom.mjs` (→ `_pages` + localize +
  manifest), `build_polaris_bundle.mjs` (→ `_polaris/polaris.css`).
  Capture pipeline + L2 plan: `scratch/docs/shopify_onetoone_pipeline.md`.
- **Backend (used by the L2 interaction layer):** `lib/admin/<domain>.js`
  + `lib/validation.js` — server-validated `/api/admin/*` endpoints (closed-set
  enums → `400`; RRB rule #10), shared `saved` state, GraphQL `productCreate`/
  `products` + MCP catalog parity. Verifier surface `GET /__bench/state`
  (Bearer `MOCK_VERIFIER_TOKEN`, default `bench-verifier`). Domains: `products`,
  `online_store` (GET/PUT `/api/admin/online_store/preferences` — 6 booleans +
  `homepageTitle`≤70 + `metaDescription`≤320; POST
  `/api/admin/online_store/themes/<id>/publish`).
- **L2 interaction** = `public/_inject/runtime.js` + per-page adapters injected
  before the last `</body>` (snapshots) and into `/_embedded/*.html` (embedded
  pages). `products.js` (list/create/edit); `online_store.js` re-animates the
  inert preferences toggles + SEO inputs and the themes "..." publish menu against
  the backend above (runs inside the same-origin embedded iframe).
- **Per-theme theme editor (fixed 2026-05-30).** The interactive theme editor
  (`public/app.js`, served as `index.html` for `/themes/<id>/editor`) used to ignore
  the route theme id and open the IDENTICAL editor (always "Origin 当前") for every
  theme. It's now theme-aware: `applyEditingThemePreset()` reads the route id and, for
  DRAFT themes, loads a per-theme preset (home `sections` + `themeSettings`) that
  replicates that theme's real storefront layout, and updates the top-bar name + role
  badge. Presets are client-side (`THEME_PRESETS`): **Horizon** (full-bleed editorial
  hero `/assets/horizon-hero.jpg` + "2026 Mock Launch Collection" + contact form) and
  **Atelier** (full-screen art hero `/assets/atelier-hero.svg` "The Elements of Style"
  + featured product + product list + multicolumn). The current theme (Origin) keeps
  its server-backed state. Draft-preview edits stay in-session (`postDraft`/save guarded
  by `presetActive`) so they never overwrite the shared server state. Presets were built
  from the real storefront previews (`?preview_theme_id=<id>`), reusing the existing
  section renderers (image-banner / featured-product / product-list / multicolumn / …).
- **Editor media + Polaris buttons + section backgrounds + 应用 placeholder (2026-05-30).**
  (1) Theme-editor **image upload is now Shopify-style**: the bare `<input type=file>` in
  section/block media settings is replaced by a thumbnail + 选择/更改 button (raw inputs
  hidden via CSS); upload runs through the media library modal's 上传文件 button
  (`mediaThumb` + `.media-control`). (2) The editor's hand-styled buttons
  (`.resource-button`, segmented controls, `.danger-button`) are restyled to the real
  **Polaris** look (white surface, hairline inset shadow, 13px/550). (3) Content sections
  (**特色产品**/featured-product, product-list, multicolumn, rich-text, contact, newsletter,
  product-highlights, related-products) gain a reusable **背景图片 (section background
  image)** control + overlay, rendered behind content by `applySectionBackground()`
  (`backgroundImageField` is appended generically in `renderSettings` for
  `BACKGROUND_SECTION_TYPES`; collection sections are intentionally excluded). (4) **/apps**
  used to render a stuck dark overlay (captured mid-load); it now serves a clean,
  non-interactive placeholder (installed-apps list) while keeping the real 1:1 nav + top
  bar — the Apps module itself is intentionally **not implemented this phase**. ⚠️
  `#AppFrameBevel` carries the class `Polaris-Frame__DarkOverlay` but is a STRUCTURAL frame
  wrapper (nav + main live inside it), NOT a scrim — do **not** `display:none` it (it blanks
  the whole page). See the `apps.html` branch in `server.js::sendSnapshot`.
- **Editor native block structure + real uploads + realistic catalog (2026-05-31).** Fixes
  three fidelity gaps in the Codex-built theme editor (`public/app.js`). (1) **Uploaded images
  now display the real image**, not a placeholder: `createUploadedMedia(name, alt, src)` takes a
  `src` and the upload handlers read the file via `readFileAsDataUrl()` (FileReader → `data:`
  URL). (2) **特色产品 (and every content section) is now block-driven, matching native
  Shopify**: featured-product ships the Dawn default preset (`文本(厂商) → 标题 → 价格 →
  多属性选择器 → 数量选择器 → 购买按钮 → 分享`; palette also offers SKU/评分), rendered from
  `section.blocks` by `featuredProductBlockMarkup()` (variant pills/dropdown, qty stepper, buy +
  dynamic-checkout, share, rating). New product block types live in `BLOCK_TYPES` +
  `blockOptionsForSection`; per-type settings via `renderProductBlockSettings()`. Source of
  truth: Shopify Dawn `sections/featured-product.liquid` schema. (3) **Every block-capable
  section now shows a 区块 list + 添加区块 in the right panel** via `maybeAppendBlockList()`
  (appended in the `renderSettings` wrapper, gated by `sectionSupportsBlocks()`); empty
  block-capable sections also get an 添加区块 row in the left tree. (4) **collection-list is
  block-driven** (one `featured-collection` block per collection) instead of a count slider. (5)
  **Realistic demo catalog**: the 8 identical `产品标题/$19.99` placeholders are replaced with a
  coherent lifestyle catalog (mug/tote/bottle/socks/candle/blanket/card-holder/board) with
  distinct prices, vendors, variant options, SKUs, and new offline SVG product images in
  `public/assets/prod-*.svg` (product **ids kept stable** so collections/templates still
  resolve). The 4 old swatch SVGs remain as empty-slot placeholders.
- **Product-create page interactions (fixed 2026-05-31).** The captured `/products/new`
  form (`public/_pages/product_new.html`, served only under the store prefix
  `/store/<handle>/products/new`) had several inert controls; all are wired in
  `public/_inject/products.js`. (1) **描述 is editable + saves**: the inert rich-text iframe
  (`#product-description-ro_ifr`) is made editable via **`document.designMode='on'`** (a
  document-level flag that survives the srcdoc body being replaced after a late load — plain
  `contentEditable` on the body element does not; re-asserted on `load` + a settle-window poll),
  synced to the hidden `descriptionHtml` textarea; `collect()` reads the **live** editor body via
  `readDescription()`. The **description toolbar is rebuilt 1:1 to the current real Shopify custom
  editor** (the captured snapshot's toolbar had 链接/图片/视频/表格 collapsed into the ⋯
  overflow): `tpl/description_toolbar.html` (real class names + the real icon SVGs captured from
  the live editor) + `description_toolbar.css` replace the captured bar via `installRealToolbar()`;
  buttons are wired with `descExec()` (refocus iframe window + restore the mousedown-captured range,
  then `execCommand`) — 加粗/斜体/下划线/段落/对齐/颜色/链接/列表/缩进/HTML all functional;
  生成文本(✨)/图片/视频/表格 are present for 1:1 (no offline action). (2) **状态/类别/类型/厂商 dropdowns open under the field**, not
  the top-left corner: the picker hosts are `display:contents` (0×0), so `openMenu` anchors to
  the visible inner control via `visibleAnchor()`/`deepIn()` (which searches the host's **own**
  shadow root for `._BorderGradient`, since `C.$` only descends into descendants' shadows).
  (3) **媒体文件 uploads render a thumbnail grid** (first = 封面图片) from the captured
  `s-internal-drop-zone` (`#file-input`) via `FileReader`; `collect()` sends `image`+`media`.
  (4) **类别/类型/厂商/产品系列/标记 pickers are functional + persist**: generic
  `wireSinglePicker` (类别 is a searchable taxonomy from `public/_inject/categories.json`, a
  real **Shopify Standard Product Taxonomy** zh-CN subset; 类型/厂商 are free-text comboboxes),
  `wireCollectionsPicker` (multi-select of the seeded collections → chips), `wireTagsPicker`
  (`openTagInput` popover → tag chips). `collect()` now sends category/vendor/productType/
  tags/collections — all already accepted by `lib/admin/products.js` (no backend change).
  Picked values display via `setPickerValueText()` (updates the light value element for 状态, or
  the shadow `.placeholder` span for the empty pickers). Verified end-to-end via CDP (fill →
  save → list shows image/category/vendor/type/tags) with zero console errors.
- **Product-create follow-up fidelity (2026-05-31).** Three further gaps vs real Shopify, all in
  `public/_inject/products.js`. (1) **媒体「上传新文件」now opens the file dialog**: the captured
  "上传新文件"/"选择现有文件" are inert text inside `._DropZonePlaceholder` and the real
  `<input type=file multiple>` (a `visually-hidden` shadow element) had no JS — so clicking did
  nothing. `wireMediaUpload()` wires the placeholder + whole drop zone to `fileInput.click()` with a
  per-gesture `opening` guard (the drop-zone + placeholder BOTH capture-fire on one click → two
  synchronous `input.click()`s, which Chrome treats as non-genuine and silently suppresses the file
  dialog — the real cause of "upload doesn't work"; fire once), and visually hides the native input
  (1:1 with real + no competing click target). The `change → ingest → thumbnail` chain was fine. (2) **类别 is now a progressive taxonomy drill-down** (not the flat full-path list
  that showed 主类+子类 together): `buildCatTree()` builds a tree from the `categories.json`
  full-paths and `openCategoryPicker()` shows top-level names with `›` chevrons → drill in →
  使用"…"/选择 leaf, with a 返回 breadcrumb; typing searches the flat full-paths (matches real).
  (3) **价格/库存/运输 progressive disclosure is a proper TOGGLE** (corrected 2026-05-31 — the first
  cut only opened, hiding the whole pills row including the chevron → "无法收起", and used a 3-col
  full-width grid for 成本/利润/利润率 that overflowed the card). Each section's controller row holds
  summary pills (`_BasePillButton`) **and** a persistent `_CollapsibleButton` chevron. On open,
  `openCollapsible()` injects the real captured fragment (`tpl/collapsible_*.html`), reveals the
  `Polaris-Collapsible`, and hides ONLY the pills container — the chevron stays so `toggleCollapsible()`
  can collapse back (pills reappear), 1:1 with real. The fragments match real structure: 原价/单价 in a
  2-col `Polaris-InlineGrid`; 成本/利润/利润率 as compact inline `_BasePill`/`_BadgeInput` chips in a
  bordered strip (not full-width fields — that was the overflow). 单件成本 computes 利润/利润率 live
  from price−cost. **compareAtPrice/costPerItem/sku/barcode persist** via `collect()` (backend
  `lib/admin/products.js` accepts them; edit-mode `prefill()` opens the collapsible before filling);
  shipping 原产国/HS 编码 are cosmetic (no backend field). Verified E2E via CDP (open + collapse via
  chevron, `overflowChildren:0`, fill → save → GET round-trips all fields) with zero console errors.
- **Product-create follow-up #2 (2026-05-31).** (1) **保存没反应** was actually a rejected save with
  only a transient English bottom toast — now a localized **critical banner** at the top + red field
  ring + scroll-to (`showSaveError`/`localizeSaveError`), plus a save **de-dupe guard** (click +
  form-submit both fired → 2 POSTs → 1). (2) **Pills 跟原生不一样**: the `_UnstyledButton`/
  `_LabelWrapper` reset classes are missing from the offline bundle, so pill buttons kept native
  chrome — added `public/_inject/product_form.css` (real values: `rgba(0,0,0,.06)` fill, radius 8,
  28px, no border; loaded by `ensureFormCss()`). (3) **库存第二数量列没对齐**: the Polaris sticky
  **overlay** (frozen-column duplicate) renders narrower than the real table (width-sync JS stripped)
  → hidden in `product_form.css` so the correct full-width column shows. (4) **多属性 now works**:
  the real variant editor is closed-shadow (uncapturable) + the captured `<s-internal-button>` trigger
  is inert, so it's rebuilt from the Shopify pattern (`wireVariants` → add up to 3 options name+values
  → `variantCombos()` cartesian product → a variant row per combo with 价格/可用/SKU). Backend extended
  (`buildOptionsVariants` in `lib/admin/products.js`) to **persist** `options`/`variants`
  (server-validated: non-empty option name, ≥1 value, numeric variant price → 400). `collect()` sends
  them, `prefill()` restores them. E2E verified (2 options → 6 variant rows → save → GET round-trips
  options+variants).
- **Product-create follow-up #3 (2026-05-31).** Three more user-reported gaps, all UI-wiring (no
  backend change). (1) **保存按钮"点不了"**: the save button is wired and fires, but its contextual-bar
  `_BorderGradient_` wrapper was captured WITHOUT its active state, so a missing CSS-variable cascade
  left it translucent (`rgba(255,255,255,.22)`) — dark text on the dark-teal bar looked greyed/dead.
  `styleSaveBar()` now forces the real computed result (保存 wrapper = solid `rgb(255,255,255)` white
  pill, 放弃 = `rgba(255,255,255,.08)`), matching live admin. (2) **多属性 选项值 was Enter-only** (hard
  to drive headlessly — the user asked if an agent could even add values): the value input now has an
  explicit **添加 button** (+ 回车/逗号 still tokenize, + **完成** commits a still-typed value), so no
  keypress is required. (3) **包装 picker was inert**: its display is already 1:1 ("商店默认 • 样品箱 -
  8.6 × 5.4 × 1.6 英寸，0 lb") and a fresh store genuinely has only the default package, so "只有默认"
  is faithful — it just didn't respond. `wirePackaging()` opens a faithful menu (default ✓ + 添加包裹
  尺寸 → settings). **Trap fixed in the same pass:** the packaging click matcher needs a `t.length<=80`
  guard, else it matches a high form container (whose text transitively includes the packaging field)
  and intercepts EVERY click — including 保存. All three verified via **real coordinate clicks** (CDP
  `Input.dispatchMouseEvent`, hit-tested like an agent), not just programmatic `.click()`.
- **Product-create follow-up #4 — the ACTUAL "保存点了没反应" (2026-06-01).** Prior rounds fixed the
  top contextual 保存 (white pill, wiring), and it always worked in tests — because it sits at viewport
  x≈1156. But the form ALSO has a bottom `Polaris-PageActions` 保存 button at x≈1438, and the capture
  froze Shopify's **Sidekick** AI panel (`id=sidekick`, `role=dialog`, `aria-label=Sidekick`) in its
  **open** state. Offline its remote content never loads, so it's an **invisible `position:fixed`
  overlay (z-index 100) covering the right ~356px of the viewport** with `pointer-events:auto` — it
  silently eats every click there, including the bottom 保存 button (the click lands on Sidekick, never
  the button, so no listener can fire). Real Shopify shows the product form with Sidekick **closed** by
  default. `neutralizeSidekick()` (in `initForm`) hides the captured-open panel → the bottom save button
  (and the right edge of the 状态/发布 column, also partly under it) become clickable. Verified: real
  coordinate click on the BOTTOM 保存 now creates the product + redirects. **Why it eluded earlier
  rounds:** synthetic `.click()`/top-button tests bypass the overlay; only a hit-tested click on the
  bottom button (at x>1372) reproduces it. (Likely a global capture artifact — promote
  `neutralizeSidekick` to `runtime.js`/`clean_dom` when wiring other L2 domains.)
- **Theme-editor (在线商店编辑页面) chrome fidelity (2026-06-01).** The hand-built editor
  (`index.html` + `styles.css` + `app.js`, NOT captured DOM) had four gaps vs the real editor.
  All targets were captured live from the real `online-store-web.shopifyapps.com` editor iframe
  over CDP (computed styles + shadow-pierced Polaris icon SVGs) — none invented. (1) **字体**:
  the editor declared `font-family: Inter` but `index.html` only loads `/styles.css` (not
  `polaris.css`), so Inter's `@font-face` never loaded → it silently fell back to San Francisco.
  Added the real 7 InterVariable `@font-face` splits (pointing at the bundled
  `/_polaris/assets/InterVariable-*.woff2`), aligned the `:root` stack, and set the base to
  **13px** (real) — `#storefront-root` pinned to 16px so the preview is unaffected. (2) **官方默认
  折叠**: the left section list rendered every section expanded; real opens only the selected one.
  `renderSectionTree` now seeds each section collapsed on first sight (`seenSectionIds`) except the
  selected; selecting a section expands it; the disclosure glyph `›/⌄` became a real rotating
  chevron SVG; section names dropped from weight 650→**450** (real). (3) **子tab样式** (the
  分区/模板设置/应用 panel tabs): glyph chars `▤ ⚙ ◫` → the real Polaris `layout-section`/`settings`/
  `apps` SVG icons; tabs 36→**32px**, active state `rgba(0,0,0,.08)` wash + Shopify-blue glyph;
  top bar 68→**56px**. (4) **右侧编辑块样式**: header 66→48px + title 16→**14px/600** + real
  `menu-horizontal`/`x` SVG icons; settings rows converted to real **dense 2-col** (label-left ~40%
  13px/450 #4d4d4d + control-right, `:has()` escapes keep textarea/rich-text/media/slider
  full-width); switch 42×24-pill → real **32×20 r6** track + 12×12 r3 thumb; segmented connected-
  white-buttons → real **grey #f1f1f1 track + white elevated pill**; inline discard hidden when
  clean. Verified via CDP A/B (Inter actually loaded, 6/7 sections collapsed, zero console errors).
- **Theme-editor left sidebar structural alignment (2026-06-02).** The hand-built sidebar's
  section/block list had four structural gaps vs the real editor, ALL captured live from
  `online-store-web.shopifyapps.com` via CDP — see `scratch/shopify_sidebar_truth.json` +
  `shopify_sidebar_icons.json` + `scratch/scripts/shopify_l2/sidebar_truth.mjs`. (1) **Type icons**:
  every section + block row in real Shopify carries a Polaris type-icon (公告栏=三横条 / 富文本=text-frame
  / 图片横幅=image-sun / 标题=T / 价格=$ / 文本=≡ / Buy Button=cart / 分享=brackets, etc.). Mock had
  none — just drag handle. Now `SECTION_TYPE_ICON_SVGS` / `BLOCK_TYPE_ICON_SVGS` (inline in app.js,
  ~28KB total) bundle the real SVGs and `renderSectionTree` injects them before each label. SPECIAL
  CASE: real 特色产品 row replaces its type-icon position with the selected product's `<IMG>`
  thumbnail (`ThumbnailsStack--image`); mock falls back to the generic `announcement-bar` rectangle
  rather than wire async thumbnail loading. (2) **「添加分区」 frequency + placement**: was inserted
  after EVERY section in 模板 group (7×) and at the bottom of 页脚 group. Real: **once** at the
  bottom of 模板 group, once at the bottom of 标头 group, and once at the **TOP** of 页脚 group
  (before the 页脚 section). (3) **「添加区块」 placement**: was inserted between every block AND
  at the end (n+1 times). Real: **once** at the top of the expanded block list. (4) **Selected vs
  expanded decoupled**: previously `select.click → collapsedSectionIds.delete(section.id)` so
  selecting auto-expanded. Real keeps these independent — verified live: 富文本 was selected &
  collapsed while 特色产品 was expanded & not selected. Removed the auto-expand; chevron click is
  the only way to expand. Also (bonus) **drag-handles + eye + ⋯ are now hover-only** (was always
  visible) — opacity:0 default, opacity:1 on `.section-row:hover/.is-selected` (matches real).
  **featured-product seed re-aligned**: was 7 blocks (extra `文本-厂商`, `数量选择器`, `购买按钮`),
  real has 6 (`标题`/`价格`/`文本`/`多属性选择器`/`Buy Button`/`分享` — note English "Buy Button").
  Updated both `server.js` initial seed AND `app.js featuredProductDefaultBlocks()` (they must stay
  in sync — server seeds the saved state, app.js generates blocks for newly-added sections).
- **Media upload backend (2026-06-02).** Uploaded images used to be FileReader-read into
  base64 dataURLs and stored inline in `state.mediaLibrary[].src` + `section/block.settings.image`.
  Because the same image string ended up referenced from several places (library + tiles +
  template snapshots) the full `/api/draft` body could reach 8+ MB per save — see the 保存中
  stuck bug in the previous note. Now there's a proper backend pair:
  `POST /api/media` (JSON `{filename, contentType, dataBase64}` → stores bytes in an in-memory
  `mediaBlobs` Map → returns `{id, url, contentType, bytes}`) and `GET /media/:id` (serves
  bytes with the original Content-Type + immutable Cache-Control + `X-Mock-Filename` header).
  Client now calls `uploadFile(file)` from BOTH the editor media picker (`media-upload-input`
  change handler) and the content/files admin (`content-file-upload`); the returned `/media/<id>`
  URL is what lands in state. Round-trip cost per save dropped from ~8 MB → ~5 KB for typical
  Origin-home + one collage upload. `/api/reset` clears `mediaBlobs`. **Limitation**: storage
  is in-memory + lost on server restart, so old URLs in a persisted state JSON 404 after restart
  (acceptable for the ephemeral-per-task RRB convention; re-upload to recover). Other file
  inputs (`article-image`, `sidekick-upload-input`, `redirect-import-file`) only store metadata,
  not bytes, so they need no change.
- **Status:** L1 (1:1 static, all 69 pages — incl. the 6 finance/markets sub-routes
  added 2026-05-30) **done**. L2 done for **products** + **在线商店 (主题/偏好设置
  operable)** + **per-theme theme editor (Origin/Horizon/Atelier distinct, sidebar structurally
  pixel-aligned to real)**; remaining domains (customers, discounts, draft/purchase orders, orders)
  follow the same recipe.
- **Verification:** `bash smoke_test.sh` (boots its own server; 241 checks incl.
  enum negatives, shadow-DOM snapshot, prefix match, local bundle, cross-surface,
  embedded-page injection + preferences/theme backend, the 6 sub-routes serving
  1:1, analytics/finance nav localization, per-theme editor presets, the 应用
  placeholder, the Shopify-style editor upload control + Polaris buttons, the
  section background-image controls, the theme-editor chrome fidelity pass —
  Inter @font-face, collapsed-by-default sections, real SVG panel tabs, dense
  settings rows, real switch/segmented — and the sidebar structural alignment:
  type-icon maps, render hooks, add-row frequency, decoupled select/expand,
  hover-only mini-icons + drag handles, and the 6-block featured-product seed).

```text
http://127.0.0.1:3097/store/i415x6-zf/products
http://127.0.0.1:3097/store/i415x6-zf/products/new
http://127.0.0.1:3097/store/i415x6-zf/orders
http://127.0.0.1:3097/store/i415x6-zf/discounts/new/amount-off-product
http://127.0.0.1:3097/store/i415x6-zf/settings/general
```

## Scope

- Shopify-like admin shell and Online Store theme editor.
- Global Admin `搜索 ⌘ K` command palette opens by click or
  `Meta/Ctrl+K`, searches static routes plus saved themes/pages/files/menus/
  blogs/articles/metaobjects/products/collections, supports arrow-key and
  Enter navigation, and persists `adminSearchRecent` / `adminSearchLastQuery`
  into shared state.
- Themes overview route with current `Origin`, draft `Horizon`/`Atelier`
  themes, edit/view/publish actions, and theme-store recommendation cards.
- Theme card overflow menus matching the captured current-theme actions:
  view, rename, duplicate, publish for drafts, delete for drafts, edit code,
  edit default content, and download theme file. Mutating actions update the
  shared theme state and emit audit events.
- Theme code editor route with a file browser, editable `layout/theme.liquid`,
  `templates/index.json`, section Liquid, CSS asset files, add-file action,
  save/discard buttons, and persisted `themeFiles` / `themeCodeLastEdited`
  state.
- Default theme content route with searchable grouped language/content keys,
  editable values, save/discard buttons, and persisted
  `themeDefaultContent` / `themeDefaultContentLastEdited` state.
- Theme download action records a mock zip filename in both the theme card and
  `themeDownloads`, so a verifier can distinguish an opened menu from a
  completed download action.
- Left section tree grouped by Header, 模板, Footer.
- Section rows with blocks have Shopify-style disclosure controls; expanding
  or collapsing a section only changes local editor UI state, leaves
  `/api/state.dirty` unchanged, and the `⌘ ⇧ O` / `⌘ ⇧ P` shortcuts expand or
  collapse all section block lists.
- Current Origin homepage seed: `公告栏`, `标头`, `富文本`, `特色产品`,
  `图片横幅`, `富文本`, `多列`, `电子邮件注册信息`, `页脚`.
- Product-focused sections: `特色产品`, `产品亮点`, `产品热点`,
  `推荐产品`, and `特色产品系列` grid/editorial/carousel variants.
- `特色产品` settings now drive the rendered storefront module, including
  width (`页面`/`全宽`), media position, equal columns, limited details width,
  gap, padding, and color scheme. `特色产品系列` image ratio writes to shared
  state and changes the actual product card media ratio in preview.
- Section add picker with the real Origin-style anchored popover, search,
  `分区/应用` tabs with search result counts, the captured `生成` row plus
  expanded category groups (`表单`, `布局`, `产品`, `产品系列`, `横幅`, `文本`,
  `媒体`), one-click section insertion rows, hover/focus preview cards, and
  the Sidekick "有想法？让我们把它变为现实" prompt card. The Sidekick prompt
  button is stateful: it generates a section through the same add-section path,
  marks the theme dirty, selects the new section, and keeps the preview/right
  inspector synchronized.
- Header/template/footer `添加分区` rows preserve the clicked group in shared
  section state, so adding from Footer creates a `footer` section instead of
  silently dropping it into the template group.
- Section choices include `特色产品系列`, `特色产品`, `产品亮点`,
  `产品热点`, `推荐产品`, `产品系列列表`, `产品系列链接`, `富文本`,
  `图片横幅`, `幻灯片`, `拼贴画`, `多行`, `可折叠内容`, `多列`, `视频`,
  `博客文章`, `页面`, `电子邮件注册信息`, `联系表`, `自定义 Liquid`,
  `自定义分区`, and more.
- Adding `分隔符` opens a captured-style right inspector with color scheme,
  width (`页面`/`全宽`), thickness, length, top/bottom padding, custom CSS, and
  delete controls; those settings immediately alter the preview divider and
  persist in section state.
- The picker `应用` tab exposes installed template app blocks such as the
  captured `Sign in with Shop Button`, includes the Shopify Apps browse link,
  shows the same `无可用预览` state, and inserts app sections into shared state.
  App blocks are tracked separately in `themeAppBlocks`, while app embeds remain in
  `appEmbeds`, matching the real editor where the `应用嵌入` panel can be empty
  even though the add-section app tab offers a Shop app block.
- Template settings use the captured Chinese category list (`logo`, `颜色`,
  `版式`, `布局`, `动画`, `按钮`, `多属性椭圆形框`, `输入`, `产品卡`,
  `产品系列卡`, `博客卡`, `内容容器`, `媒体文件`, `下拉菜单和弹出窗口`,
  `抽屉`, `徽章`, `品牌信息`, `社交媒体`, `搜索行为`, `货币格式`,
  `购物车`, `自定义 CSS`, `模板风格`) with persisted controls for the
  settings that are implemented in the mock.
- Product and collection section variants from the captured Shopify picker have
  distinct preview layouts and right-side settings: highlights, hotspots,
  related products, product-grid/editorial/carousel, and collection
  grid/focus/carousel/text/editorial/bento. All share the same draft/save,
  reorder, hide, duplicate, and delete behavior as other theme sections.
- Image banner / image-with-text sections now expose the captured Hero-style
  media, link, layout, width, media position, image height, overlay opacity,
  content position, text alignment, padding, color scheme, and custom CSS
  controls. These values alter the preview DOM immediately and persist through
  `/api/save`, so upload/link/layout tasks can be verified from `/api/state`.
- Theme editor button links include a Shopify-style resource picker: section
  and button-block link fields can browse Pages, Collections, Products, Blogs,
  and Blog Articles from the same saved content state used by Menus and URL
  Redirects, then persist the selected link through draft/save and storefront
  preview token handling.
- Complex section blocks for `幻灯片`, `拼贴画`, `多行`, and
  `可折叠内容` can be opened from the left tree and edited, copied, hidden,
  deleted, or added; media-capable blocks can choose/upload images from the
  shared media picker, and preview state follows block visibility.
- Section hide/remove/select.
- Section more-action menu for duplicate, move up/down, hide/show, and delete
  with a Shopify-style confirmation dialog before destructive removal.
- Block add picker uses the same left-anchored Shopify popover pattern with
  `区块/应用` tabs, per-section legal block lists, empty app-block state
  (`此分区没有可用的应用区块` + `无可用预览`), and insertion rows before each
  existing block plus one at the end. Adding a rich-text `文本` block from the
  first row inserts it before the existing `标题` block, selects the new block,
  opens its right inspector, and marks the draft dirty. Block more-action menu
  supports duplicate, move up/down, hide/show, and delete; block text/heading/
  subtitle/button edits update the preview DOM and saved state. Hidden blocks
  remain visible in the left tree with a hidden state indicator so they can be
  shown again like the real editor.
- Text and heading blocks in the theme editor use a captured-style rich-text
  iframe inspector with generated text, paragraph/heading style, bold, italic,
  link, bulleted list, and numbered list controls. Edits persist as
  `block.settings.html` plus plain text, update the storefront preview, and
  save through the same draft/save state as section settings.
- Mouse drag reorder and accessible keyboard reorder for both sections and
  section blocks:
  - focus `重新排列 <section> 在列表中的顺序`
  - `Space` to grab
  - `ArrowUp` / `ArrowDown` to move
  - `Space` or `Enter` to drop
- Live region text after reorder.
- Right inspector for section and block settings; text inputs update preview
  without stealing focus on every keystroke.
- Right inspector header controls are stateful: `⋯` opens the same selected
  section/block menu observed in Shopify (`重命名`, `隐藏`/`显示`, `编辑代码`).
  Rename turns the title into an inline text field, hide updates the draft
  visibility, and edit-code jumps into the mock theme code editor for the same
  theme state. `×` closes the settings panel, clears section/block selection
  from the URL and preview, and leaves the draft clean.
- Section, block, settings-header, and theme-card action menus are keyboard
  reachable: opening a menu focuses the first item, `ArrowUp` / `ArrowDown` /
  `Home` / `End` move through menu items, `Enter` / `Space` activates the
  focused item, and `Escape` returns focus to the trigger without changing
  draft state.
- Storefront preview DOM with real headings, links, forms, product cards, images.
- Storefront contact and newsletter forms submit to mock APIs with required
  field/email validation, in-page success/error messages, audit events, and
  persisted `storefrontSubmissions` / `newsletterSubscribers` state that does
  not make the theme dirty.
- Public product pages submit add-to-cart through the Shopify-style Ajax Cart
  endpoint `/cart/add.js`; `/cart.js`, `/cart/change.js`, `/cart/update.js`,
  and `/cart/clear.js` share the same `cartItems` state, validate
  product/quantity inputs, avoid making the theme dirty, and feed the same line
  items into `/cart` and `/checkout`.
- Storefront preview sections and structured blocks are selectable from the
  preview itself; click or keyboard select updates the left tree, right
  inspector, URL `section`/`block` params, and preview highlight from the same
  state.
- Storefront preview header search is interactive: the search button opens a
  product search drawer backed by the shared product list, filters results as
  the user types, and avoids being mistaken for section selection.
- Public storefront headers now keep the same operational affordances: search
  and cart controls navigate to `/search` and `/cart`, Enter/search-submit
  preserves preview tokens, and the mobile menu button toggles the nested menu
  drawer instead of acting as a dead icon.
- Media library state with image resource picker, search, mock upload, selected
  media card state, and image-banner/image-with-text/video plus structured
  block media binding.
- Theme settings panel with captured category labels (`Logo and favicon`,
  `colors`, `typography`, `page layout`, `animations`, `badges`, `buttons`,
  `cart`, `drawer sidebar`, `icons`, `input fields`, `popovers/modal`,
  `price`, `product card`, `search`, `swatches`, `variant picker`,
  `custom CSS`, `theme style`). The categories expose editable controls,
  seven color schemes plus add-scheme, and preview-affecting state for logo,
  typography, layout, buttons, product cards, price display, and theme style.
- App embeds panel with search, clickable `Shopify Forms` / `Shopify Inbox`
  recommendation cards, local App Store-style detail boundaries, and
  install/enable switches. Enabled embeds render in the storefront preview and
  are saved in shared `appEmbeds` state.
- Toolbar market context picker matching the captured editor popover: search
  field, `商店默认值`, `可自定义的市场`, `美国`, selected checkmark, URL
  `market=us` synchronization, undo/redo, save/discard, and persisted
  `marketContext` / `marketContexts` state.
- Template picker with the captured toolbar popover shape, icons, search,
  top-level types, product/collection submenus, and product/collection/page/
  blog/article/search/cart/password/404 preview path switching. Switching the
  toolbar template context updates the editor URL and `/api/state.draft`
  `previewPath` without marking the theme dirty, matching Shopify's browse
  behavior before any settings are edited.
- Editor top-right actions menu mirrors the captured Shopify toolbar:
  `编辑代码`, `编辑默认模板内容`, `查看`, external documentation/support
  handoff links, the `Origin 15.4.1 由 Shopify 开发` footer, and a keyboard
  shortcuts dialog. The save control is a split button: the primary button
  persists the draft through `/api/save`, while the dropdown exposes the
  captured `将更改保存为草稿，并在您准备好时应用` / `创建发布` flow and records
  publication drafts in shared `themePublications` state.
- Product template submenu mirrors the captured empty assignment state:
  `默认产品` is disabled with `应用到 0 个产品`, and `创建模板` is disabled until
  product assignments exist. The direct product-template renderer and resource
  picker remain available for scoped routes/tests, but the toolbar picker does
  not pretend that the unavailable real menu item is clickable.
- Default cart template editing: selecting `购物车` switches `previewPath` to
  `/cart`, renders line items from shared `cartItems`, exposes title/empty
  text/vendor/quantity/note/subtotal/checkout button settings, supports
  quantity updates and removal through `/cart/change.js`, and shares the same
  rendered cart with the public `/cart` route.
- Gift card and checkout/customer-account templates: selecting `礼品卡` or
  `结账和客户账户` now switches to `/gift_cards/mock-gift-card` or
  `/checkout`, exposes template-specific right-panel settings, persists them
  under `themeTemplates.giftCard` / `themeTemplates.checkoutAccount`, and
  reuses the same renderer on the public routes.
- Metaobject template creation: selecting `创建元对象模板` opens a create form
  with seeded metaobject definitions, writes a new dynamic `themeTemplates`
  entry, switches to `/metaobjects/<definition>/<entry>`, and exposes entry,
  layout, image, field label, and CTA settings in the right panel. This is a
  scoped implementation based on the captured template picker entry; the exact
  Shopify modal was not captured in the current evidence bundle.
- Default collection list template editing: selecting `产品系列列表` switches
  `previewPath` to `/collections`, renders the shared `collections` state with
  grid/text/editorial/carousel/bento variants, persists heading/count/style
  edits through `/api/save`, and shares the same renderer with the public
  `/collections` route.
- Default collection template editing: selecting `默认产品系列` switches
  `previewPath` to `/collections/frontpage`, replaces the left template tree
  with `产品系列横幅` and `产品网格`, and keeps save disabled until an actual
  template setting changes. Once editing begins, collection resource picking,
  in-picker collection creation, banner text/description edits,
  grid sort/view/column/page-size toggles, and saves `collections`,
  `collectionTemplate.sections`, plus `collectionSectionOrder` through the same
  draft/save API as the homepage editor.
- Collection template resource context picker: once a collection template is
  active, the toolbar shows a second resource dropdown next to the template
  picker. It lists seeded collections (`主页`, `所有产品`,
  `2026 Mock Launch Collection`), supports search, exposes a `创建产品系列`
  entry, updates the editor URL `previewPath` when browsing between
  collections, and deliberately keeps Save disabled because preview resource
  browsing is not a theme-content edit in Shopify.
- Page, blog, blog article, search, password, and 404 templates now have
  independent template section state under `themeTemplates`. Selecting them
  from the layered template picker changes `previewPath` to `/pages/contact-us`,
  `/blogs/news`, `/blogs/news/:handle`, `/search`, `/password`, or `/404`,
  swaps the left tree to the matching template section, renders a matching
  storefront preview, exposes right-side settings/resource pickers, and persists
  `templateSectionOrder` / edited values through `/api/save`.
- Pages and blog articles use a real editable rich-text iframe with toolbar
  actions for generated text, formatting, links, image/video/table inserts, and
  HTML source mode. Save buttons require both title and rich-text body content,
  and saved rich text renders through storefront page/article previews.
- Desktop/mobile preview mode reflected in URL and preview width.
- Toolbar preview inspector matches the captured `停用检查器` / `激活检查器`
  toggle: when enabled, preview sections/blocks expose selectable overlays and
  keyboard focus targets; when disabled, storefront links/buttons behave like a
  normal preview without blue selection outlines or section-picking side
  effects. The `Meta/Ctrl+Shift+I` shortcut toggles the same state.
- Keyboard shortcuts shown in the captured dialog are wired to editor state:
  `Meta+Control+1/2/3` (or `Ctrl+Alt+1/2/3` in browser automation) switches
  section/theme/apps panels, `Meta+Control+I` toggles desktop/mobile preview,
  `Meta/Ctrl+Shift+H` hides or shows the selected section/block, and
  `Shift+ArrowUp/ArrowDown`, `Shift+Enter`, `Shift+Delete/Backspace` navigate,
  open, and request removal through the same tree/confirmation flows.
- Toolbar Sidekick matches the captured editor entry: opening it changes the
  toolbar button to `关闭 Sidekick`, adds a right-side chat drawer, narrows the
  preview, shows `新建对话`, `关闭记忆`, disabled expand, the greeting
  `下午好，予菁`, the `新增功能？` chip, composer controls, and the
  changelog view with the captured 2026/2025 release notes. Opening/closing
  Sidekick does not dirty the theme. The composer `添加文件等` control opens
  the captured attachment menu (`文件`, `从设备上传`, `提及`, `技能 /`,
  `生成应用`, `应用 Messaging`), including the `提及` resource search drilldown
  with `产品` / `订单` / `客户` / `产品系列` empty-result states. Sending mock
  prompts is local UI state, while applying the generated `添加富文本分区`
  suggestion uses the same section mutation/save path as the normal
  add-section flow.
- Mobile preview uses the captured hamburger header behavior: desktop nav is
  hidden, the menu button exposes `aria-expanded`, and clicking it opens a
  readable mobile menu drawer inside the storefront preview.
- Fullscreen preview mode via `previewMode=fullscreen`; side panels collapse
  while the selected storefront section stays highlighted.
- Dirty state, undo, discard, save, and preview storefront with Shopify Preview
  Bar separate from the bare live storefront.
- Public storefront routes render from the saved snapshot rather than the
  editor draft. Bare `/` and `/storefront` keep the older live-store homepage,
  while `/storefront/preview`, root URLs with `preview_theme_id` / `oseid`,
  and public pages such as `/pages/contact-us?preview_theme_id=...` show the
  saved theme preview with a Shopify Preview Bar. Unsaved `/api/draft` edits
  remain out of public routes until `/api/save` commits them.
- Theme overview and toolbar `查看商店` links include a `preview_theme_id`,
  matching Shopify's admin-to-store preview handoff instead of opening a bare
  storefront URL.
- The Preview Bar `Hide bar` button is stateful for the browser session, and
  `Exit preview` drops back to the matching bare storefront/public route.
- Public storefront internal links generated by header menus, mobile drawers,
  footer menus, collection/product/blog/page cards, cart and checkout CTAs now
  inherit `preview_theme_id` / `oseid` while the shopper is in preview mode,
  matching the expected Shopify preview browsing loop.
- Online Store Pages list and add-page form with title, rich-text iframe,
  SEO card, visibility, template dropdown, disabled/enabled save, searchable
  and sortable list filters, checkbox bulk selection, bulk hide/show/delete,
  and saved `pages` state.
- Existing Online Store pages can be opened from the Pages list, edited, hidden,
  assigned a publish date/template/handle, deleted, and viewed through a
  separate storefront link. Handle changes update main-menu page links, and
  deleting a page removes dependent menu/page-section references from saved
  state.
- Theme editor `页面` section uses the same resource picker pattern as products
  and media; selecting a page updates the preview and saved theme state.
- Content > Files route with upload input, search/type filters, grid/list
  switch, checkbox bulk selection, single/bulk delete, copy-link action,
  editable alt text modal, and saved `mediaLibrary` state shared with the theme
  editor media picker and Preferences social image picker.
- Content > Metaobjects route with captured Custom/search/add-definition
  structure, definition list, entry list, entry create/edit/delete form,
  media-backed image selection, public `metaobjects/:definition/:entry` view
  links, and saved `metaobjectDefinitions` state shared with theme metaobject
  templates.
- Custom Liquid sections can be added from the section picker, edited in the
  right settings panel, rendered in the storefront preview, and saved. The mock
  evaluates common placeholders such as `{{ shop.name }}`,
  `{{ product.title }}`, `{{ product.price | money }}`, and translation keys
  against the same shared state.
- Custom sections can be added from the section picker, bound to section files
  from Theme Code, and now parse the file's `{% schema %}` JSON to expose
  dynamic settings such as text, textarea, URL, checkbox, range, and select
  fields. The preview renders `{{ section.settings.* }}` placeholders from
  those saved schema values, so Theme Code, the add-section picker, the right
  settings panel, preview, and `/api/state` share the same custom-section
  state. The Shopify CLI-style `theme push` shim can also upload local
  `sections/*.liquid` files into the same `themeFiles` state, so CLI-created
  section schemas become available in the browser add-section picker.
- Online Store Preferences with access switches, SEO/social fields, redirect and
  hCaptcha switches, crawler signature creation, character counters, save and
  discard.
- Settings > Domains page with captured `域名`, `连接现有域名`,
  `购买新域名`, `更改 myshopify.com 域名`, and preview-domain actions.
  Connected, purchased, verified, primary-domain, and myshopify subdomain
  changes persist in shared `domains` state and are reflected through the
  Admin GraphQL-style `domains` / `shop.primaryDomain` responses.
- Settings > Policies page with captured written-policy categories
  (`退货和退款政策`, `隐私政策`, `服务条款`, `物流政策`, `联系信息`,
  `法律声明`), editable policy bodies, footer visibility toggles, saved
  `policies` state, public `/policies/:handle` routes, and storefront footer
  policy links that update from the same state. The captured `退货规则关闭`
  card opens a return-rules management dialog with enable/disable, return
  window, return shipping, return fee, final-sale tags, and saved
  `returnRules` state.
- Saved Preferences affect storefront rendering: homepage title/meta
  description update document metadata, password protection renders a password
  gate with validation, B2B-only access renders a restricted customer-account
  gate, and crawler signatures persist in shared state.
- Content Menus list and main-menu detail with inline menu-item editing,
  add-menu-item, keyboard/pointer reorder, indent/outdent nested items,
  save/discard, page/product/collection/blog link picker, and saved menu state.
- Menus can be created from the list page, edited, deleted when they are custom
  menus, and accessed through both `content/menus` and legacy
  `online_store/menus` routes. The storefront header/mobile drawer reads
  nested `main-menu` items, and the footer reads flattened `footer-menu` items,
  so saved navigation edits affect rendered storefront links.
- Blog Articles list/new routes with empty state, rich-text iframe, excerpt,
  SEO, visibility, author/blog/tags, image upload control, save gating, and
  saved `blogArticles` state.
- Blog management routes under `online_store/blogs` with list/new/edit,
  handle, comment policy, RSS feed, SEO, delete guards, article counts, and
  saved `blogs` state. Blog handle/title changes synchronize article blog
  references, menu links, and theme-template preview paths.
- Existing Blog Articles can be opened from the list, edited, assigned a
  publish date/blog/handle/tags/SEO, deleted, and viewed through a separate
  storefront link. Blog/handle changes update main-menu article links, and
  deletion removes dependent menu references. Public blog listing/detail routes
  now honor article visibility and future publish dates, so hidden drafts stay
  out of the storefront until they are saved as visible content.
- URL Redirects list/new/import routes with empty state, import/create actions,
  CSV paste/file upload preview, row validation (`from` must start with `/`),
  import history, row delete action, save gating, and saved `redirects` /
  `redirectImports` state.
- URL redirect target picking shares the same page/product/collection/blog and
  blog-article link picker used by Menus, and saved redirects are enforced by
  the mock server as `301` redirects before storefront route rendering.
- Storefront redirects preserve active preview query tokens (`preview_theme_id`
  and `oseid`) for same-origin targets, so menu links that pass through SEO
  redirects keep the Shopify Preview Bar and draft-preview browsing context.
- Admin GraphQL-style file, metaobject, policy, page, blog, article,
  collection, and URL redirect creation/update plus list queries against the same saved state
  used by the browser mock. `fileCreate`, `fileUpdate`, and `fileDelete`
  follow Shopify's Files API payload style with `files` / `deletedFileIds` and
  `userErrors`; `metaobjectCreate`, `metaobjectUpdate`, `metaobjectDelete`,
  and `metaobjectDefinitionCreate` follow the Metaobject API's `metaobject` /
  `metaobjectDefinition` / `deletedId` plus `userErrors` shape;
  `shopPolicyUpdate` and `shopPolicies` expose policy state in the same shape
  used by the Settings > Policies UI and public policy pages;
  `urlRedirectCreate`, `urlRedirectDelete`, `urlRedirectImportCreate`, and
  `urlRedirectImportSubmit` follow the URL Redirect API's payload shape, with
  local `data:text/csv` URLs standing in for staged CSV import files; and
  `collectionCreate(input: CollectionInput!)` follows Shopify's Admin GraphQL
  payload shape with `collection` and `userErrors`.
- Catalog MCP-style `search_catalog`, `lookup_catalog`, and `get_product`
  calls expose the same product records and variant IDs that the storefront
  cart and public product pages use.
- Public storefront routes for `/pages/:handle`, `/policies/:handle`, `/collections`,
  `/collections/:handle`, `/gift_cards/:handle`,
  `/metaobjects/:definition/:entry`, `/products/:id`, `/blogs/:blog`, and
  `/blogs/:blog/:handle`, so menu links, blog indexes, and page/article view
  links resolve to rendered mock storefront pages rather than dead paths.
- In-memory API for future verifier integration.

## API

- `GET /health`
- `GET /api/state`
- `POST /api/draft`
- `POST /api/save`
- `POST /api/discard`
- `POST /api/reset`
- `GET /api/events`

Saved state is separate from draft state. A future verifier should judge `saved.sections` and `dirty`, not visual screenshots alone.

## Admin GraphQL surface

Endpoint: `POST /admin/api/<version>/graphql.json`. Regex-based dispatcher in `server.js:handleGraphqlQuery` (not a real GraphQL parser — selection-aware via `extractFieldSelection(query, fieldName)` brace-counter).

State slots (`saved.*`): `locations` (default `Shop location`), `publications` (`在线商店`/`Shop`/`POS`), `publishedResources`, `inventoryItems`, `inventoryLevels`, `stagedUploads`, `productMedia`, `appInstallation.accessScopes` (starts empty), `authTokens`, plus top-level `currencyCode: 'SGD'`. Domain modules in `lib/admin/`: `products.js`, `online_store.js`, `inventory.js`, `publications.js`, `media.js`, `themes_graphql.js`. Scope helper at `lib/admin/_scope.js` (`resolveScopes(saved, headers)` — Authorization Bearer → `authTokens[token].scopes`, fallback `appInstallation.accessScopes`). **Scope enforcement isn't wired onto write mutations yet — that lands in Phase B/D when the `shopify store auth` CLI ships.**

Mutations supported (Phase A): `productSet` (full upsert + variants + options + media + inventory items), `productCreate`, `productVariantsBulkCreate`/`Update`, `collectionCreate`, `collectionAddProducts`, `pageCreate`, `articleCreate`, `blogCreate/Update/Delete`, `menuCreate/Update/Delete`, `urlRedirect*`, `fileCreate/Update/Delete`, `metaobject*`, `shopPolicyUpdate`, `inventoryItemUpdate`, `inventorySetQuantities` (with `@idempotent` directive — missing returns the real-Shopify "directive required" error; replays return cached result; rejects `ignoreCompareQuantity` and missing `changeFromQuantity` per ForgeFit log:625/635/649), `publishablePublish` (idempotent on (resourceId, publicationId)), `stagedUploadsCreate`, `productCreateMedia` (deprecation warning hoisted to `extensions.warnings`), `themeFilesUpsert`.

Queries: `products` (selection-aware edges/nodes), `collections` (nested products + productsCount), `pages/blogs/articles/menus/files/urlRedirects/metaobjects/metaobjectDefinitions/domains/shopPolicies/themes/theme(id)/files`, `locations`, `publications`, `currentAppInstallation { accessScopes }` (request-scoped), `shop { id name email currencyCode plan{displayName} publicationCount primaryDomain }`.

Mock-internal HTTP endpoints (NOT GraphQL — for the upcoming CLI/agent wiring):
- `POST /__mock_auth/grant` — body `{storeName, scopes:[...]}`, returns `{token, accessScopes}`. Token is the Bearer the CLI sends back; scopes also union into `appInstallation.accessScopes`.
- `POST /__stage_upload/:token` — receives bytes (multipart or raw), returns 204. Token comes from `stagedUploadsCreate.stagedTargets[].url`.
- `GET /cdn/shopify/s/files/1/0835/2533/7308/files/<filename>` — serves bytes uploaded via `productCreateMedia` with `Cache-Control: public, max-age=31536000, immutable`.

Smoke: `smoke_admin_graphql_test.sh` (47 assertions) covers each new op, the `@idempotent` cascade, scope-grant + bearer-scoped query, staged-upload + CDN round-trip, theme file upsert + asset served via `/assets/`. Add to test pipeline: `bun run smoke-admin-graphql`.

## ForgeFit replay

`smoke_forgefit_replay.sh` (124 assertions) walks the real Codex+Shopify-CLI build trace at `scratch/docs/forgefit-build-log.zh-CN.md` step-by-step through `bin/shopify store {auth,execute}` — auth → shop intro → 5 `productSet` creates → `inventoryItemUpdate` + `inventorySetQuantities` (incl. the 3-error cascade and idempotency replay) → 3 collections + add-products → 3 pages → 6 staged uploads + product media + hero asset round-trip → theme `index.json` + section liquid + storefront render → re-auth with extra `read/write_publications` + `read/write_online_store_navigation` → 8× `publishablePublish` → `menuUpdate` for main + footer → final-state snapshot. This is the central proof that the v3 mock can 1:1 reproduce that Codex+Shopify-CLI session offline. Runs on `PORT=3098` (override `TEST_PORT`), uses `/tmp/forgefit-replay-auth.json` as the CLI cache, and shuts down its own server on exit so it never touches the user's live `:3097` mock. Run with `bash smoke_forgefit_replay.sh` or `bun run smoke-forgefit`.
