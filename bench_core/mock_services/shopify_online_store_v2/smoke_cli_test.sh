#!/usr/bin/env bash
# Smoke test for the Shopify CLI mock surface (bin/shopify + bin/shopify-bench).
# - Boots a fresh backend on a scratch port (default 3197; SMOKE_CLI_PORT override).
# - Verifies all 13 captured golden help fixtures are byte-identical.
# - Exercises the full e2e cycle for each subcommand (list/info/open/duplicate/
#   push/pull/publish/rename/delete/dev) + shopify-bench (state/seed/reset/health).
# - Tears down the backend.
#
# Does NOT touch the user's :3062 dev server or the :3098 bench default port —
# uses a scratch port to stay isolated (see [Don't kill the user's mock port]).
#
# Usage: bash smoke_cli_test.sh
set -u

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${SMOKE_CLI_PORT:-3197}"
TOKEN="cli-smoke-bench-token"
B="http://127.0.0.1:${PORT}"
PASS=0; FAIL=0; DIVERGE=0
TMPROOT="$(mktemp -d -t shopify-cli-smoke.XXXXXX)"
LOG="$TMPROOT/server.log"
PID_FILE="$TMPROOT/server.pid"

cleanup() {
  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid=$(cat "$PID_FILE")
    if [[ -n "$pid" ]]; then kill "$pid" 2>/dev/null || true; fi
  fi
  rm -rf "$TMPROOT"
}
trap cleanup EXIT

