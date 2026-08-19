#!/usr/bin/env bash
# smoke_drive_test.sh — Phase 2 Drive API v3 smoke test for google_docs_mock
# Tests all Phase 2 tools: drive.files.list, drive.files.get, drive.files.create,
# drive.files.copy, drive.files.update, drive.files.delete, drive.permissions.*,
# drive.revisions.*, docs.documents.create + all Convention-C aliases.
# Also runs Phase 1 regression.
#
# Boots a fresh instance on PORT=3189 (never touches 3081 or 3099).
# Use SMOKE_DRIVE_PORT env to override.
set -uo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
TEST_PORT="${SMOKE_DRIVE_PORT:-3189}"
SEED_DOC_ID="doc-prd-2026q3"   # from data/seed_state.json

PASS=0
FAIL=0

# ─── helpers ─────────────────────────────────────────────────────────────────
pass() { echo "  PASS  $1"; PASS=$((PASS+1)); }
fail() { echo "  FAIL  $1"; FAIL=$((FAIL+1)); }

assert_contains() {
  local label="$1" haystack="$2" needle="$3"
  if echo "$haystack" | grep -qF -- "$needle"; then pass "$label"
  else fail "$label  (needle='$needle' not found in response)"; fi
}

assert_not_contains() {
  local label="$1" haystack="$2" needle="$3"
  if ! echo "$haystack" | grep -qF -- "$needle"; then pass "$label"
  else fail "$label  (unexpected '$needle' found in response)"; fi
}

assert_eq() {
  local label="$1" got="$2" want="$3"
  if [ "$got" = "$want" ]; then pass "$label"
  else fail "$label  (got='$got' want='$want')"; fi
}

assert_http_code() {
  local label="$1" url="$2" body_arg="$3" expected_code="$4"
  local actual_code
  actual_code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${url}" \
    -H 'Content-Type: application/json' -d "$body_arg" 2>/dev/null)
  assert_eq "$label (HTTP $expected_code)" "$actual_code" "$expected_code"
}

# POST to /api/workspace/call (the canonical REST dispatch path).
# Use -s (silent) but NOT -f so that 4xx/5xx responses are still returned
# as body text rather than silently discarded. This lets us assert on Google
# error envelopes in negative-path tests.
ws_call() {
  curl -s -X POST "http://127.0.0.1:${TEST_PORT}/api/workspace/call" \
    -H 'Content-Type: application/json' \
    -d "$1" 2>/dev/null || { echo "  ERROR  ws_call curl failed: $1"; return 1; }
}

# POST to /mcp (JSON-RPC 2.0)
mcp_call() {
  curl -sf -X POST "http://127.0.0.1:${TEST_PORT}/mcp" \
    -H 'Content-Type: application/json' \
    -d "$1" 2>/dev/null || { echo "  ERROR  mcp_call curl failed: $1"; return 1; }
}

# GET /api/workspace/tools
ws_tools() {
  curl -sf "http://127.0.0.1:${TEST_PORT}/api/workspace/tools" 2>/dev/null
}

# ─── boot fresh instance ──────────────────────────────────────────────────────
TMPSTATE=$(mktemp -d)
echo "Starting google_docs_mock on port $TEST_PORT (state: $TMPSTATE)"
GDOCS_MOCK_STATE_DIR="$TMPSTATE" PORT="$TEST_PORT" MOCK_VERIFIER_TOKEN="bench-verifier" GDOCS_ENABLE_MCP=1 \
  node "$DIR/server.js" >"$TMPSTATE/server.log" 2>&1 &
SERVER_PID=$!
trap 'echo ""; echo "Stopping server (pid $SERVER_PID)"; kill "$SERVER_PID" 2>/dev/null; rm -rf "$TMPSTATE"' EXIT

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

# ═══════════════════════════════════════════════════════════════════════════════
# 1. tools/list — ALL new dotted tools + aliases + Phase-1 regression
# ═══════════════════════════════════════════════════════════════════════════════
echo "=== 1. tools/list — all tools present with inputSchema ==="
TOOLS=$(mcp_call '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')

