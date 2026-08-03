import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupServer, teardownServer, api, cli } from './helpers.js';

describe('Workers Sync', () => {
  before(async () => { await setupServer(); });
  after(async () => { await teardownServer(); });

  describe('API', () => {
    it('GET syncs lists sync capabilities', async () => {
      const { status, data } = await api('GET', '/api/workers/wkr_abc123/syncs');
      assert.equal(status, 200);
      assert.ok(data.results.length > 0);
      assert.equal(data.results[0].capabilityKey, 'importUsers');
    });

    it('GET sync by key returns single sync', async () => {
      const { status, data } = await api('GET', '/api/workers/wkr_abc123/syncs/importUsers');
      assert.equal(status, 200);
      assert.equal(data.status, 'running');
      assert.equal(data.runCount, 42);
    });

    it('POST trigger increments run count', async () => {
      const { data: before } = await api('GET', '/api/workers/wkr_abc123/syncs/importUsers');
      const { status, data } = await api('POST', '/api/workers/wkr_abc123/syncs/importUsers/trigger', {});
      assert.equal(status, 200);
      assert.equal(data.triggered, true);
      assert.equal(data.sync.runCount, before.runCount + 1);
    });

    it('POST trigger with preview does not write', async () => {
      const { status, data } = await api('POST', '/api/workers/wkr_abc123/syncs/importUsers/trigger', { preview: true });
      assert.equal(status, 200);
      assert.equal(data.preview, true);
      assert.ok(data.nextContext !== undefined);
    });

    it('POST pause sets status to paused', async () => {
      const { status, data } = await api('POST', '/api/workers/wkr_abc123/syncs/importUsers/pause');
      assert.equal(status, 200);
      assert.equal(data.status, 'paused');
    });

    it('POST resume sets status to running', async () => {
      const { status, data } = await api('POST', '/api/workers/wkr_abc123/syncs/importUsers/resume');
      assert.equal(status, 200);
      assert.equal(data.status, 'running');
    });

    it('GET state returns cursor and stats', async () => {
      const { status, data } = await api('GET', '/api/workers/wkr_abc123/syncs/importUsers/state');
      assert.equal(status, 200);
      assert.ok(data.cursor !== undefined);
      assert.ok(data.runCount !== undefined);
    });

    it('DELETE state resets cursor', async () => {
      const { status, data } = await api('DELETE', '/api/workers/wkr_abc123/syncs/importUsers/state');
      assert.equal(status, 200);
      const { data: after } = await api('GET', '/api/workers/wkr_abc123/syncs/importUsers/state');
      assert.equal(after.cursor, null);
      assert.equal(after.runCount, 0);
    });

    it('returns 404 for unknown sync key', async () => {
      const { status } = await api('GET', '/api/workers/wkr_abc123/syncs/nonexistent');
      assert.equal(status, 404);
    });
  });

  describe('CLI', () => {
    it('ntn-mock workers sync status shows table', async () => {
      const { stdout, exitCode } = await cli('workers sync status --worker-id wkr_abc123');
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('importUsers'));
    });

    it('ntn-mock workers sync trigger succeeds', async () => {
      const { stdout, exitCode } = await cli('workers sync trigger importUsers --worker-id wkr_abc123');
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('Triggered'));
    });

    it('ntn-mock workers sync pause succeeds', async () => {
      const { stdout, exitCode } = await cli('workers sync pause importUsers --worker-id wkr_abc123');
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('Paused'));
    });

    it('ntn-mock workers sync resume succeeds', async () => {
      const { stdout, exitCode } = await cli('workers sync resume importUsers --worker-id wkr_abc123');
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('Resumed'));
    });

    it('ntn-mock workers sync state get shows cursor', async () => {
      const { stdout, exitCode } = await cli('workers sync state get importUsers --worker-id wkr_abc123');
      assert.equal(exitCode, 0);
      assert.ok(stdout.length > 0);
    });

    it('ntn-mock workers sync state reset clears state', async () => {
      const { stdout, exitCode } = await cli('workers sync state reset importUsers --worker-id wkr_abc123');
      assert.equal(exitCode, 0);
      assert.ok(stdout.toLowerCase().includes('reset'));
    });
  });
});
