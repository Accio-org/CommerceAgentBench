'use strict';

const fs = require('fs');
const path = require('path');
const { parseGlobalFlags } = require('./flags');
const { formatOutput, writeOutput } = require('./output');
const db = require('../lib/db');

const VERSION = '1.0.33';

// Command registry
const commands = {};
const commandHelp = {};
const commandToolMap = {};
function registerCommand(name, handler, help, toolName) {
  commands[name] = handler;
  if (help) commandHelp[name] = help;
  if (toolName) commandToolMap[name] = toolName;
}

// Load all command modules
const commandFiles = fs.readdirSync(path.join(__dirname, 'commands')).filter(f => f.endsWith('.js'));
for (const file of commandFiles) {
  const mod = require(path.join(__dirname, 'commands', file));
  if (mod.register) {
    mod.register(registerCommand);
  }
}

function printHelp() {
  const help = `Discovered MCP Services:

  doc          钉钉文档（搜索 / 浏览 / 读写 / 上传下载 / 文件 / 文件夹 / 块级编辑 / 评论）
  schema       查看 MCP 工具 Schema (产品列表 / 工具参数)

Usage:
  dws <service> [command] [flags]
  dws <command> [flags]

Utility Commands:

  auth        认证管理
  help        Help about any command
  schema      查看 MCP 工具 Schema (产品列表 / 工具参数)
  version     显示版本信息

Use "dws <service> --help" for more information about a discovered MCP service or "dws <command> --help" for utility commands.

提示: 如果遇到能力缺失、命令报错、新功能未注册、或无法完成任务, 请先用 'dws upgrade' 升级到最新版本后再试. 钉钉 OpenAPI 和 dws CLI 持续迭代, 新能力和 bugfix 会先在新版本上线.`;
  console.log(help);
}

function run(argv) {
  const { flags, args } = parseGlobalFlags(argv);

  // Check for response override
  if (process.env.DWS_MOCK_RESPONSE_FILE) {
    try {
      const content = fs.readFileSync(process.env.DWS_MOCK_RESPONSE_FILE, 'utf8');
      const data = JSON.parse(content);
      writeOutput(formatOutput(data, flags), flags);
      return;
    } catch (e) {
      console.error(`Error reading DWS_MOCK_RESPONSE_FILE: ${e.message}`);
      process.exit(1);
    }
  }

  if (process.env.DWS_MOCK_RESET === '1') {
    db.resetDb();
  }

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printHelp();
    return;
  }

  if (args[0] === '--version' || args[0] === 'version') {
    console.log(`dws version v${VERSION} (mock)`);
    return;
  }

  // Handle mock admin commands
  if (args[0] === 'mock-reset') {
    db.resetDb();
    console.log('State reset to initial fixtures.');
    return;
  }

  if (args[0] === 'mock-inject') {
    const fileIdx = args.indexOf('--file');
    if (fileIdx === -1 || !args[fileIdx + 1]) {
      console.error('Usage: dws mock-inject --file <path-to-json>');
      process.exit(1);
    }
    try {
      const data = JSON.parse(fs.readFileSync(args[fileIdx + 1], 'utf8'));
      db.injectData(data);
      console.log('State injected successfully.');
    } catch (e) {
      console.error(`Error injecting state: ${e.message}`);
      process.exit(1);
    }
    return;
  }

  const config = { latency: 0, errorRate: 0 };

  // Simulate latency
  if (config.latency > 0) {
    const start = Date.now();
    while (Date.now() - start < config.latency) { /* busy wait */ }
  }

  // Simulate random errors
  if (config.errorRate > 0 && Math.random() < config.errorRate) {
    const errorResp = {
      success: false,
      errorCode: 'MOCK_RANDOM_ERROR',
      errorMessage: 'Simulated random error (configured via errorRate)'
    };
    writeOutput(formatOutput(errorResp, flags), flags);
    process.exit(1);
  }

  // Route command
  const commandKey = findCommandKey(args);
  if (commandKey && commands[commandKey]) {
    const handler = commands[commandKey];
    const commandArgs = args.slice(commandKey.split(' ').length);

    // Handle --help / -h
    if (commandArgs.includes('--help') || commandArgs.includes('-h')) {
      const help = commandHelp[commandKey];
      if (help) {
        console.log(help);
      } else {
        console.log(`${commandKey.replace(/ /g, '/')}\n\nUsage:\n  dws ${commandKey} [flags]\n\nUse "dws --help" for global flags.`);
      }
      return;
    }

    // Handle --dry-run
    if (flags.dryRun) {
      const params = parseCommandArgs(commandArgs);
      const toolName = commandToolMap[commandKey] || commandKey.replace(/ /g, '_');
      const canonicalProduct = commandKey.split(' ')[0];
      const legacyPath = commandKey;

      const dryRunResp = {
        invocation: {
          kind: 'compat_invocation',
          stage: 'compat_cli',
          implemented: false,
          dry_run: true,
          canonical_product: canonicalProduct,
          tool: toolName,
          canonical_path: `${canonicalProduct}.${toolName}`,
          legacy_path: legacyPath,
          params
        },
        response: {
          dry_run: true,
          endpoint: `https://mcp-gw.dingtalk.com/server/mock_${canonicalProduct}`,
          note: 'execution skipped by --dry-run',
          request: {
            id: Math.floor(Math.random() * 100),
            jsonrpc: '2.0',
            method: 'tools/call',
            params: {
              arguments: params,
              name: toolName
            }
          }
        }
      };
      writeOutput(formatOutput(dryRunResp, flags), flags);
      return;
    }

    const result = handler(commandArgs, flags);
    if (result !== undefined) {
      writeOutput(formatOutput(result, flags), flags);
      if (result && result.error) {
        process.exit(result.error.code || 1);
      }
    }
  } else {
    printHelp();
    const errJson = {
      error: {
        category: 'internal',
        code: 5,
        message: `unknown command "${args.join(' ')}" for "dws"`
      }
    };
    console.log(JSON.stringify(errJson, null, 2));
    process.exit(5);
  }
}

/**
 * Find the longest matching command key
 */
function findCommandKey(args) {
  // Try increasingly shorter command paths
  for (let len = Math.min(args.length, 4); len > 0; len--) {
    const key = args.slice(0, len).join(' ');
    if (commands[key]) return key;
  }
  return null;
}

const { parseCommandArgs } = require('./utils');

module.exports = { run, parseCommandArgs };
