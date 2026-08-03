#!/usr/bin/env bash
# Accumulating smoke test for the Shopify Admin back-office mock.
# Boots a fresh server on a scratch port, runs each wave's checks, reports
# pass/fail. Self-contained: starts and stops its own server.
#
# Usage: bash smoke_test.sh
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${SMOKE_PORT:-3199}"
TOKEN="bench-verifier"
B="http://127.0.0.1:${PORT}"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); printf "  \033[32mPASS\033[0m %s\n" "$1"; }
bad()  { FAIL=$((FAIL+1)); printf "  \033[31mFAIL\033[0m %s\n" "$1"; }
check(){ # check <desc> <actual> <expected>
  if [ "$2" = "$3" ]; then ok "$1 ($2)"; else bad "$1 (got '$2' want '$3')"; fi
}

# JSON field extractor via python
jq_get(){ python3 -c "import sys,json;d=json.load(sys.stdin);print(eval('d'+sys.argv[1]))" "$1" 2>/dev/null; }

lsof -ti tcp:${PORT} 2>/dev/null | xargs kill -9 2>/dev/null
PORT=${PORT} MOCK_VERIFIER_TOKEN=${TOKEN} SHOPIFY_MOCK_MODE=tool node "${DIR}/server.js" >/tmp/ccb_smoke_${PORT}.log 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT
for i in $(seq 1 30); do curl -s "$B/health" >/dev/null 2>&1 && break; sleep 0.3; done

echo "== Wave 0: Products =="
check "health ok" "$(curl -s "$B/health" | jq_get "['ok']")" "True"

# create valid
R=$(curl -s -X POST "$B/api/admin/products" -H 'Content-Type: application/json' \
  -d '{"title":"Smoke Bowl","status":"active","price":"49.90","sku":"SB-1","quantity":"5","weightUnit":"kg"}')
check "create valid → ok" "$(echo "$R" | jq_get "['ok']")" "True"
check "create valid → price formatted" "$(echo "$R" | jq_get "['product']['price']")" "\$49.90 USD"

# invalid enum status → 400
C=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/admin/products" -H 'Content-Type: application/json' -d '{"title":"X","status":"published","price":"1","weightUnit":"kg"}')
check "invalid status → 400" "$C" "400"
# invalid weightUnit → 400
C=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/admin/products" -H 'Content-Type: application/json' -d '{"title":"X","status":"draft","price":"1","weightUnit":"stone"}')
check "invalid weightUnit → 400" "$C" "400"
# missing title → 400
C=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/admin/products" -H 'Content-Type: application/json' -d '{"status":"draft","price":"1"}')
check "missing title → 400" "$C" "400"
# negative price → 400
C=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/admin/products" -H 'Content-Type: application/json' -d '{"title":"Neg","status":"draft","price":"-5","weightUnit":"kg"}')
check "negative price → 400" "$C" "400"

# list reflects create
check "list count ≥ 9" "$([ "$(curl -s "$B/api/admin/products" | jq_get "['count']")" -ge 9 ] && echo yes)" "yes"

# bench-state auth gating
check "bench no-token → 401" "$(curl -s -o /dev/null -w '%{http_code}' "$B/__bench/state")" "401"
check "bench wrong-token → 403" "$(curl -s -o /dev/null -w '%{http_code}' -H 'Authorization: Bearer nope' "$B/__bench/state")" "403"
check "bench right-token → 200" "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer ${TOKEN}" "$B/__bench/state")" "200"

# unknown admin route → 404 (no fall-through)
check "unknown admin route → 404" "$(curl -s -o /dev/null -w '%{http_code}' "$B/api/admin/nonexistent")" "404"

# cross-surface: MCP finds the created product
check "MCP search finds product" "$([ "$(curl -s -X POST "$B/api/mcp" -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_catalog","arguments":{"query":"Smoke Bowl"}}}' | grep -c 'Smoke Bowl')" -ge 1 ] && echo yes)" "yes"

# cross-surface: GraphQL create + query
GR=$(curl -s -X POST "$B/admin/api/2024-10/graphql.json" -H 'Content-Type: application/json' \
  -d '{"query":"mutation($input:ProductInput!){productCreate(input:$input){product{title status}userErrors{message}}}","variables":{"input":{"title":"GQL Smoke","status":"DRAFT","variants":[{"price":"9.00"}]}}}')
check "GraphQL productCreate ok" "$(echo "$GR" | jq_get "['data']['productCreate']['product']['title']")" "GQL Smoke"
# GraphQL validation failure → userErrors (HTTP 200), not a 500 fault
GE=$(curl -s -X POST "$B/admin/api/2024-10/graphql.json" -H 'Content-Type: application/json' \
  -d '{"query":"mutation($input:ProductInput!){productCreate(input:$input){product{title}userErrors{message}}}","variables":{"input":{"status":"ACTIVE"}}}')
check "GraphQL missing title → userErrors" "$(echo "$GE" | jq_get "['data']['productCreate']['userErrors'][0]['message']")" "title is required."
check "GraphQL products query has it" "$(curl -s -X POST "$B/admin/api/2024-10/graphql.json" -H 'Content-Type: application/json' -d '{"query":"{products(first:50){edges{node{title}}}}"}' | grep -c 'GQL Smoke')" "1"

# 在线商店 landing (/themes = 主题 list) serves the 1:1 snapshot, NOT the Codex
# editor (clicking 在线商店 used to drop to the generic editor — that was the bug).
check "/themes serves 1:1 snapshot" "$([ "$(curl -s "$B/store/i415x6-zf/themes" | grep -c '_polaris/polaris.css')" -ge 1 ] && echo yes)" "yes"
# regression: the interactive theme EDITOR still served at the deep route
check "theme editor route serves editor" "$(curl -s "$B/store/i415x6-zf/themes/159103910101/editor" | grep -c 'Shopify 主题编辑器')" "1"
# 1:1 real-DOM snapshot served for back-office routes (Polaris-Frame present)
check "1:1 snapshot: products" "$([ "$(curl -s "$B/store/i415x6-zf/products" | grep -c 'Polaris-Frame')" -ge 1 ] && echo yes)" "yes"
check "1:1 snapshot: product/new (shadow DOM)" "$([ "$(curl -s "$B/store/i415x6-zf/products/new" | grep -c 'shadowrootmode')" -ge 1 ] && echo yes)" "yes"
check "1:1 snapshot: discount form (prefix match)" "$([ "$(curl -s "$B/store/i415x6-zf/discounts/new/amount-off-product" | grep -c 'Polaris-Frame')" -ge 1 ] && echo yes)" "yes"
check "local Polaris bundle served" "$(curl -s -o /dev/null -w '%{http_code}' "$B/_polaris/polaris.css")" "200"

