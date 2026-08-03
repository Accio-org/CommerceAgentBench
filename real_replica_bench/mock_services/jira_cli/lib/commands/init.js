/**
 * init.js — `jira init` command.
 * Creates config YAML at the standard config path.
 */

import { writeConfig, configPath, configExists } from "../auth.js";
import { successMsg } from "../errors.js";

/**
 * @param {object} flags
 * @param {string} flags.installation - "Cloud" or "Local"
 * @param {string} flags.server - Jira server URL
 * @param {string} flags.login - User email
 * @param {string} flags.authType - "basic", "bearer", or "mtls"
 * @param {string} flags.project - Default project key
 * @param {string} flags.board - Default board id
 * @param {boolean} flags.force - Overwrite existing
 * @param {boolean} flags.insecure - Allow insecure TLS
 */
export function run(flags) {
  // Real CLI: when a config exists and --force is not set, the (non-interactive)
  // overwrite prompt declines -> Generate() returns ErrSkip ->
  // cmdutil.Success("Skipping config generation. Current config: %s", file) on
  // STDOUT, then os.Exit(1) (internal/cmd/init/init.go:124-126,135).
  if (configExists() && !flags.force) {
    process.stdout.write(successMsg(`Skipping config generation. Current config: ${configPath()}`));
    process.exit(1);
  }

  const config = {
    installation: flags.installation || "Cloud",
    server: flags.server || "https://jira.example.com",
    login: flags.login || "admin@example.com",
    auth_type: flags.authType || "basic",
    project: flags.project || "PROJ",
    board: flags.board || "100",
  };

  if (flags.insecure) {
    config.insecure = true;
  }

  writeConfig(config);
  // Real CLI: Success("Configuration generated: %s", file)
  // (internal/cmd/init/init.go:138).
  process.stdout.write(successMsg(`Configuration generated: ${configPath()}`));
}
