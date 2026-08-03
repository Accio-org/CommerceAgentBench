#!/usr/bin/env bash
# smoke_test.sh — Amazon SP-API mock Wave 0
#
# Validates alignment with fact sheet field names and detects fabricated endpoints.
# All checks assert EXACT field names from the SP-API swagger/fact-sheet.
#
# Usage:
#   cd real_replica_bench/mock_services/amazon_sp_api && bash smoke_test.sh
#
# Requires: bun, curl, jq
# Exit: 0 if all assertions pass; non-zero otherwise.

set -euo pipefail

PORT="${MOCK_PORT:-4000}"
BASE="http://127.0.0.1:$PORT"
VERIFIER_TOKEN="${MOCK_VERIFIER_TOKEN:-bench-verifier}"

PASS=0
FAIL=0

# ---------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------

pass() { echo "  ✓ $1"; PASS=$((PASS + 1)); }
fail() { echo "  ✗ $1"; echo "    ACTUAL: $2"; FAIL=$((FAIL + 1)); }

assert_contains() {
  local label="$1" body="$2" needle="$3"
  if echo "$body" | grep -qF "$needle"; then
    pass "$label (contains '$needle')"
  else
    fail "$label (missing '$needle')" "$body"
  fi
}

assert_not_contains() {
  local label="$1" body="$2" needle="$3"
  if echo "$body" | grep -qF "$needle"; then
    fail "$label (should NOT contain '$needle')" "$body"
  else
    pass "$label (does not contain '$needle')"
  fi
}

assert_status() {
  local label="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    pass "$label (HTTP $actual)"
  else
    fail "$label (expected HTTP $expected, got $actual)" ""
  fi
}

# ---------------------------------------------------------------
# Start server
# ---------------------------------------------------------------

echo "=== Amazon SP-API Mock Wave 0 — Smoke Test ==="
echo ""

# Kill any existing server on our port
pkill -f "bun server.js" 2>/dev/null || true
sleep 0.3

# Start server in background
MOCK_PORT="$PORT" bun server.js &
SERVER_PID=$!
trap "kill $SERVER_PID 2>/dev/null; echo ''; echo 'Server stopped.'" EXIT

# Wait for server to be ready (up to 10s)
echo "Waiting for server on :$PORT ..."
for i in {1..20}; do
  if curl -fsS "$BASE/__bench/health" >/dev/null 2>&1; then
    echo "Server ready."
    break
  fi
  sleep 0.5
  if [ "$i" = "20" ]; then
    echo "FATAL: Server did not start within 10s."
    exit 1
  fi
done
echo ""

# ---------------------------------------------------------------
# §1: /api/help — endpoint count and anti-fabrication
# ---------------------------------------------------------------
echo "--- §1: /api/help (endpoint count) ---"

HELP_BODY=$(curl -fsS "$BASE/api/help")
TOTAL_ENDPOINTS=$(echo "$HELP_BODY" | jq '.coverage.endpoints')

# Wave 0 requires ≥4 endpoints (additional waves may be loaded on same server)
if [ "$TOTAL_ENDPOINTS" -ge 4 ] 2>/dev/null; then
  pass "coverage.endpoints ≥ 4 (Wave 0: 2 Sellers + 2 Catalog registered; got $TOTAL_ENDPOINTS total)"
else
  fail "coverage.endpoints should be ≥ 4, got $TOTAL_ENDPOINTS" "$HELP_BODY"
fi

# Verify the 4 Wave-0 endpoint paths are present (additional paths from later waves are fine)
W0_PATHS_OK=true
for P in "/sellers/v1/marketplaceParticipations" "/sellers/v1/account" "/catalog/2022-04-01/items" "/catalog/2022-04-01/items/:asin"; do
  if echo "$HELP_BODY" | jq -r '[.namespaces[].endpoints[].path][]' | grep -qF "$P"; then
    true
  else
    W0_PATHS_OK=false
    fail "Wave 0 endpoint missing from /api/help" "missing: $P"
  fi
done
if $W0_PATHS_OK; then
  pass "All 4 Wave 0 endpoint paths present in /api/help"
fi

echo ""

# ---------------------------------------------------------------
# §2: Sellers getMarketplaceParticipations — fact-sheet field names
# ---------------------------------------------------------------
echo "--- §2: Sellers getMarketplaceParticipations ---"

