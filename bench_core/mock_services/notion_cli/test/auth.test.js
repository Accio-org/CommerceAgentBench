import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupServer, teardownServer, api, cli } from './helpers.js';

describe('Authentication', () => {
  before(async () => { await setupServer(); });
  after(async () => { await teardownServer(); });

  describe('API', () => {
    it('GET /api/account returns account info', async () => {
      const { status, data } = await api('GET', '/api/account');
      assert.equal(status, 200);
      assert.equal(data.email, 'dev@example.com');
      assert.equal(data.isLoggedIn, true);
    });

    it('POST /api/account/logout clears login state', async () => {
      const { status, data } = await api('POST', '/api/account/logout');
      assert.equal(status, 200);
      const { data: account } = await api('GET', '/api/account');
      assert.equal(account.isLoggedIn, false);
    });

    it('POST /api/account/login restores login state', async () => {
      const { status, data } = await api('POST', '/api/account/login');
      assert.equal(status, 200);
      assert.equal(data.isLoggedIn, true);
      assert.ok(data.token);
    });
  });

  describe('CLI', () => {
    it('ntn-mock login succeeds', async () => {
      const { stdout, exitCode } = await cli('login');
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('Logged in') || stdout.includes('Already logged in'));
    });

    it('ntn-mock logout succeeds', async () => {
      const { stdout, exitCode } = await cli('logout');
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('Logged out'));
    });

    it('ntn-mock login after logout succeeds', async () => {
      const { stdout, exitCode } = await cli('login');
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('Logged in'));
    });

    it('ntn-mock login --no-browser shows URL', async () => {
      await cli('logout');
      const { stdout, exitCode } = await cli('login --no-browser');
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('authorize') || stdout.includes('Logged in'));
    });

    it('ntn-mock login poll succeeds', async () => {
      const { stdout, exitCode } = await cli('login poll');
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('Logged in'));
    });
  });
});
