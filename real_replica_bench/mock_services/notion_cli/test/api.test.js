import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupServer, teardownServer, api, cli } from './helpers.js';

describe('API Commands', () => {
  before(async () => { await setupServer(); });
  after(async () => { await teardownServer(); });

  describe('API endpoints', () => {
    it('GET /api/endpoints lists all endpoints', async () => {
      const { status, data } = await api('GET', '/api/endpoints');
      assert.equal(status, 200);
      assert.ok(data.results.length > 20);
      assert.ok(data.results.find(e => e.path === 'v1/users/me'));
      assert.ok(data.results.find(e => e.path === 'v1/pages/:id'));
    });

    it('POST /api/endpoints/proxy v1/users/me returns user', async () => {
      const { status, data } = await api('POST', '/api/endpoints/proxy', {
        method: 'GET', path: 'v1/users/me'
      });
      assert.equal(status, 200);
      assert.equal(data.object, 'user');
      assert.equal(data.name, 'Mock Developer');
    });

    it('POST /api/endpoints/proxy v1/pages/:id returns page', async () => {
      const { status, data } = await api('POST', '/api/endpoints/proxy', {
        method: 'GET', path: 'v1/pages/page_001'
      });
      assert.equal(status, 200);
      assert.equal(data.object, 'page');
      assert.equal(data.id, 'page_001');
    });

    it('POST /api/endpoints/proxy v1/search searches pages', async () => {
      const { status, data } = await api('POST', '/api/endpoints/proxy', {
        method: 'POST', path: 'v1/search', body: { query: 'Getting' }
      });
      assert.equal(status, 200);
      assert.equal(data.object, 'list');
      assert.ok(data.results.length > 0);
    });

    it('POST /api/endpoints/proxy unknown path returns 404', async () => {
      const { status, data } = await api('POST', '/api/endpoints/proxy', {
        method: 'GET', path: 'v1/nonexistent'
      });
      assert.equal(status, 404);
      assert.equal(data.object, 'error');
    });
  });

  describe('CLI', () => {
    it('ntn-mock api ls lists endpoints', async () => {
      const { stdout, exitCode } = await cli('api ls');
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('v1/pages'));
      assert.ok(stdout.includes('v1/users'));
    });

    it('ntn-mock api v1/users/me returns user JSON', async () => {
      const { stdout, exitCode } = await cli('api v1/users/me --json');
      assert.equal(exitCode, 0);
      const data = JSON.parse(stdout);
      assert.equal(data.object, 'user');
    });

    it('ntn-mock api auto-detects GET when no body', async () => {
      const { stdout, exitCode } = await cli('api v1/users/me --json');
      assert.equal(exitCode, 0);
      const data = JSON.parse(stdout);
      assert.equal(data.object, 'user');
    });

    it('ntn-mock api with inline body field uses POST', async () => {
      const { stdout, exitCode } = await cli('api v1/search query=Getting --json');
      assert.equal(exitCode, 0);
      const data = JSON.parse(stdout);
      assert.equal(data.object, 'list');
      assert.ok(data.results.length > 0);
    });

    it('ntn-mock api with --data flag works', async () => {
      const { stdout, exitCode } = await cli('api v1/search --data \'{"query":"Getting"}\' --json');
      assert.equal(exitCode, 0);
      const data = JSON.parse(stdout);
      assert.equal(data.object, 'list');
    });

    it('ntn-mock api with -X PATCH works', async () => {
      const { stdout, exitCode } = await cli('api v1/pages/page_001 -X PATCH archived:=true --json');
      assert.equal(exitCode, 0);
      const data = JSON.parse(stdout);
      assert.equal(data.object, 'page');
    });

    it('ntn-mock api --spec shows endpoints', async () => {
      const { stdout, exitCode } = await cli('api v1/pages --spec -X POST');
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('POST'));
    });
  });
});
