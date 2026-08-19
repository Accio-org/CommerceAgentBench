#!/usr/bin/env bash
# smoke_test.sh — 把 mock 输出逐字节 diff golden（真品 stripe 1.42.1 捕获）。
# counted 检查全过 → exit 0。
set -u
cd "$(dirname "$0")"
export NO_COLOR=1 TERM=dumb STRIPE_API_KEY="" MOCK_VERIFIER_TOKEN=bench-verifier
STRIPE="bun bin/stripe"
PASS=0; FAIL=0
TMP="$(mktemp -d)"

# check <label> <golden> <stream:out|err> -- <args...>
check() {
  local label="$1" golden="$2" stream="$3"; shift 3; [ "$1" = "--" ] && shift
  local out="$TMP/$label"
  if [ "$stream" = "err" ]; then $STRIPE "$@" >/dev/null 2>"$out"; else $STRIPE "$@" >"$out" 2>/dev/null; fi
  if diff -u "golden/$golden" "$out" >"$TMP/$label.diff" 2>&1; then
    echo "  ✓ $label"; PASS=$((PASS+1))
  else
    echo "  ✗ $label  (diff:)"; sed 's/^/      /' "$TMP/$label.diff"; FAIL=$((FAIL+1))
  fi
}

# 干净库
rm -rf data

echo "== counted golden checks =="
check version            version.txt              out -- version
check top_help           help.txt                 out -- --help
check resources          resources.txt            out -- resources
check err_unknown        err_unknown_cmd.stdout.txt   out -- frobnicate
check err_no_api_key     err_no_api_key.stderr.txt    err -- customers create --name=X
check err_retrieve_noid  err_retrieve_no_id.stderr.txt err -- customers retrieve

echo ""
echo "== behavioral assertions (mock 行为，非 golden diff) =="
rm -rf data
assert() { if eval "$2"; then echo "  ✓ $1"; PASS=$((PASS+1)); else echo "  ✗ $1"; FAIL=$((FAIL+1)); fi; }
echo "sk_test_mock_key_for_smoke" | $STRIPE login --interactive >/dev/null 2>&1
CID=$($STRIPE customers create --name=A --email=a@b.com 2>/dev/null | grep '"id"' | sed 's/.*: "//;s/".*//')
assert "create 返回 cus_ 前缀 id"   "[[ '$CID' == cus_* ]]"
assert "retrieve 能查到刚建对象"     "$STRIPE customers retrieve $CID 2>/dev/null | grep -q '\"id\": \"$CID\"'"
assert "list 含该对象"               "$STRIPE customers list 2>/dev/null | grep -q '$CID'"
PID=$($STRIPE products create --name=P 2>/dev/null | grep '"id"' | sed 's/.*: "//;s/".*//')
assert "product 返回 prod_ 前缀"     "[[ '$PID' == prod_* ]]"
assert "price 能引用 product id"     "$STRIPE prices create --currency=usd --unit-amount=500 --product=$PID 2>/dev/null | grep -q '\"product\": \"$PID\"'"
assert "delete -c 返回 deleted:true" "$STRIPE customers delete $CID -c 2>/dev/null | grep -q '\"deleted\": true'"

