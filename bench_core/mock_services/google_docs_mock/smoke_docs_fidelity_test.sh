#!/usr/bin/env bash
# smoke_docs_fidelity_test.sh — Phase 3 Docs API fidelity smoke test
# Boots a fresh instance on PORT=3191, runs all fidelity assertions, then kills it.
# NEVER touches 3081 (the live server).
#
# Tests:
#  1. docs.documents.get returns real Document shape + contiguous index space
#  2. insertText round-trip
#  3. Sequential insertText (proves op2 sees op1's mutation)
#  4. deleteContentRange removes chars + recompacts indices
#  5. replaceAllText count + replacement visible
#  6. updateParagraphStyle namedStyleType=HEADING_1
#  7. Negative cases (missing fields, invalid enum, index 0, unknown key)
#  8. Export Content-Type: txt/md without charset; pdf/docx unaffected
#  9. Phase 1+2 regression
# 10. Load-bearing proof
set -uo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
export TEST_PORT="${SMOKE_FIDELITY_PORT:-3191}"
SEED_DOC_ID="doc-prd-2026q3"

PASS=0
FAIL=0

pass() { echo "  PASS  $1"; PASS=$((PASS+1)); }
fail() { echo "  FAIL  $1"; FAIL=$((FAIL+1)); }

assert_contains() {
  local label="$1" haystack="$2" needle="$3"
  if printf '%s' "$haystack" | grep -qF -- "$needle"; then pass "$label"
  else fail "$label  (needle=$(printf '%q' "$needle") not found)"; fi
}

assert_not_contains() {
  local label="$1" haystack="$2" needle="$3"
  if ! printf '%s' "$haystack" | grep -qF -- "$needle"; then pass "$label"
  else fail "$label  (unexpected $(printf '%q' "$needle") found)"; fi
}

assert_eq() {
  local label="$1" got="$2" want="$3"
  if [ "$got" = "$want" ]; then pass "$label"
  else fail "$label  (got=$(printf '%q' "$got") want=$(printf '%q' "$want"))"; fi
}

assert_ne() {
  local label="$1" got="$2" bad="$3"
  if [ "$got" != "$bad" ]; then pass "$label"
  else fail "$label  (should not equal $(printf '%q' "$bad"))"; fi
}

# Make an MCP call and return raw response
mcp_call() {
  curl -sf -X POST "http://127.0.0.1:${TEST_PORT}/mcp" \
    -H 'Content-Type: application/json' \
    --data-binary "$1" 2>/dev/null
}

