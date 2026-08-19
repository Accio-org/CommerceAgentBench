import chalk from 'chalk';
import { getClient } from '../utils/api-client.js';

export function registerDoctorCommand(program) {
  program
    .command('doctor')
    .description('Check health of the CLI setup')
    .action(async () => {
      const client = getClient();
      const ok = (msg) => console.log(chalk.green('  ✓ ') + msg);
      const warn = (msg) => console.log(chalk.yellow('  ⚠ ') + msg);

      console.log(chalk.bold('\nNotion CLI Doctor (mock)\n'));

      try {
        const health = await client.get('/health');
        ok(`CLI version: ${health.version}`);
        ok(`Mock server: running (uptime ${health.uptime}s)`);
      } catch {
        warn('Mock server: not running. Start with: npm start');
      }

      ok(`Node.js: ${process.version}`);

      try {
        const account = await client.get('/api/account');
        if (account.isLoggedIn) {
          ok(`Auth: logged in as ${account.email}`);
          ok(`Workspace: ${account.workspaceName} (${account.workspaceId})`);
          ok(`Keychain: ${account.authMethod === 'keychain' ? 'available' : 'file-based'}`);
        } else {
          warn('Auth: not logged in. Run: ntn-mock login');
        }
      } catch {
        warn('Auth: could not check (server not running)');
      }

      ok(`Config directory: ~/.config/notion`);
      console.log('');
    });
}
