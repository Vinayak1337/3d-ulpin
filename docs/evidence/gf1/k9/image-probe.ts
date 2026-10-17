/** Inspect the new environment through the unchanged reviewed hook table; compare historical pins honestly. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  inspectImageCheckpointRuntime, packetImageCheckpointRuntime,
} from '../../../../packages/server/src/modules/usp/packets/image-checkpoint-runtime';

async function main() {
  const [python, output] = process.argv.slice(2);
  assert.ok(python && output);
  process.env.ULPIN_DOCUMENT_IMAGES_PYTHON = python;
  const resolved = await inspectImageCheckpointRuntime(python, Date.now() + 10000);
  const checkpoint = await packetImageCheckpointRuntime(Date.now() + 10000);
  assert.deepEqual(checkpoint.runtime, resolved);
  const launcher = await readFile(python);
  assert.equal(resolved.launcherSha256, createHash('sha256').update(launcher).digest('hex'));
  const retained = 'E:/BhuAayam-data/task-data/desktop-packet-image-region-20261003/png-provenance.json';
  const historical = JSON.parse(await readFile(retained, 'utf8')).runtime;
  const differences = Object.entries(resolved).filter(([key, value]) => historical[key] !== value)
    .map(([key, value]) => ({ field: key, historical: historical[key], new: value }));
  const roots = [dirname(dirname(python)), dirname(python)];
  const result = {
    scope: 'file-only static runtime check; no decoder/GPU/provider execution',
    hookTableChanged: false, resolved, checkpointRecipe: checkpoint.recipe, historicalDifferences: differences,
    roots, selectedPillow: join(dirname(dirname(python)), 'Lib/site-packages/PIL'),
    historicalBindingReusable: differences.length === 0,
  };
  await writeFile(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log('New image checkpoint runtime passes the unchanged hook table; historical differences recorded.');
}

main().catch(error => {
  console.error(error.code ?? error.name, error.message);
  process.exitCode = 1;
});
