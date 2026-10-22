import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { TABULAR_LIMITS } from '@ulpin/contracts/usp';
import { sha256 } from '../../infrastructure/storage';
import { fingerprint } from '../cases/domain';
import { ingestionBinding } from '../usp/ingestion/events';
import { rowCells } from '../usp/ingestion/intake-evidence';
import { readTabularSource } from '../usp/ingestion/tabular-source';
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
  const confirmation = { case_id: source.case_id, subject, additions: 'citations', pins: {
    included: [{ itemId: row.itemId, sourceId: id, sourceRevision: 1, sourceSha256: hash, bytes: bytes.length }],
    additions: { kind: 'citations', decisions: [{ decision: 'accept', evidence: row }] } } };
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