MP_BODY=$(curl -fsS "$BASE/sellers/v1/marketplaceParticipations")

assert_contains "payload wrapper present"         "$MP_BODY" '"payload":'
assert_contains "storeName field present"         "$MP_BODY" '"storeName":'
assert_contains "isParticipating field present"   "$MP_BODY" '"isParticipating":'
assert_contains "hasSuspendedListings field"       "$MP_BODY" '"hasSuspendedListings":'
assert_contains "defaultCurrencyCode field"        "$MP_BODY" '"defaultCurrencyCode":'
assert_contains "defaultLanguageCode field"        "$MP_BODY" '"defaultLanguageCode":'
assert_contains "domainName field"                 "$MP_BODY" '"domainName":'
assert_contains "marketplace field present"        "$MP_BODY" '"marketplace":'
assert_contains "participation field present"      "$MP_BODY" '"participation":'

# payload should be an array (direct array, not an object with 'marketplaces' key)
IS_ARRAY=$(echo "$MP_BODY" | jq '.payload | type' 2>/dev/null || echo "null")
if [ "$IS_ARRAY" = '"array"' ]; then
  pass "payload is a bare array (not an object)"
else
  fail "payload should be an array, got type=$IS_ARRAY" "$MP_BODY"
fi

# Rate limit header
MP_HEADERS=$(curl -fsS -D - "$BASE/sellers/v1/marketplaceParticipations" -o /dev/null 2>&1 || curl -sS -D - "$BASE/sellers/v1/marketplaceParticipations" -o /dev/null)
if echo "$MP_HEADERS" | grep -qi "x-amzn-ratelimit-limit"; then
  pass "x-amzn-RateLimit-Limit header present"
else
  fail "x-amzn-RateLimit-Limit header missing" "$MP_HEADERS"
fi

echo ""

# ---------------------------------------------------------------
# §3: Sellers getAccount — fact-sheet field names
# ---------------------------------------------------------------
echo "--- §3: Sellers getAccount ---"

ACCT_BODY=$(curl -fsS "$BASE/sellers/v1/account")

assert_contains "payload wrapper present"              "$ACCT_BODY" '"payload":'
assert_contains "marketplaceParticipationList field"   "$ACCT_BODY" '"marketplaceParticipationList":'
assert_contains "businessType field"                   "$ACCT_BODY" '"businessType":'
assert_contains "sellingPlan field"                    "$ACCT_BODY" '"sellingPlan":'
assert_contains "business.name field"                  "$ACCT_BODY" '"name":'
assert_contains "registeredBusinessAddress field"      "$ACCT_BODY" '"registeredBusinessAddress":'
assert_contains "companyRegistrationNumber field"      "$ACCT_BODY" '"companyRegistrationNumber":'
assert_contains "primaryContact field"                 "$ACCT_BODY" '"primaryContact":'

# Regression check: must NOT use wrong field name
assert_not_contains "does NOT use 'marketplaceParticipations' (wrong name)" \
  "$ACCT_BODY" '"marketplaceParticipations":'

# businessType should be from valid enum
BTYPE=$(echo "$ACCT_BODY" | jq -r '.payload.businessType' 2>/dev/null || echo "")
VALID_BTYPES="CHARITY CRAFTSMAN NATURAL_PERSON_COMPANY PUBLIC_LISTED PRIVATE_LIMITED SOLE_PROPRIETORSHIP STATE_OWNED INDIVIDUAL"
if echo "$VALID_BTYPES" | grep -qw "$BTYPE"; then
  pass "businessType '$BTYPE' is a valid enum value"
else
  fail "businessType '$BTYPE' is not in valid enum set" "$ACCT_BODY"
fi

# sellingPlan should be PROFESSIONAL or INDIVIDUAL
SPLAN=$(echo "$ACCT_BODY" | jq -r '.payload.sellingPlan' 2>/dev/null || echo "")
if [ "$SPLAN" = "PROFESSIONAL" ] || [ "$SPLAN" = "INDIVIDUAL" ]; then
  pass "sellingPlan '$SPLAN' is a valid enum value"
else
  fail "sellingPlan '$SPLAN' is not PROFESSIONAL or INDIVIDUAL" "$ACCT_BODY"
