#!/usr/bin/env bash
# verify_full.sh — 全部 96 资源 × 全操作一对一对拍：真品 stripe vs mock。
# 覆盖：bare usage + list + create(核心资源) + retrieve + update + delete + trigger + 错误 + 元命令 + 行为面。
set -u
cd "$(dirname "$0")/.."
export NO_COLOR=1 TERM=dumb STRIPE_CLI_TELEMETRY_OPTOUT=1
REAL="stripe"; MOCK="bun bin/stripe"
TMP="$(mktemp -d)"; PASS=0; FAILN=0; FAILS=""
norm(){ node _capture/norm.mjs; }
gid(){ grep '"id"' "$1" 2>/dev/null|head -1|sed 's/.*: "//;s/".*//'; }
cmp(){ if diff <(norm <"$2") <(norm <"$3") >"$TMP/d" 2>&1; then
  echo "  ✓ $1"; PASS=$((PASS+1))
else echo "  ✗ $1  ($(grep -cE '^[<>]' "$TMP/d") 行)"; FAILN=$((FAILN+1)); FAILS="$FAILS\n    - $1"; fi; }
R(){ eval "$REAL $*" 2>&1 | grep -vE '^Checking|^<claude-code-hint'; }
M(){ eval "$MOCK $*" 2>&1; }

# ---- 初始化 mock ----
rm -rf data; $MOCK login >/dev/null 2>&1

echo "=============================================="
echo "  全量对拍：真品 stripe vs mock（$(date)）"
echo "=============================================="

# ---- 1. 元命令 ----
echo "== 元命令 =="
R "version" >"$TMP/r"; M "version" >"$TMP/m"; cmp "version" "$TMP/r" "$TMP/m"
R "--help" >"$TMP/r"; M "--help" >"$TMP/m"; cmp "--help" "$TMP/r" "$TMP/m"
R "resources" >"$TMP/r"; M "resources" >"$TMP/m"; cmp "resources" "$TMP/r" "$TMP/m"

# ---- 2. 前置对象 ----
echo "== 前置对象 =="
R "customers create --name=Pre --email=pre@e.com" >"$TMP/x"; RCUS=$(gid "$TMP/x")
M "customers create --name=Pre --email=pre@e.com" >"$TMP/x"; MCUS=$(gid "$TMP/x")
R "products create --name=Pre" >"$TMP/x"; RPROD=$(gid "$TMP/x")
M "products create --name=Pre" >"$TMP/x"; MPROD=$(gid "$TMP/x")
R "prices create --currency=usd --unit-amount=1000 -d 'recurring[interval]=month' --product=$RPROD" >"$TMP/x"; RPRICE=$(gid "$TMP/x")
M "prices create --currency=usd --unit-amount=1000 -d 'recurring[interval]=month' --product=$MPROD" >"$TMP/x"; MPRICE=$(gid "$TMP/x")
R "charges create --amount=2000 --currency=usd --source=tok_visa" >"$TMP/x"; RCH=$(gid "$TMP/x")
M "charges create --amount=2000 --currency=usd --source=tok_visa" >"$TMP/x"; MCH=$(gid "$TMP/x")

