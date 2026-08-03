import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupServer, teardownServer, api, cli } from './helpers.js';

describe('Workers', () => {
  before(async () => { await setupServer(); });
  after(async () => { await teardownServer(); });

  describe('API - CRUD', () => {
    it('GET /api/workers lists seed workers', async () => {
      const { status, data } = await api('GET', '/api/workers');
      assert.equal(status, 200);
      assert.equal(data.total, 2);
      assert.ok(data.results.find(w => w.name === 'my-sync-worker'));
      assert.ok(data.results.find(w => w.name === 'data-importer'));
    });

    it('POST /api/workers creates a new worker', async () => {
      const { status, data } = await api('POST', '/api/workers', { name: 'test-worker' });
      assert.equal(status, 201);
      assert.equal(data.name, 'test-worker');
      assert.equal(data.status, 'active');
      assert.ok(data.id.startsWith('wkr_'));
    });

    it('POST /api/workers rejects duplicate name', async () => {
      const { status, data } = await api('POST', '/api/workers', { name: 'test-worker' });
      assert.equal(status, 409);
    });

    it('POST /api/workers rejects missing name', async () => {
      const { status } = await api('POST', '/api/workers', {});
      assert.equal(status, 400);
    });

    it('GET /api/workers/:id returns worker details', async () => {
      const { status, data } = await api('GET', '/api/workers/wkr_abc123');
      assert.equal(status, 200);
      assert.equal(data.name, 'my-sync-worker');
      assert.equal(data.deployCount, 3);
    });

    it('GET /api/workers/:id returns 404 for unknown', async () => {
      const { status } = await api('GET', '/api/workers/nonexistent');
      assert.equal(status, 404);
    });

    it('PATCH /api/workers/:id updates worker', async () => {
      const { status, data } = await api('PATCH', '/api/workers/wkr_abc123', { status: 'deploying' });
      assert.equal(status, 200);
      assert.equal(data.status, 'deploying');
    });

    it('POST /api/workers/:id/deploy increments deploy count', async () => {
      const { data: before } = await api('GET', '/api/workers/wkr_abc123');
      const { status, data } = await api('POST', '/api/workers/wkr_abc123/deploy');
      assert.equal(status, 200);
      assert.equal(data.deployCount, before.deployCount + 1);
      assert.ok(data.lastDeployedAt);
    });

    it('DELETE /api/workers/:id removes worker', async () => {
      const { data: created } = await api('POST', '/api/workers', { name: 'to-delete' });
      const { status } = await api('DELETE', `/api/workers/${created.id}`);
      assert.equal(status, 200);
      const { status: getStatus } = await api('GET', `/api/workers/${created.id}`);
      assert.equal(getStatus, 404);
    });
  });

  describe('CLI - workers commands', () => {
    it('ntn-mock workers list shows workers', async () => {
      const { stdout, exitCode } = await cli('workers list');
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('my-sync-worker'));
    });

    it('ntn-mock workers list --json returns valid JSON', async () => {
      const { stdout, exitCode } = await cli('workers list --json');
      assert.equal(exitCode, 0);
      const data = JSON.parse(stdout);
      assert.ok(Array.isArray(data));
    });

    it('ntn-mock workers list --plain returns tab-separated', async () => {
      const { stdout, exitCode } = await cli('workers list --plain');
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('\t'));
      assert.ok(!stdout.includes('┌'));
    });

    it('ntn-mock workers get shows details', async () => {
      const { stdout, exitCode } = await cli('workers get wkr_abc123');
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('wkr_abc123'));
    });

    it('ntn-mock workers get returns error for unknown', async () => {
      const { exitCode } = await cli('workers get nonexistent');
      assert.equal(exitCode, 1);
    });

    it('ntn-mock workers create creates worker', async () => {
      const { stdout, exitCode } = await cli('workers create --name cli-test-worker');
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('Created'));
    });

    it('ntn-mock workers create requires --name', async () => {
      const { exitCode } = await cli('workers create');
      assert.equal(exitCode, 1);
    });

    it('ntn-mock workers new scaffolds project', async () => {
      const { stdout, exitCode } = await cli('workers new /tmp/test --no-git --no-install');
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('Scaffolded'));
    });

    it('ntn-mock workers deploy deploys worker', async () => {
      const { stdout, exitCode } = await cli('workers deploy --name deploy-cli-test');
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('Deployed'));
    });

    it('ntn-mock workers delete without --yes shows confirmation', async () => {
      const { stdout, exitCode } = await cli('workers delete wkr_abc123');
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('--yes'));
    });

    it('ntn-mock workers delete --yes deletes worker', async () => {
      // Create one to delete
      await cli('workers create --name to-delete-cli');
      const { stdout, exitCode } = await cli('workers delete wkr_abc123 --yes');
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('Deleted') || stdout.includes('deleted'));
    });

    it('ntn-mock workers tui shows mock message', async () => {
      const { stdout, exitCode } = await cli('workers tui');
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('mock') || stdout.includes('admin'));
    });
  });
});