ok()    { PASS=$((PASS+1)); printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail()  { FAIL=$((FAIL+1)); printf '  \033[31m✗\033[0m %s — %s\n' "$1" "$2"; }
note()  { DIVERGE=$((DIVERGE+1)); printf '  \033[33m≈\033[0m %s — %s\n' "$1" "$2"; }
hdr()   { printf '\n=== %s ===\n' "$1"; }

cli()  { bun "$DIR/bin/shopify" "$@"; }
cli_capture() {
  # cli_capture <var-prefix> <subcommand args...>
  # Sets ${prefix}_stdout / ${prefix}_stderr / ${prefix}_exit
  local prefix="$1"; shift
  local out_file err_file exit_code
  out_file="$TMPROOT/${prefix}.stdout"
  err_file="$TMPROOT/${prefix}.stderr"
  bun "$DIR/bin/shopify" "$@" > "$out_file" 2> "$err_file"; exit_code=$?
  printf -v "${prefix}_stdout" '%s' "$(cat "$out_file")"
  printf -v "${prefix}_stderr" '%s' "$(cat "$err_file")"
  printf -v "${prefix}_exit"   '%s' "$exit_code"
}
bench() { bun "$DIR/bin/shopify-bench" "$@"; }

hdr "Starting backend on :${PORT}"
( cd "$DIR" && PORT="$PORT" MOCK_VERIFIER_TOKEN="$TOKEN" SHOPIFY_MOCK_MODE=tool bun server.js >"$LOG" 2>&1 & echo $! > "$PID_FILE" )
# Wait up to ~5s for /health to come up.
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
export MOCK_VERIFIER_TOKEN="$TOKEN"

# ---------------------------------------------------------------------------
hdr "Golden help fixtures (byte-identical vs Shopify/cli@0df9cd72)"
# ---------------------------------------------------------------------------

check_golden() {
  local label="$1"; shift
  local fixture="$1"; shift
  local actual; actual=$(bun "$DIR/bin/shopify" "$@")
  local expected; expected=$(cat "$DIR/golden/$fixture.stdout")
  if [[ "$actual" == "$expected" ]]; then ok "$label"
  else fail "$label" "diff vs golden/$fixture.stdout (first 10 lines):"
       diff <(printf '%s' "$expected") <(printf '%s' "$actual") | head -10 || true
  fi
}

check_golden 'shopify --version'                    version                --version
check_golden 'shopify --help'                       help                   --help
check_golden 'shopify theme --help'                 theme-help             theme --help
check_golden 'shopify theme list --help'            theme-list-help        theme list --help
check_golden 'shopify theme info --help'            theme-info-help        theme info --help
check_golden 'shopify theme open --help'            theme-open-help        theme open --help
check_golden 'shopify theme duplicate --help'       theme-duplicate-help   theme duplicate --help
check_golden 'shopify theme push --help'            theme-push-help        theme push --help
check_golden 'shopify theme pull --help'            theme-pull-help        theme pull --help
check_golden 'shopify theme publish --help'         theme-publish-help     theme publish --help
check_golden 'shopify theme rename --help'          theme-rename-help      theme rename --help
check_golden 'shopify theme delete --help'          theme-delete-help      theme delete --help
check_golden 'shopify theme dev --help'             theme-dev-help         theme dev --help

# Boguscmd: real CLI emits an ANSI-boxed cli-kit error (exit 1). Mock prints
# plain text (documented divergence #3). Smoke checks only exit code.
cli_capture boguscmd boguscmd
if [[ "$boguscmd_exit" == "1" ]]; then ok 'shopify boguscmd → exit 1'
else fail 'shopify boguscmd → exit 1' "got exit $boguscmd_exit"; fi
note 'shopify boguscmd stderr format' 'plain text vs ANSI box (divergence #3)'

# ---------------------------------------------------------------------------
hdr "theme list / info / open"
# ---------------------------------------------------------------------------

if bun "$DIR/bin/shopify" theme list --json > "$TMPROOT/list.json" 2>/dev/null; then ok 'theme list --json runs'
else fail 'theme list --json runs' "non-zero exit"; fi

list_size=$(bun -e 'import {readFileSync} from "fs"; const j=JSON.parse(readFileSync(process.argv[1],"utf8")); process.stdout.write(String(j.length))' "$TMPROOT/list.json")
if [[ "$list_size" -ge 5 ]]; then ok "theme list returns ≥ 5 themes (got $list_size)"
else fail "theme list returns ≥ 5 themes" "got $list_size"; fi

if bun "$DIR/bin/shopify" theme list --role live --json > "$TMPROOT/list-live.json" 2>/dev/null; then ok 'theme list --role live --json runs'
else fail 'theme list --role live --json runs' "non-zero exit"; fi
live_count=$(bun -e 'import {readFileSync} from "fs"; const j=JSON.parse(readFileSync(process.argv[1],"utf8")); process.stdout.write(String(j.length))' "$TMPROOT/list-live.json")
if [[ "$live_count" == "1" ]]; then ok 'role=live filter returns exactly 1 theme'
else fail 'role=live filter returns exactly 1 theme' "got $live_count"; fi

# theme info --json (single-theme mode)
if bun "$DIR/bin/shopify" theme info -t 159103910101 --json > "$TMPROOT/info.json" 2>/dev/null; then ok 'theme info -t <id> --json runs'
else fail 'theme info -t <id> --json runs' "non-zero exit"; fi
info_role=$(bun -e 'import {readFileSync} from "fs"; const j=JSON.parse(readFileSync(process.argv[1],"utf8")); process.stdout.write(j.theme.role)' "$TMPROOT/info.json")
info_editor=$(bun -e 'import {readFileSync} from "fs"; const j=JSON.parse(readFileSync(process.argv[1],"utf8")); process.stdout.write(j.theme.editor_url)' "$TMPROOT/info.json")
if [[ "$info_role" == "live" ]]; then ok 'theme info: role=live for current theme'
else fail 'theme info: role=live for current theme' "got $info_role"; fi
case "$info_editor" in
  https://*/admin/themes/159103910101/editor) ok 'theme info: editor_url shape matches push.ts:42 sample' ;;
  *) fail 'theme info: editor_url shape' "got $info_editor" ;;
esac

# theme info (environment mode, no flags) — cli-kit info box goes to STDERR
cli_capture envinfo theme info
if echo "$envinfo_stderr" | grep -qF 'Theme Configuration'; then ok 'theme info (no flags) emits environment block'
else fail 'theme info (no flags) emits environment block' "got: $envinfo_stderr"; fi

