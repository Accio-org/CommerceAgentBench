import { getClient } from '../utils/api-client.js';
import { formatOutput, printSuccess, printError, printInfo } from '../utils/format.js';

export function registerEnvCommands(workersCmd, program) {
  const env = workersCmd.command('env').description('Manage environment variables');

  env
    .command('set <pairs...>')
    .description('Set one or more environment variables (KEY=VALUE)')
    .action(async (pairs) => {
      const client = getClient();
      const workerId = await resolveWorkerId(client, program);
      const vars = [];
      for (const pair of pairs) {
        const eqIdx = pair.indexOf('=');
        if (eqIdx === -1) { printError(`Invalid format: ${pair}. Use KEY=VALUE`); process.exit(1); }
        vars.push({ key: pair.slice(0, eqIdx), value: pair.slice(eqIdx + 1) });
      }
      const result = await client.post(`/api/workers/${workerId}/env`, { vars });
      for (const r of result.results) {
        printSuccess(`Set ${r.key}`);
      }
    });

  env
    .command('list')
    .alias('ls')
    .description('List environment variable keys')
    .action(async () => {
      const client = getClient();
      const workerId = await resolveWorkerId(client, program);
      const { results } = await client.get(`/api/workers/${workerId}/env`);
      const rows = results.map(v => ({ key: v.key, updated: v.updatedAt?.slice(0, 19) }));
      console.log(formatOutput(rows, program.opts()));
    });

  env
    .command('unset <key>')
    .alias('delete')
    .alias('rm')
    .description('Remove an environment variable')
    .action(async (key) => {
      const client = getClient();
      const workerId = await resolveWorkerId(client, program);
      const result = await client.delete(`/api/workers/${workerId}/env/${key}`);
      printSuccess(result.message);
    });

  env
    .command('pull')
    .description('Download remote env vars')
    .option('--file <path>', 'Output file path', '.env')
    .option('--no-file', 'Print to stdout')
    .option('--yes', 'Skip confirmation')
    .action(async (opts) => {
      const client = getClient();
      const workerId = await resolveWorkerId(client, program);
      const content = await client.get(`/api/workers/${workerId}/env/pull`);
      if (opts.file === false) {
        console.log(content);
      } else {
        const fs = await import('fs');
        fs.writeFileSync(opts.file, content, 'utf-8');
        printSuccess(`Wrote env vars to ${opts.file}`);
      }
    });

  env
    .command('push')
    .description('Push local .env file to the worker')
    .option('--file <path>', 'Input file path', '.env')
    .option('--yes', 'Skip confirmation')
    .action(async (opts) => {
      const client = getClient();
      const workerId = await resolveWorkerId(client, program);
      const fs = await import('fs');
      let content;
      try {
        content = fs.readFileSync(opts.file, 'utf-8');
      } catch {
        printError(`Could not read ${opts.file}`);
        process.exit(1);
      }
      const result = await client.post(`/api/workers/${workerId}/env/push`, { content });
      printSuccess(`Pushed ${result.keys.length} variables`);
    });
}

async function resolveWorkerId(client, program) {
  const wid = program.opts().workerId;
  if (wid) return wid;
  const { results } = await client.get('/api/workers');
  if (results.length === 1) return results[0].id;
  if (results.length === 0) { printError('No workers found'); process.exit(1); }
  printError('Multiple workers found. Use --worker-id to specify.'); process.exit(1);
}
