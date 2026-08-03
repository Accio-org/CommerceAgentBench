#!/usr/bin/env bash
# smoke_test_wave2.sh — Wave 2 smoke tests for Amazon SP-API mock
#
# Tests: Orders v0 (10 ops) + FBA Inventory v1 + Feeds 2021-06-30 (6 ops)
#
# This script SPAWNS its own bun server on port 4002 (with default seed) and
# tears it down on exit. It does NOT depend on a pre-existing server.
#
# Smoke philosophy: written by an independent auditor of the Wave 2 route impl.
# If the impl has a real bug, the smoke test FAILS LOUDLY — that's the point.
# Do NOT loosen a check just to make it pass; bugs are tracked in
# /tmp/wave2_audit_report.md.
#
# DO NOT replace smoke_test.sh / smoke_test_wave1.sh — wave 0/1 tests stay.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${SMOKE_PORT:-4002}"
VERIFIER_TOKEN="mock-verifier"
BASE_URL="http://127.0.0.1:$PORT"

PASS=0
FAIL=0
TOTAL=0
ERRORS=()

green() { printf "\033[32m%s\033[0m\n" "$*"; }
red()   { printf "\033[31m%s\033[0m\n" "$*"; }
yellow(){ printf "\033[33m%s\033[0m\n" "$*"; }

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

check() {
  local description="$1"
  local result="$2"      # "pass" or "fail"
  local detail="${3:-}"
  TOTAL=$((TOTAL+1))
  if [[ "$result" == "pass" ]]; then
    green "  ✅ check $TOTAL: $description"
    PASS=$((PASS+1))
  else
    red "  ❌ check $TOTAL: $description"
    if [[ -n "$detail" ]]; then
      red "    → $detail"
    fi
    FAIL=$((FAIL+1))
    ERRORS+=("FAIL #$TOTAL: $description${detail:+ — $detail}")
  fi
}