# theme open — output goes to STDERR (cli-kit renderInfo) with bullet list
# of preview/editor URLs as footnotes ([1]/[2]). Real CLI prints both URLs
# regardless of --editor/--live; the flag picks WHICH theme, not what prints.
cli_capture open theme open -t 159103910101
if echo "$open_stderr" | grep -qF 'Preview information for theme' && \
   echo "$open_stderr" | grep -qF 'Preview your theme' && \
   echo "$open_stderr" | grep -qF 'Customize your theme at the theme editor'; then
  ok 'theme open emits preview + editor info'
else fail 'theme open emits preview + editor info' "got: $open_stderr"; fi
cli_capture open_editor theme open -t 159103910101 --editor
if echo "$open_editor_stderr" | grep -qF 'Customize your theme at the theme editor'; then
  ok 'theme open --editor still emits both URLs (matches real CLI)'
else fail 'theme open --editor still emits both URLs' "got: $open_editor_stderr"; fi

# ---------------------------------------------------------------------------
hdr "theme duplicate / publish / rename / delete (mutation cycle)"
# ---------------------------------------------------------------------------

bench reset >/dev/null

# duplicate
if bun "$DIR/bin/shopify" theme duplicate -t 159103910101 -n 'Origin Smoke' -f --json > "$TMPROOT/dup.json" 2>/dev/null; then ok 'theme duplicate -f --json runs'
else fail 'theme duplicate -f --json runs' "non-zero exit"; fi
dup_id=$(bun -e 'import {readFileSync} from "fs"; const j=JSON.parse(readFileSync(process.argv[1],"utf8")); process.stdout.write(String(j.theme.id))' "$TMPROOT/dup.json")
dup_name=$(bun -e 'import {readFileSync} from "fs"; const j=JSON.parse(readFileSync(process.argv[1],"utf8")); process.stdout.write(j.theme.name)' "$TMPROOT/dup.json")
if [[ "$dup_id" != "159103910101" && -n "$dup_id" ]]; then ok "theme duplicate yields fresh integer id ($dup_id)"
else fail 'theme duplicate yields fresh integer id' "got $dup_id (same as source!)"; fi
if [[ "$dup_name" == "Origin Smoke" ]]; then ok 'theme duplicate honors --name'
else fail 'theme duplicate honors --name' "got $dup_name"; fi

# duplicate without --force matches real CLI: exits 1 with "Failed to prompt"
cli_capture dup_nofor theme duplicate -t 159103910101 -n 'NoForce'
if [[ "$dup_nofor_exit" == "1" ]] && echo "$dup_nofor_stderr" | grep -qF 'Failed to prompt'; then
  ok 'theme duplicate without --force → Failed to prompt (exit 1, matches real CLI)'
else fail 'theme duplicate without --force' "exit=$dup_nofor_exit; stderr=$dup_nofor_stderr"; fi

# rename
if bun "$DIR/bin/shopify" theme rename -t 159066751189 -n 'Horizon Smoke' >/dev/null 2>&1; then ok 'theme rename -t <id> -n <name> runs'
else fail 'theme rename -t <id> -n <name> runs' "non-zero exit"; fi
renamed=$(bun "$DIR/bin/shopify" theme list --json | bun -e 'process.stdin.resume(); let buf=""; process.stdin.on("data", b => buf += b.toString()); process.stdin.on("end", () => { const j=JSON.parse(buf); const t=j.find(t=>String(t.id)==="159066751189"); process.stdout.write(t?t.name:"MISSING") })')
if [[ "$renamed" == "Horizon Smoke" ]]; then ok 'rename persisted in /api/state'
else fail 'rename persisted in /api/state' "got: $renamed"; fi

# publish — flip a draft to live
if bun "$DIR/bin/shopify" theme publish -t 159066751189 -f >/dev/null 2>&1; then ok 'theme publish -t <id> -f runs'
else fail 'theme publish -t <id> -f runs' "non-zero exit"; fi
new_live=$(bun "$DIR/bin/shopify" theme list --role live --json | bun -e 'process.stdin.resume(); let buf=""; process.stdin.on("data", b => buf += b.toString()); process.stdin.on("end", () => { const j=JSON.parse(buf); process.stdout.write(j[0]?String(j[0].id):"MISSING") })')
if [[ "$new_live" == "159066751189" ]]; then ok 'publish flipped 159066751189 → live'
else fail 'publish flipped 159066751189 → live' "live is now $new_live"; fi

