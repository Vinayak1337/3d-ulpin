// R6 test guard: K9's protected-file guard (nothing under the runtimes folder, no settings file of any
// runtime, is opened), temporary folders under R6's own scratch, deletes kept, and the same guard in children.
require('../../gf1/k9/safety.cjs');
const fs = require('node:fs');
const path = require('node:path');
const child = require('node:child_process');
const { syncBuiltinESMExports } = require('node:module');
const scratch = 'E:/BhuAayam-data/task-data/r6';
const insideScratch = file => {
  const actual = path.resolve(String(file)).replaceAll('\\', '/').toLowerCase();
  return actual.startsWith(scratch.toLowerCase() + '/');
};
for (const name of ['rmSync', 'unlinkSync', 'rmdirSync']) {
  fs[name] = function(file) {
    if (!insideScratch(file)) throw new Error('R6 deletion refused');
  };
}
for (const name of ['rm', 'unlink', 'rmdir']) {
  fs.promises[name] = async function(file) {
    if (!insideScratch(file)) throw new Error('R6 deletion refused');
  };
}
for (const name of ['spawn', 'spawnSync', 'execFileSync']) {
  const original = child[name];
  child[name] = function(command, args, options = {}) {
    options.env = { ...(options.env ?? process.env), NODE_OPTIONS: `--require ${__filename}` };
    return original.call(this, command, args, options);
  };
}
process.env.TEMP = scratch + '/test-temp';
process.env.TMP = process.env.TEMP;
fs.mkdirSync(process.env.TEMP, { recursive: true });
syncBuiltinESMExports();
