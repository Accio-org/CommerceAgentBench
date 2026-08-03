import fs from 'fs';
import { getClient } from '../utils/api-client.js';
import { formatOutput, printError } from '../utils/format.js';
import { parseRequestItems } from '../utils/request-items.js';

function stdinIsPiped() {
  return !process.stdin.isTTY;
}

export function registerApiCommands(program) {
  const api = program.command('api').description('Make Notion API requests');

  api
    .command('ls')
    .description('List all available API endpoints')
    .action(async () => {
      const client = getClient();
      const { results } = await client.get('/api/endpoints');
      const rows = results.map(e => ({ method: e.method, path: e.path }));
      console.log(formatOutput(rows, program.opts()));
    });

  api
    .argument('[path]', 'API path (e.g. v1/users/me)')
    .argument('[items...]', 'Inline request items (key=value, key:=json, key==query, Header:Value)')
    .option('-X, --method <method>', 'HTTP method')
    .option('-d, --data <json>', 'Request body as JSON string')
    .option('--notion-version <version>', 'Notion API version override')
    .option('--verbose', 'Print request/response details to stderr')
    .option('--spec', 'Print endpoint spec')
    .option('--docs', 'Print endpoint docs')
    .option('--help-endpoint', 'Show endpoint help')
    .option('--file <path>', 'Read file contents into a multipart file form field')
    .action(async (apiPath, items, opts) => {
      if (!apiPath || apiPath === 'ls') return;
      const client = getClient();

      if (opts.spec || opts.docs || opts.helpEndpoint) {
        const { results } = await client.get('/api/endpoints');
        const normalized = apiPath.startsWith('/') ? apiPath.slice(1) : apiPath;
        const matching = results.filter(e => {
          const pattern = e.path.replace(/:(\w+)/g, '[^/]+');
          return new RegExp(`^${pattern}$`).test(normalized);
        });
        if (matching.length === 0) {
          printError(`No endpoint found for: ${normalized}`);
          process.exit(1);
        }
        const filtered = opts.method ? matching.filter(e => e.method === opts.method.toUpperCase()) : matching;
        const display = filtered.length > 0 ? filtered : matching;
        for (const ep of display) {
          console.log(`${ep.method} ${ep.path}`);
        }
        return;
      }

      let body = null;
      let queryParams = {};
      let extraHeaders = {};

      let fileContent = null;
      if (opts.file) {
        try {
          fileContent = fs.readFileSync(opts.file);
        } catch (err) {
          printError(`Could not read file: ${opts.file}`);
          process.exit(1);
        }
      }

      if (opts.data) {
        try { body = JSON.parse(opts.data); } catch { printError('Invalid JSON for --data'); process.exit(1); }
      } else if (items && items.length > 0) {
        const parsed = parseRequestItems(items);
        body = parsed.body;
        queryParams = parsed.queryParams;
        extraHeaders = parsed.headers;
      } else if (stdinIsPiped()) {
        const stdinBody = await readStdin();
        if (stdinBody.trim()) {
          try { body = JSON.parse(stdinBody); } catch { printError('Invalid JSON from stdin'); process.exit(1); }
        }
      }

      const method = opts.method
        ? opts.method.toUpperCase()
        : (body ? 'POST' : 'GET');

      if (opts.verbose) {
        process.stderr.write(`${method} ${apiPath}\n`);
        if (Object.keys(extraHeaders).length > 0) {
          for (const [k, v] of Object.entries(extraHeaders)) {
            process.stderr.write(`> ${k}: ${v}\n`);
          }
        }
        if (body) process.stderr.write(`> Body: ${JSON.stringify(body)}\n`);
        process.stderr.write('\n');
      }

      const proxyPayload = {
        method,
        path: apiPath.startsWith('/') ? apiPath : `/${apiPath}`,
        body,
        queryParams,
        headers: extraHeaders,
      };
      if (fileContent) {
        proxyPayload.file = {
          content: fileContent.toString('base64'),
          filename: opts.file.split('/').pop(),
          contentType: 'application/octet-stream',
        };
        if (!body) proxyPayload.body = {};
      }

      const result = await client.post('/api/endpoints/proxy', proxyPayload);

      if (opts.verbose) {
        process.stderr.write(`< Status: 200\n\n`);
      }

      console.log(formatOutput(result, program.opts()));
    });
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    if (process.stdin.isTTY) { resolve(''); return; }
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', chunk => data += chunk);
    process.stdin.on('end', () => resolve(data));
  });
}
