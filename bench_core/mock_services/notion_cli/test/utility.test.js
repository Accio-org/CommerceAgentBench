import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupServer, teardownServer, api, cli } from './helpers.js';

describe('Utility Commands', () => {
  before(async () => { await setupServer(); });
  after(async () => { await teardownServer(); });

  describe('doctor', () => {
    it('ntn-mock doctor shows health checks', async () => {
      const { stdout, exitCode } = await cli('doctor');
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('✓'));
      assert.ok(stdout.includes('CLI version'));
      assert.ok(stdout.includes('Node.js'));
      assert.ok(stdout.includes('Auth'));
    });
  });

  describe('update', () => {
    it('ntn-mock update shows up to date', async () => {
      const { stdout, exitCode } = await cli('update');
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('up to date'));
      assert.ok(stdout.includes('0.15.0'));
    });

    it('ntn-mock update --force reinstalls', async () => {
      const { stdout, exitCode } = await cli('update --force');
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('Reinstalled'));
    });
  });

  describe('version', () => {
    it('ntn-mock --version shows version', async () => {
      const { stdout, exitCode } = await cli('--version');
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('ntn 0.15.0'));
    });
  });

  describe('help', () => {
    it('ntn-mock --help shows usage', async () => {
      const { stdout, exitCode } = await cli('--help');
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('Usage'));
      assert.ok(stdout.includes('workers'));
      assert.ok(stdout.includes('pages'));
    });
  });
});