# delete an unpublished theme
if bun "$DIR/bin/shopify" theme delete -t 159103811797 -f >/dev/null 2>&1; then ok 'theme delete -t <id> -f runs'
else fail 'theme delete -t <id> -f runs' "non-zero exit"; fi
after_delete=$(bun "$DIR/bin/shopify" theme list --json | bun -e 'process.stdin.resume(); let buf=""; process.stdin.on("data", b => buf += b.toString()); process.stdin.on("end", () => { const j=JSON.parse(buf); const t=j.find(t=>String(t.id)==="159103811797"); process.stdout.write(t?"STILL_THERE":"GONE") })')
if [[ "$after_delete" == "GONE" ]]; then ok 'delete removed theme from state'
else fail 'delete removed theme from state' "still present"; fi

# trying to delete the live theme should fail
cli_capture del_live theme delete -t 159066751189 -f
if [[ "$del_live_exit" != "0" ]]; then ok 'cannot delete current theme (rejected)'
else fail 'cannot delete current theme' 'delete succeeded — guard missing'; fi

# ---------------------------------------------------------------------------
hdr "theme push / pull (file I/O)"
# ---------------------------------------------------------------------------

bench reset >/dev/null

PUSH_SRC="$TMPROOT/push-src"
mkdir -p "$PUSH_SRC/layout" "$PUSH_SRC/templates"
echo '<!doctype html><html><head>{{ content_for_header }}</head><body>{{ content_for_layout }}</body></html>' > "$PUSH_SRC/layout/theme.liquid"
echo '{"sections":{"main":{"type":"main"}},"order":["main"]}' > "$PUSH_SRC/templates/product.json"

# Real CLI prompts "Name of the new theme" interactively for push -u; mock
# matches that fail-prompt behavior unless SHOPIFY_MOCK_PUSH_NAME is set
# (mock-only escape hatch for non-interactive smoke runs).
if (cd "$PUSH_SRC" && SHOPIFY_MOCK_PUSH_NAME="CCB-Smoke-Push" bun "$DIR/bin/shopify" theme push -u --json > "$TMPROOT/push.json" 2>"$TMPROOT/push.err"); then ok 'theme push -u --json runs (with SHOPIFY_MOCK_PUSH_NAME)'
else fail 'theme push -u --json runs' "$(cat $TMPROOT/push.err)"; fi
push_id=$(bun -e 'import {readFileSync} from "fs"; const j=JSON.parse(readFileSync(process.argv[1],"utf8")); process.stdout.write(String(j.theme.id))' "$TMPROOT/push.json")
push_editor=$(bun -e 'import {readFileSync} from "fs"; const j=JSON.parse(readFileSync(process.argv[1],"utf8")); process.stdout.write(j.theme.editor_url)' "$TMPROOT/push.json")
if [[ -n "$push_id" && "$push_id" != "null" ]]; then ok "push --unpublished yields new theme id ($push_id)"
else fail 'push --unpublished yields new theme id' "got $push_id"; fi
case "$push_editor" in
  https://*/admin/themes/${push_id}/editor) ok 'push: editor_url matches push.ts:42 sample shape' ;;
  *) fail 'push: editor_url shape' "got $push_editor" ;;
esac

# Verify pushed files made it into /api/state (use curl -o + read-as-arg, not piped stdin —
# /api/state is ~30KB and arrives in multiple chunks).
curl -s "$B/api/state" -o "$TMPROOT/api-state.json"
pushed_count=$(bun -e 'import {readFileSync} from "fs"; const j=JSON.parse(readFileSync(process.argv[1],"utf8")); const target=j.draft.themeFiles.filter(f=>f.path==="layout/theme.liquid"||f.path==="templates/product.json"); process.stdout.write(String(target.length))' "$TMPROOT/api-state.json")
if [[ "$pushed_count" == "2" ]]; then ok 'pushed files visible in /api/state'
else fail 'pushed files visible in /api/state' "got $pushed_count"; fi

