// K9 local harness: retain scratch, block protected reads, and keep children CPU-only.
const fs = require('node:fs');
const path = require('node:path');
const child = require('node:child_process');
const { syncBuiltinESMExports } = require('node:module');
const scratch = 'E:/BhuAayam-data/task-data/k9';
const runtime = 'e:/bhuaayam-data/runtime';
const normalize = value => {
  if (value instanceof URL) value = require('node:url').fileURLToPath(value);
  return path.resolve(String(value)).replaceAll('\\', '/').toLowerCase();
};
const protectedFile = value => {
  const file = normalize(value);
  return file === runtime || file.startsWith(runtime + '/') || /\/(?:demo)?\.env$/.test(file);
};
const blockedOperations = [
  'readFileSync', 'readFile', 'writeFileSync', 'writeFile', 'openSync', 'open',
  'readdirSync', 'readdir', 'realpathSync',
];
for (const name of blockedOperations) {
  const original = fs[name];
  fs[name] = function(file, ...args) {
    if (protectedFile(file)) throw new Error('K9 protected filesystem access refused');
    return original.call(this, file, ...args);
  };
}
for (const name of ['readFile', 'writeFile', 'open', 'readdir', 'realpath', 'stat']) {
  const original = fs.promises[name];
  fs.promises[name] = async function(file, ...args) {
    if (protectedFile(file)) throw new Error('K9 protected filesystem access refused');
    return original.call(this, file, ...args);
  };
}
const exists = fs.existsSync;
fs.existsSync = file => protectedFile(file) ? false : exists(file);
for (const name of ['rmSync', 'unlinkSync', 'rmdirSync']) {
  fs[name] = function(file) {
    if (!normalize(file).startsWith(normalize(scratch) + '/')) throw new Error('K9 deletion refused');
  };
}
for (const name of ['rm', 'unlink', 'rmdir']) {
  fs.promises[name] = async function(file) {
    if (!normalize(file).startsWith(normalize(scratch) + '/')) throw new Error('K9 deletion refused');
  };
}
for (const name of ['spawn', 'spawnSync', 'execFileSync']) {
  const original = child[name];
  child[name] = function(command, args, options = {}) {
    options.env = { ...(options.env ?? process.env), CUDA_VISIBLE_DEVICES: '', PYTHONDONTWRITEBYTECODE: '1' };
    return original.call(this, command, args, options);
  };
}
process.env.CUDA_VISIBLE_DEVICES = '';
process.env.PYTHONDONTWRITEBYTECODE = '1';
process.env.TEMP = scratch + '/test-temp';
process.env.TMP = process.env.TEMP;
process.env.REPO_DATA = 'false';
syncBuiltinESMExports();