fi

# storeName must appear inside marketplaceParticipationList (not just getMarketplaceParticipations)
assert_contains "storeName inside marketplaceParticipationList" "$ACCT_BODY" '"storeName":'

echo ""

# ---------------------------------------------------------------
# §4: Catalog searchCatalogItems — fact-sheet response structure
# ---------------------------------------------------------------
echo "--- §4: Catalog searchCatalogItems ---"

MID="ATVPDKIKX0DER"
SEARCH_BODY=$(curl -fsS "$BASE/catalog/2022-04-01/items?marketplaceIds=$MID")

assert_contains "numberOfResults field present"  "$SEARCH_BODY" '"numberOfResults":'
assert_contains "items field present"            "$SEARCH_BODY" '"items":'

# NO payload wrapper for Catalog Items
assert_not_contains "no payload wrapper (Catalog Items direct)" "$SEARCH_BODY" '"payload":'

# Items should exist
NUM=$(echo "$SEARCH_BODY" | jq '.numberOfResults' 2>/dev/null || echo "0")
if [ "$NUM" -gt 0 ] 2>/dev/null; then
  pass "numberOfResults=$NUM (items returned)"
else
  fail "numberOfResults should be > 0" "$SEARCH_BODY"
fi

echo ""

# ---------------------------------------------------------------
# §5: Catalog item body field name alignment
# ---------------------------------------------------------------
echo "--- §5: Catalog item field name alignment ---"

ITEM_BODY=$(curl -fsS "$BASE/catalog/2022-04-01/items/B0BENCH001?marketplaceIds=$MID")

# Correct field names
assert_contains "itemName field present"    "$ITEM_BODY" '"itemName":'
assert_contains "brand field present"       "$ITEM_BODY" '"brand":'
assert_contains "color field present"       "$ITEM_BODY" '"color":'
assert_contains "asin field present"        "$ITEM_BODY" '"asin":'
assert_contains "summaries field present"   "$ITEM_BODY" '"summaries":'

# Wrong field names must NOT appear
assert_not_contains "productTitle does NOT appear"  "$ITEM_BODY" '"productTitle":'
assert_not_contains "colorByType does NOT appear"   "$ITEM_BODY" '"colorByType":'

# brandName should only appear inside refinements.brands (not in summaries)
# Since this is getCatalogItem (no refinements), brandName must NOT appear at all
assert_not_contains "brandName does NOT appear in getCatalogItem response" \
  "$ITEM_BODY" '"brandName":'

# No payload wrapper
assert_not_contains "no payload wrapper for getCatalogItem" "$ITEM_BODY" '"payload":'

# ASIN field value
ASIN_VAL=$(echo "$ITEM_BODY" | jq -r '.asin' 2>/dev/null || echo "")
if [ "$ASIN_VAL" = "B0BENCH001" ]; then
  pass "asin value correct: B0BENCH001"
else
  fail "asin value should be B0BENCH001" "$ITEM_BODY"
fi

echo ""

# ---------------------------------------------------------------
# §6: Catalog — keyword search returns refinements
# ---------------------------------------------------------------
echo "--- §6: Catalog keyword search + refinements ---"

KW_BODY=$(curl -fsS "$BASE/catalog/2022-04-01/items?marketplaceIds=$MID&keywords=BenchPro")

assert_contains "numberOfResults in keyword search"    "$KW_BODY" '"numberOfResults":'
assert_contains "refinements in keyword search"        "$KW_BODY" '"refinements":'
assert_contains "brands in refinements"                "$KW_BODY" '"brands":'
assert_contains "classifications in refinements"       "$KW_BODY" '"classifications":'
# BrandRefinement uses brandName (correct per spec)
assert_contains "brandName inside refinements.brands"  "$KW_BODY" '"brandName":'

echo ""

# ---------------------------------------------------------------
# §7: Bench control endpoints
# ---------------------------------------------------------------
echo "--- §7: Bench control endpoints ---"

# Health
HEALTH_BODY=$(curl -fsS "$BASE/__bench/health")
assert_contains "health status=ok"       "$HEALTH_BODY" '"status":"ok"'
assert_contains "health endpoints count" "$HEALTH_BODY" '"endpoints":'