# Phase 1 regression
P1_TOOLS=("docs.documents.get" "docs.documents.batchUpdate" "drive.files.export"
          "get_doc_content" "find_and_replace_doc" "export_doc_to_pdf")
for t in "${P1_TOOLS[@]}"; do
  assert_contains "tools/list: Phase1 '$t' still present" "$TOOLS" "\"name\":\"${t}\""
done

# Phase 2 dotted
P2_DOTTED=("docs.documents.create" "drive.files.list" "drive.files.get"
           "drive.files.create" "drive.files.copy" "drive.files.update"
           "drive.files.delete" "drive.permissions.create" "drive.permissions.list"
           "drive.permissions.delete" "drive.revisions.list" "drive.revisions.get")
for t in "${P2_DOTTED[@]}"; do
  assert_contains "tools/list: Phase2 dotted '$t'" "$TOOLS" "\"name\":\"${t}\""
done

# Phase 2 Convention-C aliases
P2_ALIASES=("create_doc" "search_drive_files" "search_docs" "list_docs_in_folder"
            "get_drive_file_content" "create_drive_file" "copy_drive_file"
            "update_drive_file" "set_drive_file_permissions" "get_drive_file_permissions")
for t in "${P2_ALIASES[@]}"; do
  assert_contains "tools/list: Phase2 alias '$t'" "$TOOLS" "\"name\":\"${t}\""
done

assert_contains "tools/list: inputSchema present" "$TOOLS" '"inputSchema"'
assert_not_contains "tools/list: no top-level error" "$TOOLS" '"code"'

# ═══════════════════════════════════════════════════════════════════════════════
# 2. drive.files.list: q="trashed = false" → {kind:'drive#fileList', files:[...]}
#    Each file has kind:'drive#file' + projected mimeType
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "=== 2. drive.files.list q='trashed = false' — Drive shape ==="
LIST_RESP=$(ws_call '{"name":"drive.files.list","arguments":{"q":"trashed = false"}}')
assert_contains "list: result present"          "$LIST_RESP" '"result"'
assert_contains "list: kind drive#fileList"     "$LIST_RESP" '"kind":"drive#fileList"'
assert_contains "list: files array"             "$LIST_RESP" '"files"'
assert_contains "list: each file has kind drive#file" "$LIST_RESP" '"kind":"drive#file"'
# mimeType projected — docs get google-apps mime, folders get folder mime
assert_contains "list: doc mimeType projected"  "$LIST_RESP" 'application/vnd.google-apps'

# ═══════════════════════════════════════════════════════════════════════════════
# 3. q operator-misuse: name > 'x' → 400 INVALID_ARGUMENT (negative test)
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "=== 3. q operator-misuse: name > 'x' → 400 INVALID_ARGUMENT ==="
BAD_OP_BODY='{"name":"drive.files.list","arguments":{"q":"name > '"'"'x'"'"'"}}'
BAD_OP_RESP=$(ws_call "$BAD_OP_BODY") || true
# Must contain Google error envelope
assert_contains "bad-op: error.code 400"       "$BAD_OP_RESP" '"code":400'
assert_contains "bad-op: status INVALID_ARGUMENT" "$BAD_OP_RESP" '"status":"INVALID_ARGUMENT"'
assert_contains "bad-op: domain global"        "$BAD_OP_RESP" '"domain":"global"'
# Must NOT return a fileList
assert_not_contains "bad-op: no drive#fileList" "$BAD_OP_RESP" '"kind":"drive#fileList"'

# HTTP code must be 400
assert_http_code "bad-op: HTTP 400" \
  "http://127.0.0.1:${TEST_PORT}/api/workspace/call" \
  "$BAD_OP_BODY" "400"

