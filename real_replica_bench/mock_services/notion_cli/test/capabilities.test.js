import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupServer, teardownServer, api, cli } from './helpers.js';

describe('Workers Capabilities', () => {
  before(async () => { await setupServer(); });
  after(async () => { await teardownServer(); });

  describe('API', () => {
    it('GET capabilities lists all for a worker', async () => {
      const { status, data } = await api('GET', '/api/workers/wkr_abc123/capabilities');
      assert.equal(status, 200);
      assert.equal(data.total, 3);
      const keys = data.results.map(c => c.key);
      assert.ok(keys.includes('sayHello'));
      assert.ok(keys.includes('importUsers'));
      assert.ok(keys.includes('externalEvent'));
    });

    it('capabilities have correct types', async () => {
      const { data } = await api('GET', '/api/workers/wkr_abc123/capabilities');
      const tool = data.results.find(c => c.key === 'sayHello');
      const sync = data.results.find(c => c.key === 'importUsers');
      const webhook = data.results.find(c => c.key === 'externalEvent');
      assert.equal(tool.type, 'tool');
      assert.equal(sync.type, 'sync');
      assert.equal(webhook.type, 'webhook');
    });

    it('GET capabilities for second worker', async () => {
      const { status, data } = await api('GET', '/api/workers/wkr_def456/capabilities');
      assert.equal(status, 200);
      assert.equal(data.total, 1);
      assert.equal(data.results[0].key, 'fetchData');
    });
  });

  describe('CLI', () => {
    it('ntn-mock workers capabilities list shows capabilities', async () => {
      const { stdout, exitCode } = await cli('workers capabilities list --worker-id wkr_abc123');
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('sayHello'));
      assert.ok(stdout.includes('tool'));
    });
  });
});
