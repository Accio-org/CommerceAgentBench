import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupServer, teardownServer, api, cli } from './helpers.js';

describe('Workers OAuth', () => {
  before(async () => { await setupServer(); });
  after(async () => { await teardownServer(); });

  describe('API', () => {
    it('POST oauth start returns auth URL', async () => {
      const { status, data } = await api('POST', '/api/workers/wkr_abc123/oauth/githubSync/start');
      assert.equal(status, 200);
      assert.ok(data.authorizationUrl.startsWith('https://'));
      assert.ok(data.authorizationUrl.includes('oauth'));
    });

    it('GET oauth token returns token data', async () => {
      const { status, data } = await api('GET', '/api/workers/wkr_abc123/oauth/githubSync/token');
      assert.equal(status, 200);
      assert.ok(data.accessToken.startsWith('gho_'));
      assert.equal(data.provider, 'github');
      assert.ok(Array.isArray(data.scopes));
    });

    it('GET oauth token returns 404 for unknown key', async () => {
      const { status } = await api('GET', '/api/workers/wkr_abc123/oauth/nonexistent/token');
      assert.equal(status, 404);
    });

    it('GET oauth redirect-url returns URL', async () => {
      const { status, data } = await api('GET', '/api/workers/wkr_abc123/oauth/redirect-url');
      assert.equal(status, 200);
      assert.ok(data.redirectUrl.includes('notion.so'));
    });
  });

  describe('CLI', () => {
    it('ntn-mock workers oauth start shows URL', async () => {
      const { stdout, exitCode } = await cli('workers oauth start githubSync --worker-id wkr_abc123');
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('http'));
    });

    it('ntn-mock workers oauth token shows token', async () => {
      const { stdout, exitCode } = await cli('workers oauth token githubSync --worker-id wkr_abc123');
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('gho_'));
    });

    it('ntn-mock workers oauth show-redirect-url shows URL', async () => {
      const { stdout, exitCode } = await cli('workers oauth show-redirect-url --worker-id wkr_abc123');
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('notion.so'));
    });
  });
});
