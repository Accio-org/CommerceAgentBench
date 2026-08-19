/**
 * auth.js — 复刻真品的「API key 门禁」。
 *
 * 真品逻辑：任何 API 操作前，必须有可用的 key，否则报 ERR_NO_API_KEY（stderr, exit 1）。
 * key 来源优先级：--api-key 标志 > 环境变量 STRIPE_API_KEY > 配置文件（login 写入）。
 *
 * 本 mock 不校验 key 的真伪（与 jira_cli 接受任意 token 一致），只校验「有没有」。
 */
import { getConfig } from "./db.js";
import { ERR_NO_API_KEY } from "./errors.js";

export function resolveApiKey(db, flags, profile) {
  if (flags["api-key"]) return flags["api-key"];
  if (process.env.STRIPE_API_KEY) return process.env.STRIPE_API_KEY;
  const fromConfig =
    getConfig(db, profile, "test_mode_api_key") || getConfig(db, profile, "live_mode_api_key");
  if (fromConfig) return fromConfig;
  return null;
}

// 没有 key 时打印真品错误并退出
export function requireApiKey(db, flags, profile) {
  const key = resolveApiKey(db, flags, profile);
  if (!key) {
    process.stderr.write(ERR_NO_API_KEY);
    process.exit(1);
  }
  return key;
}
