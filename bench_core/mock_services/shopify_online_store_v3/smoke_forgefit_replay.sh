#!/usr/bin/env bash
# Phase D: ForgeFit build-trace replay smoke.
#
# Walks through scratch/docs/forgefit-build-log.zh-CN.md step-by-step using
# `bin/shopify store {auth,execute}` (the CLI surface the agent actually
# drives), proving the v3 mock can 1:1 reproduce that Codex+Shopify-CLI build
# session end-to-end:
#
#   1. auth                                (log:206-221)
#   2. shop intro                          (log:228-285)
#   3. 5 product creates via productSet    (log:418-516)
#   4. inventoryItemUpdate + inventorySet  (log:579-744, with 3-error cascade)
#   5. 3 collections + add products        (log:518-552)
#   6. 3 pages                             (log:554-576)
#   7. 6 staged uploads + media bind       (log:783-924)
#   8. theme files: section + index        (log:940-997)
#   9. re-auth with extra scopes           (log:1000-1051)
#  10. publishablePublish 8 resources      (log:1075-1116)
#  11. menuUpdate main + footer            (log:1119-1190)
#  12. final state snapshot                (log:1272-1369)
#
# Every step uses bin/shopify (auth + execute); the staged-upload bytes go
# through curl because that's also what the agent's helper script does in the
# log (log:830-866). All five existing smoke suites still pass after this
# script runs in isolation — it starts/stops its own server on PORT=3098 and
# does NOT touch the user's live :3097 mock.

set -u
cd "$(dirname "$0")"

PORT="${TEST_PORT:-3098}"
B="http://127.0.0.1:${PORT}"
AUTH_PATH="/tmp/forgefit-replay-auth.json"
STORE="m5mrmw-zk.myshopify.com"
PASS=0; FAIL=0
TMP="$(mktemp -d -t forgefit-replay.XXXXXX)"

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

# Phase D shells out to the CLI binary directly (not the bun task script) to
# mirror what an agent would run. exec_cli echoes the literal command line on
# any failure so the run log explains which step blew up. The CLI prints to
# stdout when --json is omitted; we just capture both streams together.
exec_cli() {
  SHOPIFY_MOCK_URL="$B" \
  SHOPIFY_MOCK_AUTH_PATH="$AUTH_PATH" \
    bun bin/shopify "$@" 2>&1
}

# Start a fresh server on the smoke port. Match smoke_admin_graphql_test.sh's
# trap shape so concurrent invocations don't leak processes.
lsof -ti tcp:"$PORT" 2>/dev/null | xargs -r kill 2>/dev/null
rm -f "$AUTH_PATH"
PORT="$PORT" bun server.js > "$TMP/server.log" 2>&1 &
SP=$!
trap "kill $SP 2>/dev/null; rm -rf '$TMP'" EXIT
sleep 1.2
curl -sS "$B/health" >/dev/null || { echo "server failed to start on :$PORT — log:"; tail -50 "$TMP/server.log"; exit 1; }

# ---------------------------------------------------------------------------
echo "=== Step 1: auth (log:206-221) ==="
# ---------------------------------------------------------------------------
INIT_SCOPES="read_products,write_products,read_inventory,write_inventory,read_locations,read_files,write_files,read_orders,write_orders,read_fulfillments,write_fulfillments,read_customers,write_customers,read_discounts,write_discounts,read_draft_orders,write_draft_orders,read_themes,write_themes,read_content,write_content,read_online_store_pages,read_reports"
AUTH_OUT=$(SHOPIFY_CLI_AGENT_INFO='n:Codex|v:1.0|p:OpenAI' \
  SHOPIFY_CLI_AGENT_IDS='s:shopify-store-case|r:build-store|i:codex-desktop' \
  exec_cli store auth --store "$STORE" --scopes "$INIT_SCOPES")
contains "auth printed Logged in"             "$AUTH_OUT" "✔ Logged in."
contains "auth printed Authenticated as"      "$AUTH_OUT" "✔ Authenticated as theheavens24@gmail.com against ${STORE}."

# Inspect the cache file the CLI wrote. The execute calls below depend on it.
check "auth cache file exists"                "$([[ -f "$AUTH_PATH" ]] && echo yes || echo no)" "yes"

# Phase E.3 — mutation gate must reject mutations without --allow-mutations.
# (All ForgeFit mutation calls below pass the flag explicitly; this is the
# negative-path check that the gate actually fires.)
GATE_REJECT=$(exec_cli store execute --query 'mutation { x }' 2>&1 || true)
contains "mutation gate rejects without --allow-mutations" "$GATE_REJECT" "Mutations are not allowed by default"
contains "mutation gate hint mentions --allow-mutations"   "$GATE_REJECT" "--allow-mutations"

# ---------------------------------------------------------------------------
echo "=== Step 2: shop intro (log:228-285) ==="
# ---------------------------------------------------------------------------
INTRO_QUERY='query { shop { name id email currencyCode primaryDomain { url host } plan { displayName } } products(first: 10) { nodes { id title handle status totalInventory } } collections(first: 10) { nodes { id title handle } } themes(first: 10) { nodes { id name role } } pages(first: 10) { nodes { id title handle } } }'
INTRO=$(exec_cli store execute --query "$INTRO_QUERY" --json)
check "shop.currencyCode SGD"                 "$(echo "$INTRO" | jq -r '.shop.currencyCode')" "SGD"
check "shop.plan.displayName Trial"           "$(echo "$INTRO" | jq -r '.shop.plan.displayName')" "Trial"
check "themes has MAIN role"                  "$(echo "$INTRO" | jq -r '.themes.nodes | map(select(.role=="MAIN")) | length')" "1"

