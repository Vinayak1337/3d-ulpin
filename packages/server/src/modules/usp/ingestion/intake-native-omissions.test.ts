import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type { PoolClient } from 'pg';
import { INTAKE_OMISSION_LIMITS, IntakeNativeOmissionsSchema } from '@ulpin/contracts/usp';
import { AppError } from '../../../infrastructure/errors';
import { IntakeService } from './intake-service';
import { readOmissions } from './intake-native-omissions';

const subject = 'no1-protocol-operator';
const caseId = '41000000-0000-4000-8000-000000000001';
const itemId = '41000000-0000-4000-8000-000000000002';
const sourceId = '41000000-0000-4000-8000-000000000003';
const originalSha = 'c'.repeat(64);
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/**
 * In-memory protocol control, not a dataset record: a locator file in the converter's own line format
 * (services/geo/geo/native_gis.py `_Derivative`): a header, then `{feature, position}` per written row and
 * `{feature: null, position, reason}` per row not written.
 */
function locators(layer: string, rows: ({ reason: string } | null)[], positionKind = 'fid') {
  const lines = [JSON.stringify({ version: 'native-gis-locators/1', conversion: 'native_gis_to_geojson@1',
    readerVersion: 'native-gis-window/1', originalSha256: originalSha, format: 'gpkg', layer, positionKind,
    positionField: 'fid', crs: 'EPSG:2958' })];
  let written = 0;
  rows.forEach((row, position) => lines.push(JSON.stringify(row
    ? { feature: null, position: position + 1, reason: row.reason } : { feature: written++, position: position + 1 })));
  const bytes = new TextEncoder().encode(lines.join('\n') + '\n');
  return { bytes, written, notWritten: rows.filter(Boolean).length };
}

type Kept = ReturnType<typeof locators> & { layer: string; ordinal: number; childId: string };

function derivative(kept: Kept) {
  const key = `native-derivatives/${originalSha}/${kept.ordinal}/sidecar-${sha(kept.bytes)}`;
  return { key, row: { id: kept.childId, lineage: { version: 'native-derivative/1',
    conversion: 'native_gis_to_geojson@1', readerVersion: 'native-gis-window/1', originalSourceId: sourceId,
    originalSourceRevision: 1, originalSha256: originalSha, originalItemId: itemId, format: 'gpkg',
    layer: kept.layer, ordinal: kept.ordinal, crs: 'EPSG:2958', crsSource: 'stated', features: kept.written,
    notWritten: kept.notWritten, sidecar: { objectKey: key, bytes: kept.bytes.length, sha256: sha(kept.bytes) } } } };
}

function control(layers: Kept[], options: { card?: Record<string, unknown>; actor?: string } = {}) {
  const row = { item_id: itemId, source_id: sourceId, case_id: caseId, parent_item_id: null, member_path: null,
    name: 'outlines.gpkg', family: 'vector', format: 'geopackage', card: options.card ?? { format: 'geopackage' },
    plan_ref: null };
  const source = { id: sourceId, case_id: caseId, family_id: sourceId, revision: 1, name: 'outlines.gpkg',
    profile: 'gpkg-control', bytes: 4096, sha256: originalSha, object_key: 'sources/control', status: 'received',
    inspection: { actor: options.actor ?? subject } };
  const stored = new Map<string, Uint8Array>();
  const children = layers.map(kept => {
    const made = derivative(kept);
    stored.set(made.key, kept.bytes);
    return made.row;
  });
  const reads: [string, number, number][] = [];
  const client = { query: async (sql: string, values: unknown[]) => {
    if (sql.includes('FROM cases')) return { rows: values[0] === caseId ? [{ id: caseId, revision: 3,
      archived: false }] : [] };
    if (sql.startsWith('SELECT i.*')) return { rows: values[0] === caseId && values[1] === itemId ? [row] : [] };
    if (sql.includes('nativeDerivative')) {
      assert.deepEqual(values, [caseId, itemId, sourceId, originalSha]);
      return { rows: children };
    }
    if (sql.includes('FROM sources')) return { rows: values[1] === sourceId ? [source] : [] };
    throw new Error(`Unexpected protocol SQL: ${sql}`);
  } } as unknown as PoolClient;
  const read = async (key: string, start: number, end: number, size: number) => {
    assert.ok(end - start <= 1024 * 1024 && end <= size);
    reads.push([key, start, end]);
    return (stored.get(key) ?? assert.fail('no stored object')).subarray(start, end);
  };
  const service = new IntakeService({ transaction: (async (action: (c: PoolClient) => unknown) => action(client)) as
    never, read: read as never });
  return { service, reads, stored, children, read };
}

async function configured(action: () => Promise<void>) {
  const previous = process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = subject;
  try { await action(); }
  finally {
    if (previous === undefined) delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
    else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = previous;
  }
}

