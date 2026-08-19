import { getClient } from '../utils/api-client.js';
import { formatOutput, printError } from '../utils/format.js';

export function registerRunsCommands(workersCmd, program) {
  const runs = workersCmd.command('runs').description('View run history');

  runs
    .command('list')
    .alias('ls')
    .description('List recent runs')
    .action(async () => {
      const client = getClient();
      const workerId = await resolveWorkerId(client, program);
      const { results } = await client.get(`/api/workers/${workerId}/runs`);
      const rows = results.map(r => ({
        id: r.id, capability: r.capabilityKey, type: r.capabilityType,
        status: r.status, started: r.startedAt?.slice(0, 19), durationMs: r.durationMs,
      }));
      console.log(formatOutput(rows, program.opts()));
    });

  runs
    .command('logs <run-id>')
    .description('Print logs for a run')
    .action(async (runId) => {
      const client = getClient();
      const workerId = await resolveWorkerId(client, program);
      const { logs, status } = await client.get(`/api/workers/${workerId}/runs/${runId}/logs`);
      for (const log of logs) {
        const ts = log.timestamp?.slice(11, 19) || '';
        const level = log.level?.toUpperCase().padEnd(5) || 'INFO ';
        console.log(`${ts}  ${level}  ${log.message}`);
      }
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
