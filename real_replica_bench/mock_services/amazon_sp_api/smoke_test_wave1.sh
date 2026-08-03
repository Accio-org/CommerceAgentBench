#!/usr/bin/env bash
# smoke_test_wave1.sh — Wave 1 smoke tests for Amazon SP-API mock
#
# Tests: Listings Items v2021-08-01 + Product Pricing v0 + Pricing v2022-05-01 + Product Fees v0
#
# Prerequisites: server running on localhost:4000 (MOCK_PORT default)
#   Start with: bun run server.js
#
# DO NOT replace smoke_test.sh — Wave 0 tests remain unchanged.
# Both smoke files must pass independently.

set -euo pipefail

# Resolve base URL: MOCK_BASE_URL takes priority; MOCK_PORT allows port override
_DEFAULT_PORT="${MOCK_PORT:-4000}"
BASE_URL="${MOCK_BASE_URL:-http://127.0.0.1:$_DEFAULT_PORT}"
PASS=0
FAIL=0
ERRORS=()

green() { printf "\033[32m%s\033[0m\n" "$*"; }
red()   { printf "\033[31m%s\033[0m\n" "$*"; }
yellow(){ printf "\033[33m%s\033[0m\n" "$*"; }

# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------

check() {
  local description="$1"
  local result="$2"      # "pass" or "fail"
  local detail="${3:-}"
  if [[ "$result" == "pass" ]]; then
    green "  ✓ $description"
    PASS=$((PASS+1))
  else
    red "  ✗ $description"
    if [[ -n "$detail" ]]; then
      red "    → $detail"
    fi
    FAIL=$((FAIL+1))
    ERRORS+=("FAIL: $description${detail:+ — $detail}")
  fi
}

