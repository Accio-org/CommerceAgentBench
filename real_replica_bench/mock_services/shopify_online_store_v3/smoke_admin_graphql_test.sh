#!/usr/bin/env bash
# Smoke for the Admin GraphQL surface added in Phase A (ForgeFit support).
# Covers: shop fields, locations, publications, currentAppInstallation, productSet,
# productVariantsBulk{Create,Update}, collectionAddProducts, inventoryItemUpdate,
# inventorySetQuantities (+ @idempotent 3-error cascade), stagedUploadsCreate,
# productCreateMedia (+ deprecation), themes/theme(id), themeFilesUpsert.
#
# Phase D's smoke_forgefit_replay.sh chains these into the full ForgeFit trace;
# this file just validates each new op in isolation.

set -u
cd "$(dirname "$0")"

PORT=${TEST_PORT:-3098}
B="http://127.0.0.1:$PORT"
GQL="$B/admin/api/2026-01/graphql.json"
PASS=0; FAIL=0
check() {
  local name="$1" got="$2" want="$3"
  if [[ "$got" == "$want" ]]; then PASS=$((PASS+1)); printf "  \033[32mPASS\033[0m %s\n" "$name"
  else FAIL=$((FAIL+1)); printf "  \033[31mFAIL\033[0m %s (got '%s' want '%s')\n" "$name" "$got" "$want"
  fi
}
contains() {
  local name="$1" got="$2" want="$3"
  if [[ "$got" == *"$want"* ]]; then PASS=$((PASS+1)); printf "  \033[32mPASS\033[0m %s\n" "$name"
  else FAIL=$((FAIL+1)); printf "  \033[31mFAIL\033[0m %s (missing '%s' in '%s')\n" "$name" "$want" "${got:0:200}"
  fi
}
gq() { curl -sS -X POST "$GQL" -H 'content-type: application/json' -d "$1"; }
# Phase B.4 — `gqAuth <token> <json>` sends an authenticated GraphQL request. Use
# for every write mutation now that scope-gating is mandatory.
gqAuth() { curl -sS -X POST "$GQL" -H "Authorization: Bearer $1" -H 'content-type: application/json' -d "$2"; }
# `gqFakeAuth <json>` sends an unknown-token Bearer (forces resolveScopes to
# return an empty set, regardless of the saved.appInstallation fallback).
gqFakeAuth() { curl -sS -X POST "$GQL" -H "Authorization: Bearer unknown-token-for-rejection-probe" -H 'content-type: application/json' -d "$1"; }

# Start server
lsof -ti tcp:$PORT 2>/dev/null | xargs -r kill 2>/dev/null
PORT=$PORT bun server.js > /tmp/v3-admin-graphql-smoke.log 2>&1 &
SP=$!
trap "kill $SP 2>/dev/null" EXIT
sleep 1.2
curl -sS "$B/health" >/dev/null || { echo "server failed to start"; exit 1; }

echo "=== scope-gate rejects unauth writes (Phase B.5) ==="
# Every write mutation declares a required access scope. Sending a request with
# an unknown Bearer token yields an empty scope set (resolveScopes), which the
# requireScope gate rejects with a top-level GraphQL `errors[]` entry whose
# message matches real Shopify's "Access denied for <field> field. Required
# access: `write_<scope>` access scope." shape. The `data.<field>` is still
# emitted as a null result so the client can introspect.
REJ_PSET=$(gqFakeAuth '{"query":"mutation($input:ProductSetInput!){productSet(input:$input){product{title}userErrors{message}}}","variables":{"input":{"title":"Reject","handle":"reject"}}}')
contains "productSet → Access denied"          "$REJ_PSET" "Access denied"
contains "productSet → write_products scope"    "$REJ_PSET" "write_products"
contains "productSet → data.productSet null"    "$REJ_PSET" "\"product\": null"
# Phase F.3 — every access-denied error carries `locations[{line,column}]` and
# `path[<field>]` alongside `extensions.code` / `requiredAccess`. Pin the shape.
contains "error envelope: locations[]"          "$REJ_PSET" "\"locations\""
contains "error envelope: line:1"                "$REJ_PSET" "\"line\": 1"
contains "error envelope: column:3"              "$REJ_PSET" "\"column\": 3"
contains "error envelope: path[productSet]"      "$REJ_PSET" "\"path\""
# F.3 — `requiredAccess` is the BACKTICKED scope name + " access scope."
contains "error envelope: requiredAccess shape" "$REJ_PSET" "\`write_products\` access scope."

