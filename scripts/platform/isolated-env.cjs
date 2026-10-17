// Demo-only preload: legacy server configuration unconditionally probes checkout
// .env. Hide that exact path and reject reads, before any server module executes.
// All actual settings come from the authorized external demo.env via the launcher.
const fs = require('node:fs');
const path = require('node:path');
const { syncBuiltinESMExports } = require('node:module');
if (process.env.ULPIN_PROFILE !== 'demo') throw new Error('Demo preload requires ULPIN_PROFILE=demo.');
const forbidden = path.resolve(__dirname, '../../.env').toLowerCase();
const isForbidden = value => {
  if (value instanceof URL) value = require('node:url').fileURLToPath(value);
  return typeof value === 'string' && path.resolve(value).toLowerCase() === forbidden;
};
const exists = fs.existsSync, read = fs.readFileSync;
fs.existsSync = function(file) { return isForbidden(file) ? false : exists.apply(this, arguments); };
fs.readFileSync = function(file) {
  if (isForbidden(file)) {
    const error = new Error('Checkout .env reads are forbidden in the demo profile.');
    error.code = 'EACCES'; throw error;
  }
  return read.apply(this, arguments);
};
syncBuiltinESMExports();
