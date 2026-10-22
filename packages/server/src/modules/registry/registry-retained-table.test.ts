import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import type { RegistryRecord } from '@ulpin/contracts';
import { TABULAR_LIMITS, type StreamingVectorInput } from '@ulpin/contracts/usp';
import { sha256 } from '../../infrastructure/storage';
import { fingerprint } from '../cases/domain';
import { ingestionBinding } from '../usp/ingestion/events';
import { rowCells } from '../usp/ingestion/intake-evidence';
import { assertIntakeSource } from '../usp/ingestion/intake-context';
import { isRetainedMapOriginal } from '../usp/ingestion/retained-map-original';
import { sealedMapReceipt } from '../usp/ingestion/streamed-map-receipt';
import { readTabularSource } from '../usp/ingestion/tabular-source';
import { assertRegistryCurrentCitationTargetTx } from './registry-document-evidence';
import { registryDocumentSourceAccessTx, registryRecordedSourceTx, registrySourceTx } from './registry-metadata';
import { attributed, recordedSourceControl, refusal, subject } from './registry-recorded-source.test-fixture';
import { citedRowTx } from './registry-table-evidence';

const registerPath = 'E:/BhuAayam-data/datasets/nyc-10013-linked/'
  + 'nyc-landmarks-preservation-commission/gpmc-yuvp.csv';
const skip = !existsSync(registerPath) && 'the public NYC test_only register is not present';
const selection = { format: 'csv' as const, sheet: 'csv', table: null, headerRows: [1] };

/** JSON containment as used by the confirmation lookup, over the in-memory stored pins. */
function contains(actual: any, expected: any): boolean {
  if (Array.isArray(expected)) return expected.every(item => actual?.some((value: any) => contains(value, item)));
  if (expected && typeof expected === 'object') {
    return Object.entries(expected).every(([key, value]) => contains(actual?.[key], value));
  }
  return actual === expected;
}

/** The /uploads source shape, with a real row accepted in the officer's stored confirmation. */
function retainedRegister() {
  const f = recordedSourceControl(), bytes = readFileSync(registerPath), id = randomUUID();
  const hash = sha256(bytes), table = readTabularSource(bytes, selection);
  const index = table.sourceRows.indexOf(702), columnIndex = table.headers.indexOf('bin');
  const literal = table.rows[index][columnIndex];
  assert.equal(typeof literal, 'string');
  const row = { kind: 'table_row' as const, itemId: randomUUID(), caseId: f.caseRow.id, sourceId: id,
    sourceRevision: 1, sourceSha256: hash, rawJobId: randomUUID(), rawInputSha256: fingerprint('test_only:raw'),
    rawResultSha256: fingerprint(table), acceptedFence: 1, selection, sourceRow: 702,
    rowSha256: fingerprint(rowCells(table, index)), columnIndex, columnHeader: 'bin',
    cell: { state: 'literal' as const, value: literal as string } };
  const source = { id, case_id: f.caseRow.id, family_id: id, revision: 1, name: 'gpmc-yuvp.csv',
    mime_type: 'application/octet-stream', profile: 'large-original-v1', status: 'needs_input',
    bytes: bytes.length, sha256: hash, object_key: `large-originals/${id}/${hash}`,
    inspection: { profile: 'large-original-v1', status: 'needs_input', issues: [],
      summary: 'Original bytes retained and hash-verified. Conversion is unsupported; no parsing, placement, '
        + 'approval or publication of semantic records occurred.',
      largeOriginal: { uploadId: randomUUID(), operatorSubject: subject, objectEtag: hash,
        verifiedSha256: hash, verifiedBytes: bytes.length,
        provenance: { origin: 'not_stated', acquiredAt: '2026-10-21T00:00:00.000Z', state: 'not_stated' },
        conversion: 'unsupported', bundleCompleteness: 'single_original_only_archive_dependencies_not_assessed' } } };
  // The stored pins keep the keys and nesting read from the act 1 confirmation on ulpin-reh-02 (RC2).
  const targetId = randomUUID();
  const confirmation = { case_id: source.case_id, subject, additions: 'citations', pins: {
    targets: [{ targetId, packageId: randomUUID(), packageRevision: 2, reviewFingerprint: fingerprint('review') }],
    excluded: [],
    included: [{ itemId: row.itemId, jobId: row.rawJobId, sourceId: id, sourceRevision: 1, sourceSha256: hash,
      bytes: bytes.length, resultSha256: row.rawResultSha256,
      coverage: { state: 'closed', eligible: 1, read: 1, failed: 0, unread: 0, keyless: 0 } }],
    additions: { kind: 'citations', linkManifestSha256: fingerprint('links'), decisions: [{ decision: 'accept',
      targetId, candidateId: randomUUID(), candidateSha256: fingerprint('candidate'), evidence: row }] },
    profileId: randomUUID(), profileSha256: fingerprint('profile'), requestKey: randomUUID(),
    acknowledgement: 'test_only' } };
  const state = { confirmations: [confirmation] };
  f.sources.set(id, source);
  f.state.extra = (sql, args) => {
    if (sql.includes('FROM usp_intake_evidence_confirmations')) {
      return state.confirmations.filter(item => item.case_id === args[0] && item.subject === args[1]
        && item.additions === 'citations' && contains(item.pins.included, JSON.parse(args[2]))
        && contains(item.pins.additions.decisions, JSON.parse(args[3]))).map(() => ({}));
    }
    if (sql.includes('SELECT accepted_fence FROM usp_job_metadata')) return [{ accepted_fence: 1 }];
    return null;
  };
  return { f, source, bytes, row, state, confirmation };
}

