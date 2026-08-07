#!/usr/bin/env bash
# End-to-end smoke for the v3 storefront renderer.
#
# What this proves:
#   1. Backend boots on a scratch port (default 3196; override SMOKE_SF_PORT)
#   2. Default seed theme (`seeds/themes/origin/`) renders the homepage,
#      product, collection, cart, search, and 404 pages
#   3. Theme assets are served from the theme file list (assets/base.css)
#   4. Admin SPA is still reachable at /admin
#   5. CLI `shopify theme push -n` updates `draft.themeFiles[]` and the
#      storefront re-renders from the updated files immediately
#   6. `shopify-bench reset` returns to seed
#
# Does NOT touch the user's :3062 v2 dev server or the :3098/:3197 ports used
# by other shopify mocks. The smoke uses a private port and shuts down on exit.

set -u

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${SMOKE_SF_PORT:-3196}"
TOKEN="storefront-smoke-bench-token"
B="http://127.0.0.1:${PORT}"
PASS=0; FAIL=0; FAIL_LIST=()
TMPROOT="$(mktemp -d -t shopify-v3-storefront.XXXXXX)"
LOG="$TMPROOT/server.log"
PID_FILE="$TMPROOT/server.pid"

cleanup() {
  if [[ -f "$PID_FILE" ]]; then
    local pid; pid=$(cat "$PID_FILE")
    if [[ -n "$pid" ]]; then kill "$pid" 2>/dev/null || true; fi
  fi
  rm -rf "$TMPROOT"
}
trap cleanup EXIT