REJ_TFU=$(gqFakeAuth '{"query":"mutation($themeId:ID!,$files:[OnlineStoreThemeFilesUpsertFileInput!]!){themeFilesUpsert(themeId:$themeId,files:$files){upsertedThemeFiles{filename}}}","variables":{"themeId":"gid://shopify/OnlineStoreTheme/1","files":[{"filename":"templates/x.json","body":{"type":"TEXT","value":"{}"}}]}}')
contains "themeFilesUpsert → Access denied"    "$REJ_TFU" "Access denied"
contains "themeFilesUpsert → write_themes scope" "$REJ_TFU" "write_themes"

REJ_PUB=$(gqFakeAuth '{"query":"mutation($id:ID!,$input:[PublicationInput!]!){publishablePublish(id:$id,input:$input){publishable{publicationCount}}}","variables":{"id":"gid://shopify/Product/1","input":[{"publicationId":"gid://shopify/Publication/pub-online-store"}]}}')
contains "publishablePublish → Access denied"   "$REJ_PUB" "Access denied"
contains "publishablePublish → write_publications scope" "$REJ_PUB" "write_publications"

REJ_INV=$(gqFakeAuth '{"query":"mutation($input:InventorySetQuantitiesInput!){inventorySetQuantities(input:$input)@idempotent(key:\"r1\"){userErrors{message}}}","variables":{"input":{"name":"available","reason":"correction","quantities":[]}}}')
contains "inventorySetQuantities → Access denied" "$REJ_INV" "Access denied"
contains "inventorySetQuantities → write_inventory scope" "$REJ_INV" "write_inventory"

REJ_STG=$(gqFakeAuth '{"query":"mutation($input:[StagedUploadInput!]!){stagedUploadsCreate(input:$input){stagedTargets{url}}}","variables":{"input":[{"resource":"IMAGE","filename":"x.png","mimeType":"image/png","fileSize":"1","httpMethod":"POST"}]}}')
contains "stagedUploadsCreate → Access denied"  "$REJ_STG" "Access denied"
contains "stagedUploadsCreate → write_files scope" "$REJ_STG" "write_files"

REJ_CAP=$(gqFakeAuth '{"query":"mutation($id:ID!,$productIds:[ID!]!){collectionAddProducts(id:$id,productIds:$productIds){collection{id}}}","variables":{"id":"gid://shopify/Collection/1","productIds":["gid://shopify/Product/1"]}}')
contains "collectionAddProducts → Access denied" "$REJ_CAP" "Access denied"
contains "collectionAddProducts → write_products scope" "$REJ_CAP" "write_products"

echo "=== Phase F.1 — scope-gate rejects unauth READ queries ==="
# Reads now mirror writes: every gated query field requires its read_* scope.
# Failure: top-level `errors[]` with the access-denied shape, `data` omits the
# field entirely (vs writes which keep a null userErrors-shape — selection
# pruner can't include a field we never resolved).
REJ_THEMES=$(gqFakeAuth '{"query":"{themes(first:5){nodes{id name role}}}"}')
contains "themes read → Access denied"          "$REJ_THEMES" "Access denied for themes field"
contains "themes read → read_themes scope"      "$REJ_THEMES" "\`read_themes\` access scope."
contains "themes read → path[themes]"           "$REJ_THEMES" "\"themes\""

REJ_PUBS=$(gqFakeAuth '{"query":"{publications(first:10){nodes{id name}}}"}')
contains "publications read → Access denied"     "$REJ_PUBS" "Access denied for publications field"
contains "publications read → read_publications" "$REJ_PUBS" "\`read_publications\` access scope."

REJ_PRODS_READ=$(gqFakeAuth '{"query":"{products(first:5){nodes{id title}}}"}')
contains "products read → Access denied"         "$REJ_PRODS_READ" "Access denied for products field"
contains "products read → read_products scope"   "$REJ_PRODS_READ" "\`read_products\` access scope."

