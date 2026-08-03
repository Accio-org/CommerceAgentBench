#!/usr/bin/env bash
# capture_b1b.sh — 采齐 B1 剩余资源真品输出作为「模板真值」。
# 前提：已 stripe login（test mode）。创建的都是 test 对象，不涉及真钱。
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"; OUT="$HERE/golden_b1b"; rm -rf "$OUT"; mkdir -p "$OUT"
export NO_COLOR=1 TERM=dumb STRIPE_CLI_TELEMETRY_OPTOUT=1
run() { local label="$1"; shift; local d="$OUT/$label"; mkdir -p "$d"
  printf 'stripe %s\n' "$*" >"$d/cmd.txt"
  stripe "$@" >"$d/stdout.txt" 2>"$d/stderr.raw"; printf '%s\n' "$?" >"$d/exit.txt"
  grep -v '^<claude-code-hint' "$d/stderr.raw" >"$d/stderr.txt"; rm -f "$d/stderr.raw"
  echo "  [捕获] stripe $*"; }
idof() { grep '"id"' "$OUT/$1/stdout.txt" | head -1 | sed 's/.*: "//;s/".*//'; }

# 前置：customer + product + recurring price + charge
run cust   customers create --name="B1B Cust" --email="b1b@example.com"
CUS="$(idof cust)"
run prod   products create --name="B1B Plan"
PROD="$(idof prod)"
run price  prices create --currency=usd --unit-amount=1500 -d "recurring[interval]=month" --product="$PROD"
PRICE="$(idof price)"
run charge charges create --amount=2000 --currency=usd --source=tok_visa
CH="$(idof charge)"
run coupon coupons create --percent-off=25 --duration=once
COUP="$(idof coupon)"

# subscription（用 default_incomplete 绕过 pm 要求）
run subscription subscriptions create --customer="$CUS" -d "items[0][price]=$PRICE" --payment-behavior=default_incomplete

# checkout session
run checkout_session checkout sessions create --mode=payment --success-url="https://example.com/ok" -d "line_items[0][price]=$PRICE" -d "line_items[0][quantity]=1"

# refund（挂在 charge 上）
run refund refunds create --charge="$CH"

# payment_method（card via tok_visa）
run payment_method payment_methods create --type=card -d "card[token]=tok_visa"

# promotion_code（挂在 coupon 上）
run promotion_code promotion_codes create --coupon="$COUP"

# payment_link
run payment_link payment_links create -d "line_items[0][price]=$PRICE" -d "line_items[0][quantity]=1"

# events（只读，列既有事件）
run events_list events list --limit=2

echo ""; echo "==> 完成：$OUT"
for d in "$OUT"/*/; do printf "  %-18s exit=%s 行=%s\n" "$(basename "$d")" "$(cat "$d/exit.txt")" "$(wc -l < "$d/stdout.txt")"; done