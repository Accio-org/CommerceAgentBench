import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupServer, teardownServer, api, cli } from './helpers.js';

describe('State Management', () => {
  before(async () => { await setupServer(); });
  after(async () => { await teardownServer(); });

  describe('GET /api/state', () => {
    it('returns full state with all sections', async () => {
      const { status, data } = await api('GET', '/api/state');
      assert.equal(status, 200);
      assert.ok(data.account);
      assert.ok(data.settings);
      assert.ok(data.entities);
      assert.ok(data.events);
      assert.ok(data.entities.workers);
      assert.ok(data.entities.capabilities);
      assert.ok(data.entities.pages);
      assert.ok(data.entities.apiEndpoints);
    });
  });

  describe('GET /health', () => {
    it('returns ok status', async () => {
      const { status, data } = await api('GET', '/health');
      assert.equal(status, 200);
      assert.equal(data.status, 'ok');
      assert.equal(data.version, '0.15.0');
      assert.ok(data.uptime >= 0);
    });
  });

  describe('POST /api/state/reset', () => {
    it('resets state to seed data', async () => {
      // Mutate state first
      await api('POST', '/api/workers', { name: 'temp-worker' });
      await api('POST', '/api/pages', { content: '# Temp Page' });

      // Reset
      const { status, data } = await api('POST', '/api/state/reset');
      assert.equal(status, 200);
      assert.ok(data.message.includes('reset'));

      // Verify seed state
      const { data: workers } = await api('GET', '/api/workers');
      assert.equal(workers.total, 2);
      assert.ok(!workers.results.find(w => w.name === 'temp-worker'));
    });
  });

  describe('Cross-path state consistency', () => {
    it('CLI write is visible via API', async () => {
      await cli('workers create --name api-visible');
      const { data } = await api('GET', '/api/workers');
      assert.ok(data.results.find(w => w.name === 'api-visible'));
    });

    it('API write is visible via CLI', async () => {
      await api('POST', '/api/workers', { name: 'cli-visible' });
      const { stdout } = await cli('workers list');
      assert.ok(stdout.includes('cli-visible'));
    });
  });

  describe('Events', () => {
    it('mutations create events', async () => {
      await api('POST', '/api/state/reset');
      await api('POST', '/api/workers', { name: 'event-test' });
      const { data } = await api('GET', '/api/state');
      const recent = data.events.filter(e => e.action === 'worker.create' && e.details?.name === 'event-test');
      assert.ok(recent.length > 0);
    });
  });
});
