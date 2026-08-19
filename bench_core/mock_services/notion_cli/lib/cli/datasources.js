import { getClient } from '../utils/api-client.js';
import { formatOutput, printError } from '../utils/format.js';

export function registerDatasourcesCommands(program) {
  const ds = program.command('datasources').description('Manage data sources');

  ds
    .command('query <data-source-id>')
    .description('Query pages in a data source')
    .option('--limit <n>', 'Page size', '25')
    .option('--start-cursor <cursor>', 'Pagination cursor')
    .option('-s, --sort <spec>', 'Sort: property [asc|desc]')
    .option('--filter <json>', 'Filter JSON')
    .option('--filter-file <path>', 'Read filter from file')
    .option('--notion-version <version>', 'API version')
    .action(async (dsId, opts) => {
      const client = getClient();
      const body = { limit: parseInt(opts.limit, 10) };
      if (opts.startCursor) body.start_cursor = opts.startCursor;
      if (opts.sort) {
        const parts = opts.sort.split(' ');
        body.sort = [{ property: parts[0], direction: parts[1] || 'asc' }];
      }
      if (opts.filter) {
        try { body.filter = JSON.parse(opts.filter); } catch { printError('Invalid filter JSON'); process.exit(1); }
      }
      if (opts.filterFile) {
        const fs = await import('fs');
        try {
          const content = opts.filterFile === '-' ? await readStdin() : fs.readFileSync(opts.filterFile, 'utf-8');
          body.filter = JSON.parse(content);
        } catch { printError('Could not read filter file'); process.exit(1); }
      }
      const result = await client.post(`/api/datasources/${dsId}/query`, body);
      console.log(formatOutput(result, program.opts()));
    });

  ds
    .command('resolve <database-id>')
    .description('Resolve a database ID to data source IDs')
    .option('--notion-version <version>', 'API version')
    .action(async (dbId) => {
      const client = getClient();
      const result = await client.get(`/api/datasources/resolve/${dbId}`);
      console.log(formatOutput(result, program.opts()));
    });
}
