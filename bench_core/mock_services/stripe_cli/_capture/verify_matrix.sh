#!/usr/bin/env bash
# verify_matrix.sh — 全资源 × 全操作 差分对拍矩阵：真品 stripe vs mock，归一化后逐字节 diff。
# 前提：已 stripe login（test mode）。会在 test 账号创建对象（不涉及真钱）。
set -u
cd "$(dirname "$0")/.."
export NO_COLOR=1 TERM=dumb STRIPE_CLI_TELEMETRY_OPTOUT=1
REAL="stripe"; MOCK="bun bin/stripe"
TMP="$(mktemp -d)"; rm -rf data; $MOCK login >/dev/null 2>&1
PASS=0; FAILN=0; FAILS=""
norm(){ node _capture/norm.mjs; }
gid(){ grep '"id"' "$1"|head -1|sed 's/.*: "//;s/".*//'; }
cmp(){ # <label> <realfile> <mockfile>
  if diff <(norm <"$2") <(norm <"$3") >"$TMP/d" 2>&1; then
    echo "  ✓ $1"; PASS=$((PASS+1))
  else
    echo "  ✗ $1  ($(grep -cE '^[<>]' "$TMP/d") 行)"; sed 's/^/      /' "$TMP/d"|head -10
    FAILN=$((FAILN+1)); FAILS="$FAILS\n    - $1"
  fi
}
R(){ eval "$REAL $*" 2>&1; }
M(){ eval "$MOCK $*" 2>&1; }

echo "=== 前置对象（真品/ mock 各建一套）==="
R customers create --name=Pre --email=pre@e.com >"$TMP/x"; RCUS=$(gid "$TMP/x")
M customers create --name=Pre --email=pre@e.com >"$TMP/x"; MCUS=$(gid "$TMP/x")
R products create --name=Pre >"$TMP/x"; RPROD=$(gid "$TMP/x")
M products create --name=Pre >"$TMP/x"; MPROD=$(gid "$TMP/x")
R "prices create --currency=usd --unit-amount=1000 -d 'recurring[interval]=month' --product=$RPROD" >"$TMP/x"; RPRICE=$(gid "$TMP/x")
M "prices create --currency=usd --unit-amount=1000 -d 'recurring[interval]=month' --product=$MPROD" >"$TMP/x"; MPRICE=$(gid "$TMP/x")
R "charges create --amount=2000 --currency=usd --source=tok_visa" >"$TMP/x"; RCH=$(gid "$TMP/x")
M "charges create --amount=2000 --currency=usd --source=tok_visa" >"$TMP/x"; MCH=$(gid "$TMP/x")
echo "  done"

# RT <label> <resource> <realCreateArgs> <mockCreateArgs>  → 对拍 create + retrieve
RT(){ local l=$1 res=$2 ra=$3 ma=$4
  R "$res create $ra" >"$TMP/r"; M "$res create $ma" >"$TMP/m"; cmp "$l create" "$TMP/r" "$TMP/m"
  local rid=$(gid "$TMP/r") mid=$(gid "$TMP/m")
  [ -n "$rid" ] && [ -n "$mid" ] || { echo "  - $l retrieve 跳过(无id)"; return; }
  R "$res retrieve $rid" >"$TMP/r"; M "$res retrieve $mid" >"$TMP/m"; cmp "$l retrieve" "$TMP/r" "$TMP/m"
}

echo "=== 资源 create + retrieve ==="
RT customers       customers       "--name='Jenny Rosen' --email=jenny@example.com" "--name='Jenny Rosen' --email=jenny@example.com"
RT products        products        "--name='Gold Plan'" "--name='Gold Plan'"
RT prices          prices          "--currency=usd --unit-amount=1500 --product=$RPROD" "--currency=usd --unit-amount=1500 --product=$MPROD"
RT coupons         coupons         "--percent-off=25 --duration=once" "--percent-off=25 --duration=once"
RT payment_intents payment_intents "--amount=2000 --currency=usd" "--amount=2000 --currency=usd"
RT charges         charges         "--amount=2000 --currency=usd --source=tok_visa" "--amount=2000 --currency=usd --source=tok_visa"
RT refunds         refunds         "--charge=$RCH" "--charge=$MCH"
RT payment_methods payment_methods "--type=card -d 'card[token]=tok_visa'" "--type=card -d 'card[token]=tok_visa'"
RT invoiceitems    invoiceitems    "--customer=$RCUS --amount=1200 --currency=usd" "--customer=$MCUS --amount=1200 --currency=usd"
RT invoices        invoices        "--customer=$RCUS" "--customer=$MCUS"
RT subscriptions   subscriptions   "--customer=$RCUS -d 'items[0][price]=$RPRICE' --payment-behavior=default_incomplete" "--customer=$MCUS -d 'items[0][price]=$MPRICE' --payment-behavior=default_incomplete"
RT payment_links   payment_links   "-d 'line_items[0][price]=$RPRICE' -d 'line_items[0][quantity]=1'" "-d 'line_items[0][price]=$MPRICE' -d 'line_items[0][quantity]=1'"
# checkout sessions（命名空间）
R "checkout sessions create --mode=subscription --success-url=https://e.com -d 'line_items[0][price]=$RPRICE' -d 'line_items[0][quantity]=1'" >"$TMP/r"
M "checkout sessions create --mode=subscription --success-url=https://e.com -d 'line_items[0][price]=$MPRICE' -d 'line_items[0][quantity]=1'" >"$TMP/m"
cmp "checkout_sessions create" "$TMP/r" "$TMP/m"