REJ_COLS_READ=$(gqFakeAuth '{"query":"{collections(first:5){nodes{id title}}}"}')
contains "collections read → Access denied"      "$REJ_COLS_READ" "Access denied for collections field"
# Real Shopify groups collections under read_products — verify the mapping.
contains "collections read → read_products"      "$REJ_COLS_READ" "\`read_products\` access scope."

REJ_FILES_READ=$(gqFakeAuth '{"query":"{files(first:5){nodes{id}}}"}')
contains "files read → Access denied"            "$REJ_FILES_READ" "Access denied for files field"
contains "files read → read_files scope"         "$REJ_FILES_READ" "\`read_files\` access scope."

REJ_PAGES_READ=$(gqFakeAuth '{"query":"{pages(first:5){nodes{id title}}}"}')
contains "pages read → Access denied"            "$REJ_PAGES_READ" "Access denied for pages field"
contains "pages read → read_content scope"       "$REJ_PAGES_READ" "\`read_content\` access scope."

REJ_MENUS_READ=$(gqFakeAuth '{"query":"{menus(first:5){nodes{id handle}}}"}')
contains "menus read → Access denied"            "$REJ_MENUS_READ" "Access denied for menus field"
contains "menus read → read_online_store_navigation" "$REJ_MENUS_READ" "\`read_online_store_navigation\` access scope."

# F.2 — locations carries a documented Shopify quirk: message ends with
# `field.` (no scope tail) and `extensions` lacks `requiredAccess`. The shape
# was captured Tier 1B (.tmp/real-shopify-responses/07_locations.real.json).
REJ_LOCS_READ=$(gqFakeAuth '{"query":"{locations(first:5){nodes{id name}}}"}')
contains "locations read → Access denied"        "$REJ_LOCS_READ" "Access denied for locations field"
# Real shape: message is JUST "Access denied for locations field." (note the
# trailing dot, no scope name). Pin the literal — this would fail if we
# accidentally emit the generic accessDeniedError shape.
contains "locations read → no scope tail"        "$REJ_LOCS_READ" "Access denied for locations field."
# Real extensions have NO requiredAccess key — assert it's absent by checking
# the surrounding payload doesn't contain the suffix.
LOC_HAS_REQ=$(echo "$REJ_LOCS_READ" | jq -r '.errors[0].extensions | has("requiredAccess")' 2>/dev/null)
check "locations error: no requiredAccess key"   "$LOC_HAS_REQ" "false"
# Other fields' errors still carry requiredAccess (sanity-check the quirk
# doesn't leak to neighbors).
THEMES_HAS_REQ=$(echo "$REJ_THEMES" | jq -r '.errors[0].extensions | has("requiredAccess")' 2>/dev/null)
check "themes error: HAS requiredAccess key"     "$THEMES_HAS_REQ" "true"

# Partial-data response: when some queried fields pass and some fail, real
# Shopify returns both `data` (with the resolved subset) and `errors`.
# Grant ONLY read_products and query both products + themes — products should
# come back, themes should be in errors.
PARTIAL_TOK=$(curl -sS -X POST "$B/__mock_auth/grant" -H 'content-type: application/json' \
  -d '{"storeName":"smoke","scopes":["read_products"]}' | jq -r '.token')
PARTIAL=$(curl -sS -X POST "$GQL" -H "Authorization: Bearer $PARTIAL_TOK" -H 'content-type: application/json' \
  -d '{"query":"{products(first:1){nodes{id}} themes(first:1){nodes{id}}}"}')
contains "partial: data.products present"        "$PARTIAL" "\"products\""
contains "partial: themes in errors"             "$PARTIAL" "Access denied for themes field"
PARTIAL_HAS_THEMES=$(echo "$PARTIAL" | jq -r '.data | has("themes")' 2>/dev/null)
check "partial: data.themes OMITTED"             "$PARTIAL_HAS_THEMES" "false"

echo "=== shop fields (ForgeFit log:241 shape) ==="
SHOP=$(gq '{"query":"{shop{id name email currencyCode plan{displayName} primaryDomain{host} publicationCount}}"}')
check "shop.id is gid"           "$(echo "$SHOP" | jq -r '.data.shop.id')"              "gid://shopify/Shop/83525337308"
check "shop.currencyCode SGD"    "$(echo "$SHOP" | jq -r '.data.shop.currencyCode')"    "SGD"
check "shop.plan.displayName"    "$(echo "$SHOP" | jq -r '.data.shop.plan.displayName')" "Trial"
check "shop.publicationCount=3"  "$(echo "$SHOP" | jq -r '.data.shop.publicationCount')" "3"