const refused = (status: number, code: string) => (error: unknown) =>
  error instanceof AppError && error.status === status && error.code === code;

const buildings = (): Kept => ({ layer: 'Council_Buildings', ordinal: 1, childId: '41000000-0000-4000-8000-00000000000b',
  ...locators('Council_Buildings', [null, null, { reason: 'geometry_header' }, null,
    { reason: 'attribute_not_finite:HEIGHT' }, null, { reason: 'record_deleted' }]) });
const copy = (): Kept => ({ layer: 'Copy', ordinal: 0, childId: '41000000-0000-4000-8000-00000000000a',
  ...locators('Copy', [null, null, null]) });

test('each converted layer lists the features not written, with position and reason, read whole and checked',
  async () => {
    await configured(async () => {
      const { service, reads } = control([buildings(), copy()]);
      const body = IntakeNativeOmissionsSchema.parse(await service.omissions(caseId, itemId));
      assert.deepEqual(body.layers.map(layer => [layer.layer, layer.written, layer.notWritten, layer.scan]),
        [['Copy', 3, 0, 'none_left_out'], ['Council_Buildings', 4, 3, 'whole']]);
      assert.deepEqual(body.layers[1]!.listed, [{ position: 3, reason: 'geometry_header' },
        { position: 5, reason: 'attribute_not_finite:HEIGHT' }, { position: 7, reason: 'record_deleted' }]);
      assert.equal(body.layers[1]!.positionKind, 'fid');
      assert.match(body.words, /^3 features of 1 layer were not written\. /);
      assert.match(body.words, /nothing here is placed, confirmed or recorded\.$/);
      // Only the layer with features left out is read; a layer with none is not opened.
      assert.deepEqual(new Set(reads.map(([key]) => key)).size, 1);
    });
  });

test('a long list is bounded per layer with its total, and a changed locator file is refused', async () => {
  await configured(async () => {
    const many = Array.from({ length: 180 }, (_, at) => at % 3 ? { reason: 'geometry_header' } : null);
    const long: Kept = { layer: 'Parcels', ordinal: 0, childId: '41000000-0000-4000-8000-00000000000c',
      ...locators('Parcels', many) };
    const { service, stored } = control([long]);
    const body = await service.omissions(caseId, itemId);
    assert.equal(body.layers[0]!.notWritten, 120);
    assert.equal(body.layers[0]!.listed.length, INTAKE_OMISSION_LIMITS.perLayer);
    assert.deepEqual(body.layers[0]!.listed.slice(0, 2).map(entry => entry.position), [2, 3]);
    const [key] = [...stored.keys()];
    const changed = Uint8Array.from(stored.get(key!)!);
    changed[changed.length - 3] = '9'.charCodeAt(0);
    stored.set(key!, changed);
    await assert.rejects(service.omissions(caseId, itemId), refused(409, 'INTAKE_OMISSIONS_INTEGRITY'));
  });
});

test('another case, another operator and a file that is not converted are refused before anything is read',
  async () => {
    await configured(async () => {
      const other = control([buildings()]);
      await assert.rejects(other.service.omissions('41000000-0000-4000-8000-000000000009', itemId),
        refused(404, 'NOT_FOUND'));
      await assert.rejects(other.service.omissions(caseId, '41000000-0000-4000-8000-000000000009'),
        refused(404, 'NOT_FOUND'));
      const foreign = control([buildings()], { actor: 'someone-else' });
      await assert.rejects(foreign.service.omissions(caseId, itemId), refused(403, 'INTAKE_SOURCE_DENIED'));
      const geojson = control([buildings()], { card: { format: 'geojson' } });
      await assert.rejects(geojson.service.omissions(caseId, itemId), refused(409, 'INTAKE_OMISSIONS_NOT_NATIVE'));
      assert.deepEqual([other.reads, foreign.reads, geojson.reads], [[], [], []]);
    });
  });

test('past the read budget a layer is listed in part, unchecked, and a later layer keeps only its counts', async () => {
  const first = buildings();
  const second: Kept = { ...buildings(), layer: 'Later', ordinal: 2, childId: '41000000-0000-4000-8000-00000000000d',
    ...locators('Later', [{ reason: 'geometry_header' }]) };
  const { children, read } = control([first, second]);
  const budget = first.bytes.length - 40;
  const body = await readOmissions({ caseId, itemId, source: { id: sourceId, revision: 1, sha256: originalSha } as
    never, layers: children.map(child => ({ sourceId: child.id, lineage: child.lineage as never })) },
  read as never, budget);
  assert.deepEqual(body.layers.map(layer => [layer.layer, layer.scan, layer.listed.length, layer.notWritten]),
    [['Council_Buildings', 'partial', 2, 3], ['Later', 'not_read', 0, 1]]);
  assert.match(body.words, /read only in part/);
  assert.match(body.words, /only their counts are shown/);
});
