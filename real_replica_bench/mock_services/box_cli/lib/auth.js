// Auth / environment management for Box CLI mock
// Mirrors ~/.box/box_environments.json behavior

import { NO_DEFAULT_ENV, AUTH_FAILED } from './errors.js';

/**
 * Resolve a valid token from flags or stored environments.
 * Returns { token, envName, userId } or calls die() on failure.
 */
export function resolveAuth(db, flags, die) {
  // --token flag takes precedence
  if (flags.token) {
    return { token: flags.token, envName: '__inline__', userId: getDefaultUserId(db) };
  }

  // Look up default environment
  const row = db.prepare('SELECT env_name, token FROM auth_session LIMIT 1').get();
  if (!row) {
    die(NO_DEFAULT_ENV);
  }
  return { token: row.token, envName: row.env_name, userId: getDefaultUserId(db) };
}

/**
 * Get the default (first) user ID from the users table.
 */
export function getDefaultUserId(db) {
  const row = db.prepare('SELECT id FROM users ORDER BY rowid LIMIT 1').get();
  return row ? row.id : '10001';
}

/**
 * Create or replace an auth environment.
 */
export function createEnvironment(db, envName, token, timestamp) {
  db.prepare(
    'INSERT OR REPLACE INTO auth_session (env_name, token, created_at) VALUES (?, ?, ?)'
  ).run(envName, token, timestamp);
}

/**
 * Remove an auth environment by name.
 */
export function removeEnvironment(db, envName) {
  const info = db.prepare('DELETE FROM auth_session WHERE env_name = ?').run(envName);
  return info.changes > 0;
}

/**
 * List all environments.
 */
export function listEnvironments(db) {
  return db.prepare('SELECT env_name, token, created_at FROM auth_session').all();
}