# Capture the MAIN theme id for Step 8.
MAIN_THEME_ID=$(echo "$INTRO" | jq -r '.themes.nodes | map(select(.role=="MAIN"))[0].id')
[[ "$MAIN_THEME_ID" == gid://shopify/OnlineStoreTheme/* ]] && PASS=$((PASS+1)) || FAIL=$((FAIL+1))
printf "  %s MAIN theme id captured: %s\n" "$([[ "$MAIN_THEME_ID" == gid://shopify/OnlineStoreTheme/* ]] && echo PASS || echo FAIL)" "$MAIN_THEME_ID"

# Capture the singleton location id (needed by Step 4 inventorySet).
LOC_OUT=$(exec_cli store execute --query '{ locations(first:5){nodes{id name}} }' --json)
LOC_ID=$(echo "$LOC_OUT" | jq -r '.locations.nodes[0].id')
check "location is Shop location"             "$(echo "$LOC_OUT" | jq -r '.locations.nodes[0].name')" "Shop location"

# ---------------------------------------------------------------------------
echo "=== Step 3: 5 productSet creates (log:418-516) ==="
# ---------------------------------------------------------------------------
# The 5 ForgeFit products from the log: handle, title, price, sku.
PRODUCT_TITLES=("ForgeFit Adjustable Dumbbell Set" "ForgeFit Resistance Band Kit" "ForgeFit Non-Slip Training Mat" "ForgeFit Cast Iron Kettlebell" "ForgeFit Push-Up Board")
PRODUCT_HANDLES=("forgefit-adjustable-dumbbell-set" "forgefit-resistance-band-kit" "forgefit-non-slip-training-mat" "forgefit-cast-iron-kettlebell" "forgefit-push-up-board")
PRODUCT_PRICES=("189.00" "39.00" "49.00" "69.00" "59.00")
PRODUCT_SKUS=("FF-ADB-001" "FF-RBK-001" "FF-MAT-001" "FF-KB-001" "FF-PUB-001")

PRODUCT_IDS=()
VARIANT_IDS=()
INVENTORY_ITEM_IDS=()

PSET_MUTATION='mutation($input:ProductSetInput!){productSet(input:$input){product{id title handle status totalInventory variants{nodes{id price sku inventoryItem{id tracked}}}} userErrors{message}}}'

for i in 0 1 2 3 4; do
  VAR_FILE="$TMP/pset-$i.json"
  jq -n --arg title "${PRODUCT_TITLES[$i]}" --arg handle "${PRODUCT_HANDLES[$i]}" --arg price "${PRODUCT_PRICES[$i]}" --arg sku "${PRODUCT_SKUS[$i]}" \
    '{input:{title:$title,handle:$handle,vendor:"ForgeFit",status:"ACTIVE",variants:[{price:$price,sku:$sku,inventoryItem:{tracked:true}}]}}' \
    > "$VAR_FILE"
  PSET_OUT=$(exec_cli store execute --allow-mutations --query "$PSET_MUTATION" --variable-file "$VAR_FILE" --json)
  PID=$(echo "$PSET_OUT" | jq -r '.productSet.product.id')
  TITLE=$(echo "$PSET_OUT" | jq -r '.productSet.product.title')
  STATUS=$(echo "$PSET_OUT" | jq -r '.productSet.product.status')
  VAR_ID=$(echo "$PSET_OUT" | jq -r '.productSet.product.variants.nodes[0].id')
  INV_ID=$(echo "$PSET_OUT" | jq -r '.productSet.product.variants.nodes[0].inventoryItem.id')
  check "product[$i] title"                    "$TITLE" "${PRODUCT_TITLES[$i]}"
  check "product[$i] status ACTIVE"            "$STATUS" "ACTIVE"
  check "product[$i] variant price"            "$(echo "$PSET_OUT" | jq -r '.productSet.product.variants.nodes[0].price')" "${PRODUCT_PRICES[$i]}"
  check "product[$i] variant sku"              "$(echo "$PSET_OUT" | jq -r '.productSet.product.variants.nodes[0].sku')" "${PRODUCT_SKUS[$i]}"
  PRODUCT_IDS+=("$PID")
  VARIANT_IDS+=("$VAR_ID")
  INVENTORY_ITEM_IDS+=("$INV_ID")
done

# ---------------------------------------------------------------------------
echo "=== Step 4a: inventoryItemUpdate tracked=true (log:579-617) ==="
# ---------------------------------------------------------------------------
IIU_MUTATION='mutation($id:ID!,$input:InventoryItemUpdateInput!){inventoryItemUpdate(id:$id,input:$input){inventoryItem{id tracked} userErrors{message}}}'
for i in 0 1 2 3 4; do
  VAR_FILE="$TMP/iiu-$i.json"
  jq -n --arg id "${INVENTORY_ITEM_IDS[$i]}" \
    '{id:$id, input:{tracked:true}}' > "$VAR_FILE"
  IIU_OUT=$(exec_cli store execute --allow-mutations --query "$IIU_MUTATION" --variable-file "$VAR_FILE" --json)
  check "inv[$i] tracked=true"                 "$(echo "$IIU_OUT" | jq -r '.inventoryItemUpdate.inventoryItem.tracked')" "true"
done

# ---------------------------------------------------------------------------
echo "=== Step 4b: 3-error cascade (log:619-668) ==="
# ---------------------------------------------------------------------------
# Error #1: ignoreCompareQuantity unknown field.
E1_VARS="$TMP/e1.json"
jq -n --arg item "${INVENTORY_ITEM_IDS[0]}" --arg loc "$LOC_ID" \
  '{input:{name:"available",reason:"correction",ignoreCompareQuantity:false,quantities:[{inventoryItemId:$item,locationId:$loc,quantity:100,changeFromQuantity:0}]}}' \
  > "$E1_VARS"
E1=$(exec_cli store execute --allow-mutations --query 'mutation($input:InventorySetQuantitiesInput!){inventorySetQuantities(input:$input)@idempotent(key:"forgefit-e1"){userErrors{message code field}}}' --variable-file "$E1_VARS" --json)
contains "E1 ignoreCompareQuantity rejected"  "$E1" "ignoreCompareQuantity"
contains "E1 message matches log:625"          "$E1" "Field is not defined on InventorySetQuantitiesInput"

# Error #2: missing changeFromQuantity.
E2_VARS="$TMP/e2.json"
jq -n --arg item "${INVENTORY_ITEM_IDS[0]}" --arg loc "$LOC_ID" \
  '{input:{name:"available",reason:"correction",quantities:[{inventoryItemId:$item,locationId:$loc,quantity:100}]}}' \
  > "$E2_VARS"
E2=$(exec_cli store execute --allow-mutations --query 'mutation($input:InventorySetQuantitiesInput!){inventorySetQuantities(input:$input)@idempotent(key:"forgefit-e2"){userErrors{message code field}}}' --variable-file "$E2_VARS" --json)
contains "E2 message matches log:635"          "$E2" "InventoryQuantityInput must include the following argument: changeFromQuantity"

# Error #3: missing @idempotent directive.
E3_VARS="$TMP/e3.json"
jq -n --arg item "${INVENTORY_ITEM_IDS[0]}" --arg loc "$LOC_ID" \
  '{input:{name:"available",reason:"correction",quantities:[{inventoryItemId:$item,locationId:$loc,quantity:100,changeFromQuantity:0}]}}' \
  > "$E3_VARS"
E3=$(exec_cli store execute --allow-mutations --query 'mutation($input:InventorySetQuantitiesInput!){inventorySetQuantities(input:$input){userErrors{message code}}}' --variable-file "$E3_VARS" --json)
contains "E3 message matches log:649"          "$E3" "The @idempotent directive is required for this mutation but was not provided."

# ---------------------------------------------------------------------------
echo "=== Step 4c: happy-path inventorySet for 5 items (log:670-693) ==="
# ---------------------------------------------------------------------------
SET_KEY="forgefit-initial-inventory-20260529"
SET_VARS="$TMP/set.json"
jq -n --arg loc "$LOC_ID" --argjson items "$(printf '%s\n' "${INVENTORY_ITEM_IDS[@]}" | jq -Rcs 'split("\n") | map(select(length>0))')" \
  '{input:{name:"available",reason:"correction",quantities:($items | map({inventoryItemId:.,locationId:$loc,quantity:100,changeFromQuantity:0}))}}' \
  > "$SET_VARS"
SET_MUTATION='mutation($input:InventorySetQuantitiesInput!){inventorySetQuantities(input:$input)@idempotent(key:"'"$SET_KEY"'"){inventoryAdjustmentGroup{id reason changes{name delta quantityAfterChange}} userErrors{message}}}'
SET1=$(exec_cli store execute --allow-mutations --query "$SET_MUTATION" --variable-file "$SET_VARS" --json)
ADJ_ID1=$(echo "$SET1" | jq -r '.inventorySetQuantities.inventoryAdjustmentGroup.id')
AVAIL_COUNT=$(echo "$SET1" | jq -r '.inventorySetQuantities.inventoryAdjustmentGroup.changes | map(select(.name=="available" and .delta==100)) | length')
ONHAND_COUNT=$(echo "$SET1" | jq -r '.inventorySetQuantities.inventoryAdjustmentGroup.changes | map(select(.name=="on_hand" and .delta==100)) | length')
check "SET 5 available +100 deltas"            "$AVAIL_COUNT" "5"
check "SET 5 on_hand +100 deltas"              "$ONHAND_COUNT" "5"
[[ "$ADJ_ID1" == gid://shopify/InventoryAdjustmentGroup/* ]] && PASS=$((PASS+1)) || FAIL=$((FAIL+1))
printf "  %s adjustment group id minted\n" "$([[ "$ADJ_ID1" == gid://shopify/InventoryAdjustmentGroup/* ]] && echo PASS || echo FAIL)"

# Replay with same idempotency key → same adjustment group id.
SET2=$(exec_cli store execute --allow-mutations --query "$SET_MUTATION" --variable-file "$SET_VARS" --json)
ADJ_ID2=$(echo "$SET2" | jq -r '.inventorySetQuantities.inventoryAdjustmentGroup.id')
check "idempotency replay same id"             "$ADJ_ID2" "$ADJ_ID1"

# ---------------------------------------------------------------------------
echo "=== Step 5: 3 collections + add products (log:518-552) ==="
# ---------------------------------------------------------------------------
COL_MUTATION='mutation($input:CollectionInput!){collectionCreate(input:$input){collection{id title handle} userErrors{message}}}'
for cdef in "Home Gym Essentials|home-gym-essentials" "Strength Training|strength-training" "Mobility & Recovery|mobility-recovery"; do
  TITLE="${cdef%%|*}"; HANDLE="${cdef##*|}"
  VAR_FILE="$TMP/col-$HANDLE.json"
  jq -n --arg title "$TITLE" --arg handle "$HANDLE" \
    '{input:{title:$title,handle:$handle}}' > "$VAR_FILE"
  COL_OUT=$(exec_cli store execute --allow-mutations --query "$COL_MUTATION" --variable-file "$VAR_FILE" --json)
  CID=$(echo "$COL_OUT" | jq -r '.collectionCreate.collection.id')
  CHANDLE=$(echo "$COL_OUT" | jq -r '.collectionCreate.collection.handle')
  check "collection[$HANDLE] handle"           "$CHANDLE" "$HANDLE"
  [[ "$CID" == gid://shopify/Collection/* ]] && PASS=$((PASS+1)) || FAIL=$((FAIL+1))
  printf "  %s collection[$HANDLE] gid: %s\n" "$([[ "$CID" == gid://shopify/Collection/* ]] && echo PASS || echo FAIL)" "$CID"
  case "$HANDLE" in
    home-gym-essentials) CID_HOME="$CID" ;;
    strength-training)   CID_STRENGTH="$CID" ;;
    mobility-recovery)   CID_MOBILITY="$CID" ;;
  esac
done

# collectionAddProducts: all 5 → home-gym-essentials, Dumbbell+Kettlebell+PushUp → strength, Band+Mat → mobility.
CAP_MUTATION='mutation($id:ID!,$productIds:[ID!]!){collectionAddProducts(id:$id,productIds:$productIds){collection{id productsCount{count}} userErrors{message}}}'
HOME_VARS="$TMP/cap-home.json"; jq -n --arg id "$CID_HOME" --argjson pids "$(printf '%s\n' "${PRODUCT_IDS[@]}" | jq -Rcs 'split("\n") | map(select(length>0))')" '{id:$id,productIds:$pids}' > "$HOME_VARS"
CAP_HOME=$(exec_cli store execute --allow-mutations --query "$CAP_MUTATION" --variable-file "$HOME_VARS" --json)
check "home-gym-essentials productsCount=5"   "$(echo "$CAP_HOME" | jq -r '.collectionAddProducts.collection.productsCount.count')" "5"

STRENGTH_VARS="$TMP/cap-strength.json"; jq -n --arg id "$CID_STRENGTH" --argjson pids "$(printf '%s\n%s\n%s\n' "${PRODUCT_IDS[0]}" "${PRODUCT_IDS[3]}" "${PRODUCT_IDS[4]}" | jq -Rcs 'split("\n") | map(select(length>0))')" '{id:$id,productIds:$pids}' > "$STRENGTH_VARS"
CAP_STRENGTH=$(exec_cli store execute --allow-mutations --query "$CAP_MUTATION" --variable-file "$STRENGTH_VARS" --json)
check "strength-training productsCount=3"     "$(echo "$CAP_STRENGTH" | jq -r '.collectionAddProducts.collection.productsCount.count')" "3"

MOBILITY_VARS="$TMP/cap-mobility.json"; jq -n --arg id "$CID_MOBILITY" --argjson pids "$(printf '%s\n%s\n' "${PRODUCT_IDS[1]}" "${PRODUCT_IDS[2]}" | jq -Rcs 'split("\n") | map(select(length>0))')" '{id:$id,productIds:$pids}' > "$MOBILITY_VARS"
CAP_MOBILITY=$(exec_cli store execute --allow-mutations --query "$CAP_MUTATION" --variable-file "$MOBILITY_VARS" --json)
check "mobility-recovery productsCount=2"     "$(echo "$CAP_MOBILITY" | jq -r '.collectionAddProducts.collection.productsCount.count')" "2"

# ---------------------------------------------------------------------------
echo "=== Step 6: 3 pages (log:554-576) ==="
# ---------------------------------------------------------------------------
PAGE_MUTATION='mutation($page:PageCreateInput!){pageCreate(page:$page){page{id title handle} userErrors{message}}}'
for pdef in "About ForgeFit|about-forgefit" "Shipping & Returns|shipping-returns" "FAQ|faq"; do
  TITLE="${pdef%%|*}"; HANDLE="${pdef##*|}"
  VAR_FILE="$TMP/page-$HANDLE.json"
  jq -n --arg title "$TITLE" --arg handle "$HANDLE" '{page:{title:$title,handle:$handle,isPublished:true}}' > "$VAR_FILE"
  PAGE_OUT=$(exec_cli store execute --allow-mutations --query "$PAGE_MUTATION" --variable-file "$VAR_FILE" --json)
  check "page[$HANDLE] handle"                 "$(echo "$PAGE_OUT" | jq -r '.pageCreate.page.handle')" "$HANDLE"
  check "page[$HANDLE] title"                  "$(echo "$PAGE_OUT" | jq -r '.pageCreate.page.title')" "$TITLE"
done

# ---------------------------------------------------------------------------
echo "=== Step 7: 6 staged uploads + media bind + hero asset (log:783-924) ==="
# ---------------------------------------------------------------------------
# Six files: one hero + five product PNGs. We POST tiny byte strings — the
# mock doesn't validate image headers, and the smoke just needs the bytes to
# round-trip through the CDN.
PRODUCT_MEDIA_NAMES=("adjustable-dumbbell-set.png" "resistance-band-kit.png" "non-slip-training-mat.png" "cast-iron-kettlebell.png" "push-up-board.png")
PRODUCT_MEDIA_ALT=("ForgeFit Adjustable Dumbbell Set" "ForgeFit Resistance Band Kit" "ForgeFit Non-Slip Training Mat" "ForgeFit Cast Iron Kettlebell" "ForgeFit Push-Up Board")

# stagedUploadsCreate for all 6 in one batch (matches the helper script's bulk
# call in the log).
SU_VARS="$TMP/su.json"
jq -n '{input: [
  {resource:"IMAGE",filename:"forgefit-hero.png",mimeType:"image/png",fileSize:"42",httpMethod:"POST"},
  {resource:"IMAGE",filename:"adjustable-dumbbell-set.png",mimeType:"image/png",fileSize:"42",httpMethod:"POST"},
  {resource:"IMAGE",filename:"resistance-band-kit.png",mimeType:"image/png",fileSize:"42",httpMethod:"POST"},
  {resource:"IMAGE",filename:"non-slip-training-mat.png",mimeType:"image/png",fileSize:"42",httpMethod:"POST"},
  {resource:"IMAGE",filename:"cast-iron-kettlebell.png",mimeType:"image/png",fileSize:"42",httpMethod:"POST"},
  {resource:"IMAGE",filename:"push-up-board.png",mimeType:"image/png",fileSize:"42",httpMethod:"POST"}
]}' > "$SU_VARS"
SU_OUT=$(exec_cli store execute --allow-mutations --query 'mutation($input:[StagedUploadInput!]!){stagedUploadsCreate(input:$input){stagedTargets{url resourceUrl parameters{name value}} userErrors{message}}}' --variable-file "$SU_VARS" --json)
check "stagedUploads 6 targets"               "$(echo "$SU_OUT" | jq -r '.stagedUploadsCreate.stagedTargets | length')" "6"

# Upload bytes to each staged target. (Hero is index 0, products 1..5.)
for idx in 0 1 2 3 4 5; do
  URL=$(echo "$SU_OUT" | jq -r ".stagedUploadsCreate.stagedTargets[${idx}].url")
  FILE="$TMP/byte-${idx}.png"
  printf 'FAKE_FORGEFIT_BYTE_PAYLOAD_%02d_PNG_DATA' "$idx" > "$FILE"
  STATUS=$(curl -sS -X POST "$URL" --data-binary @"$FILE" -H 'content-type: image/png' -o /dev/null -w "%{http_code}")
  check "upload[$idx] HTTP 204"                "$STATUS" "204"
done

# productCreateMedia: bind each of the 5 product PNGs (indices 1..5) to the
# matching ForgeFit product.
PCM_MUTATION='mutation($productId:ID!,$media:[CreateMediaInput!]!){productCreateMedia(productId:$productId,media:$media){media{id status mediaContentType image{url}} userErrors{message}}}'
for i in 0 1 2 3 4; do
  RES_URL=$(echo "$SU_OUT" | jq -r ".stagedUploadsCreate.stagedTargets[$((i+1))].resourceUrl")
  VAR_FILE="$TMP/pcm-$i.json"
  jq -n --arg pid "${PRODUCT_IDS[$i]}" --arg src "$RES_URL" --arg alt "${PRODUCT_MEDIA_ALT[$i]}" \
    '{productId:$pid, media:[{originalSource:$src, mediaContentType:"IMAGE", alt:$alt}]}' > "$VAR_FILE"
  PCM_OUT=$(exec_cli store execute --allow-mutations --query "$PCM_MUTATION" --variable-file "$VAR_FILE" --json)
  check "media[$i] status READY"               "$(echo "$PCM_OUT" | jq -r '.productCreateMedia.media[0].status')" "READY"
  CDN_URL=$(echo "$PCM_OUT" | jq -r '.productCreateMedia.media[0].image.url')
  CDN_STATUS=$(curl -sS -o "$TMP/got-$i.png" -w "%{http_code}" "$CDN_URL")
  check "media[$i] CDN HTTP 200"               "$CDN_STATUS" "200"
  EXPECTED=$(printf 'FAKE_FORGEFIT_BYTE_PAYLOAD_%02d_PNG_DATA' "$((i+1))")
  check "media[$i] bytes match upload"         "$(cat "$TMP/got-$i.png")" "$EXPECTED"
done

# Hero PNG via themeFilesUpsert(assets/forgefit-hero.png) — matches log:944
# and proves the BASE64 body path for large binary assets works.
HERO_BYTES_FILE="$TMP/hero-bytes.bin"
printf 'FAKE_FORGEFIT_HERO_PNG_BYTES_FOR_REPLAY' > "$HERO_BYTES_FILE"
HERO_BASE64=$(base64 < "$HERO_BYTES_FILE" | tr -d '\n')
TFU_HERO_VARS="$TMP/tfu-hero.json"
jq -n --arg themeId "$MAIN_THEME_ID" --arg b64 "$HERO_BASE64" \
  '{themeId:$themeId, files:[{filename:"assets/forgefit-hero.png", body:{type:"BASE64", value:$b64}}]}' \
  > "$TFU_HERO_VARS"
TFU_HERO_MUTATION='mutation($themeId:ID!,$files:[OnlineStoreThemeFilesUpsertFileInput!]!){themeFilesUpsert(themeId:$themeId,files:$files){upsertedThemeFiles{filename} userErrors{message}}}'
TFU_HERO=$(exec_cli store execute --allow-mutations --query "$TFU_HERO_MUTATION" --variable-file "$TFU_HERO_VARS" --json)
check "hero upsert filename"                  "$(echo "$TFU_HERO" | jq -r '.themeFilesUpsert.upsertedThemeFiles[0].filename')" "assets/forgefit-hero.png"
check "hero upsert userErrors empty"           "$(echo "$TFU_HERO" | jq -r '.themeFilesUpsert.userErrors | length')" "0"
HERO_STATUS=$(curl -sS -o "$TMP/got-hero.png" -w "%{http_code}" "$B/assets/forgefit-hero.png")
check "GET /assets/forgefit-hero.png 200"      "$HERO_STATUS" "200"
check "hero bytes round-trip"                  "$(cat "$TMP/got-hero.png")" "$(cat "$HERO_BYTES_FILE")"

# ---------------------------------------------------------------------------
echo "=== Step 8: theme files: section + index template (log:940-997) ==="
# ---------------------------------------------------------------------------
# Section liquid carries a stable marker (`forgefit-hero-marker-2026D`) so we
# can grep it out of the rendered storefront HTML below.
SECTION_LIQUID='<section id="forgefit-hero" data-test="forgefit-hero-marker-2026D">
  <h1>Forge your strength at home.</h1>
  <p>Premium training gear for compact spaces, steady progress, and everyday strength.</p>
</section>
{% schema %}
{ "name": "ForgeFit home", "settings": [], "presets": [{"name": "ForgeFit home"}] }
{% endschema %}'
INDEX_JSON='{"sections":{"forgefit-home":{"type":"forgefit-home","settings":{}}},"order":["forgefit-home"]}'

TFU_THEME_VARS="$TMP/tfu-theme.json"
jq -n --arg themeId "$MAIN_THEME_ID" --arg section "$SECTION_LIQUID" --arg index "$INDEX_JSON" \
  '{themeId:$themeId, files:[
    {filename:"sections/forgefit-home.liquid", body:{type:"TEXT", value:$section}},
    {filename:"templates/index.json",          body:{type:"TEXT", value:$index}}
  ]}' > "$TFU_THEME_VARS"
