import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupServer, teardownServer, api, cli } from './helpers.js';

describe('Pages', () => {
  before(async () => { await setupServer(); });
  after(async () => { await teardownServer(); });

  describe('API - CRUD', () => {
    it('GET /api/pages lists all pages', async () => {
      const { status, data } = await api('GET', '/api/pages');
      assert.equal(status, 200);
      assert.ok(data.total >= 5);
    });

    it('GET /api/pages/:id returns page', async () => {
      const { status, data } = await api('GET', '/api/pages/page_001');
      assert.equal(status, 200);
      assert.equal(data.title, 'Getting Started');
      assert.ok(data.content.includes('# Getting Started'));
    });

    it('GET /api/pages/:id returns 404 for unknown', async () => {
      const { status } = await api('GET', '/api/pages/nonexistent');
      assert.equal(status, 404);
    });

    it('POST /api/pages creates a page', async () => {
      const { status, data } = await api('POST', '/api/pages', {
        parent: 'page:page_root',
        content: '# Test Page\n\nContent here.'
      });
      assert.equal(status, 201);
      assert.equal(data.title, 'Test Page');
      assert.equal(data.parentType, 'page');
      assert.equal(data.parentId, 'page_root');
      assert.ok(data.id.startsWith('page_'));
    });

    it('POST /api/pages extracts title from markdown', async () => {
      const { data } = await api('POST', '/api/pages', { content: '# My Title' });
      assert.equal(data.title, 'My Title');
    });

    it('POST /api/pages defaults to Untitled', async () => {
      const { data } = await api('POST', '/api/pages', { content: 'no heading here' });
      assert.equal(data.title, 'Untitled');
    });

    it('PATCH /api/pages/:id updates content', async () => {
      const { status, data } = await api('PATCH', '/api/pages/page_001', {
        content: '# Updated Title\n\nNew content.'
      });
      assert.equal(status, 200);
      assert.equal(data.title, 'Updated Title');
      assert.ok(data.content.includes('New content'));
    });

    it('POST /api/pages/:id/trash archives page', async () => {
      const { status, data } = await api('POST', '/api/pages/page_004/trash');
      assert.equal(status, 200);
      const { data: page } = await api('GET', '/api/pages/page_004');
      assert.equal(page.archived, true);
    });

    it('POST /api/pages/:id/trash returns 404 for unknown', async () => {
      const { status } = await api('POST', '/api/pages/nonexistent/trash');
      assert.equal(status, 404);
    });
  });

  describe('CLI', () => {
    it('ntn-mock pages get returns markdown', async () => {
      const { stdout, exitCode } = await cli('pages get page_001');
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('#'));
    });

    it('ntn-mock pages get --json returns JSON', async () => {
      const { stdout, exitCode } = await cli('pages get page_001 --json');
      assert.equal(exitCode, 0);
      const data = JSON.parse(stdout);
      assert.ok(data.id);
      assert.ok(data.content);
    });

    it('ntn-mock pages create with --content', async () => {
      const { stdout, exitCode } = await cli('pages create --parent page:page_root --content "# CLI Page"');
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('Created'));
    });

    it('ntn-mock pages update changes content', async () => {
      const { stdout, exitCode } = await cli('pages update page_001 --content "# CLI Updated"');
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('Updated'));
    });

    it('ntn-mock pages trash without --yes shows confirmation', async () => {
      const { stdout, exitCode } = await cli('pages trash page_001');
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('--yes'));
    });

    it('ntn-mock pages trash --yes trashes page', async () => {
      const { stdout, exitCode } = await cli('pages trash page_001 --yes');
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('trash'));
    });
  });
});