echo ""
echo "== CRUD JSON 逐字节对真品 (normalized: 掩 id/时间戳/req_id) =="
# 归一化易变字段后，mock 输出须与 golden/crud/*（真品 stripe 1.42.1 捕获）一致
norm() {
  sed -E \
    -e 's/"(id|product)": "(cus|prod|price)_[A-Za-z0-9]+"/"\1": "\2_X"/g' \
    -e 's/"(created|updated)": [0-9]+/"\1": 0/g' \
    -e 's/"invoice_prefix": "[A-Za-z0-9]+"/"invoice_prefix": "X"/g' \
    -e 's#req_[A-Za-z0-9]+#req_X#g' \
    -e 's#dashboard.stripe.com/acct_[A-Za-z0-9]+#dashboard.stripe.com/acct_X#g'
}
ncheck() { # <label> <golden-crud-file> <mock-output-file>
  if diff <(norm <"golden/crud/$2") <(norm <"$3") >"$TMP/$1.ndiff" 2>&1; then
    echo "  ✓ $1"; PASS=$((PASS+1))
  else
    echo "  ✗ $1"; sed 's/^/      /' "$TMP/$1.ndiff"; FAIL=$((FAIL+1))
  fi
}
rm -rf data; echo "sk_test_mock_key_for_smoke" | $STRIPE login --interactive >/dev/null 2>&1
$STRIPE customers create --name="Jenny Rosen" --email="jenny@example.com" -d "metadata[order_id]=6735" >"$TMP/cust" 2>&1
ncheck customer_create   customer_create.json   "$TMP/cust"
$STRIPE products create --name="Gold Plan" >"$TMP/prod" 2>&1
ncheck product_create    product_create.json    "$TMP/prod"
PID=$(grep '"id"' "$TMP/prod" | head -1 | sed 's/.*: "//;s/".*//')
$STRIPE prices create --currency=usd --unit-amount=1000 -d "recurring[interval]=month" --product="$PID" >"$TMP/price" 2>&1
ncheck price_create      price_create.json      "$TMP/price"
$STRIPE customers retrieve cus_DOESNOTEXIST000 >"$TMP/e404" 2>&1
ncheck err_resource_missing  err_resource_missing.json  "$TMP/e404"
$STRIPE prices create >"$TMP/epm" 2>&1
ncheck err_parameter_missing err_parameter_missing.json "$TMP/epm"