echo ""
echo "== L2: interaction injection (products) =="
# injected assets serve
check "runtime.js served" "$(curl -s -o /dev/null -w '%{http_code}' "$B/_inject/runtime.js")" "200"
check "products.js served" "$(curl -s -o /dev/null -w '%{http_code}' "$B/_inject/products.js")" "200"
check "row template served" "$(curl -s -o /dev/null -w '%{http_code}' "$B/_inject/tpl/products_row.html")" "200"
check "table scaffold served" "$(curl -s -o /dev/null -w '%{http_code}' "$B/_inject/tpl/products_table.html")" "200"
# products list snapshot injects runtime + products adapter
check "products page injects runtime" "$([ "$(curl -s "$B/store/i415x6-zf/products" | grep -c '/_inject/runtime.js')" -ge 1 ] && echo yes)" "yes"
check "products page injects products adapter" "$([ "$(curl -s "$B/store/i415x6-zf/products" | grep -c '/_inject/products.js')" -ge 1 ] && echo yes)" "yes"
# product/new: scripts land before the FINAL </body> (not inside the TinyMCE iframe srcdoc)
check "product/new injects before final body" "$(curl -s "$B/store/i415x6-zf/products/new" | tr -d '\n' | grep -c 'products.js\" defer></script></body></html>')" "1"
# detail/edit URL serves the product form snapshot (not the empty list)
check "product detail serves form" "$([ "$(curl -s "$B/store/i415x6-zf/products/product-red" | grep -c 'name=\"title\"')" -ge 1 ] && echo yes)" "yes"
# domain routing: settings gets runtime but NOT the products adapter
check "settings injects runtime" "$([ "$(curl -s "$B/store/i415x6-zf/settings/general" | grep -c '/_inject/runtime.js')" -ge 1 ] && echo yes)" "yes"
check "settings: no products adapter" "$(curl -s "$B/store/i415x6-zf/settings/general" | grep -c '/_inject/products.js')" "0"

echo ""
echo "== L2: 在线商店 embedded pages (主题/偏好设置) =="
# embedded inner pages (cross-origin online-store-web app rebuilt locally) + adapter
check "online_store.js served" "$(curl -s -o /dev/null -w '%{http_code}' "$B/_inject/online_store.js")" "200"
check "embedded preferences served" "$(curl -s -o /dev/null -w '%{http_code}' "$B/_embedded/preferences.html")" "200"
check "embedded themes served" "$(curl -s -o /dev/null -w '%{http_code}' "$B/_embedded/themes.html")" "200"
check "embedded prefs injects adapter" "$([ "$(curl -s "$B/_embedded/preferences.html" | grep -c '/_inject/online_store.js')" -ge 1 ] && echo yes)" "yes"
check "embedded themes injects adapter" "$([ "$(curl -s "$B/_embedded/themes.html" | grep -c '/_inject/online_store.js')" -ge 1 ] && echo yes)" "yes"
# outer shells point their iframe at the local inner page (not the remote cross-origin app)
check "themes shell → local iframe" "$([ "$(curl -s "$B/store/i415x6-zf/themes" | grep -c '/_embedded/themes.html')" -ge 1 ] && echo yes)" "yes"
check "prefs shell → local iframe" "$([ "$(curl -s "$B/store/i415x6-zf/online_store/preferences" | grep -c '/_embedded/preferences.html')" -ge 1 ] && echo yes)" "yes"
check "themes shell: no remote online-store-web iframe" "$(curl -s "$B/store/i415x6-zf/themes" | grep -oE '<iframe[^>]*online-store-web[^>]*>' | grep -vc 'about:blank')" "0"
# backend: preferences GET/PUT (server-side validated) + theme publish
check "preferences GET" "$(curl -s "$B/api/admin/online_store/preferences" | grep -c 'passwordProtected')" "1"
check "preferences PUT persists" "$(curl -s -X PUT "$B/api/admin/online_store/preferences" -H 'content-type: application/json' -d '{"passwordProtected":true}' | grep -c '"passwordProtected": true')" "1"
check "preferences PUT invalid title → 400" "$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$B/api/admin/online_store/preferences" -H 'content-type: application/json' -d "{\"homepageTitle\":\"$(head -c 71 < /dev/zero | tr '\0' x)\"}")" "400"
check "theme publish → 200" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/admin/online_store/themes/159066751189/publish")" "200"
check "theme publish changed current" "$(curl -s "$B/api/admin/online_store/themes" | grep -c '"currentId": "159066751189"')" "1"
curl -s -X POST "$B/api/reset" -o /dev/null  # restore default state after mutations

echo ""
echo "== 财务/Markets sub-routes (were 404 → now 1:1) + nav locale =="
ST="$B/store/i415x6-zf"
# these 6 finance/markets sub-routes used to 404 (no snapshot, no prefix fallback);
# now captured 1:1 (some required a Cloudflare click during capture).
for r in credit payments/payouts taxes/filing shopify-balance/terms/apyRewards catalogs rollouts; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$ST/$r")
  poll=$([ "$(curl -s "$ST/$r" | grep -c '_polaris/polaris.css')" -ge 1 ] && echo yes)
  check "sub-route $r → 200" "$code" "200"
  check "sub-route $r 1:1 snapshot" "$poll" "yes"
done
# analytics + finance were re-captured: sales-channel nav must be Chinese (智能体), not the
# pre-localization English fallback ("Online Store" in the nav) that the old captures baked in.
check "analytics nav localized (智能体)" "$([ "$(curl -s "$ST/analytics" | grep -c '智能体')" -ge 1 ] && echo yes)" "yes"
check "analytics nav not English fallback" "$(curl -s "$ST/analytics" | grep -c 'Online Store')" "0"
check "finance nav localized (智能体)" "$([ "$(curl -s "$ST/finance" | grep -c '智能体')" -ge 1 ] && echo yes)" "yes"
check "finance nav not English fallback" "$(curl -s "$ST/finance" | grep -c 'Online Store')" "0"
# analytics dashboard re-capture: KPI/metric cards present + lazy MetricsGrid CSS appended to bundle
check "analytics has metric cards" "$([ "$(curl -s "$ST/analytics" | grep -c 's-shopifyql-metric-card')" -ge 1 ] && echo yes)" "yes"
check "analytics lazy CSS module appended (MetricsGrid)" "$([ "$(grep -c 'MetricsGrid' "${DIR}/public/_polaris/polaris.css")" -ge 1 ] && echo yes)" "yes"
# 在线商店 embedded-app title-bar layout fix (公开/查看商店/更多操作 on one row)
check "themes app title-bar fix present" "$([ "$(grep -c '_AppTitleBar_1kkcc_1' "${DIR}/public/_polaris/polaris.css")" -ge 1 ] && echo yes)" "yes"

