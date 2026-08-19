import { getClient } from '../utils/api-client.js';
import { formatOutput, printError } from '../utils/format.js';

export function registerWebhooksCommands(workersCmd, program) {
  const webhooks = workersCmd.command('webhooks').description('Manage webhooks');

  webhooks
    .command('list [worker-id]')
    .alias('ls')
    .description('List webhook URLs')
    .action(async (wid) => {
      const client = getClient();
      const workerId = wid || program.opts().workerId;
      if (!workerId) {
        const { results } = await client.get('/api/workers');
        if (results.length === 1) {
          const { results: webhooks } = await client.get(`/api/workers/${results[0].id}/webhooks`);
          const rows = webhooks.map(w => ({ capability: w.capabilityKey, url: w.url }));
          console.log(formatOutput(rows, program.opts()));
          return;
        }
        printError('Worker ID required'); process.exit(1);
      }
      const { results } = await client.get(`/api/workers/${workerId}/webhooks`);
      const rows = results.map(w => ({ capability: w.capabilityKey, url: w.url }));
      console.log(formatOutput(rows, program.opts()));
    });
}