/** Protocol-only receipt shape from intake-large-steps.test.ts; no map bytes or semantic records are created. */
function retainedStreamedMap() {
  const f = recordedSourceControl(), id = randomUUID(), bytes = 43263076, hash = 'c'.repeat(64);
  const input = { version: 'geojson-stream/2', jobId: randomUUID(), caseId: f.caseRow.id, sourceId: id,
    sourceRevision: 1, sourceBytes: bytes, sourceSha256: hash, framing: 'feature-collection',
    objectKey: `large-originals/${id}/${hash}` } as StreamingVectorInput;
  const receipt = sealedMapReceipt(input, { bytes, sha256: hash, features: 1,
    metadata: { type: 'FeatureCollection' } }, [{ chunk_index: 0, first_feature_index: 0, last_feature_index: 0,
    records: 1, accepted: 1, quarantined: 0, published: true, result_sha256: hash }]);
  const source = { id, case_id: f.caseRow.id, family_id: id, revision: 1, name: 'protocol-streamed.geojson',
    profile: 'large-original-v1', status: 'ready', bytes, sha256: hash, object_key: input.objectKey,
    inspection: { status: 'needs_input', streamedMapReceipt: receipt, largeOriginal: {
      uploadId: randomUUID(), operatorSubject: subject, objectEtag: hash, verifiedSha256: hash, verifiedBytes: bytes,
      provenance: { origin: 'not_stated', acquiredAt: '2026-10-21T00:00:00.000Z', state: 'not_stated' },
      conversion: 'unsupported', bundleCompleteness: 'single_original_only_archive_dependencies_not_assessed' } } };
  const state = { confirmationLookups: 0 };
  f.sources.set(id, source);
  f.state.extra = sql => {
    if (!sql.includes('FROM usp_intake_evidence_confirmations')) return null;
    state.confirmationLookups++;
    return [];
  };
  assert(isRetainedMapOriginal(source));
  assertIntakeSource(source, ingestionBinding(source.case_id));
  return { f, source, state };
}

/** The act 1 footprints row and the recorded building citing it, with the keys and nesting read from ulpin-reh-02
 * (RC2): the batch drafted from this GeoJSON recipe original, which stayed needs_input. Values are protocol-only. */
