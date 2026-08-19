#!/usr/bin/env node

const baseUrl = process.env.GMAIL_MOCK_URL || 'http://127.0.0.1:3071';
const [, , command, ...rest] = process.argv;

function usage() {
  return `Usage:
  node workspace_cli.mjs tools
  node workspace_cli.mjs call <tool-name> [json-args]
  node workspace_cli.mjs /gmail/search <query>
  node workspace_cli.mjs /calendar/get-schedule [YYYY-MM-DD]

Environment:
  GMAIL_MOCK_URL=http://127.0.0.1:3071`;
}

async function request(path, options = {}) {
  const res = await fetch(new URL(path, baseUrl), {
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(body.message || body.error || `${path} failed with ${res.status}`);
  }
  return body;
}

function parseJsonArg(raw) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON args: ${raw}`);
  }
}

async function callTool(name, args = {}) {
  const result = await request('/api/workspace/call', {
    method: 'POST',
    body: JSON.stringify({ name, arguments: args })
  });
  console.log(JSON.stringify(result.result, null, 2));
}

async function main() {
  if (!command || command === '--help' || command === '-h') {
    console.log(usage());
    return;
  }
  if (command === 'tools') {
    const result = await request('/api/workspace/tools');
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === 'call') {
    const name = rest[0];
    if (!name) throw new Error('Missing tool name');
    await callTool(name, parseJsonArg(rest[1]));
    return;
  }
  if (command === '/gmail/search') {
    await callTool('gmail.search', { query: rest.join(' ') });
    return;
  }
  if (command === '/calendar/get-schedule') {
    await callTool('calendar.listEvents', { date: rest[0] || '' });
    return;
  }
  throw new Error(`Unknown command: ${command}\n${usage()}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
