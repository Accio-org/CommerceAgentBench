#!/usr/bin/env bash
# smoke_mcp_test.sh — Phase 1 MCP backbone smoke test for google_docs_mock
# Boots a fresh instance on PORT=3099, runs assertions, then kills it.
# NEVER touches 3081 (the live server) or 3098 (reserved for other mocks).
set -uo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
TEST_PORT="${SMOKE_MCP_PORT:-3099}"
SEED_DOC_ID="doc-prd-2026q3"   # from data/seed_state.json

PASS=0
FAIL=0

# ─── helpers ─────────────────────────────────────────────────────────────────
pass() { echo "  PASS  $1"; PASS=$((PASS+1)); }
fail() { echo "  FAIL  $1"; FAIL=$((FAIL+1)); }

assert_contains() {
  local label="$1" haystack="$2" needle="$3"
  # Use grep with -- to handle needles that start with - (like error codes -32601)
  if echo "$haystack" | grep -qF -- "$needle"; then pass "$label"; else fail "$label  (needle='$needle' not found)"; fi
}

assert_not_contains() {
  local label="$1" haystack="$2" needle="$3"
  if ! echo "$haystack" | grep -qF -- "$needle"; then pass "$label"; else fail "$label  (unexpected '$needle' found)"; fi
}

assert_eq() {
  local label="$1" got="$2" want="$3"
  if [ "$got" = "$want" ]; then pass "$label"; else fail "$label  (got='$got' want='$want')"; fi
}

mcp_call() {
  curl -sf -X POST "http://127.0.0.1:${TEST_PORT}/mcp" \
    -H 'Content-Type: application/json' \
    -d "$1" || { echo "  ERROR  curl failed for: $1"; return 1; }
}

api_call() {
  local method="$1" path_="$2" body="${3:-}"
  if [ "$method" = "GET" ]; then
    curl -sf "http://127.0.0.1:${TEST_PORT}${path_}" || { echo "  ERROR  curl GET failed: $path_"; return 1; }
  else
    curl -sf -X POST "http://127.0.0.1:${TEST_PORT}${path_}" \
      -H 'Content-Type: application/json' \
      -d "$body" || { echo "  ERROR  curl POST failed: $path_"; return 1; }
  fi
}

# ─── boot fresh instance ──────────────────────────────────────────────────────
TMPSTATE=$(mktemp -d)
echo "Starting google_docs_mock on port $TEST_PORT (state: $TMPSTATE)"
GDOCS_MOCK_STATE_DIR="$TMPSTATE" PORT="$TEST_PORT" MOCK_VERIFIER_TOKEN="bench-verifier" GDOCS_ENABLE_MCP=1 \
  node "$DIR/server.js" >"$TMPSTATE/server.log" 2>&1 &
SERVER_PID=$!
trap 'echo ""; echo "Stopping server (pid $SERVER_PID)"; kill "$SERVER_PID" 2>/dev/null; rm -rf "$TMPSTATE"' EXIT

# Wait for server to be ready (up to 6 s)
for i in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:${TEST_PORT}/health" >/dev/null 2>&1; then break; fi
  sleep 0.2
done
if ! curl -sf "http://127.0.0.1:${TEST_PORT}/health" >/dev/null 2>&1; then
  echo "FATAL: server did not start within 6s"
  cat "$TMPSTATE/server.log" 2>/dev/null || true
  exit 1
fi
echo "Server ready."
echo ""

# ─── 1. initialize ───────────────────────────────────────────────────────────
echo "=== 1. POST /mcp initialize ==="
RESP=$(mcp_call '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}')
assert_contains "initialize: result key present"           "$RESP" '"result"'
assert_contains "initialize: serverInfo.name correct"      "$RESP" '"name":"google-docs-mock"'
assert_contains "initialize: protocolVersion echoed"       "$RESP" '"protocolVersion":"2025-06-18"'
assert_contains "initialize: capabilities.tools present"   "$RESP" '"capabilities"'
assert_not_contains "initialize: no top-level error key"   "$RESP" '"error"'

