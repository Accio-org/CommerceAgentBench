// Auth module — check for valid token via config file or env
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveHome } from './db.js';
import { NO_TOKEN } from './errors.js';

/**
 * Resolve the API token from:
 * 1. TODOIST_TOKEN env var (viper convention: TODOIST_ prefix + TOKEN)
 * 2. ~/.config/todoist/config.json { "token": "..." }
 *
 * Returns the token string, or null if not found.
 */
export function resolveToken() {
  // 1. Environment variable (matches viper.SetEnvPrefix("todoist") + AutomaticEnv)
  const envToken = process.env.TODOIST_TOKEN;
  if (envToken && envToken.trim()) {
    return envToken.trim();
  }

  // 2. Config file
  const home = resolveHome();
  const configFile = join(home, '.config', 'todoist', 'config.json');
  if (existsSync(configFile)) {
    try {
      const raw = readFileSync(configFile, 'utf-8');
      const cfg = JSON.parse(raw);
      if (cfg.token && cfg.token.trim()) {
        return cfg.token.trim();
      }
    } catch {
      // Malformed config — treat as missing
    }
  }

  return null;
}

/**
 * Validate auth. Returns token or exits with error.
 */
export function requireAuth() {
  const token = resolveToken();
  if (!token) {
    process.stderr.write('Error: ' + NO_TOKEN + '\n');
    process.exit(1);
  }
  return token;
}
