/**
 * auth.js — Config file reading + token validation for Jira CLI mock.
 *
 * Config search order (mirrors real jira-cli):
 *   1. $JIRA_CONFIG_FILE
 *   2. $JIRA_MOCK_HOME/.jira/.config.yml
 *   3. $XDG_CONFIG_HOME/.jira/.config.yml
 *   4. ~/.config/.jira/.config.yml
 *
 * Auth: $JIRA_API_TOKEN env, or api_token in config file.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";

/**
 * Resolve the config file path.
 */
export function configPath() {
  if (process.env.JIRA_CONFIG_FILE) {
    return process.env.JIRA_CONFIG_FILE;
  }
  const mockHome = process.env.JIRA_MOCK_HOME;
  if (mockHome) {
    return join(mockHome, ".jira", ".config.yml");
  }
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) {
    return join(xdg, ".jira", ".config.yml");
  }
  const home = process.env.HOME || "/root";
  return join(home, ".config", ".jira", ".config.yml");
}

/**
 * Check if config file exists.
 */
export function configExists() {
  return existsSync(configPath());
}

/**
 * Read and parse config. Simple YAML key-value parser (sufficient for
 * jira-cli's flat config format — no nested structures).
 */
export function readConfig() {
  const p = configPath();
  if (!existsSync(p)) return null;
  const text = readFileSync(p, "utf-8");
  return parseSimpleYaml(text);
}

/**
 * Write config to the config file path.
 */
export function writeConfig(obj) {
  const p = configPath();
  const dir = dirname(p);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const lines = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === true) lines.push(`${k}: true`);
    else if (v === false) lines.push(`${k}: false`);
    else if (typeof v === "number") lines.push(`${k}: ${v}`);
    else lines.push(`${k}: ${v}`);
  }
  writeFileSync(p, lines.join("\n") + "\n", "utf-8");
}

/**
 * Get the current user login from config or env.
 */
export function currentUser() {
  const cfg = readConfig();
  return cfg?.login || process.env.JIRA_LOGIN || "admin@example.com";
}

/**
 * Get the configured server URL.
 */
export function serverUrl() {
  const cfg = readConfig();
  return cfg?.server || process.env.JIRA_SERVER || "https://jira.example.com";
}

/**
 * Get the default project key from config.
 */
export function defaultProject() {
  const cfg = readConfig();
  return cfg?.project || process.env.JIRA_DEFAULT_PROJECT || "PROJ";
}

/**
 * Build the browse URL for an issue/project key.
 * Mirrors cmdutil.GenerateServerBrowseURL (internal/cmdutil/utils.go:99-107):
 * "%s/browse/%s" using `browse_server` if set, else `server`.
 */
export function browseUrl(key) {
  const cfg = readConfig();
  const server =
    cfg?.browse_server || cfg?.server || process.env.JIRA_SERVER || "https://jira.example.com";
  return `${server}/browse/${key}`;
}

/**
 * Normalize an issue key the way cmdutil.GetJiraIssueKey does
 * (internal/cmdutil/utils.go:149-158): with a configured project, a pure
 * integer becomes "<PROJECT>-<n>"; otherwise the key is upper-cased.
 */
export function jiraIssueKey(key) {
  const project = defaultProject();
  if (!project) return key;
  if (/^\d+$/.test(String(key))) return `${project}-${key}`;
  return String(key).toUpperCase();
}

/**
 * Validate that auth is configured (token present).
 * For mock purposes, any non-empty token is valid.
 */
export function validateAuth() {
  if (process.env.JIRA_API_TOKEN) return true;
  const cfg = readConfig();
  if (cfg?.api_token) return true;
  return false;
}

/**
 * Parse simple YAML (flat key: value pairs, no nesting).
 */
function parseSimpleYaml(text) {
  const result = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf(":");
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let val = trimmed.slice(idx + 1).trim();
    // Strip quotes
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (val === "true") val = true;
    else if (val === "false") val = false;
    else if (/^\d+$/.test(val)) val = parseInt(val, 10);
    result[key] = val;
  }
  return result;
}