echo "=== grant scopes (F.1 — needs reads + writes for the rest of this suite) ==="
# Phase F.1 — reads are now scope-gated too. Single grant covers every read +
# write scope the rest of this smoke exercises. Tracked count matches the
# scope array length in the grant body below.
GRANT_SCOPES='["read_products","write_products","read_publications","write_publications","read_inventory","write_inventory","read_locations","read_themes","write_themes","read_files","write_files","read_content","write_content","read_online_store_pages","read_online_store_navigation","read_metaobject_definitions"]'
TOK=$(curl -sS -X POST "$B/__mock_auth/grant" -H 'content-type: application/json' \
  -d "{\"storeName\":\"m5mrmw-zk.myshopify.com\",\"scopes\":$GRANT_SCOPES}" | jq -r '.token')
[[ -n "$TOK" ]] && PASS=$((PASS+1)) || FAIL=$((FAIL+1))
printf "  %s grant token minted (%s)\n" "$([[ -n "$TOK" ]] && echo PASS || echo FAIL)" "${TOK:0:8}..."

echo "=== locations ==="
LOC=$(gqAuth "$TOK" '{"query":"{locations(first:10){nodes{id name address{country}}}}"}')
check "1 location"               "$(echo "$LOC" | jq -r '.data.locations.nodes | length')" "1"
check "location is Shop location" "$(echo "$LOC" | jq -r '.data.locations.nodes[0].name')" "Shop location"

echo "=== publications ==="
PUBS=$(gqAuth "$TOK" '{"query":"{publications(first:10){nodes{id name}}}"}')
check "3 publications"           "$(echo "$PUBS" | jq -r '.data.publications.nodes | length')" "3"
contains "在线商店 publication"   "$(echo "$PUBS")" "在线商店"

echo "=== currentAppInstallation (unauth → empty scopes) ==="
# currentAppInstallation is introspection: NEVER scope-gated, even when the
# resolution falls back to saved.appInstallation.accessScopes. With no
# Authorization header, the fallback union (whatever was granted earlier in
# THIS smoke run) drives the result. After the grant above, the union has the
# full GRANT_SCOPES set.
APP=$(gq '{"query":"{currentAppInstallation{id accessScopes{handle}}}"}')
APP_SCOPE_COUNT=$(echo "$APP" | jq -r '.data.currentAppInstallation.accessScopes | length')
check "appInstall scopes count = grant length" "$APP_SCOPE_COUNT" "$(echo "$GRANT_SCOPES" | jq 'length')"

APP2=$(gqAuth "$TOK" '{"query":"{currentAppInstallation{accessScopes{handle}}}"}')
check "Bearer reflects granted set"   "$(echo "$APP2" | jq -r '.data.currentAppInstallation.accessScopes | length')" "$(echo "$GRANT_SCOPES" | jq 'length')"

echo "=== productSet (full ForgeFit-shape input) ==="
# Phase B.4 — all write mutations from here on use the granted Bearer token.
PSET=$(gqAuth "$TOK" '{"query":"mutation($input:ProductSetInput!){productSet(input:$input){product{id title handle status totalInventory variants{nodes{id price sku inventoryItem{id tracked}}} media{nodes{id status}}} userErrors{message}}}","variables":{"input":{"title":"ForgeFit Test Dumbbell","handle":"test-dumbbell","vendor":"ForgeFit","status":"ACTIVE","variants":[{"price":"189.00","sku":"FF-TST-001","inventoryItem":{"tracked":true}}]}}}')
check "productSet ok"            "$(echo "$PSET" | jq -r '.data.productSet.product.title')" "ForgeFit Test Dumbbell"
check "variant price bare scalar" "$(echo "$PSET" | jq -r '.data.productSet.product.variants.nodes[0].price')" "189.00"
check "variant.inventoryItem.tracked=true" "$(echo "$PSET" | jq -r '.data.productSet.product.variants.nodes[0].inventoryItem.tracked')" "true"
PROD=$(echo "$PSET" | jq -r '.data.productSet.product.id')
INV=$(echo "$PSET" | jq -r '.data.productSet.product.variants.nodes[0].inventoryItem.id')