echo ""
echo "== B1 扩展资源 (create→retrieve 回环 + 输入回显 + 串联) =="
rm -rf data; echo "sk_test_mock_key_for_smoke" | $STRIPE login --interactive >/dev/null 2>&1
rcreate() { $STRIPE "$@" 2>/dev/null | grep '"id"' | head -1 | sed 's/.*: "//;s/".*//'; }
# 每个资源 create 返回带正确前缀的 id，且 retrieve 查得到
rcheck() { # <label> <id> <prefix>
  if [[ "$2" == $3* ]] && $STRIPE "$4" retrieve "$2" 2>/dev/null | grep -q "\"id\": \"$2\""; then
    echo "  ✓ $1 ($2)"; PASS=$((PASS+1)); else echo "  ✗ $1 (id=$2)"; FAIL=$((FAIL+1)); fi
}
rcheck coupon          "$(rcreate coupons create --percent-off=25 --duration=once)"            ""      coupons
rcheck payment_intent  "$(rcreate payment_intents create --amount=2000 --currency=usd)"        pi_     payment_intents
rcheck charge          "$(rcreate charges create --amount=2000 --currency=usd --source=tok_visa)" ch_  charges
REFUND_CHARGE=$($STRIPE charges create --amount=3000 --currency=usd --source=tok_visa 2>/dev/null | grep '"id"'|head -1|sed 's/.*: "//;s/".*//')
rcheck refund          "$(rcreate refunds create --charge=$REFUND_CHARGE)"                      re_     refunds
rcheck subscription    "$(rcreate subscriptions create --customer=cus_X -d items[0][price]=price_X)" sub_ subscriptions
rcheck invoice         "$(rcreate invoices create --customer=cus_X)"                            in_     invoices
rcheck invoiceitem     "$(rcreate invoiceitems create --customer=cus_X --amount=500 --currency=usd)" ii_ invoiceitems
rcheck payment_method  "$(rcreate payment_methods create --type=card)"                          pm_     payment_methods
rcheck payment_link    "$(rcreate payment_links create)"                                        plink_  payment_links
# 输入回显：amount 必须等于传入值
PIID=$($STRIPE payment_intents create --amount=4242 --currency=jpy 2>/dev/null | grep '"id"'|head -1|sed 's/.*: "//;s/".*//')
if $STRIPE payment_intents retrieve "$PIID" 2>/dev/null | grep -q '"amount": 4242'; then echo "  ✓ pi 输入回显 amount=4242"; PASS=$((PASS+1)); else echo "  ✗ pi 输入回显"; FAIL=$((FAIL+1)); fi
# 串联：refund.charge 引用传入的 charge id
CHAIN_CH=$($STRIPE charges create --amount=5000 --currency=usd --source=tok_visa 2>/dev/null | grep '"id"'|head -1|sed 's/.*: "//;s/".*//')
if $STRIPE refunds create --charge="$CHAIN_CH" 2>/dev/null | grep -q "\"charge\": \"$CHAIN_CH\""; then echo "  ✓ refund 串联 charge id"; PASS=$((PASS+1)); else echo "  ✗ refund 串联"; FAIL=$((FAIL+1)); fi
# checkout sessions 命名空间命令
CS=$($STRIPE checkout sessions create --mode=payment --success-url=https://e.com 2>/dev/null | grep '"id"'|head -1|sed 's/.*: "//;s/".*//')
if [[ "$CS" == cs_test_* ]]; then echo "  ✓ checkout sessions ($CS)"; PASS=$((PASS+1)); else echo "  ✗ checkout sessions"; FAIL=$((FAIL+1)); fi
SR=$($STRIPE shipping_rates create -d "display_name=Standard US Shipping" -d "type=fixed_amount" -d "fixed_amount[amount]=599" -d "fixed_amount[currency]=usd" 2>/dev/null | grep '"id"'|head -1|sed 's/.*: "//;s/".*//')
assert "shipping_rate create 回显 fixed_amount.amount" "$STRIPE shipping_rates retrieve $SR 2>/dev/null | grep -q '\"amount\": 599'"
$STRIPE shipping_rates update "$SR" -d "fixed_amount[amount]=999" >/dev/null 2>&1
assert "shipping_rate update 回显 fixed_amount.amount" "$STRIPE shipping_rates retrieve $SR 2>/dev/null | grep -q '\"amount\": 999'"

echo ""
echo "== B2 delete确认 / dry-run / -c =="
rm -rf data; echo "sk_test_mock_key_for_smoke" | $STRIPE login --interactive >/dev/null 2>&1
DC=$($STRIPE customers create --name=DC 2>/dev/null | grep '"id"'|head -1|sed 's/.*: "//;s/".*//')
assert "delete 默认打确认横幅"        "echo '' | $STRIPE customers delete $DC 2>&1 | grep -q \"Enter 'yes' to confirm\""
assert "delete 拒绝则不删"            "echo '' | $STRIPE customers delete $DC 2>&1 | grep -q 'Exiting without execution'"
assert "delete 拒绝后对象仍在"        "$STRIPE customers retrieve $DC 2>/dev/null | grep -q '\"id\": \"$DC\"'"
assert "delete 喂 yes 则删除"         "echo yes | $STRIPE customers delete $DC 2>&1 | grep -q '\"deleted\": true'"
DC2=$($STRIPE customers create --name=DC2 2>/dev/null | grep '"id"'|head -1|sed 's/.*: "//;s/".*//')
assert "delete -c 跳过确认直接删"     "$STRIPE customers delete $DC2 -c 2>&1 | grep -q '\"deleted\": true'"
assert "create --dry-run 出 dry_run"  "$STRIPE customers create --name=Z --dry-run 2>&1 | grep -q '\"dry_run\"'"
assert "dry-run 不落库"               "! ($STRIPE customers list 2>/dev/null | grep -q '\"name\": \"Z\"')"
assert "dry-run params 回显"          "$STRIPE customers create --name=Zed --dry-run 2>&1 | grep -q '\"name\": \"Zed\"'"

echo ""
echo "== B3 trigger / fixtures (逐字节对真品 + 落库副作用) =="
rm -rf data; echo "sk_test_mock_key_for_smoke" | $STRIPE login --interactive >/dev/null 2>&1
tcheck() { # <label> <event> <golden>
  if diff <($STRIPE trigger "$2" 2>/dev/null) "golden/trigger/$3" >"$TMP/t.diff" 2>&1; then
    echo "  ✓ $1"; PASS=$((PASS+1)); else echo "  ✗ $1"; sed 's/^/      /' "$TMP/t.diff"; FAIL=$((FAIL+1)); fi
}
tcheck "trigger customer.created"            customer.created            customer_created.txt
tcheck "trigger payment_intent.succeeded"    payment_intent.succeeded    payment_intent_succeeded.txt
tcheck "trigger price.created"               price.created               price_created.txt
tcheck "trigger checkout.session.completed"  checkout.session.completed  checkout_session_completed.txt
tcheck "trigger 未知事件提示"                 nonexistent.event           unknown.txt
# 副作用：trigger 真建对象 + 写 events 表
rm -rf data; echo "sk_test_mock_key_for_smoke" | $STRIPE login --interactive >/dev/null 2>&1
$STRIPE trigger customer.created >/dev/null 2>&1
assert "trigger 落库 customer"   "$STRIPE customers list 2>/dev/null | grep -q '\"object\": \"customer\"'"
assert "trigger 写 events 表"    "$STRIPE events list 2>/dev/null | grep -q '\"type\": \"customer.created\"'"
# fixtures 自定义文件
printf '{"_meta":{"template_version":0},"fixtures":[{"name":"c","path":"/v1/customers","method":"post","params":{"description":"x"}}]}' > "$TMP/fx.json"
assert "fixtures <file> 跑通"    "$STRIPE fixtures $TMP/fx.json 2>&1 | grep -q 'Trigger succeeded'"

echo ""
echo "== B4 校验 / 错误 (逐字节对真品) =="
rm -rf data; echo "sk_test_mock_key_for_smoke" | $STRIPE login --interactive >/dev/null 2>&1
nmask() { sed -E 's#req_[A-Za-z0-9]+#req_X#g; s#acct_[A-Za-z0-9]+#acct_X#g'; }
echeck() { # <label> <golden> -- <args...>
  local label="$1" golden="$2"; shift 2; [ "$1" = "--" ] && shift
  if diff <($STRIPE "$@" 2>&1 | nmask) <(nmask <"golden/errors/$golden") >"$TMP/e.diff" 2>&1; then
    echo "  ✓ $label"; PASS=$((PASS+1)); else echo "  ✗ $label"; sed 's/^/      /' "$TMP/e.diff"|head -6; FAIL=$((FAIL+1)); fi
}
echeck "非法 currency 错误体"  invalid_currency.json      -- payment_intents create --amount=2000 --currency=zzz
echeck "非法 duration 枚举"    invalid_enum_duration.json -- coupons create --percent-off=10 --duration=forever-ish
assert "合法 currency 通过"    "$STRIPE payment_intents create --amount=2000 --currency=eur 2>&1 | grep -q '\"object\": \"payment_intent\"'"
assert "非整数 amount → CLI错误" "$STRIPE payment_intents create --amount=abc --currency=usd 2>&1 | grep -q 'strconv.ParseInt'"
assert "未知操作 → usage"      "$STRIPE customers frobnicate 2>&1 | grep -q 'Available Operations'"
assert "非法 pm type → 拒绝"   "$STRIPE payment_methods create --type=BOGUS 2>&1 | grep -q '\"Invalid type'"
assert "合法 pm type 通过"     "$STRIPE payment_methods create --type=card 2>&1 | grep -q '\"object\": \"payment_method\"'"
assert "非法 cs mode → 拒绝"   "$STRIPE checkout sessions create --mode=BOGUS --success-url=https://e.com 2>&1 | grep -q '\"Invalid mode'"
assert "合法 cs mode 通过"     "$STRIPE checkout sessions create --mode=payment --success-url=https://e.com 2>&1 | grep -q '\"object\": \"checkout.session\"'"
assert "非法 interval → 拒绝"  "$STRIPE plans create --amount=1000 --currency=usd --interval=biweekly 2>&1 | grep -q '\"Invalid interval'"
assert "非法 collection → 拒绝" "$STRIPE subscriptions create --customer=cus_X --collection-method=bogus -d 'items[0][price]=price_X' 2>&1 | grep -q '\"Invalid collection_method'"
assert "未知参数 → 拒绝"       "$STRIPE customers create --name=X --bogus_field=Y 2>&1 | grep -q '\"parameter_unknown\"'"
assert "合法参数仍正常"        "$STRIPE customers create --name=ValidTest --email=v@t.com 2>&1 | grep -q '\"name\": \"ValidTest\"'"

echo ""
echo "== B5 seeds / bench 验证面 =="
BENCH="bun bin/stripe-bench"; export MOCK_VERIFIER_TOKEN=bench-verifier
rm -rf data
assert "bench seed 注入起始态"   "$BENCH seed --token bench-verifier 2>&1 | grep -q '\"customers\": 2'"
echo "sk_test_mock_key_for_smoke" | $STRIPE login --interactive >/dev/null 2>&1
assert "种子后 list 有数据"      "[ \$($STRIPE customers list 2>/dev/null | grep -c '\"object\": \"customer\"') -eq 2 ]"
assert "bench state dump 对象"   "$BENCH state --token bench-verifier 2>&1 | grep -q '\"resource\": \"customers\"'"
assert "bench audit 记录操作"    "$STRIPE customers create --name=AuditMe 2>/dev/null >/dev/null; $BENCH audit --token bench-verifier 2>&1 | grep -q '\"operation\": \"create\"'"
assert "bench reset 清库"        "$BENCH reset --token bench-verifier >/dev/null 2>&1; [ \$($BENCH state --token bench-verifier 2>&1 | grep -c '\"resource\"') -eq 0 ]"
assert "bench 错 token 拒绝"     "! ($BENCH state --token WRONG >/dev/null 2>&1)"

echo ""
echo "== B6 边界命令 / config / expand =="
rm -rf data; echo "sk_test_mock_key_for_smoke" | $STRIPE login --interactive >/dev/null 2>&1
assert "listen 边界桩不挂起"     "$STRIPE listen 2>&1 | grep -q 'webhook signing secret'"
assert "logs tail 边界桩"        "$STRIPE logs tail 2>&1 | grep -q 'API request logs'"
assert "samples 边界提示"        "$STRIPE samples 2>&1 | grep -q 'mock boundary'"
assert "config --set/--list"     "$STRIPE config --set color on >/dev/null 2>&1; $STRIPE config --list 2>&1 | grep -q 'color = \"on\"'"
assert "config --unset"          "$STRIPE config --unset color >/dev/null 2>&1; ! ($STRIPE config --list 2>&1 | grep -q color)"
EPID=$($STRIPE products create --name=Exp 2>/dev/null|grep '"id"'|head -1|sed 's/.*: "//;s/".*//')
EPR=$($STRIPE prices create --currency=usd --unit-amount=500 --product=$EPID 2>/dev/null|grep '"id"'|head -1|sed 's/.*: "//;s/".*//')
assert "expand: product 不展开是 id" "$STRIPE prices retrieve $EPR 2>/dev/null | grep -q '\"product\": \"prod_'"
assert "expand: -e product 变对象"   "$STRIPE prices retrieve $EPR -e product 2>/dev/null | grep -q '\"product\": {'"

echo ""
echo "== B7 login --interactive =="
rm -rf data
# --interactive 合法 key
assert "login --interactive 合法 key"  "echo sk_test_51FakeKey123 | $STRIPE login --interactive 2>&1 | grep -q 'Done! The Stripe CLI is configured'"
assert "login 后 API 可用"             "$STRIPE customers create --name=LoginTest 2>/dev/null | grep -q '\"object\": \"customer\"'"
# --interactive 非法 key
rm -rf data
assert "login --interactive 非法 key 拒绝"  "! (echo bad_key_xxx | $STRIPE login --interactive 2>/dev/null)"
assert "login --interactive 非法 key 报错"  "echo bad_key_xxx | $STRIPE login --interactive 2>&1 | grep -q 'Invalid API key format'"
# 裸 login 报错提示用 --interactive
rm -rf data
assert "login 裸调报错"               "! ($STRIPE login 2>/dev/null)"
assert "login 裸调提示 --interactive"  "$STRIPE login 2>&1 | grep -q '\-\-interactive'"
# --help
assert "login --help 显示 interactive 选项" "$STRIPE login --help 2>&1 | grep -q '\-\-interactive'"
# 未登录时 API 拒绝
rm -rf data
assert "未登录 API 拒绝"              "$STRIPE customers list 2>&1 | grep -q 'not configured API keys'"

echo ""
echo "通过 $PASS / 失败 $FAIL"
rm -rf "$TMP" data
[ "$FAIL" -eq 0 ]