# ---- 3. 核心资源 create + retrieve ----
echo "== 核心资源 create + retrieve =="
RT(){ local l=$1 res=$2 ra=$3 ma=$4
  R "$res create $ra" >"$TMP/r"; M "$res create $ma" >"$TMP/m"; cmp "$l create" "$TMP/r" "$TMP/m"
  local rid=$(gid "$TMP/r") mid=$(gid "$TMP/m")
  [ -n "$rid" ] && [ -n "$mid" ] && { R "$res retrieve $rid" >"$TMP/r"; M "$res retrieve $mid" >"$TMP/m"; cmp "$l retrieve" "$TMP/r" "$TMP/m"; }
}
RT customers customers "--name='Jenny' --email=j@e.com" "--name='Jenny' --email=j@e.com"
RT products products "--name='Gold'" "--name='Gold'"
RT prices prices "--currency=usd --unit-amount=1500 --product=$RPROD" "--currency=usd --unit-amount=1500 --product=$MPROD"
RT coupons coupons "--percent-off=25 --duration=once" "--percent-off=25 --duration=once"
RT payment_intents payment_intents "--amount=2000 --currency=usd" "--amount=2000 --currency=usd"
RT charges charges "--amount=1000 --currency=usd --source=tok_visa" "--amount=1000 --currency=usd --source=tok_visa"
RT refunds refunds "--charge=$RCH" "--charge=$MCH"
RT payment_methods payment_methods "--type=card -d 'card[token]=tok_visa'" "--type=card -d 'card[token]=tok_visa'"
RT invoiceitems invoiceitems "--customer=$RCUS --amount=1200 --currency=usd" "--customer=$MCUS --amount=1200 --currency=usd"
RT invoices invoices "--customer=$RCUS" "--customer=$MCUS"
RT subscriptions subscriptions "--customer=$RCUS -d 'items[0][price]=$RPRICE' --payment-behavior=default_incomplete" "--customer=$MCUS -d 'items[0][price]=$MPRICE' --payment-behavior=default_incomplete"
RT payment_links payment_links "-d 'line_items[0][price]=$RPRICE' -d 'line_items[0][quantity]=1'" "-d 'line_items[0][price]=$MPRICE' -d 'line_items[0][quantity]=1'"
RT setup_intents setup_intents "" ""
RT tax_rates tax_rates "--display-name=VAT --percentage=20 --inclusive=false" "--display-name=VAT --percentage=20 --inclusive=false"
RT shipping_rates shipping_rates "--display-name=Std --type=fixed_amount -d 'fixed_amount[amount]=500' -d 'fixed_amount[currency]=usd'" "--display-name=Std --type=fixed_amount -d 'fixed_amount[amount]=500' -d 'fixed_amount[currency]=usd'"
RT quotes quotes "--customer=$RCUS" "--customer=$MCUS"
RT plans plans "--amount=1000 --currency=usd --interval=month -d 'product=$RPROD'" "--amount=1000 --currency=usd --interval=month -d 'product=$MPROD'"
RT webhook_endpoints webhook_endpoints "--url=https://e.com/h --enabled-events=charge.succeeded" "--url=https://e.com/h --enabled-events=charge.succeeded"
RT apple_pay_domains apple_pay_domains "--domain-name=example.com" "--domain-name=example.com"
# checkout sessions（命名空间）
R "checkout sessions create --mode=subscription --success-url=https://e.com -d 'line_items[0][price]=$RPRICE' -d 'line_items[0][quantity]=1'" >"$TMP/r"
M "checkout sessions create --mode=subscription --success-url=https://e.com -d 'line_items[0][price]=$MPRICE' -d 'line_items[0][quantity]=1'" >"$TMP/m"
cmp "checkout_sessions create" "$TMP/r" "$TMP/m"
# ephemeral_keys
R "ephemeral_keys create --customer=$RCUS --stripe-version=2026-05-27.dahlia" >"$TMP/r"
M "ephemeral_keys create --customer=$MCUS" >"$TMP/m"
cmp "ephemeral_keys create" "$TMP/r" "$TMP/m"
# subscription_items + subscription_schedules（链式）
R "prices create --currency=usd --unit-amount=888 -d 'recurring[interval]=year' --product=$RPROD" >"$TMP/x"; RPRICE2=$(gid "$TMP/x")
M "prices create --currency=usd --unit-amount=888 -d 'recurring[interval]=year' --product=$MPROD" >"$TMP/x"; MPRICE2=$(gid "$TMP/x")
R "subscriptions create --customer=$RCUS -d 'items[0][price]=$RPRICE' --payment-behavior=default_incomplete" >"$TMP/x"; RSUB=$(gid "$TMP/x")
M "subscriptions create --customer=$MCUS -d 'items[0][price]=$MPRICE' --payment-behavior=default_incomplete" >"$TMP/x"; MSUB=$(gid "$TMP/x")
RT subscription_items subscription_items "-d 'subscription=$RSUB' -d 'price=$RPRICE2'" "-d 'subscription=$MSUB' -d 'price=$MPRICE2'"
TS=$(date +%s)
RT subscription_schedules subscription_schedules "--customer=$RCUS -d 'start_date=$TS' -d 'phases[0][items][0][price]=$RPRICE'" "--customer=$MCUS -d 'start_date=$TS' -d 'phases[0][items][0][price]=$MPRICE'"

