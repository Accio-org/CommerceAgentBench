import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupServer, teardownServer, api, cli } from './helpers.js';

describe('Files', () => {
  before(async () => { await setupServer(); });
  after(async () => { await teardownServer(); });

  describe('API', () => {
    it('GET /api/files lists uploads', async () => {
      const { status, data } = await api('GET', '/api/files');
      assert.equal(status, 200);
      assert.equal(data.total, 2);
      assert.ok(data.results.find(f => f.filename === 'architecture-diagram.png'));
    });

    it('GET /api/files/:id returns file details', async () => {
      const { status, data } = await api('GET', '/api/files/file_001');
      assert.equal(status, 200);
      assert.equal(data.filename, 'architecture-diagram.png');
      assert.equal(data.status, 'uploaded');
      assert.equal(data.contentType, 'image/png');
      assert.equal(data.contentLength, 245891);
    });

    it('GET /api/files/:id returns 404 for unknown', async () => {
      const { status } = await api('GET', '/api/files/nonexistent');
      assert.equal(status, 404);
    });

    it('POST /api/files creates a file upload', async () => {
      const { status, data } = await api('POST', '/api/files', {
        filename: 'test-upload.txt',
        contentType: 'text/plain',
        contentLength: 42
      });
      assert.equal(status, 201);
      assert.equal(data.filename, 'test-upload.txt');
      assert.equal(data.status, 'uploaded');
      assert.ok(data.id.startsWith('file_'));
    });
  });

  describe('CLI', () => {
    it('ntn-mock files list shows files', async () => {
      const { stdout, exitCode } = await cli('files list');
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('architecture-diagram'));
    });

    it('ntn-mock files get shows file details', async () => {
      const { stdout, exitCode } = await cli('files get file_001');
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('uploaded'));
      assert.ok(stdout.includes('architecture-diagram.png'));
    });

    it('ntn-mock files get returns error for unknown', async () => {
      const { exitCode } = await cli('files get nonexistent');
      assert.equal(exitCode, 1);
    });

    it('ntn-mock files create creates upload', async () => {
      const { stdout, exitCode } = await cli('files create');
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('upload'));
    });
  });
});
