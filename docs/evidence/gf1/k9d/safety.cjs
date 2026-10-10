// Reuse K9's protected-file guard; retain all K9d fixtures and propagate protection to Node children.
require('../k9/safety.cjs');
const fs = require('node:fs');
const path = require('node:path');
const child = require('node:child_process');
const { syncBuiltinESMExports } = require('node:module');
const scratch = 'E:/BhuAayam-data/task-data/k9d';
const insideScratch = file => {
  const actual = path.resolve(String(file)).replaceAll('\\', '/').toLowerCase();
  return actual.startsWith(scratch.toLowerCase() + '/');
};
for (const name of ['rmSync', 'unlinkSync', 'rmdirSync']) {
  fs[name] = function(file) {
    if (!insideScratch(file)) throw new Error('K9d deletion refused');
  };
}
for (const name of ['rm', 'unlink', 'rmdir']) {
  fs.promises[name] = async function(file) {
    if (!insideScratch(file)) throw new Error('K9d deletion refused');
  };
}
for (const name of ['spawn', 'spawnSync', 'execFileSync']) {
  const original = child[name];
  child[name] = function(command, args, options = {}) {
    options.env = {
      ...(options.env ?? process.env), CUDA_VISIBLE_DEVICES: '', PYTHONDONTWRITEBYTECODE: '1',
      NODE_OPTIONS: `--require ${__filename}`,
    };
    return original.call(this, command, args, options);
  };
}
process.env.TEMP = scratch + '/test-temp';
process.env.TMP = process.env.TEMP;
syncBuiltinESMExports();