echo "=== B8 扩充资源 create + retrieve ==="
R "subscriptions create --customer=$RCUS -d 'items[0][price]=$RPRICE' --payment-behavior=default_incomplete" >"$TMP/x"; RSUB=$(gid "$TMP/x")
M "subscriptions create --customer=$MCUS -d 'items[0][price]=$MPRICE' --payment-behavior=default_incomplete" >"$TMP/x"; MSUB=$(gid "$TMP/x")
R "prices create --currency=usd --unit-amount=888 -d 'recurring[interval]=year' --product=$RPROD" >"$TMP/x"; RPRICE2=$(gid "$TMP/x")
M "prices create --currency=usd --unit-amount=888 -d 'recurring[interval]=year' --product=$MPROD" >"$TMP/x"; MPRICE2=$(gid "$TMP/x")
RT setup_intents      setup_intents  "" ""
RT tax_rates          tax_rates      "--display-name=VAT --percentage=20 --inclusive=false" "--display-name=VAT --percentage=20 --inclusive=false"
RT shipping_rates     shipping_rates "--display-name=Std --type=fixed_amount -d 'fixed_amount[amount]=500' -d 'fixed_amount[currency]=usd'" "--display-name=Std --type=fixed_amount -d 'fixed_amount[amount]=500' -d 'fixed_amount[currency]=usd'"
RT quotes             quotes         "--customer=$RCUS" "--customer=$MCUS"
RT plans              plans          "--amount=1000 --currency=usd --interval=month -d 'product=$RPROD'" "--amount=1000 --currency=usd --interval=month -d 'product=$MPROD'"
RT subscription_items subscription_items "-d 'subscription=$RSUB' -d 'price=$RPRICE2'" "-d 'subscription=$MSUB' -d 'price=$MPRICE2'"

echo "=== update ==="
upd(){ local l=$1 res=$2 ca=$3 ua=$4
  R "$res create $ca" >"$TMP/x"; local rid=$(gid "$TMP/x"); M "$res create $ca" >"$TMP/x"; local mid=$(gid "$TMP/x")
  R "$res update $rid $ua" >"$TMP/r"; M "$res update $mid $ua" >"$TMP/m"; cmp "$l update" "$TMP/r" "$TMP/m"
}
upd customers customers "--name=U" "--name=Updated --email=u@e.com"
upd products  products  "--name=U" "--description=desc"
upd coupons   coupons   "--percent-off=10 --duration=once" "--name=Promo"

echo "=== delete（-c）==="
del(){ local l=$1 res=$2 ca=$3
  R "$res create $ca" >"$TMP/x"; local rid=$(gid "$TMP/x"); M "$res create $ca" >"$TMP/x"; local mid=$(gid "$TMP/x")
  R "$res delete $rid -c" >"$TMP/r"; M "$res delete $mid -c" >"$TMP/m"; cmp "$l delete" "$TMP/r" "$TMP/m"
}
del customers customers "--name=D"
del products  products  "--name=D"
del coupons   coupons   "--percent-off=5 --duration=once"

echo "=== 错误体 ==="
R "customers retrieve cus_NOPE000" >"$TMP/r"; M "customers retrieve cus_NOPE000" >"$TMP/m"; cmp "404 resource_missing" "$TMP/r" "$TMP/m"
R "prices create" >"$TMP/r"; M "prices create" >"$TMP/m"; cmp "parameter_missing" "$TMP/r" "$TMP/m"
R "payment_intents create --amount=2000 --currency=zzz" >"$TMP/r"; M "payment_intents create --amount=2000 --currency=zzz" >"$TMP/m"; cmp "invalid_currency" "$TMP/r" "$TMP/m"
R "coupons create --percent-off=1 --duration=nope" >"$TMP/r"; M "coupons create --percent-off=1 --duration=nope" >"$TMP/m"; cmp "invalid_enum" "$TMP/r" "$TMP/m"
R "frobnicate" >"$TMP/r"; M "frobnicate" >"$TMP/m"; cmp "unknown_command" "$TMP/r" "$TMP/m"
R "customers retrieve" >"$TMP/r"; M "customers retrieve" >"$TMP/m"; cmp "retrieve_no_id" "$TMP/r" "$TMP/m"