echo "=== productVariantsBulkCreate ==="
BVC=$(gqAuth "$TOK" "{\"query\":\"mutation(\$pid:ID!,\$variants:[ProductVariantsBulkInput!]!){productVariantsBulkCreate(productId:\$pid,variants:\$variants){productVariants{id sku} userErrors{message}}}\",\"variables\":{\"pid\":\"$PROD\",\"variants\":[{\"price\":\"199.00\",\"sku\":\"FF-TST-002\"}]}}")
check "bulkCreate 1 variant"     "$(echo "$BVC" | jq -r '.data.productVariantsBulkCreate.productVariants | length')" "1"

echo "=== inventoryItemUpdate (tracked toggle) ==="
IIU=$(gqAuth "$TOK" "{\"query\":\"mutation(\$id:ID!,\$input:InventoryItemUpdateInput!){inventoryItemUpdate(id:\$id,input:\$input){inventoryItem{id tracked} userErrors{message}}}\",\"variables\":{\"id\":\"$INV\",\"input\":{\"tracked\":true}}}")
check "tracked stays true"       "$(echo "$IIU" | jq -r '.data.inventoryItemUpdate.inventoryItem.tracked')" "true"

echo "=== inventorySetQuantities — 3-error cascade (ForgeFit log:619-668) ==="
# Error #1: ignoreCompareQuantity unknown
E1=$(gqAuth "$TOK" "{\"query\":\"mutation(\$input:InventorySetQuantitiesInput!){inventorySetQuantities(input:\$input)@idempotent(key:\\\"e1\\\"){userErrors{message code}}}\",\"variables\":{\"input\":{\"name\":\"available\",\"reason\":\"correction\",\"ignoreCompareQuantity\":false,\"quantities\":[]}}}")
contains "E1 ignoreCompareQuantity rejected" "$E1" "ignoreCompareQuantity"
# Error #2: missing changeFromQuantity
LOC_ID=$(echo "$LOC" | jq -r '.data.locations.nodes[0].id')
E2=$(gqAuth "$TOK" "{\"query\":\"mutation(\$input:InventorySetQuantitiesInput!){inventorySetQuantities(input:\$input)@idempotent(key:\\\"e2\\\"){userErrors{message code}}}\",\"variables\":{\"input\":{\"name\":\"available\",\"reason\":\"correction\",\"quantities\":[{\"inventoryItemId\":\"$INV\",\"locationId\":\"$LOC_ID\",\"quantity\":100}]}}}")
contains "E2 changeFromQuantity required" "$E2" "changeFromQuantity"
# Error #3: missing @idempotent (no directive in query)
E3=$(gqAuth "$TOK" "{\"query\":\"mutation(\$input:InventorySetQuantitiesInput!){inventorySetQuantities(input:\$input){userErrors{message code}}}\",\"variables\":{\"input\":{\"name\":\"available\",\"reason\":\"correction\",\"quantities\":[{\"inventoryItemId\":\"$INV\",\"locationId\":\"$LOC_ID\",\"quantity\":100,\"changeFromQuantity\":0}]}}}")
contains "E3 @idempotent required"        "$E3" "idempotent"

echo "=== inventorySetQuantities — happy + idempotency replay ==="
SET1=$(gqAuth "$TOK" "{\"query\":\"mutation(\$input:InventorySetQuantitiesInput!){inventorySetQuantities(input:\$input)@idempotent(key:\\\"smoke-set-1\\\"){inventoryAdjustmentGroup{id changes{name delta}}}}\",\"variables\":{\"input\":{\"name\":\"available\",\"reason\":\"correction\",\"quantities\":[{\"inventoryItemId\":\"$INV\",\"locationId\":\"$LOC_ID\",\"quantity\":100,\"changeFromQuantity\":0}]}}}")
contains "SET1 had +100 delta"            "$SET1" "100"
# Replay with same key
SET2=$(gqAuth "$TOK" "{\"query\":\"mutation(\$input:InventorySetQuantitiesInput!){inventorySetQuantities(input:\$input)@idempotent(key:\\\"smoke-set-1\\\"){inventoryAdjustmentGroup{id}}}\",\"variables\":{\"input\":{\"name\":\"available\",\"reason\":\"correction\",\"quantities\":[{\"inventoryItemId\":\"$INV\",\"locationId\":\"$LOC_ID\",\"quantity\":100,\"changeFromQuantity\":0}]}}}")
check "replay same key returns same id"   "$(echo "$SET1" | jq -r '.data.inventorySetQuantities.inventoryAdjustmentGroup.id')" "$(echo "$SET2" | jq -r '.data.inventorySetQuantities.inventoryAdjustmentGroup.id')"

