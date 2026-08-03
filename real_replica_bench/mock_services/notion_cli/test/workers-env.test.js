import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupServer, teardownServer, api, cli } from './helpers.js';

describe('Workers Env', () => {
  before(async () => { await setupServer(); });
  after(async () => { await teardownServer(); });

  describe('API', () => {
    it('GET env lists existing variables', async () => {
      const { status, data } = await api('GET', '/api/workers/wkr_abc123/env');
      assert.equal(status, 200);
      assert.ok(data.results.length >= 2);
      assert.ok(data.results.find(v => v.key === 'API_KEY'));
    });

    it('POST env sets new variables', async () => {
      const { status, data } = await api('POST', '/api/workers/wkr_abc123/env', {
        vars: [{ key: 'NEW_VAR', value: 'new_val' }]
      });
      assert.equal(status, 200);
      assert.ok(data.results.find(r => r.key === 'NEW_VAR' && r.action === 'created'));
    });

    it('POST env updates existing variables', async () => {
      const { status, data } = await api('POST', '/api/workers/wkr_abc123/env', {
        vars: [{ key: 'NEW_VAR', value: 'updated_val' }]
      });
      assert.equal(status, 200);
      assert.ok(data.results.find(r => r.key === 'NEW_VAR' && r.action === 'updated'));
    });

    it('DELETE env removes variable', async () => {
      const { status } = await api('DELETE', '/api/workers/wkr_abc123/env/NEW_VAR');
      assert.equal(status, 200);
      const { data } = await api('GET', '/api/workers/wkr_abc123/env');
      assert.ok(!data.results.find(v => v.key === 'NEW_VAR'));
    });

    it('DELETE env returns 404 for unknown key', async () => {
      const { status } = await api('DELETE', '/api/workers/wkr_abc123/env/NONEXISTENT');
      assert.equal(status, 404);
    });

    it('GET env/pull returns .env format', async () => {
      const { status, data } = await api('GET', '/api/workers/wkr_abc123/env/pull');
      assert.equal(status, 200);
      assert.ok(data.includes('API_KEY='));
      assert.ok(data.includes('DATABASE_URL='));
    });

    it('POST env/push creates vars from content', async () => {
      const { status, data } = await api('POST', '/api/workers/wkr_abc123/env/push', {
        content: 'PUSH_VAR=push_val\nANOTHER=123'
      });
      assert.equal(status, 200);
      assert.ok(data.keys.includes('PUSH_VAR'));
      assert.ok(data.keys.includes('ANOTHER'));
    });
  });

  describe('CLI', () => {
    it('ntn-mock workers env set KEY=VALUE', async () => {
      const { stdout, exitCode } = await cli('workers env set CLI_VAR=cli_val --worker-id wkr_abc123');
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('Set'));
    });

    it('ntn-mock workers env set multiple', async () => {
      const { stdout, exitCode } = await cli('workers env set A=1 B=2 --worker-id wkr_abc123');
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('A'));
      assert.ok(stdout.includes('B'));
    });

    it('ntn-mock workers env list shows keys', async () => {
      const { stdout, exitCode } = await cli('workers env list --worker-id wkr_abc123');
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('CLI_VAR'));
    });

    it('ntn-mock workers env pull --no-file prints to stdout', async () => {
      const { stdout, exitCode } = await cli('workers env pull --no-file --worker-id wkr_abc123');
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('='));
    });

    it('ntn-mock workers env unset removes key', async () => {
      const { stdout, exitCode } = await cli('workers env unset CLI_VAR --worker-id wkr_abc123');
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('Removed'));
    });
  });
});
