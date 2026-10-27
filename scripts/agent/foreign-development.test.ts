import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolve } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { test } from 'node:test';
import { checkBoundary, prepareTable } from './t1-profiles';
import { developmentManifest, foreignProfileAssets, sourceTables, stableHash, FOREIGN_MANIFEST } from './t1-sources';

function foreignFixture() {
  const asset = foreignProfileAssets().find(entry => entry.family === 'opf-d02');
  assert(asset);
  const table = sourceTables(asset)[0];
  return { asset, column: prepareTable(asset, table).profiles[0] };
}

test('the exact opf-d02 development profile passes the boundary and its pinned prefix reader', () => {
  const { asset, column } = foreignFixture();
  assert.equal(checkBoundary([column]).heldOutMatches, 0);
  assert.equal(asset.split, 'dev');
  assert.equal(sourceTables({ ...asset, preparation: 'd1f' })[0].rows.length, 128);
});

test('an unlisted foreign family is refused as development and cannot pass as pool', () => {
  const { column } = foreignFixture();
  const changed = { ...column, family: 'opf-unlisted-software-control' };
  changed.profileId = stableHash([changed.family, changed.file, changed.sheet, changed.column]);
  assert.throws(() => checkBoundary([changed]));
  assert.throws(() => checkBoundary([{ ...changed, split: 'pool' }]));
});

test('a manifest-listed foreign profile marked pool is refused', () => {
  const { column } = foreignFixture();
  assert.throws(() => checkBoundary([{ ...column, split: 'pool' }]));
});

test('a held-out id of either manifest anywhere in a profile is refused', context => {
  const { column } = foreignFixture();
  const indianBlind = [...developmentManifest().heldOut][0];
  assert(indianBlind);
  assert.throws(() => checkBoundary([{ ...column, header: indianBlind }]));
  const originalRead = fs.readFileSync;
  const foreign = JSON.parse(originalRead(FOREIGN_MANIFEST, 'utf8'));
  const foreignBlind = 'opf-heldout-software-control';
  foreign.heldout = [{ id: foreignBlind }];
  context.mock.method(fs, 'readFileSync', (path: fs.PathOrFileDescriptor, ...args: unknown[]) => {
    if (typeof path === 'string' && resolve(path) === resolve(FOREIGN_MANIFEST)) return JSON.stringify(foreign);
    return Reflect.apply(originalRead, fs, [path, ...args]);
  });
  syncBuiltinESMExports();
  context.after(() => {
    context.mock.restoreAll();
    syncBuiltinESMExports();
  });
  for (const change of [{ header: foreignBlind }, { neighbourHeaders: [foreignBlind] },
    { maskedSamples: [foreignBlind] }]) {
    assert.throws(() => checkBoundary([{ ...column, ...change }]));
  }
  assert(developmentManifest().allFamilies.has(foreignBlind));
});

test('foreign source metadata differing from its exact manifest entry is refused before any source read', () => {
  const { asset } = foreignFixture();
  assert.throws(() => sourceTables({ ...asset, original: { ...asset.original, sha256: '0'.repeat(64) } }),
    { message: 'T1_SOURCE_DENIED' });
});

test('a foreign asset whose bytes differ from its pin is refused with T1_SOURCE_DENIED', context => {
  const { asset } = foreignFixture();
  const originalRead = fs.readFileSync;
  let deniedReads = 0;
  context.mock.method(fs, 'readFileSync', (path: fs.PathOrFileDescriptor, ...args: unknown[]) => {
    if (typeof path === 'string' && resolve(path) === resolve(asset.original.externalPath)) {
      deniedReads++;
      return Buffer.from('Synthetic changed bytes; no original is rewritten.');
    }
    return Reflect.apply(originalRead, fs, [path, ...args]);
  });
  syncBuiltinESMExports();
  context.after(() => {
    context.mock.restoreAll();
    syncBuiltinESMExports();
  });
  assert.throws(() => sourceTables(asset), { message: 'T1_SOURCE_DENIED' });
  assert.equal(deniedReads, 1);
});
