#!/usr/bin/env bash
# Byte-diff smoke for the Shopify CLI mock.
#
# - Boots a fresh backend on a scratch port (default 3197; SMOKE_DIFF_PORT override).
# - Runs the mock CLI for the same surface area we captured against real
#   shopify@4.1.0 (see golden_real_cli/).
# - Diffs mock stdout/stderr/exit byte-for-byte against the captured goldens.
# - Real captures were taken against the user's live test store
#   (i415x6-zf.myshopify.com); the mock canonical fqdn is overridden via
#   MOCK_STORE_FQDN env so that diff lines align cell-by-cell.
# - Node version is the one true env-specific value (host vs capture host); it
#   is normalized before diff.
#
# Does NOT touch the user's :3062 dev server or the :3098 bench default port.
#
# Usage: bash smoke_byte_diff.sh
set -u

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${SMOKE_DIFF_PORT:-3197}"
TOKEN="cli-byte-diff-bench-token"
B="http://127.0.0.1:${PORT}"
PASS=0; FAIL=0; FAIL_LIST=()
TMPROOT="$(mktemp -d -t shopify-cli-bytediff.XXXXXX)"
LOG="$TMPROOT/server.log"
PID_FILE="$TMPROOT/server.pid"
GOLDEN_DIR="$DIR/golden_real_cli"
NORM_REAL="$TMPROOT/golden-norm"
NORM_MOCK="$TMPROOT/mock-norm"
MOCK_OUT="$TMPROOT/mock-out"

cleanup() {
  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid=$(cat "$PID_FILE")
    if [[ -n "$pid" ]]; then kill "$pid" 2>/dev/null || true; fi
  fi
  rm -rf "$TMPROOT"
}
trap cleanup EXIT

ok()   { PASS=$((PASS+1)); printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail() { FAIL=$((FAIL+1)); FAIL_LIST+=("$1"); printf '  \033[31m✗\033[0m %s\n' "$1"; }
hdr()  { printf '\n=== %s ===\n' "$1"; }

if [[ ! -d "$GOLDEN_DIR" ]]; then
  echo "golden_real_cli/ missing — run the capture script first." >&2
  exit 1
fi

hdr "Starting backend on :${PORT}"
( cd "$DIR" && PORT="$PORT" MOCK_VERIFIER_TOKEN="$TOKEN" bun server.js >"$LOG" 2>&1 & echo $! > "$PID_FILE" )
ready=0
for _ in $(seq 1 50); do
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
export MOCK_STORE_FQDN=i415x6-zf.myshopify.com  # align with golden capture context

# ---------------------------------------------------------------------------
hdr "Capturing mock output for byte diff"
# ---------------------------------------------------------------------------

mkdir -p "$MOCK_OUT"
capture() {
  local stem="$1"; shift
  bun "$DIR/bin/shopify" "$@" > "$MOCK_OUT/$stem.stdout" 2> "$MOCK_OUT/$stem.stderr"
  echo $? > "$MOCK_OUT/$stem.exit"
}

# Read-only commands.
capture list-json                theme list --json
capture list-plain               theme list
capture list-role-live-json      theme list --role live --json
capture list-role-unpublished-json theme list --role unpublished --json
capture info-env-json            theme info --json
capture info-env-plain           theme info
capture info-theme-json          theme info -t 159103910101 --json
capture info-theme-plain         theme info -t 159103910101
capture open-plain               theme open -t 159103910101
capture open-editor              theme open -t 159103910101 --editor
capture open-live                theme open --live
# Error / no-flag paths.
capture info-badid               theme info -t 99999999999
capture delete-noforce           theme delete -t 159103910101
capture duplicate-noforce        theme duplicate -t 159103910101 -n NoForce
capture rename-noname            theme rename -t 159103910101
capture boguscmd                 boguscmd
echo "  captured $(ls $MOCK_OUT | wc -l | xargs) files"

# ---------------------------------------------------------------------------
hdr "Diff vs golden_real_cli/ (node_version normalized)"
# ---------------------------------------------------------------------------

mkdir -p "$NORM_REAL" "$NORM_MOCK"
python3 - "$GOLDEN_DIR" "$NORM_REAL" "$MOCK_OUT" "$NORM_MOCK" <<'PYEOF'
import os, re, sys
src_real, dst_real, src_mock, dst_mock = sys.argv[1:5]
NV_JSON = re.compile(r'"node_version":\s*"v[^"]*"')
# The "Node version" plain-box row varies in width depending on the runtime
# host (v22.16.0 vs v24.3.0 differ by 1 char), so we strip the whole row
# rather than try to compensate the trailing pad. The JSON normalization is
# fine to keep since JSON has no width constraint.
NV_BOX_LINE = re.compile(r'^.*Node version.*$\n?', re.MULTILINE)
def normalize(text):
    text = NV_JSON.sub('"node_version": "vXX.XX.X"', text)
    text = NV_BOX_LINE.sub('', text)
    return text
for src, dst in [(src_real, dst_real), (src_mock, dst_mock)]:
    for f in os.listdir(src):
        with open(os.path.join(src, f)) as r:
            with open(os.path.join(dst, f), 'w') as w:
                w.write(normalize(r.read()))
PYEOF

for stem in list-json list-plain list-role-live-json list-role-unpublished-json \
            info-env-json info-env-plain info-theme-json info-theme-plain \
            open-plain open-editor open-live \
            info-badid delete-noforce duplicate-noforce rename-noname boguscmd; do
  for stream in stdout stderr exit; do
    fr="$NORM_REAL/$stem.$stream"
    fm="$NORM_MOCK/$stem.$stream"
    [[ ! -f "$fr" ]] && continue
    if diff -q "$fr" "$fm" > /dev/null 2>&1; then
      ok "$stem.$stream"
    else
      fail "$stem.$stream"
    fi
  done
done

# ---------------------------------------------------------------------------
hdr "Summary"
# ---------------------------------------------------------------------------
echo "  PASS: $PASS"
echo "  FAIL: $FAIL"
if (( FAIL > 0 )); then
  echo ""
  echo "  Failed assertions:"
  for n in "${FAIL_LIST[@]}"; do
    echo "    - $n"
    echo "      diff --- real vs mock ---"
    diff "$NORM_REAL/$n" "$NORM_MOCK/$n" | head -15 | sed 's/^/      /'
  done
  exit 1
fi
echo "  All byte-diffs pass ✓"