ok()   { PASS=$((PASS+1)); printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail() { FAIL=$((FAIL+1)); FAIL_LIST+=("$1"); printf '  \033[31m✗\033[0m %s — %s\n' "$1" "$2"; }
hdr()  { printf '\n=== %s ===\n' "$1"; }

assert_status_contains() {
  local label="$1" url="$2" expected_status="$3" pattern="$4"
  local out_file body
  out_file="$TMPROOT/out_$$_$RANDOM"
  local status; status=$(curl -s -w '%{http_code}' "$url" -o "$out_file")
  body=$(cat "$out_file"); rm -f "$out_file"
  if [[ "$status" != "$expected_status" ]]; then
    fail "$label" "expected status $expected_status, got $status"; return
  fi
  # Use grep -F -e so leading dashes in the pattern aren't treated as flags
  # (e.g. "--color-background" in CSS).
  if [[ -n "$pattern" ]] && ! printf '%s' "$body" | grep -qFe "$pattern"; then
    fail "$label" "body missing pattern: $pattern"; return
  fi
  ok "$label"
}

hdr "Starting v3 backend on :${PORT}"
( cd "$DIR" && PORT="$PORT" MOCK_VERIFIER_TOKEN="$TOKEN" bun server.js >"$LOG" 2>&1 & echo $! > "$PID_FILE" )
ready=0
for _ in $(seq 1 80); do
  if curl -s -f "$B/health" >/dev/null 2>&1; then ready=1; break; fi
  sleep 0.1
done
if [[ "$ready" != "1" ]]; then
  echo "Backend failed to come up; log:" >&2
  tail -n 50 "$LOG" >&2
  exit 1
fi
echo "  backend ready ($(curl -s "$B/health"))"

export SHOPIFY_MOCK_URL="$B"
export MOCK_VERIFIER_TOKEN="$TOKEN"

# ---------------------------------------------------------------------------
hdr "Default seed theme renders all main routes"
# ---------------------------------------------------------------------------
assert_status_contains 'GET /'                          "$B/"                       200 '我的商店'
assert_status_contains 'GET / shows hero heading'       "$B/"                       200 'Handcrafted products for everyday rituals'
assert_status_contains 'GET / shows featured products'  "$B/"                       200 'Featured collection'
assert_status_contains 'GET /products/<handle>'         "$B/products/ceramic-pour-over-mug" 200 'Ceramic Pour-Over Mug'
assert_status_contains 'GET /products/<handle> price'   "$B/products/ceramic-pour-over-mug" 200 '$24.00'
assert_status_contains 'GET /collections/frontpage'     "$B/collections/frontpage"  200 'product-grid'
assert_status_contains 'GET /collections/frontpage count' "$B/collections/frontpage" 200 '8 products'
assert_status_contains 'GET /collections (= all)'       "$B/collections"            200 '所有产品'
assert_status_contains 'GET /pages/<handle> (missing)'  "$B/pages/about"            404 ''
assert_status_contains 'GET /cart (empty)'              "$B/cart"                   200 'cart-empty'
assert_status_contains 'GET /search?q=mug'              "$B/search?q=mug"           200 'results for'
assert_status_contains 'GET /products/nonexistent → 404' "$B/products/nonexistent"  404 '404'
assert_status_contains 'GET /404'                       "$B/404"                    404 'Back to home'

# Theme assets
assert_status_contains 'GET /assets/base.css'           "$B/assets/base.css"        200 '--color-background'
content_type=$(curl -s -o /dev/null -w '%{content_type}' "$B/assets/base.css")
if [[ "$content_type" == text/css* ]]; then ok 'asset content-type is text/css'
else fail 'asset content-type is text/css' "got: $content_type"; fi

# ---------------------------------------------------------------------------
hdr "Admin SPA still reachable at /admin"
# ---------------------------------------------------------------------------
assert_status_contains 'GET /admin'                     "$B/admin"                  200 'Shopify Mock'
assert_status_contains 'GET /api/state (admin API)'     "$B/api/state"              200 'themeFiles'

# ---------------------------------------------------------------------------
hdr "CLI → backend → renderer integration"
# ---------------------------------------------------------------------------
PUSH_SRC="$TMPROOT/theme-edit"
mkdir -p "$PUSH_SRC/templates" "$PUSH_SRC/layout"
cat > "$PUSH_SRC/templates/index.json" <<'EOF'
{
  "sections": {
    "hero": {
      "type": "image-with-text",
      "settings": {
        "heading": "STOREFRONT-SMOKE Hero",
        "subheading": "edited via CLI push",
        "text": "<p>Round-trip body.</p>",
        "button_label": "Browse",
        "button_link": "/collections/all"
      }
    }
  },
  "order": ["hero"]
}
EOF
cp "$DIR/seeds/themes/origin/layout/theme.liquid" "$PUSH_SRC/layout/"

# Push with --nodelete so we don't wipe sections/snippets/assets the renderer needs.
if (cd "$PUSH_SRC" && bun "$DIR/bin/shopify" theme push -t 159103910101 -n --allow-live --json > "$TMPROOT/push.out" 2> "$TMPROOT/push.err"); then
  ok 'shopify theme push -n succeeded'
else
  fail 'shopify theme push -n' "$(cat "$TMPROOT/push.err")"
fi

# Storefront should now show the new heading.
assert_status_contains 'GET / after push reflects new heading' "$B/" 200 'STOREFRONT-SMOKE Hero'

# Bench reset → state returns to seed, storefront shows original heading again.
if bun "$DIR/bin/shopify-bench" reset >/dev/null 2>&1; then ok 'shopify-bench reset'
else fail 'shopify-bench reset' 'non-zero exit'; fi
assert_status_contains 'GET / after reset shows seed heading' "$B/" 200 'Handcrafted products for everyday rituals'

# ---------------------------------------------------------------------------
hdr "Summary"
# ---------------------------------------------------------------------------
echo "  PASS: $PASS"
echo "  FAIL: $FAIL"
if (( FAIL > 0 )); then
  echo ""
  echo "  Failed assertions:"
  for n in "${FAIL_LIST[@]}"; do echo "    - $n"; done
  exit 1
fi
echo "  All storefront smoke assertions pass ✓"