# ═══════════════════════════════════════════════════════════════════════════════
# 4. permissions.create — valid role/type → succeeds
#    permissions.list → Drive-shaped entry
#    mock sharedWith mirrors editor role
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "=== 4. permissions.create + permissions.list — valid writer/user ==="
PERM_CREATE=$(ws_call "{\"name\":\"drive.permissions.create\",\"arguments\":{\"fileId\":\"${SEED_DOC_ID}\",\"role\":\"writer\",\"type\":\"user\",\"emailAddress\":\"smoke@example.com\"}}")
assert_contains "perm-create: result present"         "$PERM_CREATE" '"result"'
assert_contains "perm-create: kind drive#permission"  "$PERM_CREATE" '"kind":"drive#permission"'
assert_contains "perm-create: role writer echoed"     "$PERM_CREATE" '"role":"writer"'
assert_contains "perm-create: type user echoed"       "$PERM_CREATE" '"type":"user"'
assert_contains "perm-create: emailAddress echoed"    "$PERM_CREATE" '"emailAddress":"smoke@example.com"'

PERM_LIST=$(ws_call "{\"name\":\"drive.permissions.list\",\"arguments\":{\"fileId\":\"${SEED_DOC_ID}\"}}")
assert_contains "perm-list: kind drive#permissionList" "$PERM_LIST" '"kind":"drive#permissionList"'
assert_contains "perm-list: writer visible"           "$PERM_LIST" '"role":"writer"'

# Verify mock's sharedWith uses 'editor' (the mock-native role for writer)
# Use the HTTP GET /api/files/<id> endpoint which returns only the enriched file (small response)
FILE_RESP=$(curl -s "http://127.0.0.1:${TEST_PORT}/api/files/${SEED_DOC_ID}" 2>/dev/null)
assert_contains "perm-create: sharedWith mirrors editor" "$FILE_RESP" '"editor"'

# ═══════════════════════════════════════════════════════════════════════════════
# 5. permissions.create with bad enum → 400
#    role='superuser' → 400
#    type='alien' → 400
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "=== 5. permissions.create bad enum → 400 INVALID_ARGUMENT ==="
BAD_ROLE=$(ws_call "{\"name\":\"drive.permissions.create\",\"arguments\":{\"fileId\":\"${SEED_DOC_ID}\",\"role\":\"superuser\",\"type\":\"user\"}}")
assert_contains "bad-role: code 400"           "$BAD_ROLE" '"code":400'
assert_contains "bad-role: INVALID_ARGUMENT"   "$BAD_ROLE" '"status":"INVALID_ARGUMENT"'
assert_not_contains "bad-role: no permission"  "$BAD_ROLE" '"kind":"drive#permission"'

BAD_TYPE=$(ws_call "{\"name\":\"drive.permissions.create\",\"arguments\":{\"fileId\":\"${SEED_DOC_ID}\",\"role\":\"reader\",\"type\":\"alien\"}}")
assert_contains "bad-type: code 400"           "$BAD_TYPE" '"code":400'
assert_contains "bad-type: INVALID_ARGUMENT"   "$BAD_TYPE" '"status":"INVALID_ARGUMENT"'
assert_not_contains "bad-type: no permission"  "$BAD_TYPE" '"kind":"drive#permission"'

# ═══════════════════════════════════════════════════════════════════════════════
# 6. drive.files.export mimeType validation
#    'application/zip' (valid HTML export) → succeeds
#    'image/png' → 400 INVALID_ARGUMENT
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "=== 6. drive.files.export mimeType enum validation ==="
EXPORT_OK=$(ws_call "{\"name\":\"drive.files.export\",\"arguments\":{\"fileId\":\"${SEED_DOC_ID}\",\"mimeType\":\"application/zip\"}}")
assert_contains "export-ok: exported=true"    "$EXPORT_OK" '"exported":true'
assert_contains "export-ok: mimeType zip"     "$EXPORT_OK" 'application/zip'
assert_not_contains "export-ok: no 400"       "$EXPORT_OK" '"code":400'

EXPORT_BAD=$(ws_call "{\"name\":\"drive.files.export\",\"arguments\":{\"fileId\":\"${SEED_DOC_ID}\",\"mimeType\":\"image/png\"}}")
assert_contains "export-bad: code 400"        "$EXPORT_BAD" '"code":400'
assert_contains "export-bad: INVALID_ARGUMENT" "$EXPORT_BAD" '"status":"INVALID_ARGUMENT"'
assert_not_contains "export-bad: no exported" "$EXPORT_BAD" '"exported"'