# Perform a curl call and capture response + status code
# Usage: do_curl METHOD URL [body] [extra_curl_args...]
# Sets: RESP (response body), HTTP_CODE (status code)
do_curl() {
  local method="$1"
  local url="$2"
  local body="${3:-}"
  # Only shift if there are enough positional params
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
jq_len() {
  echo "$RESP" | jq "$1" 2>/dev/null | wc -c | tr -d ' '
}
resp_contains() {
  echo "$RESP" | grep -q "$1" && echo "pass" || echo "fail"
}
resp_not_contains() {
  echo "$RESP" | grep -q "$1" && echo "fail" || echo "pass"
}

# ---------------------------------------------------------------------------
# Wait for server to be ready (up to 15 s)
# ---------------------------------------------------------------------------

echo ""
echo "=== Amazon SP-API Mock Wave 1 — Smoke Test ==="
echo ""
echo "Waiting for server on $BASE_URL ..."
for i in {1..30}; do
  if curl -fsS "$BASE_URL/__bench/health" >/dev/null 2>&1; then
    echo "Server ready."
    break
  fi
  sleep 0.5
  if [ "$i" = "30" ]; then
    echo "ERROR: server did not become ready within 15s" >&2
    exit 1
  fi
done
echo ""

VERIFIER_TOKEN="${MOCK_VERIFIER_TOKEN:-bench-verifier}"

# ---------------------------------------------------------------------------
# Section 1: STATE PROPAGATION — THE CORE TEST
# ---------------------------------------------------------------------------

echo ""
yellow "=== Section 1: State Propagation (THE CORE TEST) ==="

# Reset, then reload the default seed so all sections start from known seeded state
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_SEED="$SCRIPT_DIR/seeds/default.json"
do_curl POST "$BASE_URL/__bench/reset" '{}' -H "Authorization: Bearer bench-verifier"
if [[ -f "$DEFAULT_SEED" ]]; then
  SEED_BODY=$(cat "$DEFAULT_SEED")
  do_curl POST "$BASE_URL/__bench/seed" "$SEED_BODY" -H "Authorization: Bearer bench-verifier"
fi

# 1a. PUT a new listing
SELLER="A2BENCH00001"
SKU="MYSKU-001"
MID="ATVPDKIKX0DER"
PUT_BODY='{"productType":"SHIRT","attributes":{"item_name":[{"value":"Test Shirt Blue","marketplace_id":"ATVPDKIKX0DER"}],"list_price":[{"value":19.99,"currency":"USD"}],"condition_type":[{"value":"new_new"}]}}'
do_curl PUT "$BASE_URL/listings/2021-08-01/items/$SELLER/$SKU?marketplaceIds=$MID" "$PUT_BODY"

check "PUT listing returns 200" "$([ "$HTTP_CODE" = "200" ] && echo pass || echo fail)" "HTTP $HTTP_CODE"
PUT_STATUS=$(jq_val '.status')
check "PUT listing status is ACCEPTED" "$([ "$PUT_STATUS" = "ACCEPTED" ] && echo pass || echo fail)" "status=$PUT_STATUS"
PUT_SKU=$(jq_val '.sku')
check "PUT listing response has correct sku" "$([ "$PUT_SKU" = "$SKU" ] && echo pass || echo fail)" "sku=$PUT_SKU"
PUT_SUBMISSION=$(jq_val '.submissionId')
check "PUT listing has submissionId" "$([ -n "$PUT_SUBMISSION" ] && [ "$PUT_SUBMISSION" != "null" ] && echo pass || echo fail)" "submissionId=$PUT_SUBMISSION"

# 1b. Immediately GET — must reflect new state
do_curl GET "$BASE_URL/listings/2021-08-01/items/$SELLER/$SKU?marketplaceIds=$MID&includedData=summaries,attributes"

check "GET listing after PUT returns 200" "$([ "$HTTP_CODE" = "200" ] && echo pass || echo fail)" "HTTP $HTTP_CODE"
GET_SKU=$(jq_val '.sku')
check "GET listing returns correct sku" "$([ "$GET_SKU" = "$SKU" ] && echo pass || echo fail)" "sku=$GET_SKU"
GET_PRODUCT_TYPE=$(jq_val '.summaries[0].productType')
check "GET listing summaries[0].productType is SHIRT" "$([ "$GET_PRODUCT_TYPE" = "SHIRT" ] && echo pass || echo fail)" "productType=$GET_PRODUCT_TYPE"
GET_STATUS_ARR=$(jq_val '.summaries[0].status[0]')
check "GET listing summaries[0].status is ARRAY (first element present)" "$([ -n "$GET_STATUS_ARR" ] && [ "$GET_STATUS_ARR" != "null" ] && echo pass || echo fail)" "status[0]=$GET_STATUS_ARR"
# Verify status is an array (not a scalar)
STATUS_IS_ARRAY=$(echo "$RESP" | jq '.summaries[0].status | type' 2>/dev/null)
check "GET listing summaries[0].status type is array (not scalar)" "$([ "$STATUS_IS_ARRAY" = '"array"' ] && echo pass || echo fail)" "type=$STATUS_IS_ARRAY"
# Verify attributes were stored
GET_ATTRS=$(jq_val '.attributes')
check "GET listing has attributes section" "$([ "$GET_ATTRS" != "null" ] && [ -n "$GET_ATTRS" ] && echo pass || echo fail)" "attributes=$(echo "$GET_ATTRS" | head -c 60)"

# 1c. PATCH listing to change price
PATCH_BODY='{"productType":"SHIRT","patches":[{"op":"replace","path":"/attributes/list_price","value":[{"value":24.99,"currency":"USD"}]}]}'
do_curl PATCH "$BASE_URL/listings/2021-08-01/items/$SELLER/$SKU?marketplaceIds=$MID" "$PATCH_BODY"

check "PATCH listing returns 200" "$([ "$HTTP_CODE" = "200" ] && echo pass || echo fail)" "HTTP $HTTP_CODE"
PATCH_STATUS=$(jq_val '.status')
check "PATCH listing status is ACCEPTED" "$([ "$PATCH_STATUS" = "ACCEPTED" ] && echo pass || echo fail)" "status=$PATCH_STATUS"
PATCH_SKU=$(jq_val '.sku')
check "PATCH listing response has correct sku" "$([ "$PATCH_SKU" = "$SKU" ] && echo pass || echo fail)" "sku=$PATCH_SKU"

# 1d. Re-GET — must reflect patched price
do_curl GET "$BASE_URL/listings/2021-08-01/items/$SELLER/$SKU?marketplaceIds=$MID&includedData=attributes,summaries"

check "GET listing after PATCH returns 200" "$([ "$HTTP_CODE" = "200" ] && echo pass || echo fail)" "HTTP $HTTP_CODE"
PATCHED_PRICE=$(jq_val '.attributes.list_price[0].value')
check "GET listing attributes.list_price[0].value reflects patched 24.99" "$([ "$PATCHED_PRICE" = "24.99" ] && echo pass || echo fail)" "price=$PATCHED_PRICE"

# 1e. DELETE
do_curl DELETE "$BASE_URL/listings/2021-08-01/items/$SELLER/$SKU?marketplaceIds=$MID"

check "DELETE listing returns 200" "$([ "$HTTP_CODE" = "200" ] && echo pass || echo fail)" "HTTP $HTTP_CODE"
DEL_STATUS=$(jq_val '.status')
check "DELETE listing status is ACCEPTED" "$([ "$DEL_STATUS" = "ACCEPTED" ] && echo pass || echo fail)" "status=$DEL_STATUS"
DEL_SKU=$(jq_val '.sku')
check "DELETE listing response has sku" "$([ "$DEL_SKU" = "$SKU" ] && echo pass || echo fail)" "sku=$DEL_SKU"

# 1f. Subsequent GET must return 404
do_curl GET "$BASE_URL/listings/2021-08-01/items/$SELLER/$SKU?marketplaceIds=$MID"

check "GET deleted listing returns 404" "$([ "$HTTP_CODE" = "404" ] && echo pass || echo fail)" "HTTP $HTTP_CODE"
NOT_FOUND_CODE=$(jq_val '.errors[0].code')
check "404 error code is ResourceNotFound" "$([ "$NOT_FOUND_CODE" = "ResourceNotFound" ] && echo pass || echo fail)" "code=$NOT_FOUND_CODE"

# ---------------------------------------------------------------------------
# Section 2: PATCH Validation (CLAUDE.md rule #10)
# ---------------------------------------------------------------------------

echo ""
yellow "=== Section 2: PATCH Validation (Closed-Set op Enum) ==="

# Re-create listing for PATCH validation tests
do_curl PUT "$BASE_URL/listings/2021-08-01/items/$SELLER/$SKU?marketplaceIds=$MID" "$PUT_BODY"

# 2a. Pass op="move" (not in this API's enum)
BAD_OP_BODY='{"productType":"SHIRT","patches":[{"op":"move","from":"/attributes/brand","path":"/attributes/brand_name"}]}'
do_curl PATCH "$BASE_URL/listings/2021-08-01/items/$SELLER/$SKU?marketplaceIds=$MID" "$BAD_OP_BODY"

check "PATCH op=move returns 400" "$([ "$HTTP_CODE" = "400" ] && echo pass || echo fail)" "HTTP $HTTP_CODE"
BAD_OP_CODE=$(jq_val '.errors[0].code')
check "PATCH op=move error code is InvalidInput" "$([ "$BAD_OP_CODE" = "InvalidInput" ] && echo pass || echo fail)" "code=$BAD_OP_CODE"

# 2b. Pass op="add" without value
NO_VALUE_BODY='{"productType":"SHIRT","patches":[{"op":"add","path":"/attributes/color"}]}'
do_curl PATCH "$BASE_URL/listings/2021-08-01/items/$SELLER/$SKU?marketplaceIds=$MID" "$NO_VALUE_BODY"

check "PATCH op=add without value returns 400" "$([ "$HTTP_CODE" = "400" ] && echo pass || echo fail)" "HTTP $HTTP_CODE"

# 2c. Missing productType in PATCH body
NO_PT_BODY='{"patches":[{"op":"replace","path":"/attributes/color","value":["Blue"]}]}'
do_curl PATCH "$BASE_URL/listings/2021-08-01/items/$SELLER/$SKU?marketplaceIds=$MID" "$NO_PT_BODY"

check "PATCH without productType returns 400" "$([ "$HTTP_CODE" = "400" ] && echo pass || echo fail)" "HTTP $HTTP_CODE"
NO_PT_CODE=$(jq_val '.errors[0].code')
check "Missing productType error is MissingParameter" "$([ "$NO_PT_CODE" = "MissingParameter" ] && echo pass || echo fail)" "code=$NO_PT_CODE"

# 2d. Valid PATCH with op="delete" (no value required)
DELETE_OP_BODY='{"productType":"SHIRT","patches":[{"op":"delete","path":"/attributes/color"}]}'
do_curl PATCH "$BASE_URL/listings/2021-08-01/items/$SELLER/$SKU?marketplaceIds=$MID" "$DELETE_OP_BODY"

check "PATCH op=delete (valid, no value needed) returns 200" "$([ "$HTTP_CODE" = "200" ] && echo pass || echo fail)" "HTTP $HTTP_CODE"

# 2e. Valid PATCH with op="merge"
MERGE_OP_BODY='{"productType":"SHIRT","patches":[{"op":"merge","path":"/attributes/item_name","value":[{"value":"Merged Shirt","marketplace_id":"ATVPDKIKX0DER"}]}]}'
do_curl PATCH "$BASE_URL/listings/2021-08-01/items/$SELLER/$SKU?marketplaceIds=$MID" "$MERGE_OP_BODY"

check "PATCH op=merge (non-standard Amazon op) returns 200" "$([ "$HTTP_CODE" = "200" ] && echo pass || echo fail)" "HTTP $HTTP_CODE"

# Delete test listing
do_curl DELETE "$BASE_URL/listings/2021-08-01/items/$SELLER/$SKU?marketplaceIds=$MID"

# ---------------------------------------------------------------------------
# Section 3: searchListingsItems (pagination, seeded data)
# ---------------------------------------------------------------------------

echo ""
yellow "=== Section 3: searchListingsItems ==="

do_curl GET "$BASE_URL/listings/2021-08-01/items/$SELLER?marketplaceIds=$MID"

check "searchListingsItems returns 200" "$([ "$HTTP_CODE" = "200" ] && echo pass || echo fail)" "HTTP $HTTP_CODE"
SEARCH_TOTAL=$(jq_val '.numberOfResults')
check "searchListingsItems has numberOfResults" "$([ "$SEARCH_TOTAL" -gt 0 ] 2>/dev/null && echo pass || echo fail)" "numberOfResults=$SEARCH_TOTAL"
SEARCH_ITEMS=$(echo "$RESP" | jq '.items | length' 2>/dev/null)
check "searchListingsItems items array is present" "$([ "${SEARCH_ITEMS:-0}" -gt 0 ] && echo pass || echo fail)" "items.length=$SEARCH_ITEMS"
# Verify no payload wrapper
NO_PAYLOAD=$(echo "$RESP" | jq 'has("payload")' 2>/dev/null)
check "searchListingsItems has NO payload wrapper" "$([ "$NO_PAYLOAD" = "false" ] && echo pass || echo fail)" "has_payload=$NO_PAYLOAD"

# ---------------------------------------------------------------------------
# Section 4: Fee Estimation
# ---------------------------------------------------------------------------

echo ""
yellow "=== Section 4: Fee Estimation ==="

# 4a. Single SKU fee estimate
FEE_SKU_BODY='{"FeesEstimateRequest":{"MarketplaceId":"ATVPDKIKX0DER","IsAmazonFulfilled":true,"PriceToEstimateFees":{"ListingPrice":{"CurrencyCode":"USD","Amount":29.99}},"Identifier":"req-001"}}'
do_curl POST "$BASE_URL/products/fees/v0/listings/BP-KB-2026-SG/feesEstimate" "$FEE_SKU_BODY"

check "getMyFeesEstimateForSKU returns 200" "$([ "$HTTP_CODE" = "200" ] && echo pass || echo fail)" "HTTP $HTTP_CODE"
FEE_STATUS=$(jq_val '.payload.FeesEstimateResult.Status')
check "Fee estimate status is Success" "$([ "$FEE_STATUS" = "Success" ] && echo pass || echo fail)" "Status=$FEE_STATUS"
TOTAL_FEE=$(jq_val '.payload.FeesEstimateResult.FeesEstimate.TotalFeesEstimate.Amount')
check "TotalFeesEstimate.Amount is non-zero number" "$(echo "$TOTAL_FEE" | grep -Eq '^[0-9]+(\.[0-9]+)?$' && [ "$(echo "$TOTAL_FEE > 0" | bc -l 2>/dev/null || echo 0)" = "1" ] && echo pass || echo fail)" "Amount=$TOTAL_FEE"
# Amount must be a number type (not a string) — verify by checking no quotes in jq output
AMOUNT_TYPE=$(echo "$RESP" | jq '.payload.FeesEstimateResult.FeesEstimate.TotalFeesEstimate.Amount | type' 2>/dev/null)
check "TotalFeesEstimate.Amount is number type (not string)" "$([ "$AMOUNT_TYPE" = '"number"' ] && echo pass || echo fail)" "type=$AMOUNT_TYPE"
SELLER_INPUT_ID=$(jq_val '.payload.FeesEstimateResult.FeesEstimateIdentifier.SellerInputIdentifier')
check "SellerInputIdentifier echoed from Identifier field" "$([ "$SELLER_INPUT_ID" = "req-001" ] && echo pass || echo fail)" "SellerInputIdentifier=$SELLER_INPUT_ID"

# 4b. MFN fees should differ from FBA fees
FEE_MFN_BODY='{"FeesEstimateRequest":{"MarketplaceId":"ATVPDKIKX0DER","IsAmazonFulfilled":false,"PriceToEstimateFees":{"ListingPrice":{"CurrencyCode":"USD","Amount":29.99}},"Identifier":"req-002"}}'
do_curl POST "$BASE_URL/products/fees/v0/listings/BP-KB-2026-SG/feesEstimate" "$FEE_MFN_BODY"

check "getMyFeesEstimateForSKU MFN returns 200" "$([ "$HTTP_CODE" = "200" ] && echo pass || echo fail)" "HTTP $HTTP_CODE"
MFN_TOTAL_FEE=$(jq_val '.payload.FeesEstimateResult.FeesEstimate.TotalFeesEstimate.Amount')
check "MFN TotalFee differs from FBA (MFN has no FBAFees)" "$(echo "$MFN_TOTAL_FEE < $TOTAL_FEE" | bc -l 2>/dev/null | grep -q 1 && echo pass || echo fail)" "MFN=$MFN_TOTAL_FEE vs FBA=$TOTAL_FEE"

# 4c. Single ASIN fee estimate
FEE_ASIN_BODY='{"FeesEstimateRequest":{"MarketplaceId":"ATVPDKIKX0DER","IsAmazonFulfilled":true,"PriceToEstimateFees":{"ListingPrice":{"CurrencyCode":"USD","Amount":89.99}},"Identifier":"req-asin-001"}}'
do_curl POST "$BASE_URL/products/fees/v0/items/B0BENCH001/feesEstimate" "$FEE_ASIN_BODY"

check "getMyFeesEstimateForASIN returns 200" "$([ "$HTTP_CODE" = "200" ] && echo pass || echo fail)" "HTTP $HTTP_CODE"
ASIN_ID_TYPE=$(jq_val '.payload.FeesEstimateResult.FeesEstimateIdentifier.IdType')
check "ASIN fee estimate IdType is ASIN" "$([ "$ASIN_ID_TYPE" = "ASIN" ] && echo pass || echo fail)" "IdType=$ASIN_ID_TYPE"

# 4d. Batch fee estimate — BARE ARRAY request and response
BATCH_FEE_BODY='[{"FeesEstimateRequest":{"MarketplaceId":"ATVPDKIKX0DER","IsAmazonFulfilled":true,"PriceToEstimateFees":{"ListingPrice":{"CurrencyCode":"USD","Amount":29.99}},"Identifier":"item-001"},"IdType":"SellerSKU","IdValue":"BP-KB-2026-SG"},{"FeesEstimateRequest":{"MarketplaceId":"ATVPDKIKX0DER","IsAmazonFulfilled":false,"PriceToEstimateFees":{"ListingPrice":{"CurrencyCode":"USD","Amount":19.99}},"Identifier":"item-002"},"IdType":"ASIN","IdValue":"B0BENCH002"}]'
do_curl POST "$BASE_URL/products/fees/v0/feesEstimate" "$BATCH_FEE_BODY"

check "getMyFeesEstimates (batch) returns 200" "$([ "$HTTP_CODE" = "200" ] && echo pass || echo fail)" "HTTP $HTTP_CODE"
# Response must be a bare array, NOT wrapped in {payload: ...}
IS_ARRAY=$(echo "$RESP" | jq 'type' 2>/dev/null)
check "Batch fee response is bare array (no payload wrapper)" "$([ "$IS_ARRAY" = '"array"' ] && echo pass || echo fail)" "type=$IS_ARRAY"
BATCH_LEN=$(echo "$RESP" | jq 'length' 2>/dev/null)
check "Batch fee response length matches request (2 items)" "$([ "$BATCH_LEN" = "2" ] && echo pass || echo fail)" "length=$BATCH_LEN"
BATCH_STATUS_0=$(echo "$RESP" | jq -r '.[0].Status' 2>/dev/null)
check "Batch fee response[0].Status is Success" "$([ "$BATCH_STATUS_0" = "Success" ] && echo pass || echo fail)" "Status=$BATCH_STATUS_0"

# 4e. Validation: invalid request body shape (object not array) for batch
do_curl POST "$BASE_URL/products/fees/v0/feesEstimate" '{"requests":[]}'
check "Batch fee with object body (not array) returns 400" "$([ "$HTTP_CODE" = "400" ] && echo pass || echo fail)" "HTTP $HTTP_CODE"

# ---------------------------------------------------------------------------
# Section 5: Pricing v0
# ---------------------------------------------------------------------------

echo ""
yellow "=== Section 5: Product Pricing v0 ==="

# 5a. getPricing by Asin
do_curl GET "$BASE_URL/products/pricing/v0/price?MarketplaceId=$MID&Asins=B0BENCH001&ItemType=Asin"

check "getPricing returns 200" "$([ "$HTTP_CODE" = "200" ] && echo pass || echo fail)" "HTTP $HTTP_CODE"
# payload must be an ARRAY
PRICING_PAYLOAD_TYPE=$(echo "$RESP" | jq '.payload | type' 2>/dev/null)
check "getPricing payload is ARRAY" "$([ "$PRICING_PAYLOAD_TYPE" = '"array"' ] && echo pass || echo fail)" "type=$PRICING_PAYLOAD_TYPE"
PRICING_STATUS=$(jq_val '.payload[0].status')
check "getPricing payload[0].status is Success" "$([ "$PRICING_STATUS" = "Success" ] && echo pass || echo fail)" "status=$PRICING_STATUS"
# ASIN is uppercase in payload (PascalCase)
PRICING_ASIN=$(jq_val '.payload[0].ASIN')
check "getPricing payload[0].ASIN is uppercase" "$([ "$PRICING_ASIN" = "B0BENCH001" ] && echo pass || echo fail)" "ASIN=$PRICING_ASIN"
# Amount must be a number (not a string)
PRICING_AMOUNT=$(echo "$RESP" | jq '.payload[0].Product.Offers[0].BuyingPrice.ListingPrice.Amount' 2>/dev/null)
PRICING_AMOUNT_TYPE=$(echo "$RESP" | jq '.payload[0].Product.Offers[0].BuyingPrice.ListingPrice.Amount | type' 2>/dev/null)
check "getPricing MoneyType.Amount is number (not string)" "$([ "$PRICING_AMOUNT_TYPE" = '"number"' ] && echo pass || echo fail)" "type=$PRICING_AMOUNT_TYPE, value=$PRICING_AMOUNT"

# 5b. getItemOffers — payload is a SINGLE OBJECT (not array)
do_curl GET "$BASE_URL/products/pricing/v0/items/B0BENCH001/offers?MarketplaceId=$MID&ItemCondition=New"

check "getItemOffers returns 200" "$([ "$HTTP_CODE" = "200" ] && echo pass || echo fail)" "HTTP $HTTP_CODE"
OFFERS_PAYLOAD_TYPE=$(echo "$RESP" | jq '.payload | type' 2>/dev/null)
check "getItemOffers payload is OBJECT (not array)" "$([ "$OFFERS_PAYLOAD_TYPE" = '"object"' ] && echo pass || echo fail)" "type=$OFFERS_PAYLOAD_TYPE"
# marketplaceId is camelCase in GetOffersResult (mixed-casing fact)
OFFERS_MID=$(jq_val '.payload.marketplaceId')
check "getItemOffers payload.marketplaceId is camelCase" "$([ "$OFFERS_MID" = "$MID" ] && echo pass || echo fail)" "marketplaceId=$OFFERS_MID"
# ItemCondition is PascalCase (mixed-casing)
OFFERS_ITEM_COND=$(jq_val '.payload.ItemCondition')
check "getItemOffers payload.ItemCondition is PascalCase" "$([ "$OFFERS_ITEM_COND" = "New" ] && echo pass || echo fail)" "ItemCondition=$OFFERS_ITEM_COND"
# Amount is number
OFFERS_AMOUNT_TYPE=$(echo "$RESP" | jq '.payload.Summary.BuyBoxPrices[0].LandedPrice.Amount | type' 2>/dev/null)
check "getItemOffers MoneyType.Amount is number" "$([ "$OFFERS_AMOUNT_TYPE" = '"number"' ] && echo pass || echo fail)" "type=$OFFERS_AMOUNT_TYPE"

# 5c. getCompetitivePricing — CompetitivePriceId values are strings "1"/"2"
do_curl GET "$BASE_URL/products/pricing/v0/competitivePrice?MarketplaceId=$MID&Asins=B0BENCH001&ItemType=Asin"

check "getCompetitivePricing returns 200" "$([ "$HTTP_CODE" = "200" ] && echo pass || echo fail)" "HTTP $HTTP_CODE"
COMP_PRICE_ID=$(jq_val '.payload[0].Product.CompetitivePricing.CompetitivePrices[0].CompetitivePriceId')
check "CompetitivePriceId is string '1' (not integer)" "$([ "$COMP_PRICE_ID" = "1" ] && echo pass || echo fail)" "value=$COMP_PRICE_ID"
COMP_PRICE_ID_TYPE=$(echo "$RESP" | jq '.payload[0].Product.CompetitivePricing.CompetitivePrices[0].CompetitivePriceId | type' 2>/dev/null)
check "CompetitivePriceId type is string (fact sheet: strings, not integers)" "$([ "$COMP_PRICE_ID_TYPE" = '"string"' ] && echo pass || echo fail)" "type=$COMP_PRICE_ID_TYPE"
# condition and belongsToRequester are camelCase (mixed-casing in same response)
COMP_CONDITION=$(jq_val '.payload[0].Product.CompetitivePricing.CompetitivePrices[0].condition')
check "CompetitivePrices[0].condition is camelCase (mixed-casing fact)" "$([ "$COMP_CONDITION" = "New" ] && echo pass || echo fail)" "condition=$COMP_CONDITION"

# 5d. getListingOffers — path param is PascalCase SellerSKU
do_curl GET "$BASE_URL/products/pricing/v0/listings/BP-KB-2026-SG/offers?MarketplaceId=$MID&ItemCondition=New"

check "getListingOffers (PascalCase path param SellerSKU) returns 200" "$([ "$HTTP_CODE" = "200" ] && echo pass || echo fail)" "HTTP $HTTP_CODE"
LIST_OFFERS_TYPE=$(echo "$RESP" | jq '.payload | type' 2>/dev/null)
check "getListingOffers payload is OBJECT (not array)" "$([ "$LIST_OFFERS_TYPE" = '"object"' ] && echo pass || echo fail)" "type=$LIST_OFFERS_TYPE"

# 5e. Missing MarketplaceId → 400
do_curl GET "$BASE_URL/products/pricing/v0/price?Asins=B0BENCH001&ItemType=Asin"
check "getPricing without MarketplaceId returns 400" "$([ "$HTTP_CODE" = "400" ] && echo pass || echo fail)" "HTTP $HTTP_CODE"

# 5f. Invalid ItemCondition → 400
do_curl GET "$BASE_URL/products/pricing/v0/items/B0BENCH001/offers?MarketplaceId=$MID&ItemCondition=Perfect"
check "getItemOffers with invalid ItemCondition returns 400" "$([ "$HTTP_CODE" = "400" ] && echo pass || echo fail)" "HTTP $HTTP_CODE"

# 5g. Batch getItemOffersBatch
BATCH_ITEM_BODY='{"requests":[{"uri":"/products/pricing/v0/items/B0BENCH001/offers","method":"GET","MarketplaceId":"ATVPDKIKX0DER","ItemCondition":"New","Asin":"B0BENCH001"}]}'
do_curl POST "$BASE_URL/batches/products/pricing/v0/itemOffers" "$BATCH_ITEM_BODY"
check "getItemOffersBatch returns 200" "$([ "$HTTP_CODE" = "200" ] && echo pass || echo fail)" "HTTP $HTTP_CODE"
BATCH_RESP_TYPE=$(echo "$RESP" | jq '.responses | type' 2>/dev/null)
check "getItemOffersBatch has responses array" "$([ "$BATCH_RESP_TYPE" = '"array"' ] && echo pass || echo fail)" "type=$BATCH_RESP_TYPE"
BATCH_STATUS_CODE=$(echo "$RESP" | jq '.responses[0].status.statusCode' 2>/dev/null)
check "getItemOffersBatch responses[0].status.statusCode is 200" "$([ "$BATCH_STATUS_CODE" = "200" ] && echo pass || echo fail)" "statusCode=$BATCH_STATUS_CODE"

# ---------------------------------------------------------------------------
# Section 6: Pricing v2022-05-01 — getCompetitiveSummary (THIS endpoint, not /catalog/)
# ---------------------------------------------------------------------------

echo ""
yellow "=== Section 6: Product Pricing v2022-05-01 ==="

# 6a. getCompetitiveSummary lives under /batches/products/pricing/2022-05-01/
COMP_SUMMARY_BODY='{"requests":[{"uri":"/products/pricing/2022-05-01/items/B0BENCH001/competitiveSummary","method":"GET","asin":"B0BENCH001","marketplaceId":"ATVPDKIKX0DER","includedData":["featuredBuyingOptions","referencePrices","lowestPricedOffers"]}]}'
do_curl POST "$BASE_URL/batches/products/pricing/2022-05-01/items/competitiveSummary" "$COMP_SUMMARY_BODY"

check "getCompetitiveSummary returns 200" "$([ "$HTTP_CODE" = "200" ] && echo pass || echo fail)" "HTTP $HTTP_CODE"
CS_RESP_TYPE=$(echo "$RESP" | jq '.responses | type' 2>/dev/null)
check "getCompetitiveSummary has responses array" "$([ "$CS_RESP_TYPE" = '"array"' ] && echo pass || echo fail)" "type=$CS_RESP_TYPE"
CS_BODY_ASIN=$(echo "$RESP" | jq -r '.responses[0].body.asin' 2>/dev/null)
check "getCompetitiveSummary body.asin is camelCase" "$([ "$CS_BODY_ASIN" = "B0BENCH001" ] && echo pass || echo fail)" "asin=$CS_BODY_ASIN"
CS_FULFILLMENT=$(echo "$RESP" | jq -r '.responses[0].body.lowestPricedOffers[0].lowestPricedOffersInput.fulfillmentType' 2>/dev/null)
check "getCompetitiveSummary fulfillmentType is AFN/MFN (not Amazon/Merchant)" "$([ "$CS_FULFILLMENT" = "AFN" ] || [ "$CS_FULFILLMENT" = "MFN" ] && echo pass || echo fail)" "fulfillmentType=$CS_FULFILLMENT"
# v2022 money uses camelCase {amount, currencyCode}
CS_AMOUNT_FIELD=$(echo "$RESP" | jq -r '.responses[0].body.referencePrices[0].price | keys | sort | join(",")' 2>/dev/null)
check "v2022-05-01 MoneyType has camelCase keys (amount, currencyCode)" "$(echo "$CS_AMOUNT_FIELD" | grep -q "amount" && echo "$CS_AMOUNT_FIELD" | grep -q "currencyCode" && echo pass || echo fail)" "keys=$CS_AMOUNT_FIELD"

# 6b. Confirm /catalog/2022-04-01/items/{asin}/competitiveSummary returns 404 (anti-fabrication)
do_curl GET "$BASE_URL/catalog/2022-04-01/items/B0BENCH001/competitiveSummary?marketplaceIds=$MID"
check "Anti-fabrication: /catalog/.../competitiveSummary returns 404" "$([ "$HTTP_CODE" = "404" ] && echo pass || echo fail)" "HTTP $HTTP_CODE"

# 6c. Invalid includedData → 400
BAD_CS_BODY='{"requests":[{"uri":"/products/pricing/2022-05-01/items/B0BENCH001/competitiveSummary","method":"GET","asin":"B0BENCH001","marketplaceId":"ATVPDKIKX0DER","includedData":["invalidSection"]}]}'
do_curl POST "$BASE_URL/batches/products/pricing/2022-05-01/items/competitiveSummary" "$BAD_CS_BODY"
check "getCompetitiveSummary with invalid includedData returns sub-400 in responses" "$([ "$HTTP_CODE" = "200" ] && echo pass || echo fail)" "HTTP $HTTP_CODE (outer 200, per-item error in body)"
CS_ITEM_STATUS=$(echo "$RESP" | jq '.responses[0].status.statusCode' 2>/dev/null)
check "getCompetitiveSummary invalid includedData sub-response statusCode is 400" "$([ "$CS_ITEM_STATUS" = "400" ] && echo pass || echo fail)" "statusCode=$CS_ITEM_STATUS"

# 6d. getFeaturedOfferExpectedPriceBatch
FOEP_BODY='{"requests":[{"uri":"/products/pricing/2022-05-01/offer/featuredOfferExpectedPrice","method":"GET","marketplaceId":"ATVPDKIKX0DER","sku":"BP-KB-2026-SG"}]}'
do_curl POST "$BASE_URL/batches/products/pricing/2022-05-01/offer/featuredOfferExpectedPrice" "$FOEP_BODY"

check "getFeaturedOfferExpectedPriceBatch returns 200" "$([ "$HTTP_CODE" = "200" ] && echo pass || echo fail)" "HTTP $HTTP_CODE"
FOEP_STATUS=$(echo "$RESP" | jq '.responses[0].status.statusCode' 2>/dev/null)
check "getFeaturedOfferExpectedPriceBatch responses[0].status.statusCode is 200" "$([ "$FOEP_STATUS" = "200" ] && echo pass || echo fail)" "statusCode=$FOEP_STATUS"
FOEP_RESULT_STATUS=$(echo "$RESP" | jq -r '.responses[0].body.featuredOfferExpectedPriceResults[0].resultStatus' 2>/dev/null)
check "FOEP resultStatus is one of valid values" "$(echo "$FOEP_RESULT_STATUS" | grep -Eq 'VALID_FOEP|NO_COMPETING_OFFER|OFFER_NOT_ELIGIBLE|OFFER_NOT_FOUND' && echo pass || echo fail)" "resultStatus=$FOEP_RESULT_STATUS"
# fulfillmentType in v2022-05-01 must be AFN or MFN (not Amazon/Merchant)
FOEP_FULFILL=$(echo "$RESP" | jq -r '.responses[0].body.offerIdentifier.fulfillmentType' 2>/dev/null)
check "FOEP offerIdentifier.fulfillmentType is AFN or MFN" "$([ "$FOEP_FULFILL" = "AFN" ] || [ "$FOEP_FULFILL" = "MFN" ] && echo pass || echo fail)" "fulfillmentType=$FOEP_FULFILL"

# ---------------------------------------------------------------------------
# Section 7: Mutation reflected in /__bench/state
# ---------------------------------------------------------------------------

echo ""
yellow "=== Section 7: State Mutation Reflected in /__bench/state ==="

# Get initial listing count
do_curl GET "$BASE_URL/__bench/state" "" -H "Authorization: Bearer bench-verifier"
INITIAL_LISTINGS=$(jq_val '.counts.listings')
check "/__bench/state accessible with verifier token" "$([ "$HTTP_CODE" = "200" ] && echo pass || echo fail)" "HTTP $HTTP_CODE"

# PUT a listing
do_curl PUT "$BASE_URL/listings/2021-08-01/items/$SELLER/STATE-TEST-SKU?marketplaceIds=$MID" "$PUT_BODY"
check "PUT STATE-TEST-SKU returns 200" "$([ "$HTTP_CODE" = "200" ] && echo pass || echo fail)" "HTTP $HTTP_CODE"

# Check state after PUT
do_curl GET "$BASE_URL/__bench/state" "" -H "Authorization: Bearer bench-verifier"
AFTER_PUT_LISTINGS=$(jq_val '.counts.listings')
check "/__bench/state.counts.listings increased after PUT" "$([ "$AFTER_PUT_LISTINGS" -gt "$INITIAL_LISTINGS" ] 2>/dev/null && echo pass || echo fail)" "before=$INITIAL_LISTINGS after=$AFTER_PUT_LISTINGS"

# DELETE the listing
do_curl DELETE "$BASE_URL/listings/2021-08-01/items/$SELLER/STATE-TEST-SKU?marketplaceIds=$MID"

# Check state after DELETE
do_curl GET "$BASE_URL/__bench/state" "" -H "Authorization: Bearer bench-verifier"
AFTER_DELETE_LISTINGS=$(jq_val '.counts.listings')
check "/__bench/state.counts.listings back to original after DELETE" "$([ "$AFTER_DELETE_LISTINGS" -eq "$INITIAL_LISTINGS" ] 2>/dev/null && echo pass || echo fail)" "expected=$INITIAL_LISTINGS got=$AFTER_DELETE_LISTINGS"

# ---------------------------------------------------------------------------
# Section 8: /api/help shows 6 namespaces
# ---------------------------------------------------------------------------

echo ""
yellow "=== Section 8: /api/help Coverage ==="

do_curl GET "$BASE_URL/api/help"

check "/api/help returns 200" "$([ "$HTTP_CODE" = "200" ] && echo pass || echo fail)" "HTTP $HTTP_CODE"
HELP_NS=$(jq_val '.coverage.namespaces')
# >= 6 (not == 6): Wave 1 brought the family count to 6; later waves only add
# namespaces, so this assertion must not pin the exact total.
check "/api/help shows >= 6 namespaces" "$([ "${HELP_NS:-0}" -ge 6 ] 2>/dev/null && echo pass || echo fail)" "namespaces=$HELP_NS"
HELP_ENDPOINTS=$(jq_val '.coverage.endpoints')
check "/api/help shows >= 16 endpoints" "$([ "${HELP_ENDPOINTS:-0}" -ge 16 ] 2>/dev/null && echo pass || echo fail)" "endpoints=$HELP_ENDPOINTS"
# Verify Wave 1 namespace names appear
check "/api/help has 'Listings Items' namespace" "$(resp_contains 'Listings Items')" ""
check "/api/help has 'Product Pricing' namespace" "$(resp_contains 'Product Pricing')" ""
check "/api/help has 'Product Fees' namespace" "$(resp_contains 'Product Fees')" ""

# ---------------------------------------------------------------------------
# Section 9: Anti-fabrication preserve (Wave 0 invented endpoints must still 404)
# ---------------------------------------------------------------------------

echo ""
yellow "=== Section 9: Anti-Fabrication — Invented Endpoints Stay 404 ==="

# Wave 0 anti-fabrication endpoints
do_curl GET "$BASE_URL/catalog/2022-04-01/items/B0BENCH001/searchSuggestions?marketplaceIds=$MID"
check "Anti-fabrication: /searchSuggestions returns 404" "$([ "$HTTP_CODE" = "404" ] && echo pass || echo fail)" "HTTP $HTTP_CODE"

do_curl GET "$BASE_URL/catalog/2022-04-01/items/B0BENCH001/competitiveSummary?marketplaceIds=$MID"
check "Anti-fabrication: /catalog/.../competitiveSummary returns 404" "$([ "$HTTP_CODE" = "404" ] && echo pass || echo fail)" "HTTP $HTTP_CODE"

do_curl GET "$BASE_URL/listings/2021-08-01/items/$SELLER/$SKU/submissions?marketplaceIds=$MID"
check "Anti-fabrication: /listings/.../submissions returns 404" "$([ "$HTTP_CODE" = "404" ] && echo pass || echo fail)" "HTTP $HTTP_CODE"

# ---------------------------------------------------------------------------
# Section 10: Edge cases and additional validation
# ---------------------------------------------------------------------------

echo ""
yellow "=== Section 10: Edge Cases ==="

# 10a. PUT missing productType
do_curl PUT "$BASE_URL/listings/2021-08-01/items/$SELLER/EDGE-001?marketplaceIds=$MID" '{"attributes":{"brand":"test"}}'
check "PUT without productType returns 400" "$([ "$HTTP_CODE" = "400" ] && echo pass || echo fail)" "HTTP $HTTP_CODE"

# 10b. PUT without attributes
do_curl PUT "$BASE_URL/listings/2021-08-01/items/$SELLER/EDGE-001?marketplaceIds=$MID" '{"productType":"SHIRT"}'
check "PUT without attributes returns 400" "$([ "$HTTP_CODE" = "400" ] && echo pass || echo fail)" "HTTP $HTTP_CODE"

# 10c. PUT missing marketplaceIds
do_curl PUT "$BASE_URL/listings/2021-08-01/items/$SELLER/EDGE-001" "$PUT_BODY"
check "PUT without marketplaceIds returns 400" "$([ "$HTTP_CODE" = "400" ] && echo pass || echo fail)" "HTTP $HTTP_CODE"

# 10d. GET listing with unknown marketplace → 400
do_curl GET "$BASE_URL/listings/2021-08-01/items/$SELLER/EDGE-001?marketplaceIds=ZZZZZZZZZZ"
check "GET listing with unknown marketplace returns 400" "$([ "$HTTP_CODE" = "400" ] && echo pass || echo fail)" "HTTP $HTTP_CODE"

# 10e. VALIDATION_PREVIEW mode on PUT — doesn't persist
do_curl PUT "$BASE_URL/listings/2021-08-01/items/$SELLER/PREVIEW-SKU?marketplaceIds=$MID&mode=VALIDATION_PREVIEW" "$PUT_BODY"
check "PUT with mode=VALIDATION_PREVIEW returns 200" "$([ "$HTTP_CODE" = "200" ] && echo pass || echo fail)" "HTTP $HTTP_CODE"
PREVIEW_STATUS=$(jq_val '.status')
check "VALIDATION_PREVIEW status is VALID (not ACCEPTED)" "$([ "$PREVIEW_STATUS" = "VALID" ] && echo pass || echo fail)" "status=$PREVIEW_STATUS"
# Verify it wasn't persisted
do_curl GET "$BASE_URL/listings/2021-08-01/items/$SELLER/PREVIEW-SKU?marketplaceIds=$MID"
check "VALIDATION_PREVIEW listing not persisted (GET returns 404)" "$([ "$HTTP_CODE" = "404" ] && echo pass || echo fail)" "HTTP $HTTP_CODE"

# 10f. Fees: missing FeesEstimateRequest wrapper key
do_curl POST "$BASE_URL/products/fees/v0/listings/BP-KB-2026-SG/feesEstimate" '{"marketplaceId":"ATVPDKIKX0DER","identifier":"x"}'
check "Fee estimate with missing FeesEstimateRequest key returns 400" "$([ "$HTTP_CODE" = "400" ] && echo pass || echo fail)" "HTTP $HTTP_CODE"

# 10g. Fees: Amount as string (should fail)
BAD_AMOUNT_BODY='{"FeesEstimateRequest":{"MarketplaceId":"ATVPDKIKX0DER","PriceToEstimateFees":{"ListingPrice":{"CurrencyCode":"USD","Amount":"29.99"}},"Identifier":"x"}}'
do_curl POST "$BASE_URL/products/fees/v0/listings/BP-KB-2026-SG/feesEstimate" "$BAD_AMOUNT_BODY"
check "Fee estimate with Amount as string (not number) returns 400" "$([ "$HTTP_CODE" = "400" ] && echo pass || echo fail)" "HTTP $HTTP_CODE"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

echo ""
echo "============================="
echo " Wave 1 Smoke Test Results"
echo "============================="
green "  PASSED: $PASS"
if [ "$FAIL" -gt 0 ]; then
  red "  FAILED: $FAIL"
  echo ""
  red "Failed checks:"
  for err in "${ERRORS[@]}"; do
    red "  $err"
  done
  echo ""
  red "Wave 1 smoke test FAILED ($FAIL failures)"
  exit 1
else
  green "  FAILED: $FAIL"
  echo ""
  green "Wave 1 smoke test PASSED ($PASS/$((PASS+FAIL)))"
  exit 0
fi
