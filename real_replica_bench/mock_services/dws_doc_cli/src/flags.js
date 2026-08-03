'use strict';

/**
 * Parse global flags from argv array.
 * Returns { flags, remainingArgs }
 */
function parseGlobalFlags(argv) {
  const flags = {
    format: 'json',
    jq: null,
    fields: null,
    dryRun: false,
    yes: false,
    verbose: false,
    debug: false,
    timeout: 30,
    mock: false,
    clientId: null,
    clientSecret: null,
    token: null
  };

  const remaining = [];
  let i = 0;

  while (i < argv.length) {
    const arg = argv[i];

    if (arg === '--format' || arg === '-f') {
      flags.format = argv[++i] || 'json';
    } else if (arg === '--jq') {
      flags.jq = argv[++i] || null;
    } else if (arg === '--fields') {
      flags.fields = argv[++i] || null;
    } else if (arg === '--dry-run') {
      flags.dryRun = true;
    } else if (arg === '--yes' || arg === '-y') {
      flags.yes = true;
    } else if (arg === '--verbose' || arg === '-v') {
      flags.verbose = true;
    } else if (arg === '--debug') {
      flags.debug = true;
    } else if (arg === '--timeout') {
      flags.timeout = parseInt(argv[++i]) || 30;
    } else if (arg === '--mock') {
      flags.mock = true;
    } else if (arg === '--client-id') {
      flags.clientId = argv[++i] || null;
    } else if (arg === '--client-secret') {
      flags.clientSecret = argv[++i] || null;
    } else if (arg === '--token') {
      flags.token = argv[++i] || null;
    } else {
      remaining.push(arg);
    }
    i++;
  }

  return { flags, args: remaining };
}

module.exports = { parseGlobalFlags };
