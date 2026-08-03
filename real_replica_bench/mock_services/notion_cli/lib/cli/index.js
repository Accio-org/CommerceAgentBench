import { Command } from 'commander';
import { registerAuthCommands } from './auth.js';
import { registerWorkersCommands } from './workers.js';
import { registerSyncCommands } from './workers-sync.js';
import { registerEnvCommands } from './workers-env.js';
import { registerOAuthCommands } from './workers-oauth.js';
import { registerRunsCommands } from './workers-runs.js';
import { registerWebhooksCommands } from './workers-webhooks.js';
import { registerApiCommands } from './api.js';
import { registerDatasourcesCommands } from './datasources.js';
import { registerPagesCommands } from './pages.js';
import { registerFilesCommands } from './files.js';
import { registerDoctorCommand } from './doctor.js';
import { registerUpdateCommand } from './update.js';

export function createProgram() {
  const program = new Command();

  program
    .name('ntn-mock')
    .description('Notion CLI mock — local mock environment for all ntn commands')
    .version('ntn 0.15.0', '-V, --version')
    .option('-v, --verbose', 'Show full error details')
    .option('--workers-config-file <path>', 'Override workers.json path')
    .option('--json', 'JSON output')
    .option('--plain', 'Tab-separated output, no headers')
    .option('--worker-id <id>', 'Target worker ID');

  registerAuthCommands(program);
  const workersCmd = registerWorkersCommands(program);
  registerSyncCommands(workersCmd, program);
  registerEnvCommands(workersCmd, program);
  registerOAuthCommands(workersCmd, program);
  registerRunsCommands(workersCmd, program);
  registerWebhooksCommands(workersCmd, program);
  registerApiCommands(program);
  registerDatasourcesCommands(program);
  registerPagesCommands(program);
  registerFilesCommands(program);
  registerDoctorCommand(program);
  registerUpdateCommand(program);

  program
    .command('completions <shell>')
    .description('Generate shell completions')
    .action((shell) => {
      const valid = ['bash', 'elvish', 'fish', 'powershell', 'zsh'];
      if (!valid.includes(shell)) {
        console.error(`Unknown shell: ${shell}. Valid: ${valid.join(', ')}`);
        process.exit(1);
      }
      console.log(`# ntn-mock ${shell} completions (stub)`);
    });

  program.showHelpAfterError('For more information, try \'--help\'.');

  program.on('command:*', (args) => {
    process.stderr.write(`error: unrecognized subcommand '${args[0]}'\n\nUsage: ntn [OPTIONS] <COMMAND>\n\nFor more information, try '--help'.\n`);
    process.exit(2);
  });

  return program;
}
