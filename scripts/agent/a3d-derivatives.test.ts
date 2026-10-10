import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { mock, test } from 'node:test';
import { settings } from '../../packages/server/src/infrastructure/config';
import { sha256 } from '../../packages/server/src/infrastructure/storage';
import { inspectTabularSource, tabularDevelopmentAsset, assertTabularPin } from
  '../../packages/server/src/modules/usp/ingestion/tabular-source';

const manifestPath = 'fixtures/usp/D8-messy-india/manifest.json';
const indexPath = 'fixtures/usp/D8-messy-india/dev/d1c/derivatives.json';
const selection = { format: 'csv' as const, sheet: 'csv', table: null, headerRows: [1] };
const denied = (error: any) => error.code === 'TABULAR_DATA_DENIED';

function metadataControl(change: (manifest: any, index: any) => void, run: () => void) {
  const root = `E:/BhuAayam-data/task-data/a3d/controls/${randomUUID()}`;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const index = JSON.parse(readFileSync(indexPath, 'utf8'));
  change(manifest, index);
  for (const [path, value] of [[manifestPath, manifest], [indexPath, index]] as const) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify(value), { flag: 'wx' });
  }
  mock.getter(settings, 'repositoryRoot', () => root);
  try { run(); }
  finally { mock.restoreAll(); }
}

test('both recorded TNHB development CSV derivatives retain exact JSON-original lineage in pin/profile', () => {
  const index = JSON.parse(readFileSync(indexPath, 'utf8'));
  for (const derivative of index.derivatives.filter((item: any) => item.family === 'mi-d22')) {
    const bytes = readFileSync(derivative.developmentCopy);
    assert.equal(sha256(bytes), derivative.sha256);
    assert.equal(bytes.length, derivative.bytes);
    const inventory = inspectTabularSource(bytes, selection);
    assert.deepEqual(inventory.tabular.derivativeOf,
      { originalSha256: derivative.originalSha256, version: 'json-table-csv/1' });
    assert.equal(inventory.records, derivative.rows);
    assert(inventory.limitations.some(limitation => limitation.includes('JSON-original lineage')));
    assertTabularPin(inventory.tabular, { sha256: derivative.sha256, bytes: derivative.bytes,
      inspection: { manualProfile: { tabular: inventory.tabular } } });
    const changed = Buffer.from(bytes);
    changed[changed.length - 1] ^= 1;
    assert.throws(() => inspectTabularSource(changed, selection), denied);
  }
});

test('unknown version/generator and non-development or restricted originals deny exact derivative bytes', () => {
  const index = JSON.parse(readFileSync(indexPath, 'utf8'));
  const derivative = index.derivatives[0];
  const admit = () => tabularDevelopmentAsset(derivative.sha256, derivative.bytes);
  for (const change of [
    (_manifest: any, changed: any) => { changed.version = 'json-table-csv/999'; },
    (_manifest: any, changed: any) => { changed.script = 'unreviewed-generator.py'; },
    (_manifest: any, changed: any) => { changed.derivatives[0].scriptSha256 = '0'.repeat(64); },
    (_manifest: any, changed: any) => { changed.derivatives[0].originalSha256 = '0'.repeat(64); },
    (manifest: any) => { manifest.assets.find((asset: any) =>
      asset.original.sha256 === derivative.originalSha256).split = 'not-dev'; },
    (manifest: any) => { manifest.assets.find((asset: any) =>
      asset.original.sha256 === derivative.originalSha256).permission.state = 'restricted'; },
  ]) metadataControl(change, () => assert.throws(admit, denied));
});
