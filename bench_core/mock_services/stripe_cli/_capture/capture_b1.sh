#!/usr/bin/env bash
# capture_b1.sh — 采集 B1 新增资源的真品输出（coupons/payment_intents/charges/
# subscriptions/invoices），含必要的前置链（subscription 需 customer+price，invoice 需 customer）。
# 前提：已 stripe login（test mode）。会在 test 账号创建对象（不涉及真钱）。
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"; OUT="$HERE/golden_b1"; rm -rf "$OUT"; mkdir -p "$OUT"
export NO_COLOR=1 TERM=dumb STRIPE_CLI_TELEMETRY_OPTOUT=1

run() { local label="$1"; shift; local d="$OUT/$label"; mkdir -p "$d"
  printf 'stripe %s\n' "$*" >"$d/cmd.txt"
  stripe "$@" >"$d/stdout.txt" 2>"$d/stderr.raw"; printf '%s\n' "$?" >"$d/exit.txt"
  grep -v '^<claude-code-hint' "$d/stderr.raw" >"$d/stderr.txt"; rm -f "$d/stderr.raw"
  echo "  [捕获] stripe $*"; }
idof() { grep '"id"' "$OUT/$1/stdout.txt" | head -1 | sed 's/.*: "//;s/".*//'; }

# coupons（最简单）
run coupon_create   coupons create --percent-off=25 --duration=once
run coupon_retrieve coupons retrieve "$(idof coupon_create)"

# payment_intents（amount+currency 即可）
run pi_create       payment_intents create --amount=2000 --currency=usd
run pi_retrieve     payment_intents retrieve "$(idof pi_create)"

# charges（用测试 token tok_visa 作为 source）
run charge_create   charges create --amount=2000 --currency=usd --source=tok_visa
run charge_retrieve charges retrieve "$(idof charge_create)"

# subscriptions（链：customer + product + recurring price）
run sub_cust  customers create --name="Sub Cust" --email="sub@example.com"
CUS="$(idof sub_cust)"
run sub_prod  products create --name="Sub Plan"
PROD="$(idof sub_prod)"
run sub_price prices create --currency=usd --unit-amount=1500 -d "recurring[interval]=month" --product="$PROD"
PRICE="$(idof sub_price)"
run sub_create subscriptions create --customer="$CUS" -d "items[0][price]=$PRICE"
run sub_retrieve subscriptions retrieve "$(idof sub_create)"

# invoices（链：customer + invoice item）
run inv_cust  customers create --name="Inv Cust" --email="inv@example.com"
ICUS="$(idof inv_cust)"
run inv_item  invoiceitems create --customer="$ICUS" --amount=1200 --currency=usd
run inv_create invoices create --customer="$ICUS"
run inv_retrieve invoices retrieve "$(idof inv_create)"

echo ""; echo "==> 完成。产物在：$OUT"
