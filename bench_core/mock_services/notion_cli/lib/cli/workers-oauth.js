import { getClient } from '../utils/api-client.js';
import { formatOutput, printSuccess, printError, printInfo } from '../utils/format.js';

export function registerOAuthCommands(workersCmd, program) {
  const oauth = workersCmd.command('oauth').description('Manage OAuth');

  oauth
    .command('start <key>')
    .description('Start an OAuth flow')
    .action(async (key) => {
      const client = getClient();
      const workerId = await resolveWorkerId(client, program);
      const result = await client.post(`/api/workers/${workerId}/oauth/${key}/start`);
      printInfo('Open this URL to authorize:');
      console.log(result.authorizationUrl);
    });

  oauth
    .command('token <key>')
    .description('Print OAuth access token')
    .action(async (key) => {
      const client = getClient();
      const workerId = await resolveWorkerId(client, program);
      const token = await client.get(`/api/workers/${workerId}/oauth/${key}/token`);
      if (program.opts().plain) {
        console.log(token.accessToken);
      } else {
        console.log(formatOutput(token, program.opts()));
      }
    });

  oauth
    .command('show-redirect-url')
    .description('Print the OAuth redirect URL')
    .action(async () => {
      const client = getClient();
      const workerId = await resolveWorkerId(client, program);
      const result = await client.get(`/api/workers/${workerId}/oauth/redirect-url`);
      console.log(result.redirectUrl);
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