PULL_DEST="$TMPROOT/pull-dest"
mkdir -p "$PULL_DEST"
if (cd "$PULL_DEST" && bun "$DIR/bin/shopify" theme pull -t 159103910101 -n >/dev/null 2>&1); then ok 'theme pull -t -n runs'
else fail 'theme pull -t -n runs' "non-zero exit"; fi
pulled_count=$(find "$PULL_DEST" -type f | wc -l | xargs)
if [[ "$pulled_count" -ge 2 ]]; then ok "pull wrote ≥ 2 files (got $pulled_count)"
else fail "pull wrote ≥ 2 files" "got $pulled_count"; fi

# ---------------------------------------------------------------------------
hdr "theme dev (no-watcher skeleton)"
# ---------------------------------------------------------------------------

cli_capture dev theme dev -t 159103910101
if [[ "$dev_exit" == "0" ]]; then ok 'theme dev exits 0 (no watcher)'
else fail 'theme dev exits 0 (no watcher)' "got exit $dev_exit"; fi
# Mock matches real CLI's dev header — "(t)/(p)/(e)/(g)" keyboard shortcuts
# in a cli-kit success box on stderr. Validate the keyword pattern.
if echo "$dev_stderr" | grep -qF 'Preview your theme (t)' && echo "$dev_stderr" | grep -qF 'theme editor (e)'; then
  ok 'theme dev emits keyboard-shortcut header (matches real CLI)'
else fail 'theme dev emits keyboard-shortcut header' "got stderr: $dev_stderr"; fi
note 'theme dev (no watcher / hot-reload)' 'documented divergence #1 in fact sheet'

# ---------------------------------------------------------------------------
hdr "shopify-bench (verifier-only)"
# ---------------------------------------------------------------------------

if bun "$DIR/bin/shopify-bench" health >/dev/null 2>&1; then ok 'shopify-bench health'
else fail 'shopify-bench health' 'non-zero exit'; fi

# state needs token
bench_state_out=$(bun "$DIR/bin/shopify-bench" state 2>&1) || bench_state_exit=1
if bun "$DIR/bin/shopify-bench" state >"$TMPROOT/bench-state.json" 2>/dev/null; then ok 'shopify-bench state (token via env) runs'
else fail 'shopify-bench state runs' 'non-zero exit'; fi
bench_counts_products=$(bun -e 'import {readFileSync} from "fs"; const j=JSON.parse(readFileSync(process.argv[1],"utf8")); process.stdout.write(String(j.state.counts.products))' "$TMPROOT/bench-state.json")
if [[ "$bench_counts_products" =~ ^[0-9]+$ ]]; then ok "shopify-bench state.counts.products is integer ($bench_counts_products)"
else fail 'shopify-bench state.counts.products is integer' "got $bench_counts_products"; fi

# state w/o token fails
MOCK_VERIFIER_TOKEN= bun "$DIR/bin/shopify-bench" state >/dev/null 2>"$TMPROOT/bench-no-tok.err"; code=$?
if [[ "$code" != "0" ]]; then ok 'shopify-bench state without token → non-zero'
else fail 'shopify-bench state without token → non-zero' 'succeeded unexpectedly'; fi

# reset
if bun "$DIR/bin/shopify-bench" reset >/dev/null 2>&1; then ok 'shopify-bench reset runs'
else fail 'shopify-bench reset runs' 'non-zero exit'; fi

# ---------------------------------------------------------------------------
hdr "Summary"
# ---------------------------------------------------------------------------
echo "  PASS: $PASS"
echo "  FAIL: $FAIL"
echo "  KNOWN DIVERGENCES (informational): $DIVERGE"
if [[ "$FAIL" -gt 0 ]]; then exit 1; fi
echo "  All assertions pass ✓"