# ─── 2. tools/list ───────────────────────────────────────────────────────────
echo ""
echo "=== 2. POST /mcp tools/list ==="
TOOLS_RESP=$(mcp_call '{"jsonrpc":"2.0","id":2,"method":"tools/list"}')

EXPECTED_TOOLS=(
  "docs.documents.get"
  "docs.documents.batchUpdate"
  "drive.files.export"
  "get_doc_content"
  "find_and_replace_doc"
  "export_doc_to_pdf"
)
for t in "${EXPECTED_TOOLS[@]}"; do
  assert_contains "tools/list: '$t' present" "$TOOLS_RESP" "\"name\":\"${t}\""
done
assert_contains "tools/list: inputSchema present" "$TOOLS_RESP" '"inputSchema"'
assert_not_contains "tools/list: no top-level error" "$TOOLS_RESP" '"code"'

# ─── 3. tools/call — docs.documents.get (dotted name) ────────────────────────
echo ""
echo "=== 3. tools/call docs.documents.get ==="
GET_RESP=$(mcp_call "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"docs.documents.get\",\"arguments\":{\"documentId\":\"${SEED_DOC_ID}\"}}}")
assert_contains "get: result.content array"    "$GET_RESP" '"content"'
assert_contains "get: content[0].type=text"    "$GET_RESP" '"type":"text"'
assert_contains "get: documentId in payload"   "$GET_RESP" "${SEED_DOC_ID}"
assert_not_contains "get: no error"            "$GET_RESP" '"code"'

# ─── 4. get_doc_content alias ────────────────────────────────────────────────
echo ""
echo "=== 4. tools/call get_doc_content (alias) ==="
ALIAS_RESP=$(mcp_call "{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"tools/call\",\"params\":{\"name\":\"get_doc_content\",\"arguments\":{\"documentId\":\"${SEED_DOC_ID}\"}}}")
assert_contains "alias get_doc_content: doc returned" "$ALIAS_RESP" "${SEED_DOC_ID}"
assert_not_contains "alias get_doc_content: no error"  "$ALIAS_RESP" '"code"'
# alias and dotted-name must produce identical payloads
DOTTED_TEXT=$(echo "$GET_RESP"  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['result']['content'][0]['text'])" 2>/dev/null || echo "")
ALIAS_TEXT=$(echo  "$ALIAS_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['result']['content'][0]['text'])" 2>/dev/null || echo "")
assert_eq "alias == dotted (same payload)" "$DOTTED_TEXT" "$ALIAS_TEXT"

# ─── 5. find_and_replace_doc ─────────────────────────────────────────────────
echo ""
echo "=== 5. tools/call find_and_replace_doc ==="
FR_RESP=$(mcp_call "{
  \"jsonrpc\":\"2.0\",\"id\":5,\"method\":\"tools/call\",
  \"params\":{
    \"name\":\"find_and_replace_doc\",
    \"arguments\":{
      \"documentId\":\"${SEED_DOC_ID}\",
      \"requests\":[{
        \"replaceAllText\":{
          \"replaceText\":\"SMOKE_REPLACED\",
          \"containsText\":{\"text\":\"Q3\",\"matchCase\":false}
        }
      }]
    }
  }
}")
assert_contains "find_replace: result present"       "$FR_RESP" '"result"'
assert_not_contains "find_replace: no error code"    "$FR_RESP" '"code"'
# Replacement must be visible when re-fetching the document
VERIFY_RESP=$(mcp_call "{\"jsonrpc\":\"2.0\",\"id\":6,\"method\":\"tools/call\",\"params\":{\"name\":\"docs.documents.get\",\"arguments\":{\"documentId\":\"${SEED_DOC_ID}\"}}}")
assert_contains "find_replace: replacement visible in doc" "$VERIFY_RESP" "SMOKE_REPLACED"