# ═══════════════════════════════════════════════════════════════════════════════
# 7. drive.files.update — state propagation
#    (a) {trashed:true} → files.list q="trashed = true" shows it
#    (b) {name:'RenamedFile'} renames
#    (c) addParents / removeParents moves (verify parentId changed)
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "=== 7. drive.files.update — trash / rename / move ==="

# Create a fresh doc to trash/rename/move without affecting other tests
CREATE_FOR_TRASH=$(ws_call '{"name":"docs.documents.create","arguments":{"title":"TrashTestDoc","parentId":"root"}}')
TRASH_DOC_ID=$(echo "$CREATE_FOR_TRASH" | grep -o '"documentId":"[^"]*"' | head -1 | sed 's/"documentId":"//;s/"//')
assert_contains "update-setup: created trash-test doc" "$CREATE_FOR_TRASH" '"documentId"'

# (a) trash it
TRASH_RESP=$(ws_call "{\"name\":\"drive.files.update\",\"arguments\":{\"fileId\":\"${TRASH_DOC_ID}\",\"trashed\":true}}")
assert_contains "update-trash: trashed=true in response" "$TRASH_RESP" '"trashed":true'

# Verify via files.list q="trashed = true"
TRASHED_LIST=$(ws_call '{"name":"drive.files.list","arguments":{"q":"trashed = true"}}')
assert_contains "update-trash: trashed doc in list" "$TRASHED_LIST" "${TRASH_DOC_ID}"

# (b) rename a different doc
CREATE_FOR_RENAME=$(ws_call '{"name":"docs.documents.create","arguments":{"title":"BeforeRename","parentId":"root"}}')
RENAME_DOC_ID=$(echo "$CREATE_FOR_RENAME" | grep -o '"documentId":"[^"]*"' | head -1 | sed 's/"documentId":"//;s/"//')
RENAME_RESP=$(ws_call "{\"name\":\"drive.files.update\",\"arguments\":{\"fileId\":\"${RENAME_DOC_ID}\",\"name\":\"AfterRename\"}}")
assert_contains "update-rename: name changed in response" "$RENAME_RESP" '"name":"AfterRename"'

# (c) move using addParents/removeParents
# Create a folder to move into
CREATE_FOLDER=$(ws_call '{"name":"drive.files.create","arguments":{"name":"MoveTargetFolder","mimeType":"application/vnd.google-apps.folder","parents":["root"]}}')
FOLDER_ID=$(echo "$CREATE_FOLDER" | grep -o '"id":"folder-[^"]*"' | head -1 | sed 's/"id":"//;s/"//')
assert_contains "update-move-setup: folder created" "$CREATE_FOLDER" '"kind":"drive#file"'

CREATE_FOR_MOVE=$(ws_call '{"name":"docs.documents.create","arguments":{"title":"MoveTestDoc","parentId":"root"}}')
MOVE_DOC_ID=$(echo "$CREATE_FOR_MOVE" | grep -o '"documentId":"[^"]*"' | head -1 | sed 's/"documentId":"//;s/"//')
MOVE_RESP=$(ws_call "{\"name\":\"drive.files.update\",\"arguments\":{\"fileId\":\"${MOVE_DOC_ID}\",\"addParents\":\"${FOLDER_ID}\",\"removeParents\":\"root\"}}")
assert_contains "update-move: response has id" "$MOVE_RESP" "\"id\":\"${MOVE_DOC_ID}\""

# Verify parent changed via files.list q="'FOLDER_ID' in parents"
MOVED_LIST=$(ws_call "{\"name\":\"drive.files.list\",\"arguments\":{\"q\":\"'${FOLDER_ID}' in parents\"}}")
assert_contains "update-move: doc in target folder" "$MOVED_LIST" "${MOVE_DOC_ID}"

# ═══════════════════════════════════════════════════════════════════════════════
# 8. drive.files.create (folder) + drive.files.copy
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "=== 8. drive.files.create folder + drive.files.copy ==="