TFU_THEME=$(exec_cli store execute --allow-mutations --query "$TFU_HERO_MUTATION" --variable-file "$TFU_THEME_VARS" --json)
check "theme upsert returned 2 files"          "$(echo "$TFU_THEME" | jq -r '.themeFilesUpsert.upsertedThemeFiles | length')" "2"

# theme(id) { files(filenames:[...]) } should now return all 3 ForgeFit files.
TQ_VARS="$TMP/theme-query.json"
jq -n --arg themeId "$MAIN_THEME_ID" \
  '{themeId:$themeId, filenames:["assets/forgefit-hero.png","sections/forgefit-home.liquid","templates/index.json"]}' \
  > "$TQ_VARS"
THEME_Q=$(exec_cli store execute --query 'query($themeId:ID!,$filenames:[String!]!){theme(id:$themeId){files(filenames:$filenames){nodes{filename size contentType} userErrors{message}}}}' --variable-file "$TQ_VARS" --json)
check "theme query returned 3 files"           "$(echo "$THEME_Q" | jq -r '.theme.files.nodes | length')" "3"
check "theme query userErrors empty"           "$(echo "$THEME_Q" | jq -r '.theme.files.userErrors | length')" "0"

# Storefront round-trip: GET / should render with the new section's marker.
STOREFRONT=$(curl -sS "$B/")
contains "GET / shows forgefit-hero marker"   "$STOREFRONT" "forgefit-hero-marker-2026D"
contains "GET / shows hero headline"           "$STOREFRONT" "Forge your strength at home."