# ─── 6. unknown method → -32601 ──────────────────────────────────────────────
echo ""
echo "=== 6. POST /mcp bogus method → -32601 ==="
BOGUS_RESP=$(mcp_call '{"jsonrpc":"2.0","id":7,"method":"bogus/method"}')
assert_contains "bogus method: error field present"  "$BOGUS_RESP" '"error"'
assert_contains "bogus method: code -32601"          "$BOGUS_RESP" '-32601'
assert_not_contains "bogus method: no result"        "$BOGUS_RESP" '"result"'

# ─── 7. unknown tool → -32000 ────────────────────────────────────────────────
echo ""
echo "=== 7. tools/call unknown tool → -32000 ==="
UNKNOWN_RESP=$(mcp_call '{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"nonexistent_tool","arguments":{}}}')
assert_contains "unknown tool: error field present" "$UNKNOWN_RESP" '"error"'
assert_contains "unknown tool: code -32000"         "$UNKNOWN_RESP" '-32000'

# ─── 8. GET /api/workspace/tools — full registry with inputSchema ─────────────
echo ""
echo "=== 8. GET /api/workspace/tools ==="
WS_TOOLS=$(api_call GET "/api/workspace/tools")
assert_contains "workspace/tools: tools array"          "$WS_TOOLS" '"tools"'
assert_contains "workspace/tools: inputSchema present"  "$WS_TOOLS" '"inputSchema"'
assert_contains "workspace/tools: docs.documents.get"   "$WS_TOOLS" '"docs.documents.get"'
assert_contains "workspace/tools: get_doc_content"      "$WS_TOOLS" '"get_doc_content"'
assert_contains "workspace/tools: find_and_replace_doc" "$WS_TOOLS" '"find_and_replace_doc"'
assert_contains "workspace/tools: export_doc_to_pdf"    "$WS_TOOLS" '"export_doc_to_pdf"'

# ─── 9. POST /api/workspace/call → {result} ──────────────────────────────────
echo ""
echo "=== 9. POST /api/workspace/call {result} shape ==="
WS_CALL=$(api_call POST "/api/workspace/call" \
  "{\"name\":\"docs.documents.get\",\"arguments\":{\"documentId\":\"${SEED_DOC_ID}\"}}")
assert_contains "workspace/call: result key"   "$WS_CALL" '"result"'
assert_contains "workspace/call: doc id"       "$WS_CALL" "${SEED_DOC_ID}"

# ─── 10. export_doc_to_pdf via MCP ───────────────────────────────────────────
echo ""
echo "=== 10. tools/call export_doc_to_pdf ==="
EXPORT_RESP=$(mcp_call "{\"jsonrpc\":\"2.0\",\"id\":9,\"method\":\"tools/call\",\"params\":{\"name\":\"export_doc_to_pdf\",\"arguments\":{\"fileId\":\"${SEED_DOC_ID}\",\"mimeType\":\"application/pdf\"}}}")
assert_contains "export: result present"       "$EXPORT_RESP" '"result"'
# The payload is JSON-encoded inside content[0].text, so keys appear escaped
assert_contains "export: exported key present" "$EXPORT_RESP" 'exported'
assert_contains "export: fileId echoed"        "$EXPORT_RESP" "${SEED_DOC_ID}"
assert_contains "export: bytesBase64 present"  "$EXPORT_RESP" 'bytesBase64'
assert_not_contains "export: no error code"    "$EXPORT_RESP" '"code"'

# ─── Summary ─────────────────────────────────────────────────────────────────
echo ""
echo "=================================================="
TOTAL=$((PASS+FAIL))
echo "Results: ${PASS}/${TOTAL} passed, ${FAIL} failed"
if [ "$FAIL" -gt 0 ]; then
  echo "SMOKE TEST FAILED"
  exit 1
else
  echo "SMOKE TEST PASSED"
fi
