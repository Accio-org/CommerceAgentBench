import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupServer, teardownServer, api, cli } from './helpers.js';

describe('Workers Runs', () => {
  before(async () => { await setupServer(); });
  after(async () => { await teardownServer(); });

  describe('API', () => {
    it('GET runs lists recent runs', async () => {
      const { status, data } = await api('GET', '/api/workers/wkr_abc123/runs');
      assert.equal(status, 200);
      assert.ok(data.total >= 4);
      assert.ok(data.results[0].id);
      assert.ok(data.results[0].capabilityKey);
    });

    it('GET runs sorted by startedAt descending', async () => {
      const { data } = await api('GET', '/api/workers/wkr_abc123/runs');
      for (let i = 1; i < data.results.length; i++) {
        assert.ok(data.results[i - 1].startedAt >= data.results[i].startedAt);
      }
    });

    it('GET run logs returns log entries', async () => {
      const { status, data } = await api('GET', '/api/workers/wkr_abc123/runs/run_001/logs');
      assert.equal(status, 200);
      assert.equal(data.runId, 'run_001');
      assert.ok(Array.isArray(data.logs));
      assert.ok(data.logs.length > 0);
      assert.ok(data.logs[0].timestamp);
      assert.ok(data.logs[0].level);
      assert.ok(data.logs[0].message);
    });

    it('GET run logs returns 404 for unknown run', async () => {
      const { status } = await api('GET', '/api/workers/wkr_abc123/runs/nonexistent/logs');
      assert.equal(status, 404);
    });
  });

  describe('CLI', () => {
    it('ntn-mock workers runs list shows runs', async () => {
      const { stdout, exitCode } = await cli('workers runs list --worker-id wkr_abc123');
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('run_'));
    });

    it('ntn-mock workers runs logs shows log output', async () => {
      const { stdout, exitCode } = await cli('workers runs logs run_001 --worker-id wkr_abc123');
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('Executing'));
    });
  });
});