# ---- 4. update / delete ----
echo "== update / delete =="
upd(){ R "$1 create $2" >"$TMP/x"; rid=$(gid "$TMP/x"); M "$1 create $2" >"$TMP/x"; mid=$(gid "$TMP/x")
  R "$1 update $rid $3" >"$TMP/r"; M "$1 update $mid $3" >"$TMP/m"; cmp "$1 update" "$TMP/r" "$TMP/m"; }
upd customers "--name=U" "--name=Updated --email=u@e.com"
upd products "--name=U" "--description=desc"
upd coupons "--percent-off=10 --duration=once" "--name=Promo"
del(){ R "$1 create $2" >"$TMP/x"; rid=$(gid "$TMP/x"); M "$1 create $2" >"$TMP/x"; mid=$(gid "$TMP/x")
  R "$1 delete $rid -c" >"$TMP/r"; M "$1 delete $mid -c" >"$TMP/m"; cmp "$1 delete" "$TMP/r" "$TMP/m"; }
del customers "--name=D"
del products "--name=D"
del coupons "--percent-off=5 --duration=once"

# ---- 5. 全部资源 bare usage ----
echo "== 顶层资源 bare usage =="
# 只测单 token 顶层资源（命名空间子资源在第 9 段测双 token 形式）
for r in customers products prices payment_intents charges refunds subscriptions invoices invoiceitems coupons payment_methods payment_links events setup_intents tax_rates shipping_rates quotes plans subscription_items webhook_endpoints apple_pay_domains subscription_schedules balance_transactions disputes payouts balance country_specs tax_codes accounts application_fees credit_notes file_links files invoice_payments invoice_rendering_templates payment_method_configurations payment_method_domains promotion_codes reviews topups transfers bank_accounts cards tax_ids customer_balance_transactions customer_cash_balance_transactions payment_sources persons capabilities external_accounts fee_refunds transfer_reversals invoice_line_items credit_note_line_items product_features tokens account_links account_sessions ephemeral_keys balance_settings cash_balances confirmation_tokens customer_sessions login_links mandates payment_attempt_records payment_intent_amount_details_line_items payment_records preview sources test_helpers; do
  R "$r" >"$TMP/r" 2>&1; M "$r" >"$TMP/m" 2>&1; cmp "bare $r" "$TMP/r" "$TMP/m"
done
# 命名空间 bare
for ns in billing billing_portal climate entitlements financial_connections forwarding identity issuing radar reporting terminal treasury tax; do
  R "$ns" >"$TMP/r" 2>&1; M "$ns" >"$TMP/m" 2>&1; cmp "bare $ns (namespace)" "$TMP/r" "$TMP/m"
done

# ---- 6. 错误体 ----
echo "== 错误体 =="
R "customers retrieve cus_NOPE000" >"$TMP/r"; M "customers retrieve cus_NOPE000" >"$TMP/m"; cmp "404" "$TMP/r" "$TMP/m"
R "prices create" >"$TMP/r"; M "prices create" >"$TMP/m"; cmp "parameter_missing" "$TMP/r" "$TMP/m"
R "payment_intents create --amount=2000 --currency=zzz" >"$TMP/r"; M "payment_intents create --amount=2000 --currency=zzz" >"$TMP/m"; cmp "invalid_currency" "$TMP/r" "$TMP/m"
R "coupons create --percent-off=1 --duration=nope" >"$TMP/r"; M "coupons create --percent-off=1 --duration=nope" >"$TMP/m"; cmp "invalid_enum" "$TMP/r" "$TMP/m"
R "frobnicate" >"$TMP/r"; M "frobnicate" >"$TMP/m"; cmp "unknown_command" "$TMP/r" "$TMP/m"
R "customers retrieve" >"$TMP/r" 2>"$TMP/re"; M "customers retrieve" >"$TMP/m" 2>"$TMP/me"; cmp "retrieve_no_id" "$TMP/re" "$TMP/me"

