#!/usr/bin/env bash
# smoke_test_wave3.sh — Wave 3 smoke tests for Amazon SP-API mock
#
# Tests: Finances v0 (4 ops) + Reports 2021-06-30 (9 ops + async flow + TSV docs)
#
# This script SPAWNS its own bun server on port 4003 (default seed) and tears
# it down on exit. It does NOT depend on a pre-existing server.
#
# Smoke philosophy: written by an INDEPENDENT auditor (the planner), NOT by the
# agents that wrote routes/finances.js or routes/reports.js. Assertions are
# grounded in scratch/docs/api_alignment/amazon_spapi.md, not in whatever the
# code happens to emit. If the impl has a real bug, this FAILS LOUDLY — that's
# the point. Do NOT loosen a check just to make it pass.
#
# DO NOT replace smoke_test{,_wave1,_wave2}.sh — earlier wave tests stay.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${SMOKE_PORT:-4003}"
VERIFIER_TOKEN="mock-verifier"
BASE_URL="http://127.0.0.1:$PORT"

PASS=0
FAIL=0
TOTAL=0
ERRORS=()

green() { printf "\033[32m%s\033[0m\n" "$*"; }
red()   { printf "\033[31m%s\033[0m\n" "$*"; }
yellow(){ printf "\033[33m%s\033[0m\n" "$*"; }

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
    [[ -n "$detail" ]] && red "    → $detail"
    FAIL=$((FAIL+1))
    ERRORS+=("FAIL #$TOTAL: $description${detail:+ — $detail}")
  fi
}