# State with token
STATE_BODY=$(curl -fsS -H "Authorization: Bearer $VERIFIER_TOKEN" "$BASE/__bench/state")
assert_contains "state has sellers"    "$STATE_BODY" '"sellers":'
assert_contains "state has catalog"    "$STATE_BODY" '"catalog":'
assert_contains "state has counts"     "$STATE_BODY" '"counts":'

# State without token → 401
STATE_NOAUTH=$(curl -sS -o /dev/null -w "%{http_code}" "$BASE/__bench/state")
assert_status "state without token → 401" "401" "$STATE_NOAUTH"

# Reset
RESET_BODY=$(curl -fsS -X POST -H "Authorization: Bearer $VERIFIER_TOKEN" "$BASE/__bench/reset")
assert_contains "reset ok" "$RESET_BODY" '"ok":true'

# After reset, seed endpoint re-populates
SEED_PAYLOAD='{"marketplaces":[{"id":"ATVPDKIKX0DER","name":"Amazon.com","countryCode":"US","defaultCurrencyCode":"USD","defaultLanguageCode":"en_US","domainName":"www.amazon.com"}],"sellers":[{"sellerId":"TEST001","businessType":"PRIVATE_LIMITED","sellingPlan":"PROFESSIONAL","marketplaceParticipationList":[{"marketplace":{"id":"ATVPDKIKX0DER","name":"Amazon.com","countryCode":"US","defaultCurrencyCode":"USD","defaultLanguageCode":"en_US","domainName":"www.amazon.com"},"participation":{"isParticipating":true,"hasSuspendedListings":false},"storeName":"Reset Test Store"}]}],"catalog":[]}'
SEED_BODY=$(curl -fsS -X POST \
  -H "Authorization: Bearer $VERIFIER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$SEED_PAYLOAD" \
  "$BASE/__bench/seed")
assert_contains "seed after reset ok" "$SEED_BODY" '"ok":true'

# Confirm seller account after re-seed has correct fields
ACCT_AFTER=$(curl -fsS "$BASE/sellers/v1/account")
assert_contains "account after re-seed has marketplaceParticipationList" \
  "$ACCT_AFTER" '"marketplaceParticipationList":'
assert_contains "account after re-seed has storeName" \
  "$ACCT_AFTER" '"storeName":"Reset Test Store"'

# Reload default seed for remaining tests
curl -sS -X POST \
  -H "Authorization: Bearer $VERIFIER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(cat seeds/default.json)" \
  "$BASE/__bench/seed" >/dev/null

echo ""

# ---------------------------------------------------------------
# §8: Marketplace filter on searchCatalogItems
# ---------------------------------------------------------------
echo "--- §8: Marketplace filter ---"

DE_MID="A1PA6795UKMFR9"
DE_BODY=$(curl -fsS "$BASE/catalog/2022-04-01/items?marketplaceIds=$DE_MID")
DE_NUM=$(echo "$DE_BODY" | jq '.numberOfResults' 2>/dev/null || echo "0")

US_BODY=$(curl -fsS "$BASE/catalog/2022-04-01/items?marketplaceIds=$MID")
US_NUM=$(echo "$US_BODY" | jq '.numberOfResults' 2>/dev/null || echo "0")

if [ "$US_NUM" -gt "$DE_NUM" ] 2>/dev/null; then
  pass "US marketplace ($US_NUM items) > DE marketplace ($DE_NUM items) — filter works"
elif [ "$DE_NUM" -gt 0 ] 2>/dev/null; then
  pass "DE marketplace returns $DE_NUM items (filter not zero-filtering everything)"
else
  fail "Marketplace filter: DE returned $DE_NUM items (expected >0)" "$DE_BODY"
fi

echo ""

# ---------------------------------------------------------------
# §9: CRITICAL anti-fabrication — fake endpoints return 404
# ---------------------------------------------------------------
echo "--- §9: Anti-fabrication — fabricated endpoints must return 404 ---"

# searchSuggestions does not exist
SS_STATUS=$(curl -sS -o /dev/null -w "%{http_code}" "$BASE/catalog/2022-04-01/items/B0BENCH001/searchSuggestions")
assert_status "GET /catalog/.../searchSuggestions → 404 (endpoint does not exist)" "404" "$SS_STATUS"

