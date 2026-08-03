/**
 * json.js — JSON output renderer for --raw mode.
 * Mirrors Go's json.MarshalIndent with 2-space indent.
 */

/**
 * Render data as pretty-printed JSON (2-space indent).
 * @param {any} data
 * @returns {string}
 */
export function renderJson(data) {
  return JSON.stringify(data, null, 2);
}