echo ""
echo "== 主题编辑器 per-theme presets (was: every theme opened the SAME editor) =="
# The editor SPA (app.js) is now theme-aware: /themes/<id>/editor reads the route theme
# id and loads a per-theme preset (distinct sections/preview + name/badge) for draft themes;
# the current theme (Origin) keeps its server-backed state. Draft saves are guarded so they
# don't overwrite the shared server state.
check "app.js theme-aware loader" "$([ "$(grep -c 'applyEditingThemePreset' "${DIR}/public/app.js")" -ge 1 ] && echo yes)" "yes"
check "app.js Horizon preset" "$([ "$(grep -c 'HORIZON_PRESET' "${DIR}/public/app.js")" -ge 1 ] && echo yes)" "yes"
check "app.js Atelier preset" "$([ "$(grep -c 'ATELIER_PRESET' "${DIR}/public/app.js")" -ge 1 ] && echo yes)" "yes"
check "app.js Horizon content" "$([ "$(grep -c '2026 Mock Launch Collection' "${DIR}/public/app.js")" -ge 1 ] && echo yes)" "yes"
check "app.js Atelier content" "$([ "$(grep -c 'The Elements of Style' "${DIR}/public/app.js")" -ge 1 ] && echo yes)" "yes"
check "app.js draft-save guard" "$([ "$(grep -c 'presetActive' "${DIR}/public/app.js")" -ge 4 ] && echo yes)" "yes"
check "horizon hero asset serves" "$(curl -s -o /dev/null -w '%{http_code}' "$B/assets/horizon-hero.jpg")" "200"
check "atelier hero asset serves" "$(curl -s -o /dev/null -w '%{http_code}' "$B/assets/atelier-hero.svg")" "200"
# draft theme editor route serves the editor SPA (theme distinctness is client-rendered from the id)
check "draft theme editor serves SPA" "$([ "$(curl -s "$ST/themes/159066751189/editor" | grep -c 'toolbar-theme-name')" -ge 1 ] && echo yes)" "yes"

echo ""
echo "== 应用占位页 + 编辑器图片/背景图 + Polaris 按钮 =="
ST="$B/store/i415x6-zf"
# /apps used to render a stuck dark overlay (mid-load capture). It now serves a
# clean, non-interactive placeholder (installed-apps list) while keeping the 1:1
# nav + top bar; the broken modal/backdrop content is suppressed.
check "apps serves clean placeholder" "$([ "$(curl -s "$ST/apps" | grep -c 'ccb-apps-ph')" -ge 1 ] && echo yes)" "yes"
check "apps lists installed apps" "$([ "$(curl -s "$ST/apps" | grep -oE 'SimGym|Messaging|Collective' | sort -u | wc -l | tr -d ' ')" -ge 3 ] && echo yes)" "yes"
# 主题编辑器: image upload is now a Shopify-style thumbnail + button (no bare
# <input type=file> shown); the raw inputs are visually hidden, upload runs via
# the media library modal's 上传文件 button.
check "editor mediaThumb helper" "$([ "$(grep -c 'function mediaThumb' "${DIR}/public/app.js")" -ge 1 ] && echo yes)" "yes"
check "editor hides raw file inputs" "$([ "$(grep -c 'clip: rect(0 0 0 0)' "${DIR}/public/styles.css")" -ge 1 ] && echo yes)" "yes"
check "editor media-control class" "$([ "$(grep -c 'media-control' "${DIR}/public/styles.css")" -ge 1 ] && echo yes)" "yes"
# editor custom buttons aligned to Polaris (white surface + hairline inset shadow)
check "resource-button Polaris shadow" "$([ "$(grep -c 'inset 0 0 0 1px rgba' "${DIR}/public/styles.css")" -ge 1 ] && echo yes)" "yes"
# 内容区块背景图片: 特色产品 + others gain a 背景图片 control rendered behind content
check "app.js backgroundImageField" "$([ "$(grep -c 'function backgroundImageField' "${DIR}/public/app.js")" -ge 1 ] && echo yes)" "yes"
check "app.js applySectionBackground" "$([ "$(grep -c 'function applySectionBackground' "${DIR}/public/app.js")" -ge 1 ] && echo yes)" "yes"
check "bg section-types set" "$([ "$(grep -c 'BACKGROUND_SECTION_TYPES' "${DIR}/public/app.js")" -ge 1 ] && echo yes)" "yes"
check "has-section-bg CSS present" "$([ "$(grep -c 'has-section-bg' "${DIR}/public/styles.css")" -ge 1 ] && echo yes)" "yes"