# Create a folder
FOLDER_CREATE=$(ws_call '{"name":"drive.files.create","arguments":{"name":"SmokeFolderPhase2","mimeType":"application/vnd.google-apps.folder","parents":["root"]}}')
assert_contains "folder-create: kind drive#file" "$FOLDER_CREATE" '"kind":"drive#file"'
assert_contains "folder-create: correct mimeType" "$FOLDER_CREATE" '"mimeType":"application/vnd.google-apps.folder"'
CREATED_FOLDER_ID=$(echo "$FOLDER_CREATE" | grep -o '"id":"folder-[^"]*"' | head -1 | sed 's/"id":"//;s/"//')
assert_contains "folder-create: id present" "$FOLDER_CREATE" '"id"'

# Copy the seed doc
COPY_RESP=$(ws_call "{\"name\":\"drive.files.copy\",\"arguments\":{\"fileId\":\"${SEED_DOC_ID}\",\"name\":\"SmokeTestCopy\"}}")
assert_contains "copy: kind drive#file"          "$COPY_RESP" '"kind":"drive#file"'
assert_contains "copy: new name in response"     "$COPY_RESP" '"name":"SmokeTestCopy"'
# Extract the FIRST doc-* id in the response — that is the result id (not deep in state)
COPY_RESULT_ID=$(echo "$COPY_RESP" | grep -o '"id":"doc-[^"]*"' | head -1 | sed 's/"id":"//;s/"//')
# The copied file must have a DIFFERENT id from the original
if [ -n "$COPY_RESULT_ID" ] && [ "$COPY_RESULT_ID" != "${SEED_DOC_ID}" ]; then
  pass "copy: new id '${COPY_RESULT_ID}' differs from original '${SEED_DOC_ID}'"
else
  fail "copy: expected new id != '${SEED_DOC_ID}', got '${COPY_RESULT_ID}'"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# 9. unknown fileId → 404 NOT_FOUND with Google error envelope
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "=== 9. unknown fileId → 404 NOT_FOUND (error envelope) ==="
NF_RESP=$(ws_call '{"name":"drive.files.get","arguments":{"fileId":"no-such-file-xxxx"}}') || true
assert_contains "notfound: error.code 404"     "$NF_RESP" '"code":404'
assert_contains "notfound: status NOT_FOUND"   "$NF_RESP" '"status":"NOT_FOUND"'
assert_contains "notfound: domain global"      "$NF_RESP" '"domain":"global"'

# HTTP code must be 404
assert_http_code "notfound: HTTP 404" \
  "http://127.0.0.1:${TEST_PORT}/api/workspace/call" \
  '{"name":"drive.files.get","arguments":{"fileId":"no-such-file-xxxx"}}' "404"

# Also test via MCP path (error embedded in MCP error.data)
MCP_NF=$(mcp_call '{"jsonrpc":"2.0","id":99,"method":"tools/call","params":{"name":"drive.files.get","arguments":{"fileId":"no-such-file-xxxx"}}}')
assert_contains "notfound MCP: code -32000" "$MCP_NF" '-32000'
assert_contains "notfound MCP: NOT_FOUND in data" "$MCP_NF" 'NOT_FOUND'

# ═══════════════════════════════════════════════════════════════════════════════
# 10. Regression — Phase 1 tools still work
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "=== 10. Phase 1 regression: docs.documents.get + batchUpdate + export ==="

# docs.documents.get
GET_RESP=$(ws_call "{\"name\":\"docs.documents.get\",\"arguments\":{\"documentId\":\"${SEED_DOC_ID}\"}}")
assert_contains "p1-get: document returned"   "$GET_RESP" "${SEED_DOC_ID}"
assert_not_contains "p1-get: no error"        "$GET_RESP" '"code":400'

# docs.documents.batchUpdate (find-replace)
FR_RESP=$(ws_call "{\"name\":\"docs.documents.batchUpdate\",\"arguments\":{\"documentId\":\"${SEED_DOC_ID}\",\"requests\":[{\"replaceAllText\":{\"replaceText\":\"P1_SMOKE\",\"containsText\":{\"text\":\"Q3\",\"matchCase\":false}}}]}}")
assert_contains "p1-fr: result present"      "$FR_RESP" '"result"'
assert_not_contains "p1-fr: no 400"          "$FR_RESP" '"code":400'

