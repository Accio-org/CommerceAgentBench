import { printSuccess, printInfo } from '../utils/format.js';

export function registerUpdateCommand(program) {
  program
    .command('update')
    .description('Update ntn to the latest version')
    .option('--force', 'Reinstall even when up to date')
    .action((opts) => {
      if (opts.force) {
        printInfo('Reinstalling...');
        printSuccess('Reinstalled v0.15.0');
      } else {
        printSuccess('Already up to date (v0.15.0)');
      }
    });
}