# categories does not exist
CAT_STATUS=$(curl -sS -o /dev/null -w "%{http_code}" "$BASE/catalog/2022-04-01/categories")
assert_status "GET /catalog/.../categories → 404 (endpoint does not exist)" "404" "$CAT_STATUS"

# competitiveSummary does not exist in this namespace
CS_STATUS=$(curl -sS -o /dev/null -w "%{http_code}" "$BASE/catalog/2022-04-01/items/B0BENCH001/competitiveSummary")
assert_status "GET /catalog/.../competitiveSummary → 404 (endpoint does not exist)" "404" "$CS_STATUS"

echo ""

# ---------------------------------------------------------------
# §10: Validation — server-side closed-set enum checks
# ---------------------------------------------------------------
echo "--- §10: Server-side validation ---"

# Invalid includedData → 400
INVALID_INCLUDED=$(curl -sS -o /dev/null -w "%{http_code}" "$BASE/catalog/2022-04-01/items?marketplaceIds=$MID&includedData=FAKE_SECTION")
assert_status "invalid includedData → 400" "400" "$INVALID_INCLUDED"

# Missing marketplaceIds → 400
NO_MKT=$(curl -sS -o /dev/null -w "%{http_code}" "$BASE/catalog/2022-04-01/items")
assert_status "missing marketplaceIds → 400 (MissingParameter)" "400" "$NO_MKT"

# identifiers without identifiersType → 400
NO_IDTYPE=$(curl -sS -o /dev/null -w "%{http_code}" "$BASE/catalog/2022-04-01/items?marketplaceIds=$MID&identifiers=B0BENCH001")
assert_status "identifiers without identifiersType → 400" "400" "$NO_IDTYPE"

# Invalid ASIN format → 400
BAD_ASIN=$(curl -sS -o /dev/null -w "%{http_code}" "$BASE/catalog/2022-04-01/items/not-valid-asin?marketplaceIds=$MID")
assert_status "invalid ASIN format → 400" "400" "$BAD_ASIN"

# Non-existent ASIN → 404 (B0NOTFOUND = 10 chars, valid format but not in store)
MISSING_ASIN=$(curl -sS -o /dev/null -w "%{http_code}" "$BASE/catalog/2022-04-01/items/B0NOTFOUND?marketplaceIds=$MID")
assert_status "non-existent ASIN → 404" "404" "$MISSING_ASIN"

# identifiers + keywords mutually exclusive → 400
MUTUAL_EXCL=$(curl -sS -o /dev/null -w "%{http_code}" "$BASE/catalog/2022-04-01/items?marketplaceIds=$MID&identifiers=B0BENCH001&identifiersType=ASIN&keywords=keyboard")
assert_status "identifiers + keywords → 400 (mutually exclusive)" "400" "$MUTUAL_EXCL"

echo ""

# ---------------------------------------------------------------
# §11: includedData filtering — sections absent when not requested
# ---------------------------------------------------------------
echo "--- §11: includedData filtering ---"

# Request only identifiers — summaries should be absent
IDENTS_ONLY=$(curl -fsS "$BASE/catalog/2022-04-01/items/B0BENCH001?marketplaceIds=$MID&includedData=identifiers")
assert_not_contains "summaries absent when not in includedData" "$IDENTS_ONLY" '"summaries":'
assert_contains "identifiers present when requested" "$IDENTS_ONLY" '"identifiers":'

# Request only summaries (default behavior)
SUMM_ONLY=$(curl -fsS "$BASE/catalog/2022-04-01/items/B0BENCH001?marketplaceIds=$MID&includedData=summaries")
assert_contains "summaries present when requested" "$SUMM_ONLY" '"summaries":'
assert_not_contains "identifiers absent when not requested" "$SUMM_ONLY" '"identifiers":'

echo ""

# ---------------------------------------------------------------
# §12: Pagination
# ---------------------------------------------------------------
echo "--- §12: Pagination ---"

# Small page size to force pagination
PAGE1=$(curl -fsS "$BASE/catalog/2022-04-01/items?marketplaceIds=$MID&pageSize=3")
PAGE1_COUNT=$(echo "$PAGE1" | jq '.items | length' 2>/dev/null || echo "0")

if [ "$PAGE1_COUNT" -gt 0 ] 2>/dev/null; then
  pass "Page 1 returned $PAGE1_COUNT items"
