import { getClient } from '../utils/api-client.js';
import { formatOutput, printSuccess, printError, printInfo } from '../utils/format.js';

export function registerWorkersCommands(program) {
  const workers = program.command('workers').description('Manage workers');

  workers
    .command('new [directory]')
    .description('Scaffold a new worker project')
    .option('--force', 'Overwrite conflicting files')
    .option('--git', 'Force git init')
    .option('--no-git', 'Skip git init')
    .option('--install', 'Force dependency installation')
    .option('--no-install', 'Skip dependency installation')
    .option('--alpha', 'Install alpha instructions as AGENTS.md')
    .action(async (directory, opts) => {
      const dir = directory || '.';
      printInfo(`Scaffolding new worker project in ${dir}...`);
      console.log(`  Created package.json`);
      console.log(`  Created workers.json`);
      console.log(`  Created src/index.ts`);
      console.log(`  Created tsconfig.json`);
      if (opts.git !== false) console.log(`  Initialized git repository`);
      if (opts.install !== false) console.log(`  Installed dependencies`);
      printSuccess(`Scaffolded worker project in ${dir}`);
    });

  workers
    .command('deploy')
    .description('Build and upload the worker')
    .option('--name <name>', 'Worker name (required for new workers)')
    .option('--local-build', 'Build locally')
    .option('--no-git', 'Walk filesystem instead of using git')
    .action(async (opts) => {
      const client = getClient();
      let workerId = program.opts().workerId;

      if (!workerId && opts.name) {
        const { results } = await client.get('/api/workers');
        const existing = results.find(w => w.name === opts.name);
        if (existing) {
          workerId = existing.id;
        } else {
          const worker = await client.post('/api/workers', { name: opts.name });
          workerId = worker.id;
          printInfo(`Created new worker "${opts.name}"`);
        }
      }

      if (!workerId) {
        const { results } = await client.get('/api/workers');
        if (results.length === 1) {
          workerId = results[0].id;
        } else {
          printError('No worker-id specified. Use --worker-id or --name flag.');
          process.exit(1);
        }
      }

      printInfo('Building worker...');
      console.log('  Bundling source...');
      console.log('  Uploading...');
      const worker = await client.post(`/api/workers/${workerId}/deploy`);
      printSuccess(`Deployed "${worker.name}" (deploy #${worker.deployCount})`);
    });

  workers
    .command('list')
    .alias('ls')
    .description('List all workers in the active workspace')
    .action(async (opts) => {
      const client = getClient();
      const { results } = await client.get('/api/workers');
      const rows = results.map(w => ({
        id: w.id, name: w.name, status: w.status,
        deploys: w.deployCount, updated: w.updatedAt?.slice(0, 19),
      }));
      console.log(formatOutput(rows, program.opts()));
    });

  workers
    .command('get [worker-id]')
    .description('Show details for a single worker')
    .action(async (wid) => {
      const client = getClient();
      const workerId = wid || program.opts().workerId;
      if (!workerId) { printError('Worker ID required'); process.exit(1); }
      const worker = await client.get(`/api/workers/${workerId}`);
      console.log(formatOutput(worker, program.opts()));
    });

  workers
    .command('create')
    .description('Create a worker without deploying code')
    .option('--name <name>', 'Worker name')
    .action(async (opts) => {
      if (!opts.name) { printError('--name is required'); process.exit(1); }
      const client = getClient();
      const worker = await client.post('/api/workers', { name: opts.name });
      printSuccess(`Created worker "${worker.name}" (${worker.id})`);
    });

  workers
    .command('delete [worker-id]')
    .alias('rm')
    .description('Delete a worker')
    .option('--yes', 'Skip confirmation')
    .action(async (wid, opts) => {
      const client = getClient();
      const workerId = wid || program.opts().workerId;
      if (!workerId) { printError('Worker ID required'); process.exit(1); }
      if (!opts.yes) {
        printInfo(`Would delete worker ${workerId}. Use --yes to confirm.`);
        return;
      }
      const result = await client.delete(`/api/workers/${workerId}`);
      printSuccess(result.message);
    });

  workers
    .command('exec <key>')
    .description('Run a capability and print its output')
    .option('-d, --data <json>', 'JSON input')
    .option('--stream', 'Stream output')
    .option('-l, --local', 'Run locally via tsx')
    .option('--dotenv <path>', 'Env file for --local')
    .option('--no-dotenv', 'Skip loading .env')
    .action(async (key, opts) => {
      const client = getClient();
      const workerId = await resolveWorkerId(client, program);
      let data = {};
      if (opts.data) {
        try { data = JSON.parse(opts.data); } catch { printError('Invalid JSON for --data'); process.exit(1); }
      }
      if (opts.local) {
        printInfo(`Running ${key} locally (mock mode)...`);
      }
      const result = await client.post(`/api/workers/${workerId}/capabilities/${key}/exec`, { data });
      if (typeof result.output === 'string') {
        console.log(result.output);
      } else {
        console.log(JSON.stringify(result.output, null, 2));
      }
    });

  const capabilities = workers.command('capabilities').description('Manage capabilities');
  capabilities
    .command('list')
    .alias('ls')
    .description('List deployed capabilities')
    .action(async () => {
      const client = getClient();
      const workerId = await resolveWorkerId(client, program);
      const { results } = await client.get(`/api/workers/${workerId}/capabilities`);
      const rows = results.map(c => ({ key: c.key, type: c.type, title: c.title }));
      console.log(formatOutput(rows, program.opts()));
    });

  workers
    .command('usage [worker-id]')
    .description('Show current-period AI credit usage')
    .option('--all', 'Show usage for all workers')
    .action(async (wid, opts) => {
      const client = getClient();
      if (opts.all) {
        const { results } = await client.get('/api/workers');
        const rows = results.map(w => ({
          id: w.id, name: w.name,
          credits_used: Math.floor(Math.random() * 1000),
          credits_limit: 10000,
        }));
        console.log(formatOutput(rows, program.opts()));
      } else {
        const workerId = wid || program.opts().workerId;
        if (!workerId) {
          const { results } = await client.get('/api/workers');
          if (results.length === 1) {
            const w = results[0];
            console.log(formatOutput({ id: w.id, name: w.name, credits_used: 142, credits_limit: 10000 }, program.opts()));
            return;
          }
          printError('Worker ID required');
          process.exit(1);
        }
        const worker = await client.get(`/api/workers/${workerId}`);
        console.log(formatOutput({ id: worker.id, name: worker.name, credits_used: 142, credits_limit: 10000 }, program.opts()));
      }
    });

  workers
    .command('tui')
    .alias('ui')
    .description('Open interactive terminal UI')
    .action(() => {
      printInfo('TUI is not available in mock mode.');
      printInfo('Use the Web admin panel instead: http://localhost:' + (process.env.NTN_MOCK_PORT || '3456') + '/admin.html');
      printInfo('Or use CLI commands: ntn-mock workers list, ntn-mock workers get <id>');
    });

  workers.on('command:*', (args) => {
    process.stderr.write(`error: unrecognized subcommand '${args[0]}'\n\nUsage: ntn workers [OPTIONS] <COMMAND>\n\nFor more information, try '--help'.\n`);
    process.exit(2);
  });

  return workers;
}

async function resolveWorkerId(client, program) {
  const wid = program.opts().workerId;
  if (wid) return wid;
  const { results } = await client.get('/api/workers');
  if (results.length === 1) return results[0].id;
  if (results.length === 0) { printError('No workers found'); process.exit(1); }
  printError('Multiple workers found. Use --worker-id to specify.'); process.exit(1);
}