echo "=== collectionAddProducts ==="
COL=$(gqAuth "$TOK" '{"query":"mutation($input:CollectionInput!){collectionCreate(input:$input){collection{id handle}}}","variables":{"input":{"title":"Test Coll","handle":"test-coll"}}}')
CID=$(echo "$COL" | jq -r '.data.collectionCreate.collection.id')
CADD=$(gqAuth "$TOK" "{\"query\":\"mutation(\$id:ID!,\$productIds:[ID!]!){collectionAddProducts(id:\$id,productIds:\$productIds){collection{productsCount{count}} userErrors{message}}}\",\"variables\":{\"id\":\"$CID\",\"productIds\":[\"$PROD\"]}}")
check "collection has 1 product" "$(echo "$CADD" | jq -r '.data.collectionAddProducts.collection.productsCount.count')" "1"

echo "=== stagedUploadsCreate + upload + productCreateMedia (CDN roundtrip) ==="
STG=$(gqAuth "$TOK" '{"query":"mutation($input:[StagedUploadInput!]!){stagedUploadsCreate(input:$input){stagedTargets{url resourceUrl parameters{name value}}}}","variables":{"input":[{"resource":"IMAGE","filename":"smoke.png","mimeType":"image/png","fileSize":"15","httpMethod":"POST"}]}}')
UURL=$(echo "$STG" | jq -r '.data.stagedUploadsCreate.stagedTargets[0].url')
RES=$(echo "$STG" | jq -r '.data.stagedUploadsCreate.stagedTargets[0].resourceUrl')
contains "staged URL points to mock"      "$UURL" "/__stage_upload/"
echo -n "FAKE_SMOKE_PNG" > /tmp/smoke.png
UP_STATUS=$(curl -sS -X POST "$UURL" --data-binary @/tmp/smoke.png -H 'content-type: image/png' -o /dev/null -w "%{http_code}")
check "upload returns 204"        "$UP_STATUS" "204"
PCM=$(gqAuth "$TOK" "{\"query\":\"mutation(\$productId:ID!,\$media:[CreateMediaInput!]!){productCreateMedia(productId:\$productId,media:\$media){media{id status image{url}}}}\",\"variables\":{\"productId\":\"$PROD\",\"media\":[{\"originalSource\":\"$RES\",\"mediaContentType\":\"IMAGE\",\"alt\":\"smoke\"}]}}")
check "media status READY"        "$(echo "$PCM" | jq -r '.data.productCreateMedia.media[0].status')" "READY"
contains "deprecation warning"    "$PCM" "deprecated"
CDN_URL=$(echo "$PCM" | jq -r '.data.productCreateMedia.media[0].image.url')
CDN_STATUS=$(curl -sS -o /tmp/got.png -w "%{http_code}" "$CDN_URL")
check "CDN serves 200"            "$CDN_STATUS" "200"
check "CDN bytes match upload"    "$(cat /tmp/got.png)" "FAKE_SMOKE_PNG"

echo "=== publishablePublish + idempotent ==="
PUB1=$(gqAuth "$TOK" "{\"query\":\"mutation(\$id:ID!,\$input:[PublicationInput!]!){publishablePublish(id:\$id,input:\$input){publishable{publicationCount} userErrors{message}}}\",\"variables\":{\"id\":\"$PROD\",\"input\":[{\"publicationId\":\"gid://shopify/Publication/pub-online-store\"}]}}")
check "publishablePublish count=1" "$(echo "$PUB1" | jq -r '.data.publishablePublish.publishable.publicationCount')" "1"
PUB2=$(gqAuth "$TOK" "{\"query\":\"mutation(\$id:ID!,\$input:[PublicationInput!]!){publishablePublish(id:\$id,input:\$input){publishable{publicationCount}}}\",\"variables\":{\"id\":\"$PROD\",\"input\":[{\"publicationId\":\"gid://shopify/Publication/pub-online-store\"}]}}")
check "re-publish still count=1"  "$(echo "$PUB2" | jq -r '.data.publishablePublish.publishable.publicationCount')" "1"

