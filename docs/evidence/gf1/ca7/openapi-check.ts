// Run the native generator/check without publishing outside the task-owned evidence paths.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const cataloguePath = resolve('docs/api/openapi.json');
const pinsPath = resolve('docs/api/source-pins.json');
const baselineCatalogue = fs.readFileSync(cataloguePath, 'utf8').replace(/\r\n/g, '\n');
const baselinePins = JSON.parse(fs.readFileSync(pinsPath, 'utf8'));
const generated = new Map<string, string>();
const key = (path: unknown) => resolve(String(path));
const ownedOutput = (path: string) => [cataloguePath, pinsPath].some(target =>
  path === target || path.startsWith(`${target}.`));

function memoryPublication() {
  const exists = fs.existsSync;
  const read = fs.readFileSync;
  fs.existsSync = ((path: any) => generated.has(key(path)) || exists(path)) as typeof fs.existsSync;
  fs.readFileSync = ((path: any, options: any) => {
    const value = generated.get(key(path));
    if (value === undefined) return read(path, options);
    return options ? value : Buffer.from(value);
  }) as typeof fs.readFileSync;
  fs.writeFileSync = ((path: any, value: any) => {
    assert(ownedOutput(key(path)), 'The generator tried to publish another path.');
    generated.set(key(path), String(value));
  }) as typeof fs.writeFileSync;
  fs.renameSync = (from, to) => {
    assert(ownedOutput(key(from)) && ownedOutput(key(to)));
    assert(generated.has(key(from)));
    generated.set(key(to), generated.get(key(from))!);
    generated.delete(key(from));
  };
  fs.unlinkSync = path => {
    assert(ownedOutput(key(path)));
    generated.delete(key(path));
  };
  syncBuiltinESMExports();
}

async function main() {
  memoryPublication();
  await import('../../../../apps/api/scripts/openapi.ts');
  process.argv.push('--check');
  const generator = new URL('../../../../apps/api/scripts/openapi.ts', import.meta.url);
  generator.search = '?ca7-check';
  await import(generator.href);
  const catalogue = fs.readFileSync(cataloguePath, 'utf8').replace(/\r\n/g, '\n');
  assert.equal(catalogue, baselineCatalogue);
  const pins = JSON.parse(fs.readFileSync(pinsPath, 'utf8'));
  assert.deepEqual(pins.operations, baselinePins.operations);
  const changedPins = Object.keys(pins.sourceSha256).filter(path =>
    pins.sourceSha256[path] !== baselinePins.sourceSha256[path]);
  const changedByTask = 'packages/server/src/modules/usp/ingestion/intake-draft.ts';
  assert.deepEqual(changedPins, [changedByTask]);
  console.log(JSON.stringify({ task: 'CA7', nativeGeneration: 'passed', nativeCheck: 'passed',
    publication: 'memory only; published catalogue and pins untouched', operations: pins.operations.length,
    schemas: Object.keys(JSON.parse(catalogue).components.schemas).length, changedPins,
    changedByTask,
    generatedPinsSha256: createHash('sha256').update(fs.readFileSync(pinsPath, 'utf8')).digest('hex') }));
}

await main();
