import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupServer, teardownServer, api, cli } from './helpers.js';

describe('Workers Webhooks', () => {
  before(async () => { await setupServer(); });
  after(async () => { await teardownServer(); });

  describe('API', () => {
    it('GET webhooks lists webhook URLs', async () => {
      const { status, data } = await api('GET', '/api/workers/wkr_abc123/webhooks');
      assert.equal(status, 200);
      assert.ok(data.results.length > 0);
      assert.ok(data.results[0].url.includes('notion.so/webhooks'));
      assert.equal(data.results[0].capabilityKey, 'externalEvent');
    });
  });

  describe('CLI', () => {
    it('ntn-mock workers webhooks list shows URLs', async () => {
      const { stdout, exitCode } = await cli('workers webhooks list --worker-id wkr_abc123');
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('notion.so'));
    });
  });
});