# drive.files.export (pdf via full MIME)
EXP_RESP=$(ws_call "{\"name\":\"drive.files.export\",\"arguments\":{\"fileId\":\"${SEED_DOC_ID}\",\"mimeType\":\"application/pdf\"}}")
assert_contains "p1-export: exported=true"   "$EXP_RESP" '"exported":true'
assert_contains "p1-export: bytesBase64"     "$EXP_RESP" '"bytesBase64"'

# ═══════════════════════════════════════════════════════════════════════════════
# 11. drive.revisions.list + drive.revisions.get
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "=== 11. drive.revisions.list + drive.revisions.get ==="
REV_LIST=$(ws_call "{\"name\":\"drive.revisions.list\",\"arguments\":{\"fileId\":\"${SEED_DOC_ID}\"}}")
assert_contains "rev-list: kind drive#revisionList" "$REV_LIST" '"kind":"drive#revisionList"'
assert_contains "rev-list: revisions array" "$REV_LIST" '"revisions"'

# Get first revision id using grep (avoids parsing the large state blob)
REV_ID=$(echo "$REV_LIST" | grep -o '"id":"ver-[^"]*"' | head -1 | sed 's/"id":"//;s/"//')

if [ -n "$REV_ID" ]; then
  REV_GET=$(ws_call "{\"name\":\"drive.revisions.get\",\"arguments\":{\"fileId\":\"${SEED_DOC_ID}\",\"revisionId\":\"${REV_ID}\"}}")
  assert_contains "rev-get: kind drive#revision"   "$REV_GET" '"kind":"drive#revision"'
  assert_contains "rev-get: id matches"            "$REV_GET" "\"id\":\"${REV_ID}\""
else
  fail "rev-get: no revision found to fetch"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# 12. docs.documents.create + create_doc alias
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "=== 12. docs.documents.create / create_doc alias ==="
CREATE_RESP=$(ws_call '{"name":"docs.documents.create","arguments":{"title":"SmokeNewDoc","content":"Hello from Phase 2 smoke"}}')
assert_contains "create-doc: documentId present" "$CREATE_RESP" '"documentId"'
assert_contains "create-doc: title echoed"       "$CREATE_RESP" '"SmokeNewDoc"'
NEW_DOC_ID=$(echo "$CREATE_RESP" | grep -o '"documentId":"[^"]*"' | head -1 | sed 's/"documentId":"//;s/"//')

# create_doc alias
ALIAS_CREATE=$(ws_call '{"name":"create_doc","arguments":{"title":"SmokeAliasDoc"}}')
assert_contains "create_doc alias: documentId" "$ALIAS_CREATE" '"documentId"'

# ═══════════════════════════════════════════════════════════════════════════════
# 13. search_drive_files / search_docs / list_docs_in_folder aliases
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "=== 13. Convention-C search aliases ==="
SEARCH_RESP=$(ws_call '{"name":"search_drive_files","arguments":{"q":"trashed = false"}}')
assert_contains "search_drive_files: drive#fileList" "$SEARCH_RESP" '"kind":"drive#fileList"'

SDOCS_RESP=$(ws_call '{"name":"search_docs","arguments":{}}')
assert_contains "search_docs: drive#fileList" "$SDOCS_RESP" '"kind":"drive#fileList"'
# search_docs injects mimeType filter — all results must be docs (no folders)
assert_not_contains "search_docs: no folder mime" "$SDOCS_RESP" '"mimeType":"application/vnd.google-apps.folder"'

FOLDER_LIST=$(ws_call '{"name":"list_docs_in_folder","arguments":{"folder_id":"root"}}')
assert_contains "list_docs_in_folder: drive#fileList" "$FOLDER_LIST" '"kind":"drive#fileList"'

