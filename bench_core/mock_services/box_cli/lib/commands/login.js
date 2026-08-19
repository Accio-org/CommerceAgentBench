// box login — create an OAuth environment
// Source: src/commands/login.js

import { createEnvironment } from '../auth.js';
import { now, auditLog } from '../db.js';

export function run(db, args, flags, output) {
  // Upstream default environment name is 'oauth' (src/commands/login.js:27).
  const envName = flags.name || 'oauth';
  const token = `mock-box-token-${envName}-${Date.now()}`;
  const ts = now();

  createEnvironment(db, envName, token, ts);
  auditLog(db, 'login', 'environment', envName, { token });

  // The real OAuth login is interactive and cannot run in this mock; it prints
  // success to STDERR via this.info (src/commands/login.js:372 and :381). We
  // reproduce those lines for the seeded default user.
  const u = db.prepare('SELECT login FROM users ORDER BY rowid LIMIT 1').get();
  const userLogin = u ? u.login : 'unknown@boxmock.example.com';
  output.writeErr(`Successfully logged in as ${userLogin}!\n`);
  output.writeErr(`New environment "${envName}" has been created and selected.\n`);
}