# ---------------------------------------------------------------------------
echo "=== Step 9: re-auth with extra publish + nav scopes (log:1000-1051) ==="
# ---------------------------------------------------------------------------
FULL_SCOPES="${INIT_SCOPES},read_publications,write_publications,read_online_store_navigation,write_online_store_navigation"
REAUTH=$(exec_cli store auth --store "$STORE" --scopes "$FULL_SCOPES")
contains "re-auth printed Logged in"           "$REAUTH" "✔ Logged in."
contains "re-auth printed Authenticated as"    "$REAUTH" "✔ Authenticated as theheavens24@gmail.com against ${STORE}."

# Verify the union via currentAppInstallation. The mock unions scopes across
# all auth tokens for the same store, so write_publications + write_online_store_navigation
# show up alongside the original Phase-1 grant.
APPINST=$(exec_cli store execute --query '{ currentAppInstallation { id accessScopes { handle } } }' --json)
contains "scopes include write_publications"   "$APPINST" "write_publications"
contains "scopes include write_online_store_navigation" "$APPINST" "write_online_store_navigation"

# ---------------------------------------------------------------------------
echo "=== Step 10: publishablePublish 8 resources (log:1075-1116) ==="
# ---------------------------------------------------------------------------
PUB_MUTATION='mutation($id:ID!,$input:[PublicationInput!]!){publishablePublish(id:$id,input:$input){publishable{publicationCount} userErrors{message}}}'
ALL_RESOURCES=("${PRODUCT_IDS[@]}" "$CID_HOME" "$CID_STRENGTH" "$CID_MOBILITY")
for RID in "${ALL_RESOURCES[@]}"; do
  VAR_FILE="$TMP/pub-$(echo "$RID" | tr '/:' '_').json"
  jq -n --arg id "$RID" '{id:$id, input:[{publicationId:"gid://shopify/Publication/pub-online-store"}]}' > "$VAR_FILE"
  PUB_OUT=$(exec_cli store execute --allow-mutations --query "$PUB_MUTATION" --variable-file "$VAR_FILE" --json)
  check "publish[$(basename "$RID")] count=1"  "$(echo "$PUB_OUT" | jq -r '.publishablePublish.publishable.publicationCount')" "1"