function draftedFootprints() {
  const f = recordedSourceControl(), id = randomUUID(), hash = 'b'.repeat(64), bytes = 1103282;
  const source = { id, case_id: f.caseRow.id, family_id: id, revision: 1, name: 'protocol-footprints.geojson',
    profile: 'geojson-manual-v1', mime_type: 'application/geo+json', bytes, sha256: hash,
    object_key: `sources/${id}/${hash}`, status: 'needs_input', created_at: '2026-10-22T11:20:00.000Z',
    inspection: { actor: subject, status: 'needs_input', profile: 'geojson-manual-v1', issues: [],
      summary: 'test_only', manualProfile: { version: 'manual-geojson/1', format: 'geojson',
        crs: { value: 'EPSG:4326', unit: 'degree', evidence: 'test_only' }, paths: [], limitations: [],
        featureCount: 1, geometryTypes: ['Polygon'], schemaFingerprint: fingerprint('schema') },
      gis: { bytes, format: 'geojson', sourceSha256: hash, sourceCrs: 'EPSG:4326', crsUnit: 'degree',
        crsEvidence: 'test_only', featureCount: 1, featureIdEligible: true, featureIntegerIdEligible: true,
        fields: [], geometryTypes: ['Polygon'], layer: null, layers: [], suggestedIdField: 'id',
        suggestedNameField: null, suggestedNamespace: 'test_only', suggestedTitle: 'test_only',
        quarantine: { version: 'test_only', sourceSha256: hash, total: 1, accepted: 1, rejected: 0,
          complete: true, rejections: [], message: 'test_only' } } } };
  const recordId = randomUUID();
  const body = { id: recordId, siteId: f.siteId, kind: 'building', revision: 1, identifier: 'BLD-PROTOCOL',
    alias: 'b1', name: 'test_only', representation: 'physical_exterior', synthetic: false, links: [], rights: [],
    footprint: [], evidence: [{ sourceId: id, locator: 'feature 1' }] };
  f.sources.set(id, source);
  f.state.extra = (sql, args) => sql.includes('FROM registry_records r LEFT JOIN usp_project_codes')
    ? [{ id: recordId, site_id: f.siteId, kind: 'building', revision: 1, body, project_status: null }]
      .filter(row => row.id === args[0] && row.site_id === args[1])
    : null;
  assert(isRetainedMapOriginal(source));
  return { f, source, record: body as unknown as RegistryRecord };
}

test('retained streamed map sources keep ordinary and citation access without a table confirmation',
  () => attributed(async () => {
    const { f, source, state } = retainedStreamedMap();
    for (const status of ['ready', 'partial']) {
      source.status = status;
      assert.equal((await registrySourceTx(f.client, f.siteId, source.id)).sha256, source.sha256);
      assert.equal((await registryDocumentSourceAccessTx(f.client, f.siteId, source.id)).sha256, source.sha256);
    }
    source.status = 'needs_input';
    assert.equal((await registryDocumentSourceAccessTx(f.client, f.siteId, source.id)).sha256, source.sha256);
    await assert.rejects(() => registrySourceTx(f.client, f.siteId, source.id),
      refusal(409, 'REGISTRY_SOURCE_UNAVAILABLE'), 'the pre-existing ordinary status gate is unchanged');
    assert.equal(state.confirmationLookups, 0);
  }));

test('a geometry-free package pinning a streamed map keeps its original-only authority path',
  () => attributed(async () => {
    const { f, source, state } = retainedStreamedMap();
    f.pinned.add(source.id);
    // As before RC1, a map receipt alone does not grant document-original access to a geometry-free package.
    await assert.rejects(() => registryRecordedSourceTx(f.client, f.siteId, source.id),
      refusal(403, 'DOCUMENT_DENIED'));
    assert.equal(state.confirmationLookups, 0);
  }));

test('the batch-kept register with an accepted table row is available to the card and recorded-source read',
  { skip }, () => attributed(async () => {
    const { f, source, row } = retainedRegister();
    assert.equal(row.cell.value, '1001960');
    assert.equal((await registrySourceTx(f.client, f.siteId, source.id)).sha256, source.sha256);
    const recorded = await registryRecordedSourceTx(f.client, f.siteId, source.id);
    assert.equal(recorded.sha256, source.sha256);
    assert.equal(recorded.accessSha256, ingestionBinding(source.case_id).access);
    assert.equal(recorded.documentResult, undefined);
  }));

test('the confirmed register row is read from its retained original with exact byte, hash and memory bounds',
  { skip }, () => attributed(async () => {
    const { f, source, bytes, row } = retainedRegister();
    const reads: unknown[][] = [];
    const cited = await citedRowTx(f.client, f.siteId, row, { bytes: async (...args) => {
      reads.push(args);
      return bytes;
    } });
    assert.equal(reads.length, 1);
    assert.deepEqual(reads[0].slice(0, 3), [source.object_key, bytes.length, source.sha256]);
    assert.equal(reads[0][3], TABULAR_LIMITS.bytes);
    assert.match(cited.excerpt, /(?:^|\n)bin: 1001960(?:\n|$)/);
    assert.equal(cited.accessSha256, ingestionBinding(source.case_id).access);
    const changed = Buffer.from(bytes);
    changed[0] ^= 1;
    await assert.rejects(citedRowTx(f.client, f.siteId, row, { bytes: async () => changed }),
      refusal(409, 'STALE_REVISION'));
  }));