# Capture body + status. Usage: do_curl METHOD URL [body] [extra_curl_args...]
do_curl() {
  local method="$1"
  local url="$2"
  local body="${3:-}"
  if [[ $# -ge 3 ]]; then shift 3; else shift $#; fi
  local extra_args=("$@")
  if [[ -n "$body" ]]; then
    local tmpfile; tmpfile=$(mktemp)
    printf '%s' "$body" > "$tmpfile"
    RESP=$(curl -s -w '\n__STATUS__%{http_code}' -X "$method" \
      -H "Content-Type: application/json" -H "x-amz-access-token: test-token" \
      "${extra_args[@]+"${extra_args[@]}"}" --data "@$tmpfile" "$url") \
      || { RESP=""; HTTP_CODE=0; rm -f "$tmpfile"; return 0; }
    rm -f "$tmpfile"
  else
    RESP=$(curl -s -w '\n__STATUS__%{http_code}' -X "$method" \
      -H "x-amz-access-token: test-token" \
      "${extra_args[@]+"${extra_args[@]}"}" "$url") \
      || { RESP=""; HTTP_CODE=0; return 0; }
  fi
  HTTP_CODE=$(echo "$RESP" | grep -o '__STATUS__[0-9]*' | sed 's/__STATUS__//')
  RESP=$(echo "$RESP" | sed 's/\n__STATUS__[0-9]*$//' | sed '$s/__STATUS__[0-9]*$//')
}

jq_val()  { echo "$RESP" | jq -r "$1" 2>/dev/null || echo "<jq_error>"; }
jq_type() { echo "$RESP" | jq -r "$1 | type" 2>/dev/null || echo "<jq_error>"; }

# ---------------------------------------------------------------------------
# Spawn server
# ---------------------------------------------------------------------------
echo ""
echo "=== Amazon SP-API Mock Wave 3 — Smoke Test (Finances v0 + Reports 2021-06-30) ==="
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

for i in {1..60}; do
  if curl -fsS "$BASE_URL/__bench/health" >/dev/null 2>&1; then
    echo "Server ready on $BASE_URL"; break
  fi
  sleep 0.5
  if [[ "$i" = "60" ]]; then red "ERROR: server not ready within 30s"; cat "$SERVER_LOG"; exit 1; fi
done
echo ""

# Seeded order linked to financial events (from seeds/default.json)
SEED_ORDER="112-4567890-1234567"

# ===========================================================================
# §1 — Finances API v0  (payload wrapper, PascalCase, money = CurrencyAmount NUMBER)
# ===========================================================================
yellow "=== §1 Finances v0 ==="

# 1a. /api/help advertises the finances namespace
do_curl GET "$BASE_URL/api/help"
HAS_FIN=$(echo "$RESP" | jq -r '[.. | strings] | map(select(test("finances/v0"))) | length>0' 2>/dev/null)
check "/api/help advertises /finances/v0 namespace" "$([ "$HAS_FIN" = "true" ] && echo pass || echo fail)" "found=$HAS_FIN"

# 1b. listFinancialEvents → 200 + payload wrapper (Finances DOES wrap, unlike Reports)
do_curl GET "$BASE_URL/finances/v0/financialEvents?PostedAfter=2026-05-01T00:00:00Z&PostedBefore=2026-05-25T00:00:00Z"
check "listFinancialEvents returns 200" "$([ "$HTTP_CODE" = "200" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"
HAS_PAYLOAD=$(echo "$RESP" | jq 'has("payload")' 2>/dev/null)
check "listFinancialEvents HAS payload wrapper" "$([ "$HAS_PAYLOAD" = "true" ] && echo pass || echo fail)" "has_payload=$HAS_PAYLOAD"
HAS_FE=$(echo "$RESP" | jq '.payload | has("FinancialEvents")' 2>/dev/null)
check "payload.FinancialEvents present (PascalCase)" "$([ "$HAS_FE" = "true" ] && echo pass || echo fail)" "has=$HAS_FE"
SHIP_LEN=$(echo "$RESP" | jq '.payload.FinancialEvents.ShipmentEventList | length' 2>/dev/null)
check "FinancialEvents.ShipmentEventList non-empty (≥1)" "$([ "${SHIP_LEN:-0}" -ge 1 ] && echo pass || echo fail)" "len=$SHIP_LEN"

# 1c. MONEY TRAP — CurrencyAmount must be a NUMBER, and field must NOT be 'Amount'
AMT_TYPE=$(echo "$RESP" | jq -r '[.payload.FinancialEvents.ShipmentEventList[0] | .. | objects | select(has("CurrencyAmount"))][0].CurrencyAmount | type' 2>/dev/null)
check "money uses CurrencyAmount as NUMBER (not string)" "$([ "$AMT_TYPE" = "number" ] && echo pass || echo fail)" "type=$AMT_TYPE"
WRONG_AMOUNT=$(echo "$RESP" | jq '[.payload.FinancialEvents | .. | objects | select(has("CurrencyCode") and has("Amount"))] | length' 2>/dev/null)
check "NO finances money object uses Orders-style 'Amount' field" "$([ "${WRONG_AMOUNT:-1}" = "0" ] && echo pass || echo fail)" "wrong_amount_objs=$WRONG_AMOUNT"
CC=$(echo "$RESP" | jq -r '[.payload.FinancialEvents.ShipmentEventList[0] | .. | objects | select(has("CurrencyCode"))][0].CurrencyCode' 2>/dev/null)
check "money has CurrencyCode (e.g. USD)" "$([ -n "$CC" ] && [ "$CC" != "null" ] && echo pass || echo fail)" "code=$CC"

# 1d. listFinancialEventsByOrderId — seeded order returns events
do_curl GET "$BASE_URL/finances/v0/orders/$SEED_ORDER/financialEvents"
check "listFinancialEventsByOrderId(seeded order) returns 200" "$([ "$HTTP_CODE" = "200" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"
BYO_FE=$(echo "$RESP" | jq '.payload | has("FinancialEvents")' 2>/dev/null)
check "byOrderId response has payload.FinancialEvents" "$([ "$BYO_FE" = "true" ] && echo pass || echo fail)" "has=$BYO_FE"

# 1e. listFinancialEventGroups → 200 with FinancialEventGroupList
do_curl GET "$BASE_URL/finances/v0/financialEventGroups"
check "listFinancialEventGroups returns 200" "$([ "$HTTP_CODE" = "200" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"
HAS_GRP=$(echo "$RESP" | jq '.payload | has("FinancialEventGroupList")' 2>/dev/null)
check "payload.FinancialEventGroupList present" "$([ "$HAS_GRP" = "true" ] && echo pass || echo fail)" "has=$HAS_GRP"
GRP_ID=$(echo "$RESP" | jq -r '.payload.FinancialEventGroupList[0].FinancialEventGroupId' 2>/dev/null)

# 1f. listFinancialEventsByGroupId → 200
if [[ -n "$GRP_ID" && "$GRP_ID" != "null" ]]; then
  do_curl GET "$BASE_URL/finances/v0/financialEventGroups/$GRP_ID/financialEvents"
  check "listFinancialEventsByGroupId(seeded group) returns 200" "$([ "$HTTP_CODE" = "200" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE group=$GRP_ID"
else
  check "listFinancialEventsByGroupId(seeded group) returns 200" "fail" "no seeded FinancialEventGroupId found"
fi

# 1g. Date-range validation — PostedBefore must be later than PostedAfter (fact sheet)
do_curl GET "$BASE_URL/finances/v0/financialEvents?PostedAfter=2026-05-20T00:00:00Z&PostedBefore=2026-05-01T00:00:00Z"
check "listFinancialEvents rejects PostedBefore<PostedAfter (400)" "$([ "$HTTP_CODE" = "400" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"

# 1h. Anti-fabrication — invented finances endpoint must 404
do_curl GET "$BASE_URL/finances/v0/bogusEndpoint"
check "fabricated /finances/v0/bogusEndpoint → 404" "$([ "$HTTP_CODE" = "404" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"

echo ""
# ===========================================================================
# §2 — Reports API v2021-06-30  (camelCase, NO payload wrapper, async, TSV docs)
# ===========================================================================
yellow "=== §2 Reports 2021-06-30 ==="

SETTLE_TYPE="GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2"
REIMB_TYPE="GET_FBA_REIMBURSEMENTS_DATA"
MP='["ATVPDKIKX0DER"]'

# 2a. /api/help advertises reports namespace
do_curl GET "$BASE_URL/api/help"
HAS_REP=$(echo "$RESP" | jq -r '[.. | strings] | map(select(test("reports/2021-06-30"))) | length>0' 2>/dev/null)
check "/api/help advertises /reports/2021-06-30 namespace" "$([ "$HAS_REP" = "true" ] && echo pass || echo fail)" "found=$HAS_REP"

# 2b. createReport → 202, bare {reportId}, NO payload wrapper
do_curl POST "$BASE_URL/reports/2021-06-30/reports" "{\"reportType\":\"$SETTLE_TYPE\",\"marketplaceIds\":$MP}"
check "createReport returns HTTP 202 (not 200)" "$([ "$HTTP_CODE" = "202" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE body=$RESP"
RID=$(jq_val '.reportId')
check "createReport returns reportId" "$([ -n "$RID" ] && [ "$RID" != "null" ] && echo pass || echo fail)" "reportId=$RID"
ONLY_RID=$(echo "$RESP" | jq -r '[keys[]] == ["reportId"]' 2>/dev/null)
check "createReport body is ONLY {reportId} (no payload wrapper)" "$([ "$ONLY_RID" = "true" ] && echo pass || echo fail)" "keys=$(echo "$RESP" | jq -c 'keys' 2>/dev/null)"

# 2c. Closed-set: bogus reportType → 400
do_curl POST "$BASE_URL/reports/2021-06-30/reports" "{\"reportType\":\"GET_TOTALLY_FAKE_REPORT\",\"marketplaceIds\":$MP}"
check "createReport with invalid reportType → 400 (closed-set)" "$([ "$HTTP_CODE" = "400" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"

# 2d. Required field: missing marketplaceIds → 400
do_curl POST "$BASE_URL/reports/2021-06-30/reports" "{\"reportType\":\"$SETTLE_TYPE\"}"
check "createReport missing marketplaceIds → 400" "$([ "$HTTP_CODE" = "400" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"

# 2e. Async poll machine: poll1 → IN_PROGRESS, NO payload wrapper
do_curl GET "$BASE_URL/reports/2021-06-30/reports/$RID"
check "getReport poll#1 returns 200" "$([ "$HTTP_CODE" = "200" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"
ST1=$(jq_val '.processingStatus')
check "getReport poll#1 processingStatus = IN_PROGRESS" "$([ "$ST1" = "IN_PROGRESS" ] && echo pass || echo fail)" "status=$ST1"
REP_PAYLOAD=$(echo "$RESP" | jq 'has("payload")' 2>/dev/null)
check "getReport has NO payload wrapper (camelCase direct object)" "$([ "$REP_PAYLOAD" = "false" ] && echo pass || echo fail)" "has_payload=$REP_PAYLOAD"

# 2f. poll2 → DONE + reportDocumentId
do_curl GET "$BASE_URL/reports/2021-06-30/reports/$RID"
ST2=$(jq_val '.processingStatus')
check "getReport poll#2 processingStatus = DONE" "$([ "$ST2" = "DONE" ] && echo pass || echo fail)" "status=$ST2"
DOC_ID=$(jq_val '.reportDocumentId')
check "DONE report has reportDocumentId" "$([ -n "$DOC_ID" ] && [ "$DOC_ID" != "null" ] && echo pass || echo fail)" "docId=$DOC_ID"

# 2g. getReportDocument → {reportDocumentId, url, compressionAlgorithm:GZIP}
do_curl GET "$BASE_URL/reports/2021-06-30/documents/$DOC_ID"
check "getReportDocument returns 200" "$([ "$HTTP_CODE" = "200" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"
DOC_URL=$(jq_val '.url')
check "getReportDocument returns url" "$([ -n "$DOC_URL" ] && [ "$DOC_URL" != "null" ] && echo pass || echo fail)" "url=$DOC_URL"
COMP=$(jq_val '.compressionAlgorithm')
check "getReportDocument compressionAlgorithm = GZIP" "$([ "$COMP" = "GZIP" ] && echo pass || echo fail)" "comp=$COMP"

# 2h. Fetch the document — gzip bytes that gunzip to a 24-column kebab-case settlement TSV
MAGIC=$(curl -s "$DOC_URL" | head -c2 | xxd -p 2>/dev/null)
check "document bytes are gzip (magic 1f8b)" "$([ "$MAGIC" = "1f8b" ] && echo pass || echo fail)" "magic=$MAGIC"
HDR=$(curl -s "$DOC_URL" | gunzip 2>/dev/null | head -1)
NCOLS=$(echo "$HDR" | awk -F'\t' '{print NF}')
check "settlement TSV header has 24 tab-separated columns" "$([ "$NCOLS" = "24" ] && echo pass || echo fail)" "ncols=$NCOLS"
FIRST_COL=$(echo "$HDR" | awk -F'\t' '{print $1}')
LAST_COL=$(echo "$HDR" | awk -F'\t' '{print $NF}')
check "settlement TSV first col = settlement-id, last = promotion-id (kebab-case)" \
  "$([ "$FIRST_COL" = "settlement-id" ] && [ "$LAST_COL" = "promotion-id" ] && echo pass || echo fail)" "first=$FIRST_COL last=$LAST_COL"
# spot-check the V2 general-purpose amount columns exist
HAS_AMTCOLS=$(echo "$HDR" | grep -q $'amount-type\tamount-description\tamount' && echo yes || echo no)
check "settlement TSV has V2 amount-type/amount-description/amount triplet" "$([ "$HAS_AMTCOLS" = "yes" ] && echo pass || echo fail)" "found=$HAS_AMTCOLS"

# 2i. nocompress=1 → plain TSV with identical header
PLAIN_HDR=$(curl -s "$DOC_URL?nocompress=1" | head -1)
check "?nocompress=1 serves plain TSV with same header" "$([ "$PLAIN_HDR" = "$HDR" ] && echo pass || echo fail)" "match=$([ "$PLAIN_HDR" = "$HDR" ] && echo yes || echo no)"

# 2j. Reimbursements report → 18-column TSV
do_curl POST "$BASE_URL/reports/2021-06-30/reports" "{\"reportType\":\"$REIMB_TYPE\",\"marketplaceIds\":$MP}"
RID2=$(jq_val '.reportId')
do_curl GET "$BASE_URL/reports/2021-06-30/reports/$RID2" >/dev/null
do_curl GET "$BASE_URL/reports/2021-06-30/reports/$RID2"
DOC_ID2=$(jq_val '.reportDocumentId')
do_curl GET "$BASE_URL/reports/2021-06-30/documents/$DOC_ID2"
DOC_URL2=$(jq_val '.url')
RHDR=$(curl -s "$DOC_URL2?nocompress=1" | head -1)
RNCOLS=$(echo "$RHDR" | awk -F'\t' '{print NF}')
check "reimbursements TSV header has 18 columns" "$([ "$RNCOLS" = "18" ] && echo pass || echo fail)" "ncols=$RNCOLS"
RFIRST=$(echo "$RHDR" | awk -F'\t' '{print $1}')
check "reimbursements TSV first col = approval-date" "$([ "$RFIRST" = "approval-date" ] && echo pass || echo fail)" "first=$RFIRST"
HAS_REASON=$(echo "$RHDR" | grep -qw "reason" && echo yes || echo no)
check "reimbursements TSV has 'reason' column" "$([ "$HAS_REASON" = "yes" ] && echo pass || echo fail)" "found=$HAS_REASON"

# 2k. getReports list (camelCase 'reports' key) includes seeded reports
do_curl GET "$BASE_URL/reports/2021-06-30/reports?reportTypes=$SETTLE_TYPE"
check "getReports list returns 200" "$([ "$HTTP_CODE" = "200" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"
HAS_REPORTS=$(echo "$RESP" | jq 'has("reports")' 2>/dev/null)
check "getReports top-level has 'reports' (camelCase)" "$([ "$HAS_REPORTS" = "true" ] && echo pass || echo fail)" "has=$HAS_REPORTS"

# 2l. cancelReport on a fresh IN_QUEUE report → 2xx, then report is CANCELLED
do_curl POST "$BASE_URL/reports/2021-06-30/reports" "{\"reportType\":\"$SETTLE_TYPE\",\"marketplaceIds\":$MP}"
RID3=$(jq_val '.reportId')
do_curl DELETE "$BASE_URL/reports/2021-06-30/reports/$RID3"
check "cancelReport on IN_QUEUE report → 2xx" "$([ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "204" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"
do_curl GET "$BASE_URL/reports/2021-06-30/reports/$RID3"
ST3=$(jq_val '.processingStatus')
check "cancelled report processingStatus = CANCELLED (does not advance)" "$([ "$ST3" = "CANCELLED" ] && echo pass || echo fail)" "status=$ST3"

# 2m. Seeded pre-DONE report serves its document
do_curl GET "$BASE_URL/reports/2021-06-30/reports/50001234567890"
SEED_ST=$(jq_val '.processingStatus')
check "seeded report 50001234567890 is DONE" "$([ "$SEED_ST" = "DONE" ] && echo pass || echo fail)" "status=$SEED_ST"
SEED_DOC=$(jq_val '.reportDocumentId')
do_curl GET "$BASE_URL/reports/2021-06-30/documents/$SEED_DOC"
check "seeded report's getReportDocument → 200" "$([ "$HTTP_CODE" = "200" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE docId=$SEED_DOC"

# 2n. Schedules
do_curl GET "$BASE_URL/reports/2021-06-30/schedules"
check "getReportSchedules → 200" "$([ "$HTTP_CODE" = "200" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"
HAS_SCHED=$(echo "$RESP" | jq 'has("reportSchedules")' 2>/dev/null)
check "getReportSchedules has 'reportSchedules' (camelCase)" "$([ "$HAS_SCHED" = "true" ] && echo pass || echo fail)" "has=$HAS_SCHED"

# 2o. Negatives — nonexistent report / document → 404
do_curl GET "$BASE_URL/reports/2021-06-30/reports/99999999999999"
check "getReport(nonexistent) → 404" "$([ "$HTTP_CODE" = "404" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"
do_curl GET "$BASE_URL/reports/2021-06-30/documents/amzn1.spdoc.fake.notreal"
check "getReportDocument(nonexistent) → 404" "$([ "$HTTP_CODE" = "404" ] && echo pass || echo fail)" "HTTP=$HTTP_CODE"

# ===========================================================================
# Summary
# ===========================================================================
echo ""
echo "=============================="
echo " Wave 3 Smoke Test Results"
echo "=============================="
green "  PASSED: $PASS / $TOTAL"
if [[ "$FAIL" -gt 0 ]]; then
  red "  FAILED: $FAIL"
  echo ""
  red "Failed checks:"
  for e in "${ERRORS[@]}"; do red "  $e"; done
  echo ""
  red "Wave 3 smoke test FAILED ($FAIL/$TOTAL failed)"
  exit 1
fi
echo ""
green "Wave 3 smoke test PASSED ($PASS/$TOTAL)"