done
# Re-publish first resource — idempotent, still count=1.
PUB_REPLAY=$(exec_cli store execute --allow-mutations --query "$PUB_MUTATION" --variable-file "$TMP/pub-$(echo "${ALL_RESOURCES[0]}" | tr '/:' '_').json" --json)
check "re-publish still count=1"               "$(echo "$PUB_REPLAY" | jq -r '.publishablePublish.publishable.publicationCount')" "1"

# ---------------------------------------------------------------------------
echo "=== Step 11: menuUpdate main + footer (log:1119-1190) ==="
# ---------------------------------------------------------------------------
# Look up main + footer menu gids first (we'll need them for menuUpdate(id:)).
MENU_LIST=$(exec_cli store execute --query '{ menus(first:10){nodes{id handle title}} }' --json)
MAIN_MENU_ID=$(echo "$MENU_LIST" | jq -r '.menus.nodes | map(select(.handle=="main-menu"))[0].id')
FOOTER_MENU_ID=$(echo "$MENU_LIST" | jq -r '.menus.nodes | map(select(.handle=="footer-menu"))[0].id')
[[ "$MAIN_MENU_ID" == gid://shopify/Menu/* ]] && PASS=$((PASS+1)) || FAIL=$((FAIL+1))
printf "  %s main-menu gid: %s\n" "$([[ "$MAIN_MENU_ID" == gid://shopify/Menu/* ]] && echo PASS || echo FAIL)" "$MAIN_MENU_ID"
[[ "$FOOTER_MENU_ID" == gid://shopify/Menu/* ]] && PASS=$((PASS+1)) || FAIL=$((FAIL+1))
printf "  %s footer-menu gid: %s\n" "$([[ "$FOOTER_MENU_ID" == gid://shopify/Menu/* ]] && echo PASS || echo FAIL)" "$FOOTER_MENU_ID"

MAIN_VARS="$TMP/menu-main.json"
jq -n --arg id "$MAIN_MENU_ID" '{id:$id, menu:{title:"Main menu", handle:"main-menu", items:[
  {title:"Home",      url:"/",                                  type:"FRONTPAGE"},
  {title:"Shop",      url:"/collections/home-gym-essentials",   type:"COLLECTION"},
  {title:"Strength",  url:"/collections/strength-training",     type:"COLLECTION"},
  {title:"Mobility",  url:"/collections/mobility-recovery",     type:"COLLECTION"},
  {title:"About",     url:"/pages/about-forgefit",              type:"PAGE"},
  {title:"FAQ",       url:"/pages/faq",                         type:"PAGE"}
]}}' > "$MAIN_VARS"
# The mock's MenuItem GraphQL node uses `title` + `url` (matches real Shopify);
# our internal storage normalises those to label/link but the response fields
# are the GraphQL-shape names. Select accordingly.
MENU_MUTATION='mutation($id:ID!,$menu:MenuUpdateInput!){menuUpdate(id:$id, menu:$menu){menu{id title handle items{title url type}} userErrors{message}}}'
MAIN_UPD=$(exec_cli store execute --allow-mutations --query "$MENU_MUTATION" --variable-file "$MAIN_VARS" --json)
check "main-menu items length=6"               "$(echo "$MAIN_UPD" | jq -r '.menuUpdate.menu.items | length')" "6"
check "main-menu first item title"             "$(echo "$MAIN_UPD" | jq -r '.menuUpdate.menu.items[0].title')" "Home"
check "main-menu Shop url"                     "$(echo "$MAIN_UPD" | jq -r '.menuUpdate.menu.items[1].url')" "/collections/home-gym-essentials"

FOOTER_VARS="$TMP/menu-footer.json"
jq -n --arg id "$FOOTER_MENU_ID" '{id:$id, menu:{title:"Footer menu", handle:"footer-menu", items:[
  {title:"Contact",            url:"/pages/contact",          type:"PAGE"},
  {title:"Shipping & Returns", url:"/pages/shipping-returns", type:"PAGE"},
  {title:"FAQ",                url:"/pages/faq",              type:"PAGE"},
  {title:"Search",             url:"/search",                 type:"SEARCH"}
]}}' > "$FOOTER_VARS"
FOOTER_UPD=$(exec_cli store execute --allow-mutations --query "$MENU_MUTATION" --variable-file "$FOOTER_VARS" --json)
check "footer-menu items length=4"             "$(echo "$FOOTER_UPD" | jq -r '.menuUpdate.menu.items | length')" "4"
check "footer-menu Search url"                 "$(echo "$FOOTER_UPD" | jq -r '.menuUpdate.menu.items[3].url')" "/search"