# ═══════════════════════════════════════════════════════════════════════════════
# 14. drive.files.delete — permanent delete
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "=== 14. drive.files.delete — permanent delete ==="
CREATE_FOR_DEL=$(ws_call '{"name":"docs.documents.create","arguments":{"title":"DeleteMeDoc"}}')
DEL_ID=$(echo "$CREATE_FOR_DEL" | grep -o '"documentId":"[^"]*"' | head -1 | sed 's/"documentId":"//;s/"//')
assert_contains "delete-setup: doc created" "$CREATE_FOR_DEL" '"documentId"'

DELETE_RESP=$(ws_call "{\"name\":\"drive.files.delete\",\"arguments\":{\"fileId\":\"${DEL_ID}\"}}")
assert_contains "delete: result present" "$DELETE_RESP" '"result"'

# File must be gone
AFTER_DEL=$(ws_call "{\"name\":\"drive.files.get\",\"arguments\":{\"fileId\":\"${DEL_ID}\"}}") || true
assert_contains "delete: file gone (404)" "$AFTER_DEL" '"code":404'

# ═══════════════════════════════════════════════════════════════════════════════
# 15. drive.permissions.delete
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "=== 15. drive.permissions.delete ==="
# Add a new permission then delete it. Use a unique email for isolation.
DEL_EMAIL="del-smoke-$(date +%s)@example.com"
PERM_ADD=$(ws_call "{\"name\":\"drive.permissions.create\",\"arguments\":{\"fileId\":\"${SEED_DOC_ID}\",\"role\":\"reader\",\"type\":\"user\",\"emailAddress\":\"${DEL_EMAIL}\"}}")
assert_contains "perm-delete-setup: created" "$PERM_ADD" '"kind":"drive#permission"'
# Extract the perm id using grep + sed (avoids parsing the full state blob)
PERM_ID=$(echo "$PERM_ADD" | grep -o '"id":"perm-[^"]*"' | head -1 | sed 's/"id":"//;s/"//')
assert_contains "perm-delete-setup: permId extracted" "$PERM_ID" 'perm-'

PERM_DEL=$(ws_call "{\"name\":\"drive.permissions.delete\",\"arguments\":{\"fileId\":\"${SEED_DOC_ID}\",\"permissionId\":\"${PERM_ID}\"}}")
assert_contains "perm-delete: result present" "$PERM_DEL" '"result"'

# The deleted permission must not appear in list — check list result only
PERM_LIST2=$(ws_call "{\"name\":\"drive.permissions.list\",\"arguments\":{\"fileId\":\"${SEED_DOC_ID}\"}}")
# Verify the deleted permission is not in the permissions list.
# We check the `permissions` key JSON — isolate it from the rest of the response
# by looking for the email ONLY in the permissions array context, not the state blob.
# Strategy: strip everything after the first "\"state\":" occurrence, then check.
PERM_RESULT_NO_STATE=$(echo "$PERM_LIST2" | sed 's/,"state":.*//')
assert_not_contains "perm-delete: gone from list result" "$PERM_RESULT_NO_STATE" "${DEL_EMAIL}"

# ═══════════════════════════════════════════════════════════════════════════════
# 16. Smoke is load-bearing: corrupt one assertion and verify it fails
#     (We test an assertion that SHOULD fail to confirm our harness catches it.)
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "=== 16. Load-bearing check — harness catches failures ==="
# We synthetically run an assert_contains that must FAIL (haystack lacks needle)
FAKE_RESP='{"result":{"files":[{"kind":"drive#file"}]}}'
SENTINEL_BEFORE=$FAIL
assert_contains "_load_bearing_intentional_fail_" "$FAKE_RESP" '"kind":"drive#WRONG"'
if [ "$FAIL" -gt "$SENTINEL_BEFORE" ]; then
  # Good — the harness caught it. Now increment PASS and decrement FAIL
  # to cancel this "expected failure" from the total.
  PASS=$((PASS+1))
  FAIL=$((FAIL-1))
  echo "  PASS  load-bearing: harness correctly caught the injected failure"
else
  fail "load-bearing: harness did NOT catch a false assertion"
fi

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