test('a kept original without an accepted table confirmation at its pins remains unavailable',
  { skip }, () => attributed(async () => {
    const { f, source, state, confirmation } = retainedRegister();
    const read = () => registryRecordedSourceTx(f.client, f.siteId, source.id);
    for (const change of [
      () => { state.confirmations = []; },
      () => { confirmation.subject = 'another-operator'; },
      () => { confirmation.pins.additions.decisions[0].decision = 'reject'; },
      () => { confirmation.pins.additions.decisions[0].evidence.sourceRevision++; },
      () => { confirmation.pins.additions.decisions[0].evidence.sourceSha256 = '0'.repeat(64); },
      () => { confirmation.pins.included[0].sourceSha256 = '0'.repeat(64); },
    ]) {
      const saved = structuredClone(confirmation);
      change();
      await assert.rejects(read, refusal(409, 'REGISTRY_SOURCE_UNAVAILABLE'));
      await assert.rejects(() => registryDocumentSourceAccessTx(f.client, f.siteId, source.id),
        refusal(409, 'REGISTRY_SOURCE_UNAVAILABLE'));
      Object.assign(confirmation, saved);
      state.confirmations = [confirmation];
    }
  }));

test('a confirmed batch table still refuses another site, archived case, operator and changed receipt',
  { skip }, () => attributed(async () => {
    const { f, source } = retainedRegister();
    const read = () => registryRecordedSourceTx(f.client, f.siteId, source.id);
    await assert.rejects(() => registrySourceTx(f.client, randomUUID(), source.id),
      refusal(403, 'REGISTRY_SOURCE_DENIED'));
    f.caseRow.archived = true;
    await assert.rejects(read, refusal(403, 'REGISTRY_SOURCE_DENIED'));
    f.caseRow.archived = false;
    source.inspection.largeOriginal.operatorSubject = 'another-operator';
    await assert.rejects(read, refusal(403, 'REGISTRY_SOURCE_DENIED'));
    source.inspection.largeOriginal.operatorSubject = subject;
    const original = structuredClone(source);
    for (const change of [
      () => { source.sha256 = '0'.repeat(64); },
      () => { source.bytes++; },
      () => { source.object_key = `large-originals/${randomUUID()}/${source.sha256}`; },
    ]) {
      change();
      await assert.rejects(read, refusal(422, 'INTAKE_SOURCE_INTEGRITY'));
      Object.assign(source, structuredClone(original));
    }
    delete (source.inspection as Record<string, unknown>).largeOriginal;
    await assert.rejects(read, refusal(403, 'INTAKE_SOURCE_DENIED'));
    Object.assign(source, structuredClone(original));
    f.pinned.add(source.id);
    assert.equal((await read()).sha256, source.sha256, 'upload authority is not document-only package authority');
  }));

test('the recorded building citing its batch-drafted footprints opens for its confirmed citations',
  () => attributed(async () => {
    const { f, source, record } = draftedFootprints();
    const current = await assertRegistryCurrentCitationTargetTx(f.client, f.siteId, record, true);
    assert.equal(current.body.evidence[0].sourceId, source.id);
    assert.equal((await registrySourceTx(f.client, f.siteId, source.id)).sha256, source.sha256);
    const recorded = await registryRecordedSourceTx(f.client, f.siteId, source.id);
    assert.equal(recorded.accessSha256, ingestionBinding(source.case_id).access);
    assert.equal(source.status, 'needs_input');
  }));

test('batch-drafted footprints still refuse another site, archived case, operator and changed receipt',
  () => attributed(async () => {
    const { f, source, record } = draftedFootprints();
    const open = () => assertRegistryCurrentCitationTargetTx(f.client, f.siteId, record, true);
    await assert.rejects(() => registrySourceTx(f.client, randomUUID(), source.id),
      refusal(403, 'REGISTRY_SOURCE_DENIED'));
    f.caseRow.archived = true;
    await assert.rejects(open, refusal(403, 'REGISTRY_SOURCE_DENIED'));
    f.caseRow.archived = false;
    source.inspection.actor = 'another-operator';
    await assert.rejects(open, refusal(403, 'REGISTRY_SOURCE_DENIED'));
    const original = structuredClone({ ...source, inspection: { ...source.inspection, actor: subject } });
    for (const change of [
      () => { source.sha256 = '0'.repeat(64); },
      () => { source.inspection.manualProfile.version = 'manual-tabular/1'; },
    ]) {
      Object.assign(source, structuredClone(original));
      change();
      await assert.rejects(open, refusal(409, 'REGISTRY_SOURCE_UNAVAILABLE'));
    }
    Object.assign(source, structuredClone(original));
    assert.equal((await open()).id, record.id);
  }));
