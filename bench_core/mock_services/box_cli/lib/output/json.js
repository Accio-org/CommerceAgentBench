// JSON output renderer for Box CLI mock
// Matches real CLI: 4-space indent JSON

/**
 * Render an object or array as JSON with 4-space indentation.
 * box-command.js: JSON output path
 */
export function renderJson(data) {
  return JSON.stringify(data, null, 4);
}
