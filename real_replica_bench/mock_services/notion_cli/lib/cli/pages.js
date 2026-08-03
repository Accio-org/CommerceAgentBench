import { getClient } from '../utils/api-client.js';
import { formatOutput, printSuccess, printError } from '../utils/format.js';

export function registerPagesCommands(program) {
  const pages = program.command('pages').description('Manage pages');

  pages
    .command('get <page-id>')
    .description('Retrieve a page as Markdown')
    .option('--json', 'Output as JSON')
    .option('--notion-version <version>', 'API version')
    .action(async (pageId, opts) => {
      const client = getClient();
      const page = await client.get(`/api/pages/${pageId}`);
      if (opts.json || program.opts().json) {
        console.log(JSON.stringify(page, null, 2));
      } else {
        console.log(page.content || '(empty page)');
      }
    });

  pages
    .command('create')
    .description('Create a page from Markdown content')
    .option('--parent <ref>', 'Parent: page:<id>, database:<id>, or data-source:<id>')
    .option('--content <markdown>', 'Markdown content (reads stdin if omitted)')
    .option('--notion-version <version>', 'API version')
    .action(async (opts) => {
      const client = getClient();
      let content = opts.content;
      if (!content) {
        content = await readStdin();
      }
      const body = { content };
      if (opts.parent) body.parent = opts.parent;
      const page = await client.post('/api/pages', body);
      printSuccess(`Created page "${page.title}" (${page.id})`);
    });

  pages
    .command('update <page-id>')
    .description('Update page content from Markdown')
    .option('--content <markdown>', 'Markdown content (reads stdin if omitted)')
    .option('--allow-deleting-content', 'Permit deletion of child pages/databases')
    .option('--notion-version <version>', 'API version')
    .action(async (pageId, opts) => {
      const client = getClient();
      let content = opts.content;
      if (!content) {
        content = await readStdin();
      }
      const page = await client.patch(`/api/pages/${pageId}`, { content });
      printSuccess(`Updated page "${page.title}"`);
    });

  pages
    .command('trash <page-id>')
    .description('Trash a page')
    .option('--yes', 'Skip confirmation')
    .option('--notion-version <version>', 'API version')
    .action(async (pageId, opts) => {
      const client = getClient();
      if (!opts.yes) {
        const page = await client.get(`/api/pages/${pageId}`);
        console.log(`Would trash page "${page.title}". Use --yes to confirm.`);
        return;
      }
      const result = await client.post(`/api/pages/${pageId}/trash`);
      printSuccess(result.message);
    });
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    if (process.stdin.isTTY) { resolve(''); return; }
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', chunk => data += chunk);
    process.stdin.on('end', () => resolve(data));
  });
}
