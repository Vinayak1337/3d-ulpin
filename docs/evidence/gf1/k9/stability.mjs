// Ten CPU-only starts exercise writable-cache import behaviour against the frozen environment ACL.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { documentRuntimeReport } from '../../../../scripts/platform/demo-document-runtime.mjs';
import { readDemoDocumentRuntime } from '../../../../scripts/platform/demo-config.mjs';

const [pathsFile, output] = process.argv.slice(2);
assert.ok(pathsFile && output);
const paths = readDemoDocumentRuntime(pathsFile);
const before = documentRuntimeReport(paths);
const script = [
  'import sys, importlib',
  'sys.dont_write_bytecode = False',
  'import _virtualenv, _distutils_hack, pywin32_bootstrap',
  'for module in (_virtualenv, _distutils_hack, pywin32_bootstrap): importlib.reload(module)',
  'import argparse, asyncio, email, json, pathlib, sqlite3',
  'import pypdfium2, pymupdf, PIL.Image, psutil, defusedxml.ElementTree',
].join('\n');
const starts = [];
for (let index = 0; index < 10; index++) {
  // Step 2 explicitly asks for no -B. Startup stays protected by the required environment variable;
  // after startup, normal cache-writing behaviour is enabled, including explicit hook reloads.
  const result = spawnSync(paths.ULPIN_DOCUMENT_PAGES_PYTHON, ['-c', script], {
    env: { ...process.env, CUDA_VISIBLE_DEVICES: '', PYTHONDONTWRITEBYTECODE: '1' },
    encoding: 'utf8', timeout: 30000, windowsHide: true,
  });
  starts.push({ start: index + 1, exit: result.status, stderr: result.stderr });
  assert.equal(result.status, 0, result.stderr);
}
const after = documentRuntimeReport(paths);
assert.deepEqual(after, before);
assert.equal(after.regionProfileSha256, paths.ULPIN_PACKET_REGIONS_PROFILE_SHA256);
assert.equal(after.regionRepoMatches, true);
assert.equal(readFileSync(pathsFile).length > 0, true);
writeFileSync(output, JSON.stringify({ before, starts, after, cacheWritesEnabledAfterStartup: true }, null, 2) + '\n', {
  flag: 'wx',
});
console.log('Ten starts passed; the same frozen profile still passes documentRuntimeReport.');