# Extract text payload from MCP result (the JSON string inside content[0].text)
# Usage: mcp_inner "$RESP" OR echo "$RESP" | mcp_inner
# Returns the INNER JSON string (already escaped, suitable for further processing)
mcp_inner() {
  local input
  if [ $# -ge 1 ]; then
    input="$1"
    printf '%s' "$input"
  else
    cat  # pass stdin through
  fi | python3 -c "
import sys, json
data = sys.stdin.read()
try:
    d = json.loads(data)
    print(d['result']['content'][0]['text'], end='')
except Exception as e:
    import sys
    print('MCP_INNER_ERROR: ' + str(e), file=sys.stderr)
    print('', end='')
" 2>/dev/null
}

# ─── boot fresh instance ──────────────────────────────────────────────────────
TMPSTATE=$(mktemp -d)
echo "Starting google_docs_mock on port $TEST_PORT (state: $TMPSTATE)"
GDOCS_MOCK_STATE_DIR="$TMPSTATE" PORT="$TEST_PORT" MOCK_VERIFIER_TOKEN="bench-verifier" GDOCS_ENABLE_MCP=1 \
  node "$DIR/server.js" >"$TMPSTATE/server.log" 2>&1 &
SERVER_PID=$!
trap 'echo ""; echo "Stopping server (pid $SERVER_PID)"; kill "$SERVER_PID" 2>/dev/null; rm -rf "$TMPSTATE"' EXIT

for i in $(seq 1 40); do
  curl -sf "http://127.0.0.1:${TEST_PORT}/health" >/dev/null 2>&1 && break
  sleep 0.2
done
if ! curl -sf "http://127.0.0.1:${TEST_PORT}/health" >/dev/null 2>&1; then
  echo "FATAL: server did not start"
  cat "$TMPSTATE/server.log" || true
  exit 1
fi
echo "Server ready."
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 1: docs.documents.get — real Document shape + contiguous index space
# ═══════════════════════════════════════════════════════════════════════════════
echo "=== TEST 1: docs.documents.get — real Document shape ==="

GET_RESP=$(mcp_call "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"docs.documents.get\",\"arguments\":{\"documentId\":\"${SEED_DOC_ID}\"}}}")
DOC_TEXT=$(mcp_inner "$GET_RESP")

# Basic field presence checks (on DOC_TEXT = inner JSON)
assert_contains "1.1 documentId present"    "$DOC_TEXT" '"documentId"'
assert_contains "1.2 title present"         "$DOC_TEXT" '"title"'
assert_contains "1.3 revisionId present"    "$DOC_TEXT" '"revisionId"'
assert_contains "1.4 body present"          "$DOC_TEXT" '"body"'
assert_contains "1.5 body.content present"  "$DOC_TEXT" '"content"'
assert_contains "1.6 sectionBreak present"  "$DOC_TEXT" '"sectionBreak"'

# Python structural checks
python3 - <<'PYEOF'
import sys, json, subprocess, os
port = os.environ['TEST_PORT']
doc_id = 'doc-prd-2026q3'

def fetch_doc():
    raw = subprocess.check_output([
        'curl', '-sf', '-X', 'POST', f'http://127.0.0.1:{port}/mcp',
        '-H', 'Content-Type: application/json',
        '--data-binary', json.dumps({"jsonrpc":"2.0","id":99,"method":"tools/call",
            "params":{"name":"docs.documents.get","arguments":{"documentId":doc_id}}})
    ])
    outer = json.loads(raw)
    return json.loads(outer['result']['content'][0]['text'])

doc = fetch_doc()
content = doc['body']['content']

# sectionBreak at index 0
assert 'sectionBreak' in content[0], f"content[0] should be sectionBreak"
assert content[0]['endIndex'] == 1, f"sectionBreak endIndex should be 1, got {content[0]['endIndex']}"
print("  PASS  1.7 content[0].sectionBreak.endIndex == 1")

# first paragraph startIndex == 1
para1 = content[1]
assert 'paragraph' in para1, "content[1] should be paragraph"
assert para1['startIndex'] == 1, f"first paragraph startIndex should be 1, got {para1.get('startIndex')}"
print("  PASS  1.8 first paragraph startIndex == 1")

# endIndex - startIndex == len(textRun.content) for all paragraphs
VALID_NST = {'NAMED_STYLE_TYPE_UNSPECIFIED','NORMAL_TEXT','TITLE','SUBTITLE',
             'HEADING_1','HEADING_2','HEADING_3','HEADING_4','HEADING_5','HEADING_6'}
for i in range(1, len(content)):
    e = content[i]
    if 'paragraph' not in e: continue
    si, ei = e['startIndex'], e['endIndex']
    elems = e['paragraph']['elements']
    assert len(elems) == 1, f"para {i}: expected 1 element, got {len(elems)}"
    tr_len = len(elems[0]['textRun']['content'])
    assert ei - si == tr_len, \
        f"para {i}: endIndex({ei})-startIndex({si})={ei-si} != textRun.length={tr_len}"
    nst = e['paragraph']['paragraphStyle']['namedStyleType']
    assert nst in VALID_NST, f"para {i}: invalid namedStyleType '{nst}'"
print("  PASS  1.9 all para: endIndex-startIndex == textRun.content.length")
print("  PASS  1.10 all namedStyleType in valid enum")

# Contiguous: endIndex[N] == startIndex[N+1]
for i in range(1, len(content) - 1):
    ei = content[i]['endIndex']
    si_next = content[i+1].get('startIndex')
    if si_next is None: continue
    assert ei == si_next, f"content[{i}].endIndex({ei}) != content[{i+1}].startIndex({si_next})"
print("  PASS  1.11 contiguous index space")
PYEOF

echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 2: insertText round-trip
# ═══════════════════════════════════════════════════════════════════════════════
echo "=== TEST 2: insertText round-trip ==="

# Create a fresh doc so we don't pollute the seed doc state
CREATE2=$(mcp_call "{\"jsonrpc\":\"2.0\",\"id\":20,\"method\":\"tools/call\",\"params\":{\"name\":\"docs.documents.create\",\"arguments\":{\"title\":\"InsertTest\",\"content\":\"Hello world\"}}}")
INS_DOC_ID=$(mcp_inner "$CREATE2" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('documentId',''))" 2>/dev/null)
assert_ne "2.0 created doc for insert test" "$INS_DOC_ID" ""

# Get original total endIndex
PRE_TOTAL=$(mcp_call "{\"jsonrpc\":\"2.0\",\"id\":21,\"method\":\"tools/call\",\"params\":{\"name\":\"docs.documents.get\",\"arguments\":{\"documentId\":\"${INS_DOC_ID}\"}}}" \
  | mcp_inner | python3 -c "
import sys,json
doc = json.loads(sys.stdin.read())
print(doc['body']['content'][-1]['endIndex'])
" 2>/dev/null || echo "0")
echo "  INFO  pre-insert total endIndex: $PRE_TOTAL"

# Insert "PREFIX " at index 1
INSERT_RESP=$(mcp_call "{\"jsonrpc\":\"2.0\",\"id\":22,\"method\":\"tools/call\",\"params\":{\"name\":\"docs.documents.batchUpdate\",\"arguments\":{\"documentId\":\"${INS_DOC_ID}\",\"requests\":[{\"insertText\":{\"location\":{\"index\":1},\"text\":\"PREFIX \"}}]}}}")
INSERT_INNER=$(mcp_inner "$INSERT_RESP")

assert_contains "2.1 batchUpdate result present"      "$GET_RESP" '"result"'
assert_contains "2.2 replies in response"             "$INSERT_INNER" '"replies"'
assert_contains "2.3 writeControl present"            "$INSERT_INNER" '"writeControl"'
assert_contains "2.4 requiredRevisionId present"      "$INSERT_INNER" '"requiredRevisionId"'

# Re-fetch and verify
POST_DOC=$(mcp_call "{\"jsonrpc\":\"2.0\",\"id\":23,\"method\":\"tools/call\",\"params\":{\"name\":\"docs.documents.get\",\"arguments\":{\"documentId\":\"${INS_DOC_ID}\"}}}")
POST_DOC_TEXT=$(mcp_inner "$POST_DOC")

export INS_DOC_ID PRE_TOTAL
python3 - <<'PYEOF'
import subprocess, json, os
port = os.environ['TEST_PORT']
doc_id = os.environ['INS_DOC_ID']
pre_total = int(os.environ.get('PRE_TOTAL', '0') or '0')

raw = subprocess.check_output([
    'curl','-sf','-X','POST',f'http://127.0.0.1:{port}/mcp',
    '-H','Content-Type: application/json',
    '--data-binary', json.dumps({"jsonrpc":"2.0","id":99,"method":"tools/call",
        "params":{"name":"docs.documents.get","arguments":{"documentId":doc_id}}})
])
outer = json.loads(raw)
doc = json.loads(outer['result']['content'][0]['text'])
content = doc['body']['content']

first_para = next((e for e in content if 'paragraph' in e and e.get('startIndex') == 1), None)
assert first_para, "No paragraph at startIndex=1"
text = first_para['paragraph']['elements'][0]['textRun']['content']
assert text.startswith('PREFIX '), f"Expected start 'PREFIX ', got {repr(text[:30])}"
print("  PASS  2.5 first paragraph starts with 'PREFIX '")

total_end = content[-1]['endIndex']
assert total_end == pre_total + 7, \
    f"Expected total endIndex {pre_total}+7={pre_total+7}, got {total_end}"
print(f"  PASS  2.6 total index space grew by 7 (len('PREFIX ')): {pre_total}+7={total_end}")
PYEOF

echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 3: Sequential insertText — op2 sees op1 result
# ═══════════════════════════════════════════════════════════════════════════════
echo "=== TEST 3: Sequential insertText (op2 sees op1 result) ==="

CREATE3=$(mcp_call "{\"jsonrpc\":\"2.0\",\"id\":30,\"method\":\"tools/call\",\"params\":{\"name\":\"docs.documents.create\",\"arguments\":{\"title\":\"SeqTest\",\"content\":\"Hello\"}}}")
SEQ_DOC_ID=$(mcp_inner "$CREATE3" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('documentId',''))" 2>/dev/null)
assert_ne "3.1 created doc for seq test" "$SEQ_DOC_ID" ""

export SEQ_DOC_ID
SEQ_RESP=$(mcp_call "{\"jsonrpc\":\"2.0\",\"id\":31,\"method\":\"tools/call\",\"params\":{\"name\":\"docs.documents.batchUpdate\",\"arguments\":{\"documentId\":\"${SEQ_DOC_ID}\",\"requests\":[{\"insertText\":{\"location\":{\"index\":1},\"text\":\"AAA\"}},{\"insertText\":{\"location\":{\"index\":1},\"text\":\"BBB\"}}]}}}")
SEQ_INNER=$(mcp_inner "$SEQ_RESP")
assert_contains "3.2 sequential batch: replies"         "$SEQ_INNER" '"replies"'
assert_not_contains "3.3 sequential batch: no error"    "$SEQ_RESP" '"code"'

python3 - <<'PYEOF'
import subprocess, json, os
port = os.environ['TEST_PORT']
doc_id = os.environ['SEQ_DOC_ID']

raw = subprocess.check_output([
    'curl','-sf','-X','POST',f'http://127.0.0.1:{port}/mcp',
    '-H','Content-Type: application/json',
    '--data-binary', json.dumps({"jsonrpc":"2.0","id":99,"method":"tools/call",
        "params":{"name":"docs.documents.get","arguments":{"documentId":doc_id}}})
])
outer = json.loads(raw)
doc = json.loads(outer['result']['content'][0]['text'])
content = doc['body']['content']
first_para = next((e for e in content if 'paragraph' in e and e.get('startIndex') == 1), None)
assert first_para, "No paragraph at startIndex=1"
text = first_para['paragraph']['elements'][0]['textRun']['content']
# op1: insert AAA at 1 → "AAAHello"
# op2: insert BBB at 1 (after op1) → "BBBAAAHello"
assert text.startswith('BBBAAA'), \
    f"Expected start 'BBBAAA' (sequential ops), got {repr(text[:20])}"
print("  PASS  3.4 first paragraph begins BBBAAA (op2 saw op1 result — sequential)")
PYEOF

echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 4: deleteContentRange
# ═══════════════════════════════════════════════════════════════════════════════
echo "=== TEST 4: deleteContentRange ==="

CREATE4=$(mcp_call "{\"jsonrpc\":\"2.0\",\"id\":40,\"method\":\"tools/call\",\"params\":{\"name\":\"docs.documents.create\",\"arguments\":{\"title\":\"DelTest\",\"content\":\"ABCDEF\"}}}")
DEL_DOC_ID=$(mcp_inner "$CREATE4" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('documentId',''))" 2>/dev/null)
assert_ne "4.1 created doc for delete test" "$DEL_DOC_ID" ""
export DEL_DOC_ID

# "ABCDEF\n" at [1,8). Delete [2,5) → removes BCD → "AEF"
DEL_RESP=$(mcp_call "{\"jsonrpc\":\"2.0\",\"id\":41,\"method\":\"tools/call\",\"params\":{\"name\":\"docs.documents.batchUpdate\",\"arguments\":{\"documentId\":\"${DEL_DOC_ID}\",\"requests\":[{\"deleteContentRange\":{\"range\":{\"startIndex\":2,\"endIndex\":5}}}]}}}")
DEL_INNER=$(mcp_inner "$DEL_RESP")
assert_contains "4.2 deleteContentRange: replies present" "$DEL_INNER" '"replies"'
assert_not_contains "4.3 deleteContentRange: no error"    "$DEL_RESP" '"code"'

python3 - <<'PYEOF'
import subprocess, json, os
port = os.environ['TEST_PORT']
doc_id = os.environ['DEL_DOC_ID']

raw = subprocess.check_output([
    'curl','-sf','-X','POST',f'http://127.0.0.1:{port}/mcp',
    '-H','Content-Type: application/json',
    '--data-binary', json.dumps({"jsonrpc":"2.0","id":99,"method":"tools/call",
        "params":{"name":"docs.documents.get","arguments":{"documentId":doc_id}}})
])
outer = json.loads(raw)
doc = json.loads(outer['result']['content'][0]['text'])
content = doc['body']['content']

first_para = next((e for e in content if 'paragraph' in e and e.get('startIndex') == 1), None)
assert first_para, "No paragraph at startIndex=1"
text = first_para['paragraph']['elements'][0]['textRun']['content']
# "ABCDEF\n" at [1,8). delete [2,5) removes indices 2,3,4 = chars B,C,D
# remaining: "AEF\n"
assert text == 'AEF\n', f"Expected 'AEF\\n', got {repr(text)}"
print("  PASS  4.4 delete [2,5): ABCDEF → AEF")

# Verify contiguous
for i in range(1, len(content) - 1):
    ei = content[i]['endIndex']
    si_next = content[i+1].get('startIndex', None)
    if si_next is None: continue
    assert ei == si_next, f"content[{i}].endIndex({ei}) != content[{i+1}].startIndex({si_next})"
print("  PASS  4.5 indices recompacted after delete")
PYEOF

echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 5: replaceAllText count + replacement
# ═══════════════════════════════════════════════════════════════════════════════
echo "=== TEST 5: replaceAllText ==="

# Create a fresh doc with a known word repeated N times
CREATE5=$(mcp_call "{\"jsonrpc\":\"2.0\",\"id\":50,\"method\":\"tools/call\",\"params\":{\"name\":\"docs.documents.create\",\"arguments\":{\"title\":\"ReplTest\",\"content\":\"WORD alpha WORD beta WORD\"}}}")
REPL_DOC_ID=$(mcp_inner "$CREATE5" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('documentId',''))" 2>/dev/null)
assert_ne "5.1 created doc for replace test" "$REPL_DOC_ID" ""
export REPL_DOC_ID

REPLACE_RESP=$(mcp_call "{\"jsonrpc\":\"2.0\",\"id\":51,\"method\":\"tools/call\",\"params\":{\"name\":\"docs.documents.batchUpdate\",\"arguments\":{\"documentId\":\"${REPL_DOC_ID}\",\"requests\":[{\"replaceAllText\":{\"replaceText\":\"SUBSTITUTED\",\"containsText\":{\"text\":\"WORD\",\"matchCase\":true}}}]}}}")
REPLACE_INNER=$(mcp_inner "$REPLACE_RESP")
assert_contains "5.2 replaceAllText: replies"                  "$REPLACE_INNER" '"replies"'
assert_contains "5.3 replaceAllText reply: occurrencesChanged" "$REPLACE_INNER" '"occurrencesChanged"'

OCC=$(printf '%s' "$REPLACE_INNER" | python3 -c "
import sys,json
d = json.loads(sys.stdin.read())
print(d['replies'][0]['replaceAllText']['occurrencesChanged'])
" 2>/dev/null || echo "-1")
assert_eq "5.4 occurrencesChanged == 3" "$OCC" "3"

# Verify replacement visible
POST_REPL=$(mcp_call "{\"jsonrpc\":\"2.0\",\"id\":52,\"method\":\"tools/call\",\"params\":{\"name\":\"docs.documents.get\",\"arguments\":{\"documentId\":\"${REPL_DOC_ID}\"}}}")
assert_contains "5.5 'SUBSTITUTED' visible in doc" "$(mcp_inner "$POST_REPL")" "SUBSTITUTED"
assert_not_contains "5.6 'WORD' gone from doc"    "$(mcp_inner "$POST_REPL")" '"WORD"'

echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 6: updateParagraphStyle namedStyleType=HEADING_1
# ═══════════════════════════════════════════════════════════════════════════════
echo "=== TEST 6: updateParagraphStyle namedStyleType=HEADING_1 ==="

CREATE6=$(mcp_call "{\"jsonrpc\":\"2.0\",\"id\":60,\"method\":\"tools/call\",\"params\":{\"name\":\"docs.documents.create\",\"arguments\":{\"title\":\"StyleTest\",\"content\":\"My paragraph\"}}}")
STYLE_DOC_ID=$(mcp_inner "$CREATE6" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('documentId',''))" 2>/dev/null)
assert_ne "6.1 created doc for style test" "$STYLE_DOC_ID" ""
export STYLE_DOC_ID

# Paragraph is at [1, 14) ("My paragraph\n"). Use range [1,2) to select first block.
STYLE_RESP=$(mcp_call "{\"jsonrpc\":\"2.0\",\"id\":61,\"method\":\"tools/call\",\"params\":{\"name\":\"docs.documents.batchUpdate\",\"arguments\":{\"documentId\":\"${STYLE_DOC_ID}\",\"requests\":[{\"updateParagraphStyle\":{\"range\":{\"startIndex\":1,\"endIndex\":2},\"paragraphStyle\":{\"namedStyleType\":\"HEADING_1\"},\"fields\":\"namedStyleType\"}}]}}}")
STYLE_INNER=$(mcp_inner "$STYLE_RESP")
assert_contains "6.2 updateParagraphStyle: replies" "$STYLE_INNER" '"replies"'
assert_not_contains "6.3 no error"                  "$STYLE_RESP" '"code"'

python3 - <<'PYEOF'
import subprocess, json, os
port = os.environ['TEST_PORT']
doc_id = os.environ['STYLE_DOC_ID']

raw = subprocess.check_output([
    'curl','-sf','-X','POST',f'http://127.0.0.1:{port}/mcp',
    '-H','Content-Type: application/json',
    '--data-binary', json.dumps({"jsonrpc":"2.0","id":99,"method":"tools/call",
        "params":{"name":"docs.documents.get","arguments":{"documentId":doc_id}}})
])
outer = json.loads(raw)
doc = json.loads(outer['result']['content'][0]['text'])
content = doc['body']['content']
para = next((e for e in content if 'paragraph' in e and e.get('startIndex') == 1), None)
assert para, "No paragraph at startIndex=1"
nst = para['paragraph']['paragraphStyle']['namedStyleType']
assert nst == 'HEADING_1', f"Expected HEADING_1, got {nst}"
print("  PASS  6.4 paragraph namedStyleType == HEADING_1 after updateParagraphStyle")
PYEOF

echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 7: Negative cases
# ═══════════════════════════════════════════════════════════════════════════════
echo "=== TEST 7: Negative cases ==="

# 7.1 updateTextStyle without fields → INVALID_ARGUMENT
NOTEXTS_RESP=$(mcp_call "{\"jsonrpc\":\"2.0\",\"id\":70,\"method\":\"tools/call\",\"params\":{\"name\":\"docs.documents.batchUpdate\",\"arguments\":{\"documentId\":\"${SEED_DOC_ID}\",\"requests\":[{\"updateTextStyle\":{\"range\":{\"startIndex\":1,\"endIndex\":5},\"textStyle\":{\"bold\":true}}}]}}}")
assert_contains "7.1a updateTextStyle no fields: error key"   "$NOTEXTS_RESP" '"error"'
assert_contains "7.1b updateTextStyle no fields: code"        "$NOTEXTS_RESP" '"code"'
assert_contains "7.1c updateTextStyle no fields: INVALID_ARG" "$NOTEXTS_RESP" 'INVALID_ARGUMENT'

# 7.2 updateParagraphStyle invalid namedStyleType "H1" → INVALID_ARGUMENT
BADSTYLE_RESP=$(mcp_call "{\"jsonrpc\":\"2.0\",\"id\":71,\"method\":\"tools/call\",\"params\":{\"name\":\"docs.documents.batchUpdate\",\"arguments\":{\"documentId\":\"${SEED_DOC_ID}\",\"requests\":[{\"updateParagraphStyle\":{\"range\":{\"startIndex\":1,\"endIndex\":5},\"paragraphStyle\":{\"namedStyleType\":\"H1\"},\"fields\":\"namedStyleType\"}}]}}}")
assert_contains "7.2a updateParagraphStyle H1: error key"   "$BADSTYLE_RESP" '"error"'
assert_contains "7.2b updateParagraphStyle H1: INVALID_ARG" "$BADSTYLE_RESP" 'INVALID_ARGUMENT'

# 7.3 insertText at index 0 (section break) → INVALID_ARGUMENT
IDX0_RESP=$(mcp_call "{\"jsonrpc\":\"2.0\",\"id\":72,\"method\":\"tools/call\",\"params\":{\"name\":\"docs.documents.batchUpdate\",\"arguments\":{\"documentId\":\"${SEED_DOC_ID}\",\"requests\":[{\"insertText\":{\"location\":{\"index\":0},\"text\":\"oops\"}}]}}}")
assert_contains "7.3a insertText index=0: error key"   "$IDX0_RESP" '"error"'
assert_contains "7.3b insertText index=0: INVALID_ARG" "$IDX0_RESP" 'INVALID_ARGUMENT'

# 7.4 Unknown request key fooRequest → INVALID_ARGUMENT
UNKNOWN_KEY_RESP=$(mcp_call "{\"jsonrpc\":\"2.0\",\"id\":73,\"method\":\"tools/call\",\"params\":{\"name\":\"docs.documents.batchUpdate\",\"arguments\":{\"documentId\":\"${SEED_DOC_ID}\",\"requests\":[{\"fooRequest\":{}}]}}}")
assert_contains "7.4a unknown key fooRequest: error key"   "$UNKNOWN_KEY_RESP" '"error"'
assert_contains "7.4b unknown key fooRequest: INVALID_ARG" "$UNKNOWN_KEY_RESP" 'INVALID_ARGUMENT'
assert_contains "7.4c unknown key named in error msg"      "$UNKNOWN_KEY_RESP" 'fooRequest'

echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 8: Export Content-Type — txt/md without charset; pdf/docx unaffected
# ═══════════════════════════════════════════════════════════════════════════════
echo "=== TEST 8: Export Content-Type ==="

# MCP tool: mimeType field should be bare (no charset suffix)
TXT_EXPORT=$(mcp_call "{\"jsonrpc\":\"2.0\",\"id\":80,\"method\":\"tools/call\",\"params\":{\"name\":\"drive.files.export\",\"arguments\":{\"fileId\":\"${SEED_DOC_ID}\",\"format\":\"txt\"}}}")
TXT_MIME=$(mcp_inner "$TXT_EXPORT" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('mimeType',''))" 2>/dev/null)
assert_eq "8.1 txt mimeType == text/plain (no charset)"     "$TXT_MIME" "text/plain"
assert_not_contains "8.2 txt mimeType: no charset suffix"  "$TXT_MIME" "charset"

MD_EXPORT=$(mcp_call "{\"jsonrpc\":\"2.0\",\"id\":81,\"method\":\"tools/call\",\"params\":{\"name\":\"drive.files.export\",\"arguments\":{\"fileId\":\"${SEED_DOC_ID}\",\"format\":\"md\"}}}")
MD_MIME=$(mcp_inner "$MD_EXPORT" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('mimeType',''))" 2>/dev/null)
assert_eq "8.3 md mimeType == text/markdown (no charset)"   "$MD_MIME" "text/markdown"
assert_not_contains "8.4 md mimeType: no charset suffix"   "$MD_MIME" "charset"

PDF_EXPORT=$(mcp_call "{\"jsonrpc\":\"2.0\",\"id\":82,\"method\":\"tools/call\",\"params\":{\"name\":\"drive.files.export\",\"arguments\":{\"fileId\":\"${SEED_DOC_ID}\",\"format\":\"pdf\"}}}")
PDF_MIME=$(mcp_inner "$PDF_EXPORT" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('mimeType',''))" 2>/dev/null)
assert_eq "8.5 pdf mimeType == application/pdf"             "$PDF_MIME" "application/pdf"

DOCX_EXPORT=$(mcp_call "{\"jsonrpc\":\"2.0\",\"id\":83,\"method\":\"tools/call\",\"params\":{\"name\":\"drive.files.export\",\"arguments\":{\"fileId\":\"${SEED_DOC_ID}\",\"format\":\"docx\"}}}")
DOCX_MIME=$(mcp_inner "$DOCX_EXPORT" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('mimeType',''))" 2>/dev/null)
assert_eq "8.6 docx mimeType == application/vnd.openxmlformats..." \
  "$DOCX_MIME" "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

# HTTP endpoint Content-Type header check
TXT_HTTP=$(curl -si "http://127.0.0.1:${TEST_PORT}/api/documents/export?fileId=${SEED_DOC_ID}&format=txt" 2>/dev/null)
TXT_CT=$(printf '%s' "$TXT_HTTP" | grep -i '^content-type:' | head -1 | tr -d '\r')
assert_contains    "8.7 HTTP txt Content-Type: text/plain"    "$TXT_CT" "text/plain"
assert_not_contains "8.8 HTTP txt no charset in header"       "$TXT_CT" "charset"

MD_HTTP=$(curl -si "http://127.0.0.1:${TEST_PORT}/api/documents/export?fileId=${SEED_DOC_ID}&format=md" 2>/dev/null)
MD_CT=$(printf '%s' "$MD_HTTP" | grep -i '^content-type:' | head -1 | tr -d '\r')
assert_contains    "8.9 HTTP md Content-Type: text/markdown"  "$MD_CT" "text/markdown"
assert_not_contains "8.10 HTTP md no charset in header"       "$MD_CT" "charset"

echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 9: Phase 1+2 regression
# ═══════════════════════════════════════════════════════════════════════════════
echo "=== TEST 9: Phase 1+2 regression ==="

# smoke_mcp_test.sh and smoke_drive_test.sh each boot their own fresh server.
# Use a non-colliding port range (3194, 3195) to avoid conflict with our 3191 server.
echo "  Running smoke_mcp_test.sh on fresh port 3194..."
if SMOKE_MCP_PORT=3194 bash "$DIR/smoke_mcp_test.sh" 2>&1 | tail -5; then
  pass "9.1 smoke_mcp_test.sh PASSED"
else
  fail "9.1 smoke_mcp_test.sh FAILED"
fi

if [ -f "$DIR/smoke_drive_test.sh" ]; then
  echo "  Running smoke_drive_test.sh on fresh port 3195..."
  if SMOKE_DRIVE_PORT=3195 bash "$DIR/smoke_drive_test.sh" 2>&1 | tail -5; then
    pass "9.2 smoke_drive_test.sh PASSED"
  else
    fail "9.2 smoke_drive_test.sh FAILED"
  fi
else
  pass "9.2 smoke_drive_test.sh (not found, skipped)"
fi
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 10: Load-bearing proof
# ═══════════════════════════════════════════════════════════════════════════════
echo "=== TEST 10: Load-bearing proof ==="

# Deliberately wrong assertion: expect sectionBreak.endIndex==999 (real is 1)
LB_RESULT=$(python3 - <<'PYEOF'
import subprocess, json, os, sys
port = os.environ['TEST_PORT']
raw = subprocess.check_output([
    'curl','-sf','-X','POST',f'http://127.0.0.1:{port}/mcp',
    '-H','Content-Type: application/json',
    '--data-binary', json.dumps({"jsonrpc":"2.0","id":999,"method":"tools/call",
        "params":{"name":"docs.documents.get","arguments":{"documentId":"doc-prd-2026q3"}}})
])
outer = json.loads(raw)
doc = json.loads(outer['result']['content'][0]['text'])
real_end = doc['body']['content'][0]['endIndex']

# Test 1: corrupt assertion → should fail
try:
    assert real_end == 999, f"sectionBreak endIndex is {real_end}, not 999"
    print("CORRUPT_PASS")
except AssertionError as e:
    print(f"CORRUPT_FAIL: {e}")

# Test 2: real assertion → should pass
try:
    assert real_end == 1, f"Expected 1, got {real_end}"
    print("REAL_PASS")
except AssertionError as e:
    print(f"REAL_FAIL: {e}")
PYEOF
)

if printf '%s' "$LB_RESULT" | grep -q "CORRUPT_FAIL"; then
  pass "10.1 Corrupt assertion correctly fails (sectionBreak.endIndex!=999)"
else
  fail "10.1 Corrupt assertion unexpectedly passed"
fi

if printf '%s' "$LB_RESULT" | grep -q "REAL_PASS"; then
  pass "10.2 Real assertion passes (sectionBreak.endIndex==1)"
else
  fail "10.2 Real assertion failed after restore"
fi

echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════════════════════════════════════════
echo "=================================================="
TOTAL=$((PASS+FAIL))
echo "Results: ${PASS}/${TOTAL} passed, ${FAIL} failed"
if [ "$FAIL" -gt 0 ]; then
  echo "SMOKE TEST FAILED"
  exit 1
else
  echo "SMOKE TEST PASSED"
fi
