import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupServer, teardownServer, api, cli } from './helpers.js';

describe('Workers Exec', () => {
  before(async () => { await setupServer(); });
  after(async () => { await teardownServer(); });

  describe('API', () => {
    it('POST exec runs sayHello capability', async () => {
      const { status, data } = await api('POST', '/api/workers/wkr_abc123/capabilities/sayHello/exec', { data: { name: 'Test' } });
      assert.equal(status, 200);
      assert.equal(data.output, 'Hello, Test!');
      assert.ok(data.run);
      assert.equal(data.run.status, 'completed');
    });

    it('POST exec returns default output for non-sayHello', async () => {
      const { status, data } = await api('POST', '/api/workers/wkr_abc123/capabilities/importUsers/exec', { data: {} });
      assert.equal(status, 200);
      assert.ok(data.output.imported !== undefined);
    });

    it('POST exec returns 404 for unknown capability', async () => {
      const { status } = await api('POST', '/api/workers/wkr_abc123/capabilities/nonexistent/exec', { data: {} });
      assert.equal(status, 404);
    });

    it('exec creates a run record', async () => {
      const { data: before } = await api('GET', '/api/workers/wkr_abc123/runs');
      await api('POST', '/api/workers/wkr_abc123/capabilities/sayHello/exec', { data: { name: 'RunCheck' } });
      const { data: after } = await api('GET', '/api/workers/wkr_abc123/runs');
      assert.ok(after.total > before.total);
    });
  });

  describe('CLI', () => {
    it('ntn-mock workers exec sayHello with data', async () => {
      const { stdout, exitCode } = await cli('workers exec sayHello -d \'{"name":"CLI"}\' --worker-id wkr_abc123');
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('Hello, CLI!'));
    });

    it('ntn-mock workers exec with invalid JSON fails', async () => {
      const { exitCode } = await cli('workers exec sayHello -d \'{bad}\' --worker-id wkr_abc123');
      assert.equal(exitCode, 1);
    });
  });
});