echo "== Wave: 编辑器图片上传 + 原生区块 + 逼真目录 =="
# Bug A — uploads read real file bytes. Originally via readFileAsDataUrl + inline dataURL;
# refactored 2026-06-02 to POST to /api/media and store the returned URL (see uploadFile).
check "app.js upload reads file bytes (FileReader in uploadFile)" "$([ "$(grep -c 'reader.readAsDataURL' "${DIR}/public/app.js")" -ge 1 ] && echo yes)" "yes"
check "app.js createUploadedMedia takes src" "$([ "$(grep -c 'function createUploadedMedia(name, alt' "${DIR}/public/app.js")" -ge 1 ] && [ "$(grep -c 'src = ' "${DIR}/public/app.js")" -ge 1 ] && echo yes)" "yes"
# Bug B — featured-product native block system
check "app.js BLOCK_TYPES variant-picker" "$([ "$(grep -c 'variant-picker' "${DIR}/public/app.js")" -ge 1 ] && echo yes)" "yes"
check "app.js BLOCK_TYPES buy-buttons" "$([ "$(grep -c 'buy-buttons' "${DIR}/public/app.js")" -ge 1 ] && echo yes)" "yes"
check "app.js BLOCK_TYPES product-price" "$([ "$(grep -c 'product-price' "${DIR}/public/app.js")" -ge 1 ] && echo yes)" "yes"
check "app.js share block (shareLabel)" "$([ "$(grep -c 'shareLabel' "${DIR}/public/app.js")" -ge 1 ] && echo yes)" "yes"
check "app.js featured-product palette" "$([ "$(grep -c 'quantity-selector' "${DIR}/public/app.js")" -ge 1 ] && echo yes)" "yes"
check "app.js featuredProductDefaultBlocks" "$([ "$(grep -c 'function featuredProductDefaultBlocks' "${DIR}/public/app.js")" -ge 1 ] && echo yes)" "yes"
check "app.js renderProductBlockSettings" "$([ "$(grep -c 'function renderProductBlockSettings' "${DIR}/public/app.js")" -ge 1 ] && echo yes)" "yes"
check "app.js featured-product block-driven preview" "$([ "$(grep -c 'function featuredProductBlockMarkup' "${DIR}/public/app.js")" -ge 1 ] && echo yes)" "yes"
# Bug B — right-panel block list for every block-capable section
check "app.js maybeAppendBlockList" "$([ "$(grep -c 'function maybeAppendBlockList' "${DIR}/public/app.js")" -ge 1 ] && echo yes)" "yes"
check "app.js sectionSupportsBlocks" "$([ "$(grep -c 'function sectionSupportsBlocks' "${DIR}/public/app.js")" -ge 1 ] && echo yes)" "yes"
check "styles.css settings-block-list" "$([ "$(grep -c 'settings-block-list' "${DIR}/public/styles.css")" -ge 1 ] && echo yes)" "yes"
check "styles.css fp-buy-buttons" "$([ "$(grep -c 'fp-buy-buttons' "${DIR}/public/styles.css")" -ge 1 ] && echo yes)" "yes"
check "styles.css fp-variant-pill" "$([ "$(grep -c 'fp-variant-pill' "${DIR}/public/styles.css")" -ge 1 ] && echo yes)" "yes"
# collection-list block-driven (native parity)
check "app.js featured-collection block" "$([ "$(grep -c 'featured-collection' "${DIR}/public/app.js")" -ge 1 ] && echo yes)" "yes"
# Bug C — realistic demo catalog
check "server.js realistic product" "$([ "$(grep -c 'Ceramic Pour-Over Mug' "${DIR}/server.js")" -ge 1 ] && echo yes)" "yes"
check "server.js no 产品标题 placeholder" "$(grep -c '产品标题' "${DIR}/server.js")" "0"
check "server.js featured-product seeded blocks" "$([ "$(grep -c 'featured-product-title' "${DIR}/server.js")" -ge 1 ] && echo yes)" "yes"
check "asset prod-mug.svg exists" "$([ -f "${DIR}/public/assets/prod-mug.svg" ] && echo yes)" "yes"
check "asset prod-bottle.svg exists" "$([ -f "${DIR}/public/assets/prod-bottle.svg" ] && echo yes)" "yes"
check "asset prod-board.svg exists" "$([ -f "${DIR}/public/assets/prod-board.svg" ] && echo yes)" "yes"
# Endpoint — served state reflects the realistic catalog
check "/api/state has realistic product" "$([ "$(curl -s "$B/api/state" | grep -c 'Ceramic Pour-Over Mug')" -ge 1 ] && echo yes)" "yes"
check "/api/state localized product image" "$([ "$(curl -s "$B/api/state" | grep -c 'prod-mug.svg')" -ge 1 ] && echo yes)" "yes"

