import { getClient } from '../utils/api-client.js';
import { formatOutput, printSuccess, printError, printInfo } from '../utils/format.js';

export function registerSyncCommands(workersCmd, program) {
  const sync = workersCmd.command('sync').description('Manage syncs');

  sync
    .command('status [capability-key]')
    .description('Show sync status')
    .option('--no-watch', 'Print once and exit')
    .option('--interval <seconds>', 'Poll interval in watch mode', '2')
    .action(async (capKey, opts) => {
      const client = getClient();
      const workerId = await resolveWorkerId(client, program);
      if (capKey) {
        const syncState = await client.get(`/api/workers/${workerId}/syncs/${capKey}`);
        console.log(formatOutput(syncState, program.opts()));
      } else {
        const { results } = await client.get(`/api/workers/${workerId}/syncs`);
        const rows = results.map(s => ({
          key: s.capabilityKey, status: s.status, runs: s.runCount,
          errors: s.errorCount, lastRun: s.lastRunAt?.slice(0, 19),
          schedule: s.schedule,
        }));
        console.log(formatOutput(rows, program.opts()));
      }
    });

  sync
    .command('trigger <key>')
    .description('Trigger a sync immediately')
    .option('--preview', 'Invoke without writing to target')
    .option('-c, --context <json>', 'Cursor from previous preview')
    .option('-l, --local', 'Run locally')
    .option('--dotenv <path>', 'Env file for --local')
    .option('--no-dotenv', 'Skip .env')
    .action(async (key, opts) => {
      const client = getClient();
      const workerId = await resolveWorkerId(client, program);
      const body = {};
      if (opts.preview) body.preview = true;
      if (opts.context) {
        try { body.context = JSON.parse(opts.context); } catch { printError('Invalid JSON for --context'); process.exit(1); }
      }
      const result = await client.post(`/api/workers/${workerId}/syncs/${key}/trigger`, body);
      if (result.preview) {
        printInfo('Preview mode - no data written');
        console.log(JSON.stringify(result, null, 2));
      } else {
        printSuccess(`Triggered sync "${key}"`);
      }
    });

  sync
    .command('pause <key>')
    .description('Pause scheduled execution')
    .action(async (key) => {
      const client = getClient();
      const workerId = await resolveWorkerId(client, program);
      await client.post(`/api/workers/${workerId}/syncs/${key}/pause`);
      printSuccess(`Paused sync "${key}"`);
    });

  sync
    .command('resume <key>')
    .description('Resume scheduled execution')
    .action(async (key) => {
      const client = getClient();
      const workerId = await resolveWorkerId(client, program);
      await client.post(`/api/workers/${workerId}/syncs/${key}/resume`);
      printSuccess(`Resumed sync "${key}"`);
    });

  const syncState = sync.command('state').description('Manage sync state');

  syncState
    .command('get <key>')
    .description('Print sync cursor and stats')
    .action(async (key) => {
      const client = getClient();
      const workerId = await resolveWorkerId(client, program);
      const state = await client.get(`/api/workers/${workerId}/syncs/${key}/state`);
      console.log(formatOutput(state, program.opts()));
    });

  syncState
    .command('reset <key>')
    .description('Clear sync cursor and stats')
    .action(async (key) => {
      const client = getClient();
      const workerId = await resolveWorkerId(client, program);
      const result = await client.delete(`/api/workers/${workerId}/syncs/${key}/state`);
      printSuccess(result.message || `Reset sync state for "${key}"`);
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
