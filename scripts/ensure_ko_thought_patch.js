#!/usr/bin/env node
'use strict';

const cli = require('../host/cli');

if (require.main === module) {
  cli.runCli(process.argv.slice(2)).catch((err) => {
    process.stderr.write(`[ko-thought-translator] error: ${err && err.message ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}

module.exports = cli;