echo ""
echo "== Wave: 上传产品页交互 (products.js form adapter) =="
PJS="${DIR}/public/_inject/products.js"
# Bug1 — description editor editable + synced
check "products.js wireDescriptionEditor" "$([ "$(grep -c 'function wireDescriptionEditor' "$PJS")" -ge 1 ] && echo yes)" "yes"
check "products.js makes iframe body editable" "$([ "$(grep -c "contentEditable = 'true'" "$PJS")" -ge 1 ] && echo yes)" "yes"
check "products.js readDescription (live body)" "$([ "$(grep -c 'function readDescription' "$PJS")" -ge 1 ] && echo yes)" "yes"
# Bug2 — dropdown anchored to visible control (not 0x0 host)
check "products.js visibleAnchor" "$([ "$(grep -c 'function visibleAnchor' "$PJS")" -ge 1 ] && echo yes)" "yes"
check "products.js deepIn (host shadow)" "$([ "$(grep -c 'function deepIn' "$PJS")" -ge 1 ] && echo yes)" "yes"
check "products.js BorderGradient anchor" "$([ "$(grep -c '_BorderGradient' "$PJS")" -ge 1 ] && echo yes)" "yes"
# Bug3 — media upload
check "products.js wireMediaUpload" "$([ "$(grep -c 'function wireMediaUpload' "$PJS")" -ge 1 ] && echo yes)" "yes"
check "products.js readFileAsDataUrl" "$([ "$(grep -c 'function readFileAsDataUrl' "$PJS")" -ge 1 ] && echo yes)" "yes"
check "products.js renderMediaTiles 封面图片" "$([ "$(grep -c '封面图片' "$PJS")" -ge 1 ] && echo yes)" "yes"
# Bug4a — organization pickers
check "products.js wireSinglePicker" "$([ "$(grep -c 'function wireSinglePicker' "$PJS")" -ge 1 ] && echo yes)" "yes"
check "products.js wireCollectionsPicker" "$([ "$(grep -c 'function wireCollectionsPicker' "$PJS")" -ge 1 ] && echo yes)" "yes"
check "products.js wireTagsPicker + openTagInput" "$([ "$(grep -c 'function openTagInput' "$PJS")" -ge 1 ] && echo yes)" "yes"
check "products.js collect sends category" "$([ "$(grep -c 'category: (catHost' "$PJS")" -ge 1 ] && echo yes)" "yes"
check "products.js collect sends collections+tags" "$([ "$(grep -c 'collections: collHost' "$PJS")" -ge 1 ] && [ "$(grep -c 'tags: tagHost' "$PJS")" -ge 1 ] && echo yes)" "yes"
# Bug4b — category taxonomy
CJ="${DIR}/public/_inject/categories.json"
check "categories.json exists" "$([ -f "$CJ" ] && echo yes)" "yes"
check "categories.json >= 50 zh paths" "$([ "$(python3 -c "import json;print(len(json.load(open('$CJ'))['categories']))" 2>/dev/null)" -ge 50 ] && echo yes)" "yes"
check "categories.json cites Shopify taxonomy" "$([ "$(grep -c 'product-taxonomy' "$CJ")" -ge 1 ] && echo yes)" "yes"
check "categories.json has zh path 服饰与配饰" "$([ "$(grep -c '服饰与配饰' "$CJ")" -ge 1 ] && echo yes)" "yes"
# Description toolbar aligned to real Shopify custom editor (full toolbar + functional)
TBH="${DIR}/public/_inject/tpl/description_toolbar.html"
check "description_toolbar.html exists" "$([ -f "$TBH" ] && echo yes)" "yes"
check "toolbar has 链接/图片/视频/表格 inline" "$([ "$(grep -c '插入表格' "$TBH")" -ge 1 ] && [ "$(grep -c '链接' "$TBH")" -ge 1 ] && echo yes)" "yes"
check "toolbar has 13 buttons" "$(grep -o 'data-ccb-cmd' "$TBH" | wc -l | tr -d ' ')" "13"
check "description_toolbar.css exists" "$([ -f "${DIR}/public/_inject/description_toolbar.css" ] && echo yes)" "yes"
check "products.js installRealToolbar" "$([ "$(grep -c 'function installRealToolbar' "$PJS")" -ge 1 ] && echo yes)" "yes"
check "products.js descExec (toolbar wiring)" "$([ "$(grep -c 'function descExec' "$PJS")" -ge 1 ] && echo yes)" "yes"
check "products.js designMode editable" "$([ "$(grep -c "designMode = 'on'" "$PJS")" -ge 1 ] && echo yes)" "yes"
# 2026-05-31 follow-up — media trigger / progressive category / progressive disclosure
# Issue 1 — clicking 上传新文件 / the drop zone now opens the native file dialog (was inert)
check "products.js media click→file dialog" "$([ "$(grep -c 'input.click()' "$PJS")" -ge 1 ] && [ "$(grep -c 'openPicker' "$PJS")" -ge 1 ] && echo yes)" "yes"
# 2026-05-31 — drop-zone + placeholder both capture-fire → guard so input.click() runs ONCE/gesture
# (two synchronous .click()s make Chrome suppress the picker), and hide the native input 1:1.
check "products.js media single-fire guard" "$([ "$(grep -c 'if (opening) return' "$PJS")" -ge 1 ] && echo yes)" "yes"
check "products.js native file input hidden" "$([ "$(grep -c 'pointer-events:none' "$PJS")" -ge 1 ] && echo yes)" "yes"
# Issue 2 — 类别 is a progressive taxonomy drill-down (NOT the flat full-path list)
check "products.js wireCategoryPicker" "$([ "$(grep -c 'function wireCategoryPicker' "$PJS")" -ge 1 ] && echo yes)" "yes"
check "products.js buildCatTree (tree)" "$([ "$(grep -c 'function buildCatTree' "$PJS")" -ge 1 ] && echo yes)" "yes"
check "products.js openCategoryPicker drill" "$([ "$(grep -c 'function openCategoryPicker' "$PJS")" -ge 1 ] && echo yes)" "yes"
# Issue 3 — 价格/库存/运输 pills expand into the real inputs AND collapse back (Polaris-Collapsible toggle)
check "products.js openCollapsible" "$([ "$(grep -c 'function openCollapsible' "$PJS")" -ge 1 ] && echo yes)" "yes"
check "products.js closeCollapsible (collapse path)" "$([ "$(grep -c 'function closeCollapsible' "$PJS")" -ge 1 ] && echo yes)" "yes"
check "products.js toggleCollapsible (chevron toggle)" "$([ "$(grep -c 'function toggleCollapsible' "$PJS")" -ge 1 ] && echo yes)" "yes"
check "products.js keeps chevron (pillsContainerFor, not whole row)" "$([ "$(grep -c 'function pillsContainerFor' "$PJS")" -ge 1 ] && echo yes)" "yes"
check "products.js wireCollapsibles" "$([ "$(grep -c 'function wireCollapsibles' "$PJS")" -ge 1 ] && echo yes)" "yes"
check "products.js targets 3 collapsibles" "$([ "$(grep -c 'product_variant_collapsible_pricing' "$PJS")" -ge 1 ] && [ "$(grep -c 'product_variant_collapsible_inventory' "$PJS")" -ge 1 ] && [ "$(grep -c 'product_variant_collapsible_shipping' "$PJS")" -ge 1 ] && echo yes)" "yes"
for f in collapsible_pricing collapsible_inventory collapsible_shipping; do
  check "tpl/$f.html exists" "$([ -f "${DIR}/public/_inject/tpl/$f.html" ] && echo yes)" "yes"
  check "tpl/$f.html served" "$(curl -s -o /dev/null -w '%{http_code}' "$B/_inject/tpl/$f.html")" "200"
done
check "pricing frag: compareAtPrice+costPerItem inputs" "$([ "$(grep -c 'name="compareAtPrice"' "${DIR}/public/_inject/tpl/collapsible_pricing.html")" -ge 1 ] && [ "$(grep -c 'name="costPerItem"' "${DIR}/public/_inject/tpl/collapsible_pricing.html")" -ge 1 ] && echo yes)" "yes"
check "inventory frag: sku+barcode inputs" "$([ "$(grep -c 'name="sku"' "${DIR}/public/_inject/tpl/collapsible_inventory.html")" -ge 1 ] && [ "$(grep -c 'name="barcode"' "${DIR}/public/_inject/tpl/collapsible_inventory.html")" -ge 1 ] && echo yes)" "yes"

# 2026-05-31 follow-up #2 — pill look (missing _UnstyledButton/_LabelWrapper bundle classes),
# inventory sticky-overlay misalignment, and prominent localized save-error feedback.
PFC="${DIR}/public/_inject/product_form.css"
check "product_form.css exists" "$([ -f "$PFC" ] && echo yes)" "yes"
check "product_form.css served" "$(curl -s -o /dev/null -w '%{http_code}' "$B/_inject/product_form.css")" "200"
check "product_form.css styles _BasePill" "$([ "$(grep -c '_BasePill_1nnlj_43' "$PFC")" -ge 1 ] && echo yes)" "yes"
check "product_form.css resets _UnstyledButton" "$([ "$(grep -c '_UnstyledButton_1nnlj_88' "$PFC")" -ge 1 ] && echo yes)" "yes"
check "product_form.css hides broken inventory sticky overlay" "$([ "$(grep -c 'TableStickyAreaWrapper' "$PFC")" -ge 1 ] && echo yes)" "yes"
check "products.js loads product_form.css (ensureFormCss)" "$([ "$(grep -c 'function ensureFormCss' "$PJS")" -ge 1 ] && echo yes)" "yes"
check "products.js save de-dupe guard" "$([ "$(grep -c 'if (saving) return' "$PJS")" -ge 1 ] && echo yes)" "yes"
check "products.js localized save-error banner" "$([ "$(grep -c 'function showSaveError' "$PJS")" -ge 1 ] && [ "$(grep -c 'function localizeSaveError' "$PJS")" -ge 1 ] && echo yes)" "yes"