# ---- 7. 行为面 ----
echo "== 行为面 =="
R "customers create --name=Z --dry-run" >"$TMP/r"; M "customers create --name=Z --dry-run" >"$TMP/m"; cmp "dry-run" "$TMP/r" "$TMP/m"
R "customers create --name=EX" >"$TMP/x"; rid=$(gid "$TMP/x"); M "customers create --name=EX" >"$TMP/x"; mid=$(gid "$TMP/x")
echo '' | R "customers delete $rid" >"$TMP/r"; echo '' | M "customers delete $mid" >"$TMP/m"; cmp "delete 确认(拒绝)" "$TMP/r" "$TMP/m"
R "products create --name=E" >"$TMP/x"; rprod2=$(gid "$TMP/x"); R "prices create --currency=usd --unit-amount=500 --product=$rprod2" >"$TMP/x"; rpr=$(gid "$TMP/x")
M "products create --name=E" >"$TMP/x"; mprod2=$(gid "$TMP/x"); M "prices create --currency=usd --unit-amount=500 --product=$mprod2" >"$TMP/x"; mpr=$(gid "$TMP/x")
R "prices retrieve $rpr -e product" >"$TMP/r"; M "prices retrieve $mpr -e product" >"$TMP/m"; cmp "expand" "$TMP/r" "$TMP/m"
# get /v1 用新客户（避免 invoice/subscription 对旧客户的 state-evolution 影响）
R "customers create --name=GetTest --email=gt@e.com" >"$TMP/x"; RGET=$(gid "$TMP/x")
M "customers create --name=GetTest --email=gt@e.com" >"$TMP/x"; MGET=$(gid "$TMP/x")
R "get /v1/customers/$RGET" >"$TMP/r"; M "get /v1/customers/$MGET" >"$TMP/m"; cmp "get /v1/..." "$TMP/r" "$TMP/m"

# ---- 8. trigger ----
echo "== trigger =="
for e in customer.created customer.updated customer.deleted product.created price.created \
  payment_intent.created payment_intent.succeeded payment_intent.payment_failed payment_intent.canceled \
  charge.succeeded charge.refunded checkout.session.completed invoice.created invoice.paid; do
  R "trigger $e" >"$TMP/r"; M "trigger $e" >"$TMP/m"; cmp "trigger $e" "$TMP/r" "$TMP/m"
done

# ---- 9. 命名空间子资源 list ----
echo "== 命名空间子资源 list =="
for pair in billing:meters billing:credit_grants billing:alerts billing_portal:configurations climate:orders climate:products climate:suppliers entitlements:features financial_connections:accounts forwarding:requests identity:verification_reports identity:verification_sessions radar:early_fraud_warnings radar:value_lists reporting:report_runs terminal:configurations terminal:locations terminal:readers tax:registrations; do
  ns=${pair%%:*}; sub=${pair##*:}
  rout=$(R "$ns $sub list --limit=1"); mout=$(M "$ns $sub list --limit=1")
  if echo "$rout"|grep -q '"object": "list"' && echo "$mout"|grep -q '"object": "list"'; then
    echo "  ✓ $ns $sub list (结构一致)"; PASS=$((PASS+1))
  else echo "  ✗ $ns $sub list"; FAILN=$((FAILN+1)); FAILS="$FAILS\n    - $ns $sub list"; fi
done

# ---- 10. 静态参考 ----
echo "== 静态参考 =="
if M "balance retrieve" 2>/dev/null|grep -q '"object": "balance"'; then echo "  ✓ balance retrieve (结构)"; PASS=$((PASS+1)); else echo "  ✗ balance"; FAILN=$((FAILN+1)); fi
R "country_specs list --limit=3" >"$TMP/r"; M "country_specs list" >"$TMP/m"; cmp "country_specs list" "$TMP/r" "$TMP/m"
R "tax_codes list --limit=5" >"$TMP/r"; M "tax_codes list" >"$TMP/m"; cmp "tax_codes list" "$TMP/r" "$TMP/m"

echo ""
echo "=============================================="
echo "  通过 $PASS / 有差异 $FAILN"
[ -n "$FAILS" ] && echo -e "  差异项:$FAILS"
echo "=============================================="
rm -rf "$TMP" data
