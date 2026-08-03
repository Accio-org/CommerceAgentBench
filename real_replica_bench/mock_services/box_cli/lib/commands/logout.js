// box logout — remove an OAuth environment
// Source: src/commands/logout.js

import { removeEnvironment, listEnvironments } from '../auth.js';
import { auditLog } from '../db.js';

export function run(db, args, flags, output) {
  const envs = listEnvironments(db);
  if (envs.length === 0) {
    // Upstream: src/commands/logout.js:53-55 (this.error → exit 2).
    output.writeErr('No current environment found. Nothing to log out from.\n');
    return;
  }

  // Real logout revokes the current environment's token; the mock removes the
  // stored environment(s) and prints the success line to STDERR via this.info
  // (src/commands/logout.js:144-146).
  if (flags.force) {
    for (const env of envs) {
      removeEnvironment(db, env.env_name);
      auditLog(db, 'logout', 'environment', env.env_name, {});
    }
  } else {
    const env = envs[0];
    removeEnvironment(db, env.env_name);
    auditLog(db, 'logout', 'environment', env.env_name, {});
  }
  const current = envs[0].env_name;
  output.writeErr(`Successfully logged out from "${current}" environment.\n`);
}