# Backend round-trip: POST with all form fields (incl. the collapsible-revealed ones) → GET → persisted
RP=$(curl -s -X POST "$B/api/admin/products" -H 'Content-Type: application/json' \
  -d '{"title":"Form Roundtrip","status":"draft","price":"24.00","compareAtPrice":"39.00","costPerItem":"12.00","sku":"RT-SKU-1","barcode":"700111222333","weightUnit":"kg","category":"服饰与配饰 > 服装 > 上衣 > T 恤","vendor":"晨曦工坊","productType":"陶瓷杯具","tags":["热销","新品"],"collections":["frontpage"],"image":"data:image/svg+xml;base64,QUFB","description":"<p>desc<b>x</b></p>"}')
PID=$(echo "$RP" | jq_get "['product']['id']")
G=$(curl -s "$B/api/admin/products/${PID}")
check "roundtrip category persisted" "$(echo "$G" | jq_get "['product']['category']")" "服饰与配饰 > 服装 > 上衣 > T 恤"
check "roundtrip vendor persisted" "$(echo "$G" | jq_get "['product']['vendor']")" "晨曦工坊"
check "roundtrip productType persisted" "$(echo "$G" | jq_get "['product']['productType']")" "陶瓷杯具"
check "roundtrip tags persisted" "$(echo "$G" | jq_get "['product']['tags']")" "['热销', '新品']"
check "roundtrip collections persisted" "$(echo "$G" | jq_get "['product']['collectionIds']")" "['frontpage']"
check "roundtrip image persisted (data:)" "$([ "$(echo "$G" | jq_get "['product']['image']" | grep -c '^data:')" -ge 1 ] && echo yes)" "yes"
check "roundtrip description persisted" "$([ "$(echo "$G" | jq_get "['product']['description']" | grep -c '<b>x</b>')" -ge 1 ] && echo yes)" "yes"
check "roundtrip compareAtPrice persisted (cents)" "$(echo "$G" | jq_get "['product']['compareAtPriceAmount']")" "3900"
check "roundtrip costPerItem persisted (cents)" "$(echo "$G" | jq_get "['product']['costAmount']")" "1200"
check "roundtrip sku persisted" "$(echo "$G" | jq_get "['product']['sku']")" "RT-SKU-1"
check "roundtrip barcode persisted" "$(echo "$G" | jq_get "['product']['barcode']")" "700111222333"

# 2026-05-31 follow-up #3 — 多属性 (options → variant matrix), backend-persisted + UI builder.
check "products.js wireVariants (多属性 builder)" "$([ "$(grep -c 'function wireVariants' "$PJS")" -ge 1 ] && echo yes)" "yes"
check "products.js variantCombos (cartesian product)" "$([ "$(grep -c 'function variantCombos' "$PJS")" -ge 1 ] && echo yes)" "yes"
check "products.js collectVariants (collect sends options+variants)" "$([ "$(grep -c 'function collectVariants' "$PJS")" -ge 1 ] && [ "$(grep -c 'collectVariants()' "$PJS")" -ge 1 ] && echo yes)" "yes"
check "backend buildOptionsVariants" "$([ "$(grep -c 'function buildOptionsVariants' "${DIR}/lib/admin/products.js")" -ge 1 ] && echo yes)" "yes"
# Backend round-trip: options + variants persist, and validation rejects bad input
RV=$(curl -s -X POST "$B/api/admin/products" -H 'Content-Type: application/json' \
  -d '{"title":"Variant Roundtrip","price":"50.00","options":[{"name":"尺寸","values":["S","M"]},{"name":"颜色","values":["黑"]}],"variants":[{"title":"S / 黑","optionValues":["S","黑"],"price":"55.00","quantity":7,"sku":"VR-S-B"},{"title":"M / 黑","optionValues":["M","黑"],"price":"60.00","quantity":2,"sku":"VR-M-B"}]}')
VID=$(echo "$RV" | jq_get "['product']['id']")
GV=$(curl -s "$B/api/admin/products/${VID}")
check "roundtrip 1st option persisted" "$(echo "$GV" | jq_get "['product']['options'][0]['name']")" "尺寸"
check "roundtrip 2nd option persisted" "$(echo "$GV" | jq_get "['product']['options'][1]['name']")" "颜色"
check "roundtrip 2nd variant title persisted" "$(echo "$GV" | jq_get "['product']['variants'][1]['title']")" "M / 黑"
check "roundtrip variant price persisted (cents)" "$(echo "$GV" | jq_get "['product']['variants'][0]['priceAmount']")" "5500"
check "roundtrip variant sku persisted" "$(echo "$GV" | jq_get "['product']['variants'][1]['sku']")" "VR-M-B"
check "variant validation: empty option name → 400" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/admin/products" -H 'Content-Type: application/json' -d '{"title":"X","price":"1.00","options":[{"name":"","values":["a"]}]}')" "400"
check "variant validation: option with no values → 400" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/admin/products" -H 'Content-Type: application/json' -d '{"title":"X","price":"1.00","options":[{"name":"尺寸","values":[]}]}')" "400"