echo "=== B9 可创建资源 create + retrieve ==="
RT webhook_endpoints  webhook_endpoints  "--url=https://e.com/h --enabled-events=charge.succeeded" "--url=https://e.com/h --enabled-events=charge.succeeded"
RT apple_pay_domains  apple_pay_domains  "--domain-name=ex.com" "--domain-name=ex.com"
RT subscription_schedules subscription_schedules "--customer=$RCUS -d 'start_date=1780000000' -d 'phases[0][items][0][price]=$RPRICE'" "--customer=$MCUS -d 'start_date=1780000000' -d 'phases[0][items][0][price]=$MPRICE'"

echo "=== B9 静态参考资源 ==="
# balance 是动态账户状态（余额随 charge 变），不可逐字节；只校验结构
if M "balance retrieve" | grep -q '"object": "balance"'; then echo "  ✓ balance retrieve（动态，结构校验）"; PASS=$((PASS+1)); else echo "  ✗ balance retrieve"; FAILN=$((FAILN+1)); fi
R "country_specs list --limit=3" >"$TMP/r"; M "country_specs list" >"$TMP/m"; cmp "country_specs list" "$TMP/r" "$TMP/m"
R "tax_codes list --limit=5" >"$TMP/r"; M "tax_codes list" >"$TMP/m"; cmp "tax_codes list" "$TMP/r" "$TMP/m"

echo "=== 资源 usage（bare <res> --help）==="
for r in customers products prices coupons payment_intents charges refunds subscriptions invoices invoiceitems payment_methods payment_links events setup_intents tax_rates shipping_rates quotes plans subscription_items webhook_endpoints apple_pay_domains subscription_schedules balance_transactions disputes payouts balance country_specs tax_codes; do
  R "$r" >"$TMP/r"; M "$r" >"$TMP/m"; cmp "bare $r usage" "$TMP/r" "$TMP/m"
done
R "checkout sessions" >"$TMP/r"; M "checkout sessions" >"$TMP/m"; cmp "bare checkout sessions usage" "$TMP/r" "$TMP/m"

echo "=== 元命令 ==="
R "version" >"$TMP/r"; M "version" >"$TMP/m"; cmp "version" "$TMP/r" "$TMP/m"
R "--help" >"$TMP/r"; M "--help" >"$TMP/m"; cmp "--help" "$TMP/r" "$TMP/m"
R "resources" >"$TMP/r"; M "resources" >"$TMP/m"; cmp "resources" "$TMP/r" "$TMP/m"

echo "=== 通用 HTTP / dry-run / expand / delete确认 ==="
R customers create --name=G >"$TMP/x"; rid=$(gid "$TMP/x"); M customers create --name=G >"$TMP/x"; mid=$(gid "$TMP/x")
R "get /v1/customers/$rid" >"$TMP/r"; M "get /v1/customers/$mid" >"$TMP/m"; cmp "get /v1/customers/:id" "$TMP/r" "$TMP/m"
R "customers create --name=Dry --email=d@e.com --dry-run" >"$TMP/r"; M "customers create --name=Dry --email=d@e.com --dry-run" >"$TMP/m"; cmp "create --dry-run" "$TMP/r" "$TMP/m"
R products create --name=E >"$TMP/x"; rp=$(gid "$TMP/x"); R "prices create --currency=usd --unit-amount=500 --product=$rp" >"$TMP/x"; rpr=$(gid "$TMP/x")
M products create --name=E >"$TMP/x"; mp=$(gid "$TMP/x"); M "prices create --currency=usd --unit-amount=500 --product=$mp" >"$TMP/x"; mpr=$(gid "$TMP/x")
R "prices retrieve $rpr -e product" >"$TMP/r"; M "prices retrieve $mpr -e product" >"$TMP/m"; cmp "prices retrieve -e product" "$TMP/r" "$TMP/m"
R customers create --name=DD >"$TMP/x"; rid=$(gid "$TMP/x"); M customers create --name=DD >"$TMP/x"; mid=$(gid "$TMP/x")
echo '' | stripe customers delete "$rid" >"$TMP/r" 2>&1; echo '' | bun bin/stripe customers delete "$mid" >"$TMP/m" 2>&1
cmp "delete 确认(拒绝)" "$TMP/r" "$TMP/m"

echo "=== trigger（全部 14 事件）==="
for e in customer.created customer.updated customer.deleted product.created price.created \
         payment_intent.created payment_intent.succeeded payment_intent.payment_failed payment_intent.canceled \
         charge.succeeded charge.refunded checkout.session.completed invoice.created invoice.paid; do
  R "trigger $e" >"$TMP/r"; M "trigger $e" >"$TMP/m"; cmp "trigger $e" "$TMP/r" "$TMP/m"
done

echo ""
echo "======================================"
echo "逐字节一致 $PASS / 有差异 $FAILN"
[ -n "$FAILS" ] && echo -e "差异项:$FAILS"
rm -rf "$TMP" data
