import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  attributed, digest, movedOnReader, recordedOriginal, recordedSourceControl, refusal, retainOriginal, storeJob,
  type RecordedSourceControl, type Row,
} from '../registry/registry-recorded-source.test-fixture';
import { buildingLedger } from './building-ledger';
import { exportConsolidatedRegister } from './consolidated-register';

const globals = globalThis as unknown as { ulpinPool?: unknown };

/** A building recorded from a geometry-free package: its facts cite the pinned originals by page, nothing else. */
function recordBuilding(f: RecordedSourceControl, sourceIds: string[]) {
  const buildingId = randomUUID();
  const areaId = randomUUID();
  const feature = { id: buildingId, kind: 'building', name: 'Recorded building', geometry: null,
    geographicGeometry: null, sourceGeometry: null, placement: 'unknown', sourceRevisionId: sourceIds[0],
    evidence: sourceIds.map(id => ({ sourceRevisionId: id, page: 1 })) };
  const pkg = { id: randomUUID(), areaId, geometryFree: true, parts: [], features: [feature], factCandidates: [],
    sourceRevisionIds: sourceIds,
    documentPins: sourceIds.map(id => ({ sourceId: id, sourceRevision: 1, sourceSha256: digest })) };
  const root = { id: buildingId, identifier: 'application-building', revision: 1, body: feature, area_id: areaId,
    site_id: f.siteId, reference: null, frame: { id: 'frame', benchmark: 'unknown' }, area_name: 'Recorded area',
    area_revision: 1, site_revision: 1, recorded_at: '2026-10-09T22:50:30Z' };
  f.state.extra = (q: string): Row[] | null => {
    if (q.startsWith('SELECT f.id,f.identifier')) return [root];
    if (q.includes('FROM physical_feature_revisions')) return [{ revision: 1, created_at: root.recorded_at }];
    if (q.startsWith('SELECT id,revision,state,body FROM import_packages')) {
      return [{ id: pkg.id, revision: 1, state: 'COMMITTED', body: pkg }];
    }
    if (q.startsWith('SELECT p.body,a.site_id FROM import_packages')) return [{ body: pkg, site_id: f.siteId }];
    if (q.startsWith('WITH RECURSIVE related')
      || /FROM (registry_records|property_associations|external_identifiers|area_check_runs)\b/.test(q)) return [];
    return null;
  };
  return buildingId;
}

/** Tower-like: one cited original with an accepted reading, one that never had one. */
async function recorded(work: (f: RecordedSourceControl, buildingId: string,
  read: ReturnType<typeof recordedOriginal>, unread: Row) => Promise<void>) {
  const pool = globals.ulpinPool;
  const f = recordedSourceControl();
  await attributed(async () => {
    const read = recordedOriginal(f);
    const unread = retainOriginal(f);
    f.pinned.add(unread.id);
    globals.ulpinPool = f.pool;
    try { await work(f, recordBuilding(f, [read.source.id, unread.id]), read, unread); }
    finally { globals.ulpinPool = pool; }
  });
}
const register = async (buildingId: string) => {
  const { generatedAt: _generatedAt, ...report } = await (await exportConsolidatedRegister(buildingId, 'json')).json();
  return report;
};

test('the register of a recorded building reads the same after the document reader hash changed', () => recorded(
  async (f, buildingId, read, unread) => {
    const before = await register(buildingId);
    assert.deepEqual(before.sources.map((source: Row) => source.id).sort(), [read.source.id, unread.id].sort());
    assert(before.sources.every((source: Row) => source.documentResult === undefined));

    storeJob(f, { ...read.input, readerSha256: movedOnReader });
    const after = await register(buildingId);
    const stated = after.sources.find((source: Row) => source.id === read.source.id);
    assert.deepEqual(stated.documentResult, { current: false, reasons: ['reader_changed'] });
    delete stated.documentResult;
    assert.deepEqual(after, before);
  }));

test('the ledger of a recorded building reads the same after a later import advanced the case revision',
  () => recorded(async (f, buildingId, read) => {
    const before = await buildingLedger(buildingId);
    assert.equal(before.sources.length, 2);
    retainOriginal(f);
    f.caseRow.revision += 1;
    const after = await buildingLedger(buildingId);
    const note = `The document reading retained beside source ${read.source.id} is no longer current `
      + '(case_advanced); the recorded citation is unchanged.';
    assert.deepEqual(after.missing.filter(item => !before.missing.includes(item)), [note]);
    assert.deepEqual({ ...after, missing: before.missing }, before);
  }));

test('an archived case and a changed original still refuse the register and the ledger with their own codes',
  () => recorded(async (f, buildingId, read) => {
    f.caseRow.archived = true;
    await assert.rejects(() => exportConsolidatedRegister(buildingId, 'json'), refusal(403, 'DOCUMENT_DENIED'));
    await assert.rejects(() => buildingLedger(buildingId), refusal(403, 'DOCUMENT_DENIED'));
    f.caseRow.archived = false;
    read.source.sha256 = 'd'.repeat(64);
    await assert.rejects(() => exportConsolidatedRegister(buildingId, 'json'),
      refusal(422, 'DOCUMENT_SOURCE_INTEGRITY'));
    await assert.rejects(() => buildingLedger(buildingId), refusal(422, 'DOCUMENT_SOURCE_INTEGRITY'));
  }));
