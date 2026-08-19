'use strict';

/**
 * Parse remaining args into key-value pairs
 */
function parseCommandArgs(args) {
  const params = {};
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        params[key] = next;
        i += 2;
      } else {
        params[key] = true;
        i++;
      }
    } else {
      if (!params._positional) params._positional = [];
      params._positional.push(arg);
      i++;
    }
  }
  return params;
}

module.exports = { parseCommandArgs };
