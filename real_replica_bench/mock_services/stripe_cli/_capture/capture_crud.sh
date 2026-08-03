#!/usr/bin/env bash
# capture_crud.sh — 采集真品 stripe 的资源 CRUD 真实输出，用来把 mock 的
# JSON 序列化格式（键顺序/缩进/字段集/list 包装/错误体）校到逐字节一致。
#
# 前提：先在你自己的终端跑过 `stripe login`（test mode 即可）。
# 注意：本脚本会在你的 test mode 账号真实创建对象（不涉及真钱），结尾会删除建的 customer。

set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/golden_crud"
rm -rf "$OUT"; mkdir -p "$OUT"

export NO_COLOR=1 TERM=dumb STRIPE_CLI_TELEMETRY_OPTOUT=1

# 必须已登录：1.42.1 登录后 whoami 显示 "Test mode key: available"；未登录显示 "Authenticated: false"
WHOAMI=$(stripe whoami 2>/dev/null | grep -v '^<claude-code-hint')
if echo "$WHOAMI" | grep -qi "Authenticated: *false" || ! echo "$WHOAMI" | grep -qiE "Test mode key|Account:"; then
  echo "❌ 还没登录。请先在终端执行：stripe login   （选 test mode）" >&2
  exit 1
fi
echo "✓ 已登录，开始采集真实 CRUD 输出…"

# run <label> <args...> ：存 cmd/stdout/stderr/exit，并剥离 agent 环境注入的 hint 行
run() {
  local label="$1"; shift
  local dir="$OUT/$label"; mkdir -p "$dir"
  printf 'stripe %s\n' "$*" > "$dir/cmd.txt"
  stripe "$@" > "$dir/stdout.txt" 2> "$dir/stderr.raw"
  printf '%s\n' "$?" > "$dir/exit.txt"
  grep -v '^<claude-code-hint' "$dir/stderr.raw" > "$dir/stderr.txt"; rm -f "$dir/stderr.raw"
  echo "  [捕获] stripe $*"
}
idof() { grep '"id"' "$OUT/$1/stdout.txt" | head -1 | sed 's/.*: "//;s/".*//'; }

# ---- customers 链（格式锚点）----
run cust_create   customers create --name="Jenny Rosen" --email="jenny@example.com" -d "metadata[order_id]=6735"
CID="$(idof cust_create)"
echo "    CID=$CID"
run cust_retrieve customers retrieve "$CID"
run cust_update   customers update "$CID" --name="Jenny Updated"
run cust_list     customers list --limit=3

# ---- products / prices 链 ----
run prod_create   products create --name="Gold Plan"
PID="$(idof prod_create)"
echo "    PID=$PID"
run price_create  prices create --currency=usd --unit-amount=1000 -d "recurring[interval]=month" --product="$PID"

# ---- 真实 API 错误（替换我手写的错误体）----
run err_404           customers retrieve cus_DOESNOTEXIST000
run err_missing_param prices create

# ---- 清理：删掉建的 customer（product/price 留着无妨，可在 Dashboard 删）----
run cust_delete   customers delete "$CID"

echo ""
echo "==> 完成。产物在：$OUT"
echo "    把整个 golden_crud/ 交给 Claude（或直接告诉我跑完了）。"