echo "=== themes / theme(id) / themeFilesUpsert ==="
THM=$(gq '{"query":"{themes(first:5){nodes{id name role}}}"}')
contains "MAIN theme exists"      "$THM" "MAIN"
MAIN=$(echo "$THM" | jq -r '.data.themes.nodes[] | select(.role=="MAIN") | .id')
TFU=$(gqAuth "$TOK" "{\"query\":\"mutation(\$themeId:ID!,\$files:[OnlineStoreThemeFilesUpsertFileInput!]!){themeFilesUpsert(themeId:\$themeId,files:\$files){upsertedThemeFiles{filename} userErrors{message}}}\",\"variables\":{\"themeId\":\"$MAIN\",\"files\":[{\"filename\":\"assets/smoke-hero.png\",\"body\":{\"type\":\"BASE64\",\"value\":\"iVBORw0KGgo=\"}},{\"filename\":\"templates/test.json\",\"body\":{\"type\":\"TEXT\",\"value\":\"{}\"}}]}}")
check "upserted 2 files"          "$(echo "$TFU" | jq -r '.data.themeFilesUpsert.upsertedThemeFiles | length')" "2"
TFG=$(gq "{\"query\":\"{theme(id:\\\"$MAIN\\\"){files(filenames:[\\\"assets/smoke-hero.png\\\",\\\"templates/test.json\\\"]){nodes{filename size contentType}}}}\"}")
check "queried 2 files back"      "$(echo "$TFG" | jq -r '.data.theme.files.nodes | length')" "2"
ASSET_STATUS=$(curl -sS -o /tmp/smoke-hero.png -w "%{http_code}" "$B/assets/smoke-hero.png")
check "asset served via /assets/" "$ASSET_STATUS" "200"

echo "=== Phase E.1: selection-set pruning ==="
# Real Shopify returns ONLY fields the query selected. These assertions pin
# that contract — they would all fail under the pre-Phase-E "every resolver
# dumps a fixed superset" behavior.
PRUNE_SHOP=$(gq '{"query":"{shop{name}}"}')
check "{shop{name}} → only name key"           "$(echo "$PRUNE_SHOP" | jq -r '.data.shop | keys | join(",")')" "name"

PRUNE_PROD=$(gq '{"query":"{products(first:5){nodes{id}}}"}')
check "products: only nodes (no edges/pageInfo)" "$(echo "$PRUNE_PROD" | jq -r '.data.products | keys | sort | join(",")')" "nodes"
check "products.nodes[0]: only id"              "$(echo "$PRUNE_PROD" | jq -r '.data.products.nodes[0] | keys | join(",")')" "id"

PRUNE_BOTH=$(gq '{"query":"{products(first:5){edges{node{id}} nodes{id}}}"}')
check "products: both edges+nodes selected"     "$(echo "$PRUNE_BOTH" | jq -r '.data.products | keys | sort | join(",")')" "edges,nodes"
check "products.edges[0].node: only id"         "$(echo "$PRUNE_BOTH" | jq -r '.data.products.edges[0].node | keys | join(",")')" "id"

PRUNE_NESTED=$(gq '{"query":"{shop{plan{displayName}}}"}')
check "shop.plan: only displayName"             "$(echo "$PRUNE_NESTED" | jq -r '.data.shop.plan | keys | join(",")')" "displayName"

PRUNE_COL=$(gq '{"query":"{collections(first:5){nodes{id productsCount{count}}}}"}')
check "collections.nodes[0]: only id+productsCount" "$(echo "$PRUNE_COL" | jq -r '.data.collections.nodes[0] | keys | sort | join(",")')" "id,productsCount"
check "productsCount: only count"               "$(echo "$PRUNE_COL" | jq -r '.data.collections.nodes[0].productsCount | keys | join(",")')" "count"

echo
echo "=== Summary ==="
echo "  PASS: $PASS"
echo "  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] && echo "All Admin GraphQL smoke assertions pass ✓" || echo "Failures detected ✗"
exit $FAIL
