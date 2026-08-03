#!/usr/bin/env bun

import { createProgram } from '../lib/cli/index.js';
import { printError } from '../lib/utils/format.js';

const program = createProgram();

program.parseAsync(process.argv).catch(err => {
  if (program.opts().verbose) {
    console.error(err);
  } else {
    printError(err.message || String(err));
  }
  process.exit(1);
});