# Re-query menus to confirm both updates persisted (same title/url shape).
MENU_AFTER=$(exec_cli store execute --query '{ menus(first:10){nodes{handle title items{title url}}} }' --json)
contains "menus query has main-menu Strength" "$MENU_AFTER" "/collections/strength-training"
contains "menus query has footer Shipping"    "$MENU_AFTER" "shipping-returns"

# ---------------------------------------------------------------------------
echo "=== Step 12: final state snapshot (log:1272-1369) ==="
# ---------------------------------------------------------------------------
# Single query that pulls everything the log's final-state report touched.
FINAL_QUERY='query {
  products(first: 50) { nodes { id title handle status totalInventory media(first:5){nodes{status}} } }
  collections(first: 20) { nodes { handle title productsCount { count } } }
  menus(first: 10) { nodes { handle title items { label link } } }
  themes(first: 5) { nodes { id name role } }
}'
FINAL=$(exec_cli store execute --query "$FINAL_QUERY" --json)

# 5 ForgeFit products: all ACTIVE, totalInventory=100, media READY.
FORGEFIT_COUNT=$(echo "$FINAL" | jq -r '.products.nodes | map(select(.title | startswith("ForgeFit"))) | length')
check "5 ForgeFit products present"            "$FORGEFIT_COUNT" "5"
ACTIVE_COUNT=$(echo "$FINAL" | jq -r '.products.nodes | map(select((.title | startswith("ForgeFit")) and .status=="ACTIVE")) | length')
check "5 ForgeFit ACTIVE"                      "$ACTIVE_COUNT" "5"
INV100_COUNT=$(echo "$FINAL" | jq -r '.products.nodes | map(select((.title | startswith("ForgeFit")) and .totalInventory==100)) | length')
check "5 ForgeFit totalInventory=100"          "$INV100_COUNT" "5"
MEDIA_READY=$(echo "$FINAL" | jq -r '.products.nodes | map(select((.title | startswith("ForgeFit")) and (.media.nodes | map(select(.status=="READY")) | length) >= 1)) | length')
check "5 ForgeFit media READY"                 "$MEDIA_READY" "5"

