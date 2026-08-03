import { getClient } from '../utils/api-client.js';
import { formatOutput, printSuccess } from '../utils/format.js';

function stdinIsPiped() {
  return !process.stdin.isTTY;
}

export function registerFilesCommands(program) {
  const files = program.command('files').description('Manage file uploads');

  files
    .command('create')
    .description('Upload a file to Notion')
    .option('--filename <name>', 'Set a specific filename')
    .option('--content-type <mime>', 'Override MIME type', 'application/octet-stream')
    .option('--external-url <url>', 'Import from an external URL instead of stdin')
    .action(async (opts) => {
      const client = getClient();
      const globalOpts = program.opts();

      let contentLength = 0;
      let contentBase64 = null;
      let filename = opts.filename || `upload-${Date.now()}.bin`;

      if (opts.externalUrl) {
        filename = opts.filename || new URL(opts.externalUrl).pathname.split('/').pop() || filename;
      } else if (stdinIsPiped()) {
        const chunks = [];
        for await (const chunk of process.stdin) {
          chunks.push(chunk);
        }
        const buffer = Buffer.concat(chunks);
        contentLength = buffer.length;
        contentBase64 = buffer.toString('base64');
      }

      const file = await client.post('/api/files', {
        filename,
        contentType: opts.contentType,
        contentLength,
        externalUrl: opts.externalUrl || null,
        content: contentBase64,
      });

      if (globalOpts.json) {
        console.log(JSON.stringify(file, null, 2));
      } else if (globalOpts.plain) {
        console.log([file.id, file.filename, file.status, file.contentType, file.contentLength].join('\t'));
      } else {
        console.log(`ID             ${file.id}`);
        console.log(`Filename       ${file.filename}`);
        console.log(`Status         ${file.status}`);
        console.log(`Content type   ${file.contentType}`);
        console.log(`Content length ${file.contentLength}`);
        console.log(`Created time   ${file.createdAt}`);
        console.log(`Last edited    ${file.lastEdited || file.createdAt}`);
        console.log(`Expiry time    ${file.expiryTime}`);
        printSuccess('File upload created');
      }
    });

  files
    .command('get <upload-id>')
    .description('Get upload details')
    .action(async (uploadId) => {
      const client = getClient();
      const file = await client.get(`/api/files/${uploadId}`);
      if (program.opts().json) {
        console.log(JSON.stringify(file, null, 2));
      } else if (program.opts().plain) {
        console.log([file.id, file.filename, file.status, file.contentType, file.contentLength].join('\t'));
      } else {
        console.log(`ID             ${file.id}`);
        console.log(`Filename       ${file.filename}`);
        console.log(`Status         ${file.status}`);
        console.log(`Content type   ${file.contentType}`);
        console.log(`Content length ${file.contentLength}`);
        console.log(`Created time   ${file.createdAt}`);
        console.log(`Last edited    ${file.lastEdited}`);
        console.log(`Expiry time    ${file.expiryTime}`);
      }
    });

  files
    .command('list')
    .description('List file uploads')
    .action(async () => {
      const client = getClient();
      const { results } = await client.get('/api/files');
      const rows = results.map(f => ({
        id: f.id, filename: f.filename, status: f.status,
        type: f.contentType, size: f.contentLength,
      }));
      console.log(formatOutput(rows, program.opts()));
    });
}
