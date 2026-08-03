'use strict';

const fs = require('fs');
const path = require('path');
const { parseCommandArgs } = require('../utils');

const MOCK_HOME = process.env.DWS_MOCK_HOME || path.join(require('os').homedir(), '.dws-mock');
const CRED_PATH = path.join(MOCK_HOME, 'credentials.json');

const GLOBAL_FLAGS = `
Global Flags:
      --client-id string       Override OAuth client ID (DingTalk AppKey)
      --client-secret string   Override OAuth client secret (DingTalk AppSecret)
      --debug                  显示调试日志
      --dry-run                预览操作内容，不实际执行
      --fields string          筛选输出字段 (逗号分隔, 如: name,id,status)
  -f, --format string          输出格式: json|table|raw|pretty|ndjson|csv (default "json")
      --jq string              jq 表达式过滤输出 (如: '.items[] | .name')
      --mock                   使用 Mock 数据 (开发调试用)
      --timeout int            HTTP 请求超时时间 (秒) (default 30)
  -v, --verbose                显示详细日志
  -y, --yes                    跳过确认提示 (AI Agent 模式)`;

const GROUP_HELP = `管理钉钉 CLI 的认证凭证。支持 OAuth 扫码登录和 Device Flow。

Usage:
  dws auth [flags]
  dws auth [command]

Available Commands:
  export      导出可迁移认证包
  import      导入可迁移认证包
  login       登录钉钉（自动刷新 token，必要时扫码）
  logout      清除认证信息
  reset       重置认证信息（清除本地 Token，触发重新授权）
  status      查看认证状态

Flags:
  -h, --help   help for auth
${GLOBAL_FLAGS}

Use "dws auth [command] --help" for more information about a command.`;

const HELP_LOGIN = `登录钉钉并获取认证凭证。

支持的登录方式:
  - OAuth Loopback 流 (默认): 本机自动起 127.0.0.1 监听接收回调，浏览器授权后自动完成
  - OAuth 设备流 (--device): 显示 user_code + 短 URL，适合 SSH 远程 / 容器 / 无头环境
  - 直接提供 Token (--token): 跳过授权，使用已有 token

不支持的登录方式:
  - 邮箱/密码登录
  - 手机号/验证码登录
  - 应用凭证 (AppKey/AppSecret) 直接登录

注意: SSH 远程或无头环境（无本地浏览器可访问远端的 127.0.0.1）请使用 --device，
      否则 OAuth 回调会跳到本机不可达的 127.0.0.1 链接，授权完成后无法回写 token。

示例:
  dws auth login              # 本机扫码登录 (loopback 流)
  dws auth login --device     # SSH 远程 / 无头环境登录 (设备流)
  dws auth login --force      # 强制重新登录 (忽略缓存 token)
  dws auth login --token xxx  # 使用指定 token

Usage:
  dws auth login [flags]

Flags:
      --device         Use device authorization flow
      --force          Force interactive login (ignore cached token)
  -h, --help           help for login
      --token string   Access token
${GLOBAL_FLAGS}`;

const HELP_STATUS = `查看认证状态

Usage:
  dws auth status [flags]

Flags:
  -h, --help   help for status
${GLOBAL_FLAGS}`;

const HELP_LOGOUT = `清除认证信息

Usage:
  dws auth logout [flags]

Flags:
  -h, --help   help for logout
${GLOBAL_FLAGS}`;

// ─── Credential helpers (shared with doc.js via requireAuth) ──

function loadCredentials() {
  if (!fs.existsSync(CRED_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(CRED_PATH, 'utf8'));
  } catch { return null; }
}

function saveCredentials(cred) {
  fs.mkdirSync(path.dirname(CRED_PATH), { recursive: true });
  fs.writeFileSync(CRED_PATH, JSON.stringify(cred, null, 2) + '\n', { mode: 0o600 });
}

function deleteCredentials() {
  try { fs.unlinkSync(CRED_PATH); } catch { /* ignore */ }
}

function authError() {
  return {
    error: {
      actions: ['dws auth login'],
      category: 'auth', code: 2,
      hint: "运行 'dws auth login' 完成登录后重试",
      message: '未登录，请先执行 dws auth login',
      reason: 'not_authenticated'
    }
  };
}

function requireAuth() {
  const cred = loadCredentials();
  if (!cred || !cred.authenticated) return authError();
  return null;
}

// ─── Handlers ─────────────────────────────────────────────

function handleLogin(args, flags) {
  const params = parseCommandArgs(args);
  const token = params.token || flags.token;
  const clientId = params['client-id'] || flags.clientId;
  const clientSecret = params['client-secret'] || flags.clientSecret;

  const existing = loadCredentials();
  if (existing && existing.authenticated && !params.force) {
    return {
      success: true,
      message: 'Token 有效，无需重新登录',
      token_valid: true,
      expires_at: existing.expires_at
    };
  }

  const now = new Date();
  const expires = new Date(now.getTime() + 2 * 3600 * 1000);
  const refreshExpires = new Date(now.getTime() + 30 * 24 * 3600 * 1000);

  const cred = {
    authenticated: true,
    token: token || 'mock-access-token',
    client_id: clientId || null,
    client_secret: clientSecret || null,
    token_valid: true,
    expires_at: expires.toISOString(),
    refresh_expires_at: refreshExpires.toISOString(),
    corp_id: 'dingmock000000000000000000000000000',
    authenticated_at: now.toISOString()
  };
  saveCredentials(cred);
  return { success: true, message: '登录成功', token_valid: true, expires_at: cred.expires_at };
}

function handleStatus() {
  const cred = loadCredentials();
  if (!cred || !cred.authenticated) {
    return { success: true, authenticated: false, message: '未登录' };
  }
  return {
    success: true,
    authenticated: true,
    token_valid: true,
    refresh_token_valid: true,
    expires_at: cred.expires_at,
    refresh_expires_at: cred.refresh_expires_at,
    corp_id: cred.corp_id
  };
}

function handleLogout() {
  deleteCredentials();
  return { success: true, message: '认证信息已清除' };
}

function handleReset() {
  deleteCredentials();
  return { success: true, message: '认证信息已重置，请重新登录' };
}

function handleStub(name) {
  return {
    error: {
      category: 'api', code: 1,
      message: `auth ${name} 暂不支持 (mock 环境)`,
      reason: 'not_implemented'
    }
  };
}

// ─── Registration ─────────────────────────────────────────

function register(registerCommand) {
  registerCommand('auth', () => { console.log(GROUP_HELP); }, GROUP_HELP, null);
  registerCommand('auth login', handleLogin, HELP_LOGIN, null);
  registerCommand('auth status', handleStatus, HELP_STATUS, null);
  registerCommand('auth logout', handleLogout, HELP_LOGOUT, null);
  registerCommand('auth reset', handleReset, HELP_LOGOUT, null);
  registerCommand('auth export', () => handleStub('export'), null, null);
  registerCommand('auth import', () => handleStub('import'), null, null);
}

module.exports = { register, requireAuth, loadCredentials, authError };
