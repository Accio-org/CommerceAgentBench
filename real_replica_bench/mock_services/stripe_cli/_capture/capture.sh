#!/usr/bin/env bash
# capture.sh — 采集真品 stripe CLI 的输出，作为 mock 的 golden 真值。
#
# 全程离线、安全：不需要登录、不会创建任何 Stripe 对象。
# （未登录时敲 create 只会返回 auth 错误，那个错误本身就是我们要的 golden。）
#
# 用法：
#   bash capture.sh
# 跑完后把整个 _capture/golden_raw/ 目录给 Claude。

set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/golden_raw"
rm -rf "$OUT"
mkdir -p "$OUT"

STRIPE_BIN="$(command -v stripe || true)"
if [ -z "$STRIPE_BIN" ]; then
  echo "找不到 stripe，请确认已安装并在 PATH 中" >&2
  exit 1
fi

# 关闭颜色 / 关闭升级检查噪音，让输出更稳定可复现
export NO_COLOR=1
export TERM=dumb
export STRIPE_CLI_TELEMETRY_OPTOUT=1

# run <label> <args...>
# 把一条命令的 命令行 / exit code / stdout / stderr 分别存档
run() {
  local label="$1"; shift
  local dir="$OUT/$label"
  mkdir -p "$dir"
  printf 'stripe %s\n' "$*" > "$dir/cmd.txt"
  stripe "$@" > "$dir/stdout.txt" 2> "$dir/stderr.txt"
  printf '%s\n' "$?" > "$dir/exit.txt"
  echo "  [捕获] stripe $*"
}

echo "==> 真品版本"
stripe version > "$OUT/_version.txt" 2>&1
echo "    $(head -1 "$OUT/_version.txt")"

echo "==> 顶层 & 元命令"
run version            version
run version_flag       --version
run help               --help
run help_bare          help
run resources          resources
run config_help        config --help
run config_list        config --list
run login_help         login --help
run logout_help        logout --help
run whoami_help        whoami --help
run completion_help    completion --help
run get_help           get --help
run post_help          post --help
run delete_help        delete --help
run trigger_help       trigger --help
run listen_help        listen --help

echo "==> 核心资源的 help（揭示真实操作集 + flag）"
for r in customers products prices coupons payment_intents charges subscriptions invoices; do
  run "res_${r}_help" "$r" --help
done

echo "==> create 子命令的 help（揭示每个字段的真实 flag 名）"
run customers_create_help  customers create --help
run products_create_help   products create --help
run prices_create_help     prices create --help

echo "==> 错误路径（这些是高价值 golden）"
run err_unknown_cmd        frobnicate
run err_unknown_resource   notaresource list
run err_no_operation       customers
run err_retrieve_no_id     customers retrieve
# 下面这些未登录时会触发 auth 错误；若你已登录 test mode，则会真实创建对象（test mode 不涉及真钱）
run try_customers_create   customers create --name="Jenny Rosen" --email="jenny@example.com"
run try_products_create    products create --name="Gold Plan"
run try_customers_list     customers list --limit=3

echo ""
echo "==> 完成。产物在：$OUT"
echo "    把整个 golden_raw/ 目录交给 Claude 即可。"