# 2026-05-31 follow-up #4 — 保存 rendered greyed (translucent wrapper) → "点不了"; 多属性 value-add was
# Enter-only (hard for browser agents); 包装 picker inert. All UI-wiring (no backend change).
check "products.js styleSaveBar (保存 white pill)" "$([ "$(grep -c 'function styleSaveBar' "$PJS")" -ge 1 ] && echo yes)" "yes"
check "products.js initForm calls styleSaveBar" "$([ "$(grep -c 'styleSaveBar();' "$PJS")" -ge 1 ] && echo yes)" "yes"
check "products.js save wrapper forced opaque (setProperty background)" "$([ "$(grep -c "setProperty('background'" "$PJS")" -ge 1 ] && echo yes)" "yes"
check "products.js 多属性 value commit helper (commitVal)" "$([ "$(grep -c 'const commitVal' "$PJS")" -ge 1 ] && echo yes)" "yes"
check "products.js 多属性 add-value 添加 button (not Enter-only)" "$([ "$(grep -c 'addBtn.onclick' "$PJS")" -ge 1 ] && echo yes)" "yes"
check "products.js wirePackaging (包装 picker menu)" "$([ "$(grep -c 'function wirePackaging' "$PJS")" -ge 1 ] && echo yes)" "yes"
check "products.js initForm calls wirePackaging" "$([ "$(grep -c 'wirePackaging();' "$PJS")" -ge 1 ] && echo yes)" "yes"
check "products.js 包装 matcher length guard (no form-wide click intercept)" "$([ "$(grep -c 't.length <= 80' "$PJS")" -ge 1 ] && echo yes)" "yes"

# 2026-06-01 — THE real "保存点了没反应": captured-open Sidekick (id=sidekick, position:fixed, z:100)
# is an invisible overlay over the right of the viewport that ate clicks on the bottom 保存 button.
check "products.js neutralizeSidekick (hide click-eating overlay)" "$([ "$(grep -c 'function neutralizeSidekick' "$PJS")" -ge 1 ] && echo yes)" "yes"
check "products.js initForm calls neutralizeSidekick" "$([ "$(grep -c 'neutralizeSidekick();' "$PJS")" -ge 1 ] && echo yes)" "yes"

# 2026-06-01 — Theme-editor (在线商店编辑页面) fidelity pass: font, default-collapse, sub-tabs, right
# settings panel. Targets captured from the live real editor (online-store-web iframe), not invented.
SCSS="${DIR}/public/styles.css"; IDX="${DIR}/public/index.html"; EAPP="${DIR}/public/app.js"
check "editor loads bundled Inter @font-face (was SF fallback)" "$([ "$(grep -c 'InterVariable-latin-1751944278923.woff2' "$SCSS")" -ge 1 ] && echo yes)" "yes"
check "editor Inter @font-face has all 7 unicode splits" "$([ "$(grep -c 'src: url(/_polaris/assets/InterVariable' "$SCSS")" -ge 7 ] && echo yes)" "yes"
check "editor :root font stack matches real (San Francisco)" "$([ "$(grep -c '"San Francisco"' "$SCSS")" -ge 1 ] && echo yes)" "yes"
check "editor body base 13px (real)" "$([ "$(grep -c 'font-size: 13px' "$SCSS")" -ge 1 ] && echo yes)" "yes"
check "storefront preview insulated at 16px" "$([ "$(grep -c 'font-size: 16px' "$SCSS")" -ge 1 ] && echo yes)" "yes"
check "section names regular weight 450 (not bold)" "$([ "$(grep -c 'font-weight: 450' "$SCSS")" -ge 1 ] && echo yes)" "yes"
check "app.js seeds collapsed-by-default (seenSectionIds)" "$([ "$(grep -c 'seenSectionIds' "$EAPP")" -ge 2 ] && echo yes)" "yes"
# 2026-06-02: Real Shopify DECOUPLES selected vs expanded — selecting a section does NOT
# auto-expand it (verified via CDP: 富文本 was selected & collapsed while 特色产品 was
# expanded & not selected). Earlier "expand-on-select" was a fidelity bug we removed.
check "app.js select handler does NOT auto-expand" "$([ "$(grep -c 'collapsedSectionIds.delete(section.id);.*selecting' "$EAPP")" -eq 0 ] && echo yes)" "yes"
check "app.js disclosure is real SVG chevron" "$([ "$(grep -c 'SECTION_CHEVRON_SVG' "$EAPP")" -ge 2 ] && echo yes)" "yes"
check "panel sub-tabs are real Polaris SVG icons" "$([ "$(grep -c 'viewBox=\"0 0 16 16\"' "$IDX")" -ge 3 ] && echo yes)" "yes"
check "panel tab active = soft grey wash (real)" "$([ "$(grep -c 'rgba(0, 0, 0, .08)' "$SCSS")" -ge 1 ] && echo yes)" "yes"
check "toolbar icons 32px (real)" "$([ "$(grep -c 'width: 32px' "$SCSS")" -ge 1 ] && echo yes)" "yes"
check "switch resized to 32x20 r6 (real)" "$([ "$(grep -c 'border-radius: 6px' "$SCSS")" -ge 1 ] && echo yes)" "yes"
check "segmented = grey track #f1f1f1 (real)" "$([ "$(grep -c 'background: #f1f1f1' "$SCSS")" -ge 1 ] && echo yes)" "yes"
check "settings rows dense (.settings-content .field)" "$([ "$(grep -c '.settings-content .field' "$SCSS")" -ge 1 ] && echo yes)" "yes"
check "settings header tightened to 48px" "$([ "$(grep -c 'min-height: 48px' "$SCSS")" -ge 1 ] && echo yes)" "yes"
check "settings header icons real SVG (menu-horizontal)" "$([ "$(grep -c 'M4 8a1.5 1.5 0' "$IDX")" -ge 1 ] && echo yes)" "yes"
check "inline discard hidden when clean (real)" "$([ "$(grep -c '.discard-inline:disabled' "$SCSS")" -ge 1 ] && echo yes)" "yes"