# 3 ForgeFit collections with correct counts.
check "home-gym-essentials count=5"            "$(echo "$FINAL" | jq -r '.collections.nodes | map(select(.handle=="home-gym-essentials"))[0].productsCount.count')" "5"
check "strength-training count=3"              "$(echo "$FINAL" | jq -r '.collections.nodes | map(select(.handle=="strength-training"))[0].productsCount.count')" "3"
check "mobility-recovery count=2"              "$(echo "$FINAL" | jq -r '.collections.nodes | map(select(.handle=="mobility-recovery"))[0].productsCount.count')" "2"

# Main + footer menus have the 6 / 4 item counts from Step 11.
check "main-menu has 6 items"                  "$(echo "$FINAL" | jq -r '.menus.nodes | map(select(.handle=="main-menu"))[0].items | length')" "6"
check "footer-menu has 4 items"                "$(echo "$FINAL" | jq -r '.menus.nodes | map(select(.handle=="footer-menu"))[0].items | length')" "4"
# Customer account menu untouched (log:1352).
check "customer-account-main-menu still has 2 items" "$(echo "$FINAL" | jq -r '.menus.nodes | map(select(.handle=="customer-account-main-menu"))[0].items | length')" "2"

# Theme files: 3 ForgeFit files present with userErrors:[].
FINAL_THEME=$(exec_cli store execute --query 'query($themeId:ID!,$filenames:[String!]!){theme(id:$themeId){files(filenames:$filenames){nodes{filename contentType} userErrors{message}}}}' --variable-file "$TQ_VARS" --json)
check "final theme files 3 nodes"              "$(echo "$FINAL_THEME" | jq -r '.theme.files.nodes | length')" "3"
check "final theme userErrors:[]"              "$(echo "$FINAL_THEME" | jq -r '.theme.files.userErrors | length')" "0"
# Validate per-file contentType through the parsed structure (the response
# came back via --json so it's compact; jq sidesteps spacing concerns).
HERO_CT=$(echo "$FINAL_THEME" | jq -r '.theme.files.nodes | map(select(.filename=="assets/forgefit-hero.png"))[0].contentType')
SECTION_CT=$(echo "$FINAL_THEME" | jq -r '.theme.files.nodes | map(select(.filename=="sections/forgefit-home.liquid"))[0].contentType')
TPL_CT=$(echo "$FINAL_THEME" | jq -r '.theme.files.nodes | map(select(.filename=="templates/index.json"))[0].contentType')
check "assets/forgefit-hero.png contentType"   "$HERO_CT" "image/png"
check "sections/forgefit-home.liquid contentType" "$SECTION_CT" "application/x-liquid"
check "templates/index.json contentType"       "$TPL_CT" "application/json"

echo
echo "=== Summary ==="
echo "  PASS: $PASS"
echo "  FAIL: $FAIL"
if [[ $FAIL -eq 0 ]]; then
  echo "ForgeFit replay smoke green ✓ — v3 mock 1:1-reproduces the build trace."
  exit 0
fi
echo "ForgeFit replay smoke FAILED — see assertion list above."
exit 1
