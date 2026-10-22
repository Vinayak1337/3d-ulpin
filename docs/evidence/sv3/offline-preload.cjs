// Reuse the checked-in isolation guard, then deny all settings reads and network dispatch for this task.
process.env.ULPIN_PROFILE = 'demo';
process.env.REPO_DATA = 'false';
process.env.ULPIN_MODEL_GATEWAY_ENABLED = '0';
process.env.ULPIN_MAPPING_TEACHER_ADAPTER = 'manual';
delete process.env.ULPIN_MODEL_SQL_URL;
process.env.ULPIN_TEACHER_RECORDINGS_DIR = require('node:fs').mkdtempSync(
  require('node:path').join(require('node:os').tmpdir(), 'sv3-recordings-'),
);
require('../../../scripts/platform/isolated-env.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { syncBuiltinESMExports } = require('node:module');
const forbidden = value => {
  if (value instanceof URL) value = fileURLToPath(value);
  if (typeof value !== 'string') return false;
  const normalized = path.resolve(value).replaceAll('\\', '/').toLowerCase();
  return /(?:^|\/)\.?[^/]*\.env$/.test(normalized)
    || normalized.endsWith('/.env')
    || normalized.startsWith('e:/bhuaayam-data/runtime/');
};
for (const target of [fs, fs.promises]) {
  for (const name of ['readFileSync', 'readFile', 'openSync', 'open', 'readdirSync', 'readdir', 'mkdirSync', 'mkdir']) {
    if (!target[name]) continue;
    const original = target[name];
    target[name] = function (file, ...args) {
      if (forbidden(file)) throw Object.assign(new Error('Offline settings read refused.'), { code: 'EACCES' });
      return original.call(this, file, ...args);
    };
  }
}
const noNetwork = () => { throw new Error('Offline network dispatch refused.'); };
globalThis.fetch = noNetwork;
const socket = require('node:net').Socket.prototype;
const connect = socket.connect;
socket.connect = function (...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const pipe = typeof first === 'string' ? first : first?.path;
  if (typeof pipe === 'string' && /^\\\\[.?]\\pipe\\/i.test(pipe)) return connect.apply(this, args);
  return noNetwork();
};
require('node:http').request = noNetwork;
require('node:https').request = noNetwork;
syncBuiltinESMExports();