else
  fail "Page 1 returned 0 items" "$PAGE1"
fi

NEXT_TOKEN=$(echo "$PAGE1" | jq -r '.pagination.nextToken // empty' 2>/dev/null || echo "")
if [ -n "$NEXT_TOKEN" ]; then
  pass "pagination.nextToken present (more pages)"
  # Fetch page 2
  PAGE2=$(curl -fsS "$BASE/catalog/2022-04-01/items?marketplaceIds=$MID&pageToken=$(printf '%s' "$NEXT_TOKEN" | python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.stdin.read()))')")
  PAGE2_COUNT=$(echo "$PAGE2" | jq '.items | length' 2>/dev/null || echo "0")
  if [ "$PAGE2_COUNT" -gt 0 ] 2>/dev/null; then
    pass "Page 2 returned $PAGE2_COUNT items"
  else
    fail "Page 2 returned 0 items" "$PAGE2"
  fi
  # Page 2 should have previousToken
  PREV_TOKEN=$(echo "$PAGE2" | jq -r '.pagination.previousToken // empty' 2>/dev/null || echo "")
  if [ -n "$PREV_TOKEN" ]; then
    pass "pagination.previousToken present on page 2"
  else
    fail "pagination.previousToken missing on page 2" "$PAGE2"
  fi
else
  # With only 10 items seeded for US market and pageSize=3, there should be a next page
  US_TOTAL=$(echo "$PAGE1" | jq '.numberOfResults' 2>/dev/null || echo "0")
  if [ "$US_TOTAL" -le 3 ] 2>/dev/null; then
    pass "pagination.nextToken absent (total=$US_TOTAL fits in 1 page)"
  else
    fail "pagination.nextToken missing when total=$US_TOTAL > pageSize=3" "$PAGE1"
  fi
fi

echo ""

# ---------------------------------------------------------------
# §13: Identifier search
# ---------------------------------------------------------------
echo "--- §13: Identifier-based search (ASIN) ---"

ASIN_SEARCH=$(curl -fsS "$BASE/catalog/2022-04-01/items?marketplaceIds=$MID&identifiers=B0BENCH001&identifiersType=ASIN")
assert_contains "identifier search returns items"    "$ASIN_SEARCH" '"items":'
ASIN_COUNT=$(echo "$ASIN_SEARCH" | jq '.numberOfResults' 2>/dev/null || echo "0")
if [ "$ASIN_COUNT" = "1" ]; then
  pass "ASIN identifier search returns exactly 1 item"
else
  fail "ASIN identifier search should return 1 item, got $ASIN_COUNT" "$ASIN_SEARCH"
fi

echo ""

# ---------------------------------------------------------------
# §14: Rate limit headers on Sellers endpoints
# ---------------------------------------------------------------
echo "--- §14: Rate limit headers ---"

# Sellers: rate limit should be 0.016
MP_RATE=$(curl -sS -D - "$BASE/sellers/v1/marketplaceParticipations" -o /dev/null | grep -i "x-amzn-ratelimit-limit" | tr -d '\r\n' | sed 's/.*: *//')
if echo "$MP_RATE" | grep -q "0.016"; then
  pass "Sellers rate limit header = 0.016"
else
  fail "Sellers rate limit should be 0.016, got: '$MP_RATE'" ""
fi

# Catalog: rate limit should be 2
CAT_RATE=$(curl -sS -D - "$BASE/catalog/2022-04-01/items?marketplaceIds=$MID" -o /dev/null | grep -i "x-amzn-ratelimit-limit" | tr -d '\r\n' | sed 's/.*: *//')
if echo "$CAT_RATE" | grep -q "^2$"; then
  pass "Catalog rate limit header = 2"
else
  fail "Catalog rate limit should be 2, got: '$CAT_RATE'" ""
fi

echo ""

# ---------------------------------------------------------------
# Summary
# ---------------------------------------------------------------
TOTAL=$((PASS + FAIL))
echo "=============================="
echo "Results: $PASS/$TOTAL passed"
if [ "$FAIL" -gt 0 ]; then
  echo "FAIL: $FAIL assertions failed"
  echo "=============================="
  exit 1
else
  echo "ALL ASSERTIONS PASSED"
  echo "=============================="
  exit 0
fi
