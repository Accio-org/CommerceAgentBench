import { getClient } from '../utils/api-client.js';
import { printSuccess, printInfo } from '../utils/format.js';

export function registerAuthCommands(program) {
  const login = program
    .command('login')
    .description('Log in to Notion and connect to a workspace')
    .option('--no-browser', 'Headless login (for containers, CI, SSH)')
    .action(async (opts) => {
      const client = getClient();
      try {
        const account = await client.get('/api/account');
        if (account.isLoggedIn) {
          printInfo(`Already logged in as ${account.email} (${account.workspaceName})`);
          return;
        }
      } catch { /* server may not be running */ }

      if (opts.browser === false) {
        printInfo('Open this URL in a browser to authorize:');
        console.log('  https://www.notion.so/cli/authorize?code=mock-auth-code');
        printInfo('Then run: ntn login poll');
        const account = await client.post('/api/account/login');
        printSuccess(`Logged in to "${account.workspaceName}" as ${account.email}`);
        return;
      }

      const account = await client.post('/api/account/login');
      printSuccess(`Logged in to "${account.workspaceName}" as ${account.email}`);
    });

  login
    .command('poll')
    .description('Redeem token after headless login')
    .action(async () => {
      const client = getClient();
      const account = await client.post('/api/account/login');
      printSuccess(`Logged in to "${account.workspaceName}" as ${account.email}`);
    });

  program
    .command('logout')
    .description('Clear stored credentials for the current workspace')
    .action(async () => {
      const client = getClient();
      await client.post('/api/account/logout');
      printSuccess('Logged out');
    });
}
