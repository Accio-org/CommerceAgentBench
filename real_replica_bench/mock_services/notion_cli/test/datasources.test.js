import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupServer, teardownServer, api, cli } from './helpers.js';

describe('Datasources', () => {
  before(async () => { await setupServer(); });
  after(async () => { await teardownServer(); });

  describe('API', () => {
    it('GET /api/datasources lists datasources', async () => {
      const { status, data } = await api('GET', '/api/datasources');
      assert.equal(status, 200);
      assert.ok(data.results.length > 0);
      assert.equal(data.results[0].title, 'Tasks');
    });

    it('POST query returns pages with pagination', async () => {
      const { status, data } = await api('POST', '/api/datasources/ds_001/query', { limit: 1 });
      assert.equal(status, 200);
      assert.ok(data.results.length <= 1);
      assert.ok(data.total >= 2);
      assert.equal(data.has_more, true);
      assert.ok(data.next_cursor);
    });

    it('POST query with start_cursor paginates', async () => {
      const { data: page1 } = await api('POST', '/api/datasources/ds_001/query', { limit: 1 });
      const { data: page2 } = await api('POST', '/api/datasources/ds_001/query', {
        limit: 1, start_cursor: page1.next_cursor
      });
      assert.ok(page2.results.length > 0);
      assert.notEqual(page1.results[0].id, page2.results[0].id);
    });

    it('POST query with filter narrows results', async () => {
      const { data } = await api('POST', '/api/datasources/ds_001/query', {
        filter: { Status: 'Open' }
      });
      for (const page of data.results) {
        assert.equal(page.properties.Status, 'Open');
      }
    });

    it('POST query with sort orders results', async () => {
      const { data } = await api('POST', '/api/datasources/ds_001/query', {
        sort: [{ property: 'Priority', direction: 'asc' }]
      });
      if (data.results.length >= 2) {
        const p0 = data.results[0].properties?.Priority ?? 0;
        const p1 = data.results[1].properties?.Priority ?? 0;
        assert.ok(p0 <= p1);
      }
    });

    it('POST query returns 404 for unknown datasource', async () => {
      const { status } = await api('POST', '/api/datasources/nonexistent/query', {});
      assert.equal(status, 404);
    });

    it('GET resolve returns datasource IDs for database', async () => {
      const { status, data } = await api('GET', '/api/datasources/resolve/db_001');
      assert.equal(status, 200);
      assert.ok(data.results.find(r => r.id === 'ds_001'));
    });

    it('GET resolve returns 404 for unknown database', async () => {
      const { status } = await api('GET', '/api/datasources/resolve/nonexistent');
      assert.equal(status, 404);
    });
  });

  describe('CLI', () => {
    it('ntn-mock datasources query returns results', async () => {
      const { stdout, exitCode } = await cli('datasources query ds_001 --limit 5');
      assert.equal(exitCode, 0);
      assert.ok(stdout.length > 0);
    });

    it('ntn-mock datasources resolve shows datasource', async () => {
      const { stdout, exitCode } = await cli('datasources resolve db_001');
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('ds_001'));
    });
  });
});