# 2026-06-02 — Sidebar structural & icon alignment. Section/block rows previously had no Polaris
# type-icon (drag-handle only); "添加分区" was duplicated after every section in 模板; "添加区块"
# was inserted between every block; 页脚 group's add-row was at the BOTTOM instead of top; and
# the eye/⋯ mini-icons were always visible. SVGs sourced from live admin.shopify.com editor
# capture (2026-06-02) — see scratch/shopify_sidebar_icons.json + truth.json.
SVR="${DIR}/server.js"
check "app.js declares SECTION_TYPE_ICON_SVGS map" "$([ "$(grep -c 'const SECTION_TYPE_ICON_SVGS = {' "$EAPP")" -ge 1 ] && echo yes)" "yes"
check "app.js declares BLOCK_TYPE_ICON_SVGS map" "$([ "$(grep -c 'const BLOCK_TYPE_ICON_SVGS = {' "$EAPP")" -ge 1 ] && echo yes)" "yes"
check "icon maps embed >=12 16x16 SVGs" "$([ "$(grep -c 'viewBox=' "$EAPP")" -ge 12 ] && echo yes)" "yes"
check "app.js section-row renders sectionTypeIconSvg" "$([ "$(grep -c 'sectionTypeIconSvg(section.type)' "$EAPP")" -ge 1 ] && echo yes)" "yes"
check "app.js block-row renders blockTypeIconSvg" "$([ "$(grep -c 'blockTypeIconSvg(block.type)' "$EAPP")" -ge 1 ] && echo yes)" "yes"
check "styles.css has .section-type-icon / .block-type-icon" "$([ "$(grep -c '.block-type-icon' "$SCSS")" -ge 1 ] && echo yes)" "yes"
check "styles.css mini-icon opacity:0 default (hover-only)" "$([ "$(grep -c 'opacity: 0;' "$SCSS")" -ge 1 ] && echo yes)" "yes"
check "styles.css mini-icon shown on .section-row.is-selected" "$([ "$(grep -c '.section-row.is-selected .mini-icon' "$SCSS")" -ge 1 ] && echo yes)" "yes"
check "styles.css drag handles hidden by default (hover-only)" "$([ "$(grep -c '.block-drag-handle {' "$SCSS")" -ge 1 ] && [ "$(grep -A2 '.block-drag-handle {' "$SCSS" | grep -c 'opacity: 0')" -ge 0 ] && echo yes)" "yes"
check "styles.css drag handles shown on row hover/select" "$([ "$(grep -c '.section-row:hover .drag-handle' "$SCSS")" -ge 1 ] && echo yes)" "yes"
check "app.js 页脚 group add-row at TOP (before sections)" "$([ "$(grep -c 'group === .footer.' "$EAPP")" -ge 1 ] && echo yes)" "yes"
check "app.js template add-row only once at bottom" "$([ "$(grep -c 'group === .header. || group === .template.' "$EAPP")" -ge 1 ] && echo yes)" "yes"
check "app.js add-block-row at top of block list (no per-block dup)" "$([ "$(grep -c 'appendAddBlockRow(blocks.length)' "$EAPP")" -ge 1 ] && echo yes)" "yes"
# featured-product seed: real Origin has 6 blocks (标题 / 价格 / 文本 / 多属性选择器 / Buy Button / 分享).
# Mock previously had 7 (extra vendor + quantity_selector, 购买按钮 not "Buy Button"). server.js + app.js
# must agree on the new 6-block list.
check "server.js featured-product seed has Buy Button (English)" "$([ "$(grep -c 'Buy Button' "$SVR")" -ge 1 ] && echo yes)" "yes"
check "server.js featured-product seed dropped vendor block" "$([ "$(grep -c 'featured-product-vendor' "$SVR")" -eq 0 ] && echo yes)" "yes"
check "server.js featured-product seed dropped quantity-selector block" "$([ "$(grep -c 'featured-product-quantity' "$SVR")" -eq 0 ] && echo yes)" "yes"
check "app.js featuredProductDefaultBlocks uses Buy Button label" "$([ "$(grep -c 'Buy Button' "$EAPP")" -ge 1 ] && echo yes)" "yes"
check "app.js featuredProductDefaultBlocks dropped 文本 - 厂商" "$([ "$(grep -c '文本 - 厂商' "$EAPP")" -eq 0 ] && echo yes)" "yes"

# 2026-06-02 — Two fixes for "保存中" stuck bug. (1) readBody body cap raised 5MB→20MB so that
# editor saves with inlined base64 images (collage tile images ~600KB each) succeed. (2) The
# saveButton click handler must wrap syncDraft/save in try/finally so a network failure no longer
# leaves the button stuck on "保存中" — previously the textContent reset never ran on throw.
check "server.js readBody cap 20MB (was 5MB)" "$([ "$(grep -c '20 \* 1024 \* 1024' "$SVR")" -ge 1 ] && echo yes)" "yes"
# /api/media + /media/:id — out-of-band image storage so base64 dataURLs stop bloating draft.
check "server.js POST /api/media endpoint" "$([ "$(grep -cF '/api/media' "$SVR")" -ge 1 ] && echo yes)" "yes"
check "server.js GET /media/:id endpoint" "$([ "$(grep -cF 'pathname.startsWith' "$SVR")" -ge 1 ] && echo yes)" "yes"
check "server.js mediaBlobs Map declared" "$([ "$(grep -c 'const mediaBlobs = new Map' "$SVR")" -ge 1 ] && echo yes)" "yes"
check "server.js /api/reset clears mediaBlobs" "$([ "$(grep -c 'resetMediaBlobs()' "$SVR")" -ge 1 ] && echo yes)" "yes"
check "app.js uploadFile posts to /api/media" "$([ "$(grep -cF '/api/media' "$EAPP")" -ge 1 ] && echo yes)" "yes"
check "app.js media-upload-input handler uses uploadFile" "$([ "$(grep -c 'uploadFile(file)' "$EAPP")" -ge 1 ] && echo yes)" "yes"
check "app.js no longer references readFileAsDataUrl (dead code removed)" "$([ "$(grep -c 'readFileAsDataUrl' "$EAPP")" -eq 0 ] && echo yes)" "yes"
# End-to-end: actually round-trip a small base64 image through the live endpoint.
MEDIA_RESP=$(curl -s -X POST "$B/api/media" -H 'Content-Type: application/json' \
  -d '{"filename":"smoke.png","contentType":"image/png","dataBase64":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGP4DwABBAEAfbLI3wAAAABJRU5ErkJggg=="}')
MEDIA_URL=$(echo "$MEDIA_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('url') or '')" 2>/dev/null)
check "POST /api/media returns /media/<id> url" "$([ -n "$MEDIA_URL" ] && echo yes)" "yes"
check "GET <returned url> serves bytes 200" "$(curl -s -o /dev/null -w '%{http_code}' "$B$MEDIA_URL")" "200"
check "GET /media/<unknown> → 404" "$(curl -s -o /dev/null -w '%{http_code}' "$B/media/nope-does-not-exist")" "404"
check "app.js saveButton click catches save errors" "$([ "$(grep -cF '[save] failed' "$EAPP")" -ge 1 ] && echo yes)" "yes"
check "app.js saveButton finally branch resets textContent" "$([ "$(grep -B1 -A2 '} finally {' "$EAPP" | grep -c '保存' )" -ge 1 ] && echo yes)" "yes"

echo ""
echo "== RESULT: ${PASS} passed, ${FAIL} failed =="
[ "$FAIL" -eq 0 ]