# Capture both body and status code in one call.
# Usage: do_curl METHOD URL [body] [extra_curl_args...]
# Sets: RESP (response body), HTTP_CODE (HTTP status)
do_curl() {
  local method="$1"
  local url="$2"
  local body="${3:-}"
  if [[ $# -ge 3 ]]; then
    shift 3
  else
    shift $#
  fi
  local extra_args=("$@")

  if [[ -n "$body" ]]; then
    local tmpfile
    tmpfile=$(mktemp)
    printf '%s' "$body" > "$tmpfile"
    RESP=$(curl -s -w '\n__STATUS__%{http_code}' -X "$method" \
      -H "Content-Type: application/json" \
      -H "x-amz-access-token: test-token" \
      "${extra_args[@]+"${extra_args[@]}"}" \
      --data "@$tmpfile" \
      "$url") || { RESP=""; HTTP_CODE=0; rm -f "$tmpfile"; return 0; }
    rm -f "$tmpfile"
  else
    RESP=$(curl -s -w '\n__STATUS__%{http_code}' -X "$method" \
      -H "x-amz-access-token: test-token" \
      "${extra_args[@]+"${extra_args[@]}"}" \
      "$url") || { RESP=""; HTTP_CODE=0; return 0; }
  fi

  HTTP_CODE=$(echo "$RESP" | grep -o '__STATUS__[0-9]*' | sed 's/__STATUS__//')
  RESP=$(echo "$RESP" | sed 's/\n__STATUS__[0-9]*$//' | sed '$s/__STATUS__[0-9]*$//')
}

jq_val() {
  echo "$RESP" | jq -r "$1" 2>/dev/null || echo "<jq_error>"
}
jq_type() {
  echo "$RESP" | jq -r "$1 | type" 2>/dev/null || echo "<jq_error>"
}

# ---------------------------------------------------------------------------
# Spawn server
# ---------------------------------------------------------------------------

echo ""
echo "=== Amazon SP-API Mock Wave 2 — Smoke Test ==="
echo ""
echo "Booting bun server on :$PORT ..."

SERVER_LOG="$(mktemp)"
( cd "$SCRIPT_DIR" && PORT=$PORT MOCK_VERIFIER_TOKEN=$VERIFIER_TOKEN bun server.js > "$SERVER_LOG" 2>&1 ) &
SERVER_PID=$!
cleanup() {
  kill "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
  rm -f "$SERVER_LOG"
}
trap cleanup EXIT INT TERM

# Wait for server ready (max 30s)
for i in {1..60}; do
  if curl -fsS "$BASE_URL/__bench/health" >/dev/null 2>&1; then
    echo "Server ready on $BASE_URL"
    break
  fi
  sleep 0.5
  if [[ "$i" = "60" ]]; then
    red "ERROR: server did not become ready within 30s"
    cat "$SERVER_LOG"
    exit 1
  fi
done
echo ""

# ===========================================================================
# Section 1 — Feeds positive flow
# ===========================================================================
yellow "=== §1 Feeds — positive ==="

# 1a. createFeedDocument returns 201 + feedDocumentId + url
do_curl POST "$BASE_URL/feeds/2021-06-30/documents" '{"contentType":"text/xml; charset=UTF-8"}'
check "createFeedDocument returns HTTP 201" "$([ "$HTTP_CODE" = "201" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE body=$RESP"
FEED_DOC_ID=$(jq_val '.feedDocumentId')
check "createFeedDocument returns feedDocumentId" "$([ -n "$FEED_DOC_ID" ] && [ "$FEED_DOC_ID" != "null" ] && echo pass || echo fail)" "id=$FEED_DOC_ID"
UPLOAD_URL=$(jq_val '.url')
check "createFeedDocument returns url" "$([ -n "$UPLOAD_URL" ] && [ "$UPLOAD_URL" != "null" ] && echo pass || echo fail)" "url=$UPLOAD_URL"
# Anti-fabrication: encryptionDetails MUST NOT be present (2021-06-30 removed it)
ENCR=$(jq_val '.encryptionDetails')
check "createFeedDocument has NO encryptionDetails field (2021-06-30 removed it)" "$([ "$ENCR" = "null" ] && echo pass || echo fail)" "encryptionDetails=$ENCR"

# 1b. createFeed returns 202 + feedId
CREATE_FEED_BODY="{\"feedType\":\"POST_PRODUCT_DATA\",\"marketplaceIds\":[\"ATVPDKIKX0DER\"],\"inputFeedDocumentId\":\"$FEED_DOC_ID\"}"
do_curl POST "$BASE_URL/feeds/2021-06-30/feeds" "$CREATE_FEED_BODY"
check "createFeed returns HTTP 202 (not 200)" "$([ "$HTTP_CODE" = "202" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE body=$RESP"
FEED_ID_NEW=$(jq_val '.feedId')
check "createFeed returns feedId" "$([ -n "$FEED_ID_NEW" ] && [ "$FEED_ID_NEW" != "null" ] && echo pass || echo fail)" "feedId=$FEED_ID_NEW"

# 1c. getFeed immediately → IN_QUEUE
do_curl GET "$BASE_URL/feeds/2021-06-30/feeds/$FEED_ID_NEW"
check "getFeed (just created) returns HTTP 200" "$([ "$HTTP_CODE" = "200" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"
STATUS=$(jq_val '.processingStatus')
check "getFeed.processingStatus is IN_QUEUE just after createFeed" "$([ "$STATUS" = "IN_QUEUE" ] && echo pass || echo fail)" "status=$STATUS"
# No payload wrapper — Feed body is direct
HAS_PAYLOAD=$(echo "$RESP" | jq 'has("payload")' 2>/dev/null)
check "getFeed has NO payload wrapper (direct Feed object)" "$([ "$HAS_PAYLOAD" = "false" ] && echo pass || echo fail)" "has_payload=$HAS_PAYLOAD"
# Casing: feedId camelCase
HAS_FEEDID=$(echo "$RESP" | jq 'has("feedId")' 2>/dev/null)
check "getFeed has feedId (camelCase)" "$([ "$HAS_FEEDID" = "true" ] && echo pass || echo fail)" "has=$HAS_FEEDID"

# 1d. getFeeds list with pagination
do_curl GET "$BASE_URL/feeds/2021-06-30/feeds?feedTypes=POST_PRODUCT_DATA&pageSize=10"
check "getFeeds list returns 200" "$([ "$HTTP_CODE" = "200" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"
FEEDS_LEN=$(echo "$RESP" | jq '.feeds | length' 2>/dev/null)
check "getFeeds returns feeds array (≥1)" "$([ "${FEEDS_LEN:-0}" -ge 1 ] && echo pass || echo fail)" "len=$FEEDS_LEN"
# feeds key camelCase
HAS_FEEDS=$(echo "$RESP" | jq 'has("feeds")' 2>/dev/null)
check "getFeeds top-level has feeds (camelCase)" "$([ "$HAS_FEEDS" = "true" ] && echo pass || echo fail)" "has=$HAS_FEEDS"

# 1e. cancelFeed on IN_QUEUE → 200 empty body
do_curl DELETE "$BASE_URL/feeds/2021-06-30/feeds/$FEED_ID_NEW"
check "cancelFeed on IN_QUEUE feed returns 200" "$([ "$HTTP_CODE" = "200" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE body=$RESP"
# body should be {} (or empty)
TRIM_BODY=$(echo "$RESP" | tr -d ' \n\r')
check "cancelFeed response body is empty/{}" "$([ "$TRIM_BODY" = "{}" ] || [ -z "$TRIM_BODY" ] && echo pass || echo fail)" "body='$TRIM_BODY'"

# 1f. getFeed on cancelled feed → CANCELLED
do_curl GET "$BASE_URL/feeds/2021-06-30/feeds/$FEED_ID_NEW"
STATUS=$(jq_val '.processingStatus')
check "After cancelFeed: getFeed.processingStatus is CANCELLED" "$([ "$STATUS" = "CANCELLED" ] && echo pass || echo fail)" "status=$STATUS"

# 1g. getFeedDocument on seed result doc → 200
do_curl GET "$BASE_URL/feeds/2021-06-30/documents/seed-result-doc-001"
check "getFeedDocument (seed result doc) returns 200" "$([ "$HTTP_CODE" = "200" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"
URL_FIELD=$(jq_val '.url')
check "getFeedDocument returns url field" "$([ -n "$URL_FIELD" ] && [ "$URL_FIELD" != "null" ] && echo pass || echo fail)" "url=$URL_FIELD"
# encryptionDetails STILL absent
ENCR2=$(jq_val '.encryptionDetails')
check "getFeedDocument has NO encryptionDetails" "$([ "$ENCR2" = "null" ] && echo pass || echo fail)" "encr=$ENCR2"

# ===========================================================================
# Section 2 — FBA Inventory positive
# ===========================================================================
echo ""
yellow "=== §2 FBA Inventory — positive ==="

do_curl GET "$BASE_URL/fba/inventory/v1/summaries?granularityType=Marketplace&granularityId=ATVPDKIKX0DER&marketplaceIds=ATVPDKIKX0DER&details=true"
check "getInventorySummaries returns 200" "$([ "$HTTP_CODE" = "200" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"
# Response shape: { payload: {...}, pagination: {}, errors: [] }
HAS_PAYLOAD=$(echo "$RESP" | jq 'has("payload")' 2>/dev/null)
check "FBA response has top-level payload" "$([ "$HAS_PAYLOAD" = "true" ] && echo pass || echo fail)" "has=$HAS_PAYLOAD"
HAS_PAGINATION=$(echo "$RESP" | jq 'has("pagination")' 2>/dev/null)
check "FBA response has TOP-LEVEL pagination (SIBLING of payload, not nested inside)" "$([ "$HAS_PAGINATION" = "true" ] && echo pass || echo fail)" "has=$HAS_PAGINATION"
HAS_ERRORS=$(echo "$RESP" | jq 'has("errors")' 2>/dev/null)
check "FBA response has top-level errors" "$([ "$HAS_ERRORS" = "true" ] && echo pass || echo fail)" "has=$HAS_ERRORS"
# pagination NOT inside payload
NESTED_PAG=$(echo "$RESP" | jq '.payload | has("pagination")' 2>/dev/null)
check "FBA payload does NOT have nested pagination" "$([ "$NESTED_PAG" = "false" ] && echo pass || echo fail)" "nested=$NESTED_PAG"
# granularity present in payload
HAS_GRAN=$(echo "$RESP" | jq '.payload | has("granularity")' 2>/dev/null)
check "FBA payload has granularity" "$([ "$HAS_GRAN" = "true" ] && echo pass || echo fail)" "has=$HAS_GRAN"
GRAN_TYPE=$(jq_val '.payload.granularity.granularityType')
check "FBA granularity.granularityType is Marketplace" "$([ "$GRAN_TYPE" = "Marketplace" ] && echo pass || echo fail)" "type=$GRAN_TYPE"
# inventorySummaries array present
SUMS_LEN=$(echo "$RESP" | jq '.payload.inventorySummaries | length' 2>/dev/null)
check "FBA inventorySummaries[] is non-empty (seed)" "$([ "${SUMS_LEN:-0}" -ge 1 ] && echo pass || echo fail)" "len=$SUMS_LEN"
# Casing: asin lowercase
FIRST_ASIN=$(jq_val '.payload.inventorySummaries[0].asin')
check "FBA inventorySummaries[0].asin (lowercase casing) is non-empty" "$([ -n "$FIRST_ASIN" ] && [ "$FIRST_ASIN" != "null" ] && echo pass || echo fail)" "asin=$FIRST_ASIN"
# NOT ASIN uppercase
HAS_ASIN_UPPER=$(echo "$RESP" | jq '.payload.inventorySummaries[0] | has("ASIN")' 2>/dev/null)
check "FBA inventorySummaries[0] does NOT have ASIN (uppercase)" "$([ "$HAS_ASIN_UPPER" = "false" ] && echo pass || echo fail)" "has_upper=$HAS_ASIN_UPPER"
# fnSku and sellerSku camelCase
FIRST_FNSKU=$(jq_val '.payload.inventorySummaries[0].fnSku')
check "FBA inventorySummaries[0].fnSku (camelCase) is non-empty" "$([ -n "$FIRST_FNSKU" ] && [ "$FIRST_FNSKU" != "null" ] && echo pass || echo fail)" "fnSku=$FIRST_FNSKU"
FIRST_SKU=$(jq_val '.payload.inventorySummaries[0].sellerSku')
check "FBA inventorySummaries[0].sellerSku (camelCase) is non-empty" "$([ -n "$FIRST_SKU" ] && [ "$FIRST_SKU" != "null" ] && echo pass || echo fail)" "sellerSku=$FIRST_SKU"
# details=true → inventoryDetails present
HAS_DETAILS=$(echo "$RESP" | jq '.payload.inventorySummaries[0] | has("inventoryDetails")' 2>/dev/null)
check "FBA details=true → inventoryDetails present" "$([ "$HAS_DETAILS" = "true" ] && echo pass || echo fail)" "has=$HAS_DETAILS"

# 2b. details=false → inventoryDetails OMITTED
do_curl GET "$BASE_URL/fba/inventory/v1/summaries?granularityType=Marketplace&granularityId=ATVPDKIKX0DER&marketplaceIds=ATVPDKIKX0DER&details=false"
NO_DETAILS=$(echo "$RESP" | jq '.payload.inventorySummaries[0] | has("inventoryDetails")' 2>/dev/null)
check "FBA details=false → inventoryDetails KEY ABSENT" "$([ "$NO_DETAILS" = "false" ] && echo pass || echo fail)" "has=$NO_DETAILS"

# 2c. sellerSku filter
do_curl GET "$BASE_URL/fba/inventory/v1/summaries?granularityType=Marketplace&granularityId=ATVPDKIKX0DER&marketplaceIds=ATVPDKIKX0DER&sellerSku=BP-KB-2026-SG&details=true"
check "FBA sellerSku filter returns 200" "$([ "$HTTP_CODE" = "200" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"
FILTER_LEN=$(echo "$RESP" | jq '.payload.inventorySummaries | length' 2>/dev/null)
check "FBA sellerSku=BP-KB-2026-SG filter returns 1 item" "$([ "${FILTER_LEN:-0}" = "1" ] && echo pass || echo fail)" "len=$FILTER_LEN"
RET_SKU=$(jq_val '.payload.inventorySummaries[0].sellerSku')
check "FBA filtered item has correct sellerSku" "$([ "$RET_SKU" = "BP-KB-2026-SG" ] && echo pass || echo fail)" "sku=$RET_SKU"

# 2d. Missing granularityType → 400
do_curl GET "$BASE_URL/fba/inventory/v1/summaries?granularityId=ATVPDKIKX0DER&marketplaceIds=ATVPDKIKX0DER"
check "FBA missing granularityType → 400" "$([ "$HTTP_CODE" = "400" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"
ERR_CODE=$(jq_val '.errors[0].code')
check "FBA missing granularityType error code MissingParameter" "$([ "$ERR_CODE" = "MissingParameter" ] && echo pass || echo fail)" "code=$ERR_CODE"

# 2e. Missing granularityId → 400
do_curl GET "$BASE_URL/fba/inventory/v1/summaries?granularityType=Marketplace&marketplaceIds=ATVPDKIKX0DER"
check "FBA missing granularityId → 400" "$([ "$HTTP_CODE" = "400" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"

# 2f. Missing marketplaceIds → 400
do_curl GET "$BASE_URL/fba/inventory/v1/summaries?granularityType=Marketplace&granularityId=ATVPDKIKX0DER"
check "FBA missing marketplaceIds → 400" "$([ "$HTTP_CODE" = "400" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"

# ===========================================================================
# Section 3 — Orders v0 positive
# ===========================================================================
echo ""
yellow "=== §3 Orders v0 — positive ==="

# 3a. getOrders requires MarketplaceIds
do_curl GET "$BASE_URL/orders/v0/orders"
check "getOrders without MarketplaceIds → 400" "$([ "$HTTP_CODE" = "400" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"

# 3b. getOrders with MarketplaceIds → 200, payload wrapper, Orders[]
do_curl GET "$BASE_URL/orders/v0/orders?MarketplaceIds=ATVPDKIKX0DER&CreatedAfter=2024-01-01T00:00:00Z"
check "getOrders with MarketplaceIds → 200" "$([ "$HTTP_CODE" = "200" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"
HAS_PAYLOAD=$(echo "$RESP" | jq 'has("payload")' 2>/dev/null)
check "getOrders has payload wrapper (Orders v0 PascalCase convention)" "$([ "$HAS_PAYLOAD" = "true" ] && echo pass || echo fail)" "has=$HAS_PAYLOAD"
HAS_ORDERS=$(echo "$RESP" | jq '.payload | has("Orders")' 2>/dev/null)
check "getOrders payload has Orders (PascalCase) array" "$([ "$HAS_ORDERS" = "true" ] && echo pass || echo fail)" "has=$HAS_ORDERS"
ORDERS_LEN=$(echo "$RESP" | jq '.payload.Orders | length' 2>/dev/null)
check "getOrders Orders[] is non-empty (seed)" "$([ "${ORDERS_LEN:-0}" -ge 1 ] && echo pass || echo fail)" "len=$ORDERS_LEN"

# 3c. getOrder single
ORDER_ID="112-4567890-1234567"
do_curl GET "$BASE_URL/orders/v0/orders/$ORDER_ID"
check "getOrder single returns 200" "$([ "$HTTP_CODE" = "200" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"
RET_ORDER_ID=$(jq_val '.payload.AmazonOrderId')
check "getOrder payload.AmazonOrderId matches" "$([ "$RET_ORDER_ID" = "$ORDER_ID" ] && echo pass || echo fail)" "id=$RET_ORDER_ID"
# Order schema PascalCase
HAS_STATUS=$(echo "$RESP" | jq '.payload | has("OrderStatus")' 2>/dev/null)
check "getOrder has OrderStatus (PascalCase)" "$([ "$HAS_STATUS" = "true" ] && echo pass || echo fail)" "has=$HAS_STATUS"

# 3d. getOrderItems
do_curl GET "$BASE_URL/orders/v0/orders/$ORDER_ID/orderItems"
check "getOrderItems returns 200" "$([ "$HTTP_CODE" = "200" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"
ITEMS_LEN=$(echo "$RESP" | jq '.payload.OrderItems | length' 2>/dev/null)
check "getOrderItems OrderItems[] is non-empty" "$([ "${ITEMS_LEN:-0}" -ge 1 ] && echo pass || echo fail)" "len=$ITEMS_LEN"
RET_ASIN=$(jq_val '.payload.OrderItems[0].ASIN')
check "OrderItems[0].ASIN (uppercase) is present" "$([ -n "$RET_ASIN" ] && [ "$RET_ASIN" != "null" ] && echo pass || echo fail)" "ASIN=$RET_ASIN"
RET_SKU=$(jq_val '.payload.OrderItems[0].SellerSKU')
check "OrderItems[0].SellerSKU (PascalCase+UpperSku) is present" "$([ -n "$RET_SKU" ] && [ "$RET_SKU" != "null" ] && echo pass || echo fail)" "SellerSKU=$RET_SKU"

# 3e. getOrderBuyerInfo separate op
do_curl GET "$BASE_URL/orders/v0/orders/$ORDER_ID/buyerInfo"
check "getOrderBuyerInfo returns 200" "$([ "$HTTP_CODE" = "200" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"

# 3f. getOrderAddress separate op
do_curl GET "$BASE_URL/orders/v0/orders/$ORDER_ID/address"
check "getOrderAddress returns 200" "$([ "$HTTP_CODE" = "200" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"
HAS_ADDR=$(echo "$RESP" | jq '.payload | has("ShippingAddress")' 2>/dev/null)
check "getOrderAddress payload has ShippingAddress" "$([ "$HAS_ADDR" = "true" ] && echo pass || echo fail)" "has=$HAS_ADDR"

# 3g. getOrderRegulatedInfo
do_curl GET "$BASE_URL/orders/v0/orders/$ORDER_ID/regulatedInfo"
check "getOrderRegulatedInfo returns 200" "$([ "$HTTP_CODE" = "200" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"

# 3h. updateVerificationStatus PATCH /regulatedInfo
do_curl PATCH "$BASE_URL/orders/v0/orders/$ORDER_ID/regulatedInfo" '{"regulatedOrderVerificationStatus":"Approved"}'
# Swagger says 204; impl currently 200. Audit report logs this as a bug; we still
# accept either to surface the bug but not blow up.
# Per task instructions: "if a real bug exists, log it in audit report AND keep going (smoke can fail)"
# We mark it as STRICT: swagger says 204, so check fails until fixed.
check "updateVerificationStatus PATCH returns 204 (No Content) per swagger" "$([ "$HTTP_CODE" = "204" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE — BUG #1 in audit report (currently returns 200)"

# 3i. updateShipmentStatus POST /shipment
# This currently 500s due to ctx-not-defined bug; audit-logged.
do_curl POST "$BASE_URL/orders/v0/orders/$ORDER_ID/shipment" '{"marketplaceId":"ATVPDKIKX0DER","shipmentStatus":"PickedUp"}'
check "updateShipmentStatus POST /shipment returns 204 (No Content) per swagger" "$([ "$HTTP_CODE" = "204" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE — BUG #2 + #3 (ctx undefined + status 200 vs 204)"

# 3j. confirmShipment POST /shipmentConfirmation
do_curl POST "$BASE_URL/orders/v0/orders/$ORDER_ID/shipmentConfirmation" '{}'
check "confirmShipment POST /shipmentConfirmation returns 204 per swagger" "$([ "$HTTP_CODE" = "204" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE — BUG #4 + #5"

# ===========================================================================
# Section 4 — Money type (Orders v0 Amount = STRING)
# ===========================================================================
echo ""
yellow "=== §4 Money type ==="

do_curl GET "$BASE_URL/orders/v0/orders/$ORDER_ID"
AMT_TYPE=$(echo "$RESP" | jq '.payload.OrderTotal.Amount | type' 2>/dev/null)
check "Order OrderTotal.Amount type is STRING (Orders v0 trap)" "$([ "$AMT_TYPE" = '"string"' ] && echo pass || echo fail)" "type=$AMT_TYPE"
AMT_VAL=$(jq_val '.payload.OrderTotal.Amount')
check "Order OrderTotal.Amount matches expected '49.98'" "$([ "$AMT_VAL" = "49.98" ] && echo pass || echo fail)" "amount=$AMT_VAL"
CC_VAL=$(jq_val '.payload.OrderTotal.CurrencyCode')
check "Order OrderTotal.CurrencyCode is 'USD'" "$([ "$CC_VAL" = "USD" ] && echo pass || echo fail)" "cc=$CC_VAL"

# Also check OrderItem.ItemPrice.Amount is STRING
do_curl GET "$BASE_URL/orders/v0/orders/$ORDER_ID/orderItems"
IPA_TYPE=$(echo "$RESP" | jq '.payload.OrderItems[0].ItemPrice.Amount | type' 2>/dev/null)
check "OrderItem ItemPrice.Amount type is STRING" "$([ "$IPA_TYPE" = '"string"' ] && echo pass || echo fail)" "type=$IPA_TYPE"

# ===========================================================================
# Section 5 — Closed-set negative validation
# ===========================================================================
echo ""
yellow "=== §5 Closed-set negative ==="

# 5a. Bad feedType — Note: mock accepts any non-empty string for feedType (per
# fact sheet "feedType is open string but we validate non-empty"). The audit
# specifically tests that an OBVIOUSLY invalid input (empty string) is rejected,
# while keeping the closed-set check tight on known constraint fields.
do_curl POST "$BASE_URL/feeds/2021-06-30/feeds" '{"feedType":"","marketplaceIds":["ATVPDKIKX0DER"],"inputFeedDocumentId":"abc"}'
check "createFeed with empty feedType → 400" "$([ "$HTTP_CODE" = "400" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"

# 5b. createFeed missing marketplaceIds → 400
do_curl POST "$BASE_URL/feeds/2021-06-30/feeds" '{"feedType":"POST_PRODUCT_DATA","inputFeedDocumentId":"abc"}'
check "createFeed missing marketplaceIds → 400" "$([ "$HTTP_CODE" = "400" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"

# 5c. createFeed missing inputFeedDocumentId → 400
do_curl POST "$BASE_URL/feeds/2021-06-30/feeds" '{"feedType":"POST_PRODUCT_DATA","marketplaceIds":["ATVPDKIKX0DER"]}'
check "createFeed missing inputFeedDocumentId → 400" "$([ "$HTTP_CODE" = "400" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"

# 5d. Bad processingStatuses query value
do_curl GET "$BASE_URL/feeds/2021-06-30/feeds?feedTypes=POST_PRODUCT_DATA&processingStatuses=BOGUS"
check "getFeeds bad processingStatuses → 400" "$([ "$HTTP_CODE" = "400" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"
ERR_CODE=$(jq_val '.errors[0].code')
check "Bad processingStatuses error code InvalidInput" "$([ "$ERR_CODE" = "InvalidInput" ] && echo pass || echo fail)" "code=$ERR_CODE"

# 5e. Bad OrderStatuses filter
do_curl GET "$BASE_URL/orders/v0/orders?MarketplaceIds=ATVPDKIKX0DER&CreatedAfter=2024-01-01T00:00:00Z&OrderStatuses=BOGUS"
check "getOrders bad OrderStatus → 400" "$([ "$HTTP_CODE" = "400" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"
ERR_CODE=$(jq_val '.errors[0].code')
check "Bad OrderStatus error code InvalidInput" "$([ "$ERR_CODE" = "InvalidInput" ] && echo pass || echo fail)" "code=$ERR_CODE"

# 5f. Bad FulfillmentChannel
do_curl GET "$BASE_URL/orders/v0/orders?MarketplaceIds=ATVPDKIKX0DER&CreatedAfter=2024-01-01T00:00:00Z&FulfillmentChannels=BOGUS"
check "getOrders bad FulfillmentChannel → 400" "$([ "$HTTP_CODE" = "400" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"

# 5g. Bad PaymentMethod
do_curl GET "$BASE_URL/orders/v0/orders?MarketplaceIds=ATVPDKIKX0DER&CreatedAfter=2024-01-01T00:00:00Z&PaymentMethods=BogusPay"
check "getOrders bad PaymentMethod → 400" "$([ "$HTTP_CODE" = "400" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"

# 5h. Bad granularityType (anything other than Marketplace)
do_curl GET "$BASE_URL/fba/inventory/v1/summaries?granularityType=Country&granularityId=ATVPDKIKX0DER&marketplaceIds=ATVPDKIKX0DER"
check "FBA bad granularityType=Country → 400 (only 'Marketplace' valid)" "$([ "$HTTP_CODE" = "400" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"
ERR_CODE=$(jq_val '.errors[0].code')
check "Bad granularityType error code InvalidInput" "$([ "$ERR_CODE" = "InvalidInput" ] && echo pass || echo fail)" "code=$ERR_CODE"

# 5i. FBA marketplaceIds max-1 violation
do_curl GET "$BASE_URL/fba/inventory/v1/summaries?granularityType=Marketplace&granularityId=ATVPDKIKX0DER&marketplaceIds=ATVPDKIKX0DER,A1F83G8C2ARO7P"
check "FBA marketplaceIds>1 → 400 (max 1 item)" "$([ "$HTTP_CODE" = "400" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"

# 5j. PATCH /regulatedInfo with bad verificationStatus
do_curl PATCH "$BASE_URL/orders/v0/orders/$ORDER_ID/regulatedInfo" '{"regulatedOrderVerificationStatus":"BogusStatus"}'
check "PATCH bad verificationStatus → 400" "$([ "$HTTP_CODE" = "400" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"

# 5k. PATCH /regulatedInfo missing required field
do_curl PATCH "$BASE_URL/orders/v0/orders/$ORDER_ID/regulatedInfo" '{}'
check "PATCH /regulatedInfo missing field → 400" "$([ "$HTTP_CODE" = "400" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"

# 5l. getOrder with bad orderId format
do_curl GET "$BASE_URL/orders/v0/orders/INVALID-FORMAT"
check "getOrder bad orderId format → 400" "$([ "$HTTP_CODE" = "400" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"

# 5m. getOrder with well-formed but unknown orderId → 404
do_curl GET "$BASE_URL/orders/v0/orders/999-9999999-9999999"
check "getOrder unknown orderId → 404 ResourceNotFound" "$([ "$HTTP_CODE" = "404" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"
ERR_CODE=$(jq_val '.errors[0].code')
check "Unknown orderId error code ResourceNotFound" "$([ "$ERR_CODE" = "ResourceNotFound" ] && echo pass || echo fail)" "code=$ERR_CODE"

# 5n. getFeed unknown feedId → 404
do_curl GET "$BASE_URL/feeds/2021-06-30/feeds/99999999999"
check "getFeed unknown feedId → 404" "$([ "$HTTP_CODE" = "404" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"

# 5o. getFeedDocument unknown id → 404
do_curl GET "$BASE_URL/feeds/2021-06-30/documents/nonexistent-doc"
check "getFeedDocument unknown id → 404" "$([ "$HTTP_CODE" = "404" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"

# 5p. cancelFeed on already-DONE seed feed → 400
do_curl DELETE "$BASE_URL/feeds/2021-06-30/feeds/100000000000001"
check "cancelFeed on DONE feed → 400 (only IN_QUEUE cancellable)" "$([ "$HTTP_CODE" = "400" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"

# 5q. cancelFeed on FATAL seed feed → 400
do_curl DELETE "$BASE_URL/feeds/2021-06-30/feeds/100000000000002"
check "cancelFeed on FATAL feed → 400" "$([ "$HTTP_CODE" = "400" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"

# ===========================================================================
# Section 6 — Anti-fabrication (CRITICAL)
# ===========================================================================
echo ""
yellow "=== §6 Anti-fabrication ==="

# 6a. POST /fba/inventory/v1/items (sandbox-only, NOT implemented) → 404
do_curl POST "$BASE_URL/fba/inventory/v1/items" '{}'
check "POST /fba/inventory/v1/items → 404 (sandbox-only, NOT impl'd)" "$([ "$HTTP_CODE" = "404" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"

# 6b. DELETE /fba/inventory/v1/items/SKU → 404
do_curl DELETE "$BASE_URL/fba/inventory/v1/items/SOME-SKU"
check "DELETE /fba/inventory/v1/items/SKU → 404 (sandbox-only)" "$([ "$HTTP_CODE" = "404" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"

# 6c. POST /fba/inventory/v1/items/inventory → 404
do_curl POST "$BASE_URL/fba/inventory/v1/items/inventory" '{}'
check "POST /fba/inventory/v1/items/inventory → 404 (sandbox-only)" "$([ "$HTTP_CODE" = "404" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"

# 6d. POST /orders/v0/orders/{id}/regulatedInfo (real op is PATCH not POST) → 404
do_curl POST "$BASE_URL/orders/v0/orders/$ORDER_ID/regulatedInfo" '{"regulatedOrderVerificationStatus":"Approved"}'
check "POST /orders/v0/.../regulatedInfo → 404 (real op is PATCH)" "$([ "$HTTP_CODE" = "404" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"

# 6e. PUT /orders/v0/orders/{id}/regulatedInfo → 404
do_curl PUT "$BASE_URL/orders/v0/orders/$ORDER_ID/regulatedInfo" '{"regulatedOrderVerificationStatus":"Approved"}'
check "PUT /orders/v0/.../regulatedInfo → 404" "$([ "$HTTP_CODE" = "404" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"

# 6f. Verify NO route named updateOrderRegulatedInfo by checking help registry
do_curl GET "$BASE_URL/api/help"
HAS_OLD_OP=$(echo "$RESP" | grep -c 'updateOrderRegulatedInfo' || true)
check "Help registry has NO 'updateOrderRegulatedInfo' (real name = updateVerificationStatus)" "$([ "$HAS_OLD_OP" = "0" ] && echo pass || echo fail)" "occurrences=$HAS_OLD_OP"
HAS_NEW_OP=$(echo "$RESP" | grep -c 'updateVerificationStatus' || true)
check "Help registry mentions updateVerificationStatus" "$([ "$HAS_NEW_OP" -ge "1" ] && echo pass || echo fail)" "occurrences=$HAS_NEW_OP"

# 6g. Anti-fab: getFeed should NOT have encryptionDetails in response
do_curl GET "$BASE_URL/feeds/2021-06-30/documents/seed-result-doc-001"
ENCR=$(jq_val '.encryptionDetails')
check "getFeedDocument has NO encryptionDetails (anti-fab; 2020-09-04 only)" "$([ "$ENCR" = "null" ] && echo pass || echo fail)" "encr=$ENCR"

# 6h. Anti-fab: createFeed body without feedType → MissingParameter not InvalidPayload or fabricated code
do_curl POST "$BASE_URL/feeds/2021-06-30/feeds" '{"marketplaceIds":["ATVPDKIKX0DER"],"inputFeedDocumentId":"abc"}'
ERR_CODE=$(jq_val '.errors[0].code')
check "createFeed missing feedType uses standard SP-API code (MissingParameter or InvalidInput)" "$([ "$ERR_CODE" = "MissingParameter" ] || [ "$ERR_CODE" = "InvalidInput" ] && echo pass || echo fail)" "code=$ERR_CODE"

# ===========================================================================
# Section 7 — Bench endpoints
# ===========================================================================
echo ""
yellow "=== §7 Bench endpoints ==="

# 7a. /__bench/state without token → 401
do_curl GET "$BASE_URL/__bench/state"
check "/__bench/state without token → 401" "$([ "$HTTP_CODE" = "401" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"

# 7b. /__bench/state with WRONG token → 403
do_curl GET "$BASE_URL/__bench/state" "" -H "Authorization: Bearer WRONG-TOKEN"
check "/__bench/state with wrong token → 403" "$([ "$HTTP_CODE" = "403" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"

# 7c. /__bench/state with verifier token → 200 + orders/feeds/inventory non-empty
do_curl GET "$BASE_URL/__bench/state" "" -H "Authorization: Bearer $VERIFIER_TOKEN"
check "/__bench/state with verifier token → 200" "$([ "$HTTP_CODE" = "200" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"
ORDERS_KEYS=$(echo "$RESP" | jq '.orders | keys | length' 2>/dev/null)
check "bench/state orders non-empty (from seed)" "$([ "${ORDERS_KEYS:-0}" -ge 1 ] && echo pass || echo fail)" "len=$ORDERS_KEYS"
FEEDS_KEYS=$(echo "$RESP" | jq '.feeds | keys | length' 2>/dev/null)
check "bench/state feeds non-empty" "$([ "${FEEDS_KEYS:-0}" -ge 1 ] && echo pass || echo fail)" "len=$FEEDS_KEYS"
INV_KEYS=$(echo "$RESP" | jq '.inventorySummaries | keys | length' 2>/dev/null)
check "bench/state inventorySummaries non-empty" "$([ "${INV_KEYS:-0}" -ge 1 ] && echo pass || echo fail)" "len=$INV_KEYS"

# 7d. /__bench/advance with token → 200 (currently only takes ms, NOT feedId — audit bug #6)
do_curl POST "$BASE_URL/__bench/advance" '{"ms":1000}' -H "Authorization: Bearer $VERIFIER_TOKEN"
check "/__bench/advance with ms=1000 → 200" "$([ "$HTTP_CODE" = "200" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"

# 7e. /__bench/advance without token → 401
do_curl POST "$BASE_URL/__bench/advance" '{"ms":1000}'
check "/__bench/advance without token → 401" "$([ "$HTTP_CODE" = "401" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"

# 7f. /__bench/seed accepts inventory override
SEED_OVERRIDE='{"marketplaces":[{"id":"ATVPDKIKX0DER","name":"Amazon.com","countryCode":"US","defaultCurrencyCode":"USD","defaultLanguageCode":"en_US","domainName":"www.amazon.com"}],"sellers":[{"sellerId":"A2BENCH00001","name":"Bench Test Store"}],"inventorySummaries":[{"sellerId":"A2BENCH00001","marketplaceId":"ATVPDKIKX0DER","asin":"B0BENCH999","fnSku":"X001BENCH99","sellerSku":"OVERRIDE-SKU-001","condition":"NewItem","productName":"Override Test","totalQuantity":42,"lastUpdatedTime":"2026-05-29T00:00:00Z","stores":["ATVPDKIKX0DER"]}]}'
do_curl POST "$BASE_URL/__bench/seed" "$SEED_OVERRIDE" -H "Authorization: Bearer $VERIFIER_TOKEN"
check "/__bench/seed with inventory override → 200" "$([ "$HTTP_CODE" = "200" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"
OK_FIELD=$(jq_val '.ok')
check "/__bench/seed response has ok=true" "$([ "$OK_FIELD" = "true" ] && echo pass || echo fail)" "ok=$OK_FIELD"

# After seed override, FBA returns the new SKU
do_curl GET "$BASE_URL/fba/inventory/v1/summaries?granularityType=Marketplace&granularityId=ATVPDKIKX0DER&marketplaceIds=ATVPDKIKX0DER&details=false"
RET_SKU=$(jq_val '.payload.inventorySummaries[0].sellerSku')
check "After seed override: FBA inventory shows OVERRIDE-SKU-001" "$([ "$RET_SKU" = "OVERRIDE-SKU-001" ] && echo pass || echo fail)" "sku=$RET_SKU"

# 7g. /__bench/reset clears state
do_curl POST "$BASE_URL/__bench/reset" "" -H "Authorization: Bearer $VERIFIER_TOKEN"
check "/__bench/reset → 200" "$([ "$HTTP_CODE" = "200" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"

# After reset, getOrder should 404
do_curl GET "$BASE_URL/orders/v0/orders/$ORDER_ID"
check "After reset: getOrder seeded → 404" "$([ "$HTTP_CODE" = "404" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"

# 7h. /__bench/reset without token → 401
do_curl POST "$BASE_URL/__bench/reset" ''
check "/__bench/reset without token → 401" "$([ "$HTTP_CODE" = "401" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"

# 7i. /__bench/health is public (no token needed)
do_curl GET "$BASE_URL/__bench/health"
check "/__bench/health is public (no token) → 200" "$([ "$HTTP_CODE" = "200" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"

# Re-seed default for later tests
DEFAULT_SEED_PATH="$SCRIPT_DIR/seeds/default.json"
if [[ -f "$DEFAULT_SEED_PATH" ]]; then
  SEED_BODY=$(cat "$DEFAULT_SEED_PATH")
  do_curl POST "$BASE_URL/__bench/seed" "$SEED_BODY" -H "Authorization: Bearer $VERIFIER_TOKEN"
  check "Re-seed from default.json → 200" "$([ "$HTTP_CODE" = "200" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"
fi

# ===========================================================================
# Section 8 — Extra: Feeds nextToken-exclusive (loose validation per audit #7)
# ===========================================================================
echo ""
yellow "=== §8 Feeds pagination semantics ==="

# Generate a multi-page feed list using small pageSize (no filter → all 3 seed feeds → page 1 has nextToken)
do_curl GET "$BASE_URL/feeds/2021-06-30/feeds?pageSize=1"
check "getFeeds pageSize=1 (no filter) returns 200" "$([ "$HTTP_CODE" = "200" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"
NEXT_TOKEN=$(jq_val '.nextToken')
check "getFeeds pageSize=1 produces a nextToken (multi-page)" "$([ -n "$NEXT_TOKEN" ] && [ "$NEXT_TOKEN" != "null" ] && echo pass || echo fail)" "nextToken=$NEXT_TOKEN"
if [[ -n "$NEXT_TOKEN" && "$NEXT_TOKEN" != "null" ]]; then
  ENCODED_TOKEN=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$NEXT_TOKEN")
  do_curl GET "$BASE_URL/feeds/2021-06-30/feeds?nextToken=$ENCODED_TOKEN"
  check "getFeeds with nextToken (no other params) returns 200" "$([ "$HTTP_CODE" = "200" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"
fi

# ===========================================================================
# Section 9 — Cross-namespace: Order shipped, inventory reduced
# ===========================================================================
echo ""
yellow "=== §9 Cross-namespace coupling (Order→FBA) ==="

# Read inventory for BP-KB-2026-SG before shipment
do_curl GET "$BASE_URL/fba/inventory/v1/summaries?granularityType=Marketplace&granularityId=ATVPDKIKX0DER&marketplaceIds=ATVPDKIKX0DER&sellerSku=BP-KB-2026-SG&details=true"
BEFORE_FULFILL=$(jq_val '.payload.inventorySummaries[0].inventoryDetails.fulfillableQuantity')
check "Pre-ship: BP-KB-2026-SG.fulfillableQuantity is readable" "$([ -n "$BEFORE_FULFILL" ] && [ "$BEFORE_FULFILL" != "null" ] && echo pass || echo fail)" "before=$BEFORE_FULFILL"

# Try to ship order 112-4567890-1234567 which has BP-KB-2026-SG
do_curl POST "$BASE_URL/orders/v0/orders/$ORDER_ID/shipment" '{"marketplaceId":"ATVPDKIKX0DER"}'
SHIP_STATUS="$HTTP_CODE"
# Whether this succeeded (204/200) or 500'd (BUG #2), check what happened to inventory
do_curl GET "$BASE_URL/fba/inventory/v1/summaries?granularityType=Marketplace&granularityId=ATVPDKIKX0DER&marketplaceIds=ATVPDKIKX0DER&sellerSku=BP-KB-2026-SG&details=true"
AFTER_FULFILL=$(jq_val '.payload.inventorySummaries[0].inventoryDetails.fulfillableQuantity')
# If shipment succeeded, fulfillableQuantity should decrease. If it 500'd, no change.
if [[ "$SHIP_STATUS" = "204" ]] || [[ "$SHIP_STATUS" = "200" ]]; then
  check "Post-ship: fulfillableQuantity DECREASED (cross-namespace coupling works)" "$([ "$AFTER_FULFILL" -lt "$BEFORE_FULFILL" ] && echo pass || echo fail)" "before=$BEFORE_FULFILL after=$AFTER_FULFILL ship_status=$SHIP_STATUS"
else
  check "Cross-namespace coupling: shipment 500 means coupling untestable in current state" "fail" "ship_status=$SHIP_STATUS — BUG #2 (ctx not defined) blocks this entire test"
fi

# ===========================================================================
# Section 10 — Schema sanity: getFeed has resultFeedDocumentId only on DONE
# ===========================================================================
echo ""
yellow "=== §10 Feed schema sanity ==="

# Seed feed 100000000000001 is DONE with resultFeedDocumentId
do_curl GET "$BASE_URL/feeds/2021-06-30/feeds/100000000000001"
DONE_STATUS=$(jq_val '.processingStatus')
check "Seed feed 001 status is DONE" "$([ "$DONE_STATUS" = "DONE" ] && echo pass || echo fail)" "status=$DONE_STATUS"
HAS_RESULT_DOC=$(echo "$RESP" | jq 'has("resultFeedDocumentId")' 2>/dev/null)
check "DONE feed HAS resultFeedDocumentId" "$([ "$HAS_RESULT_DOC" = "true" ] && echo pass || echo fail)" "has=$HAS_RESULT_DOC"

# Seed feed 100000000000003 is IN_QUEUE — should NOT have resultFeedDocumentId
do_curl GET "$BASE_URL/feeds/2021-06-30/feeds/100000000000003"
INQUEUE_STATUS=$(jq_val '.processingStatus')
check "Seed feed 003 status is IN_QUEUE" "$([ "$INQUEUE_STATUS" = "IN_QUEUE" ] && echo pass || echo fail)" "status=$INQUEUE_STATUS"
NO_RESULT_DOC=$(echo "$RESP" | jq 'has("resultFeedDocumentId")' 2>/dev/null)
check "IN_QUEUE feed has NO resultFeedDocumentId (only on DONE)" "$([ "$NO_RESULT_DOC" = "false" ] && echo pass || echo fail)" "has=$NO_RESULT_DOC"

# ===========================================================================
# Summary
# ===========================================================================
echo ""
echo "=============================="
echo " Wave 2 Smoke Test Results"
echo "=============================="
green "  PASSED: $PASS / $TOTAL"
if [ "$FAIL" -gt 0 ]; then
  red "  FAILED: $FAIL"
  echo ""
  red "Failed checks:"
  for err in "${ERRORS[@]}"; do
    red "  $err"
  done
  echo ""
  red "Wave 2 smoke test FAILED ($FAIL/$TOTAL failed)"
  exit 1
else
  green "  FAILED: $FAIL"
  echo ""
  green "Wave 2 smoke test PASSED ($PASS/$TOTAL)"
  exit 0
fi
