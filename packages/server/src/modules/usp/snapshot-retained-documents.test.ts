import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { DocumentInput } from '@ulpin/contracts/usp';
import { transaction } from '../../infrastructure/db';
import { fingerprint } from '../cases/domain';
import { captureDocumentSourceTx } from './ingestion/document-authority';
import { documentInput, documentSourceTx } from './ingestion/document-context';
import { readManifest } from './snapshots';
import { control, errorCode, type SourceFixture } from './source-stated-identity.test-fixture';

const digest = 'e'.repeat(64);
const movedOnReader = '0'.repeat(64);
const globals = globalThis as unknown as { ulpinPool?: unknown };

/** Answers the document job reads from memory; every other statement stays with the existing protocol double. */
function withJobs(f: SourceFixture) {
  const jobs = new Map<string, Record<string, unknown>>();
  const query = async (sql: string, values: any[] = []) => {
    if (!/\bFROM jobs\b/.test(sql)) return f.memory.query(sql, values);
    const rows = jobs.has(values[0]) ? [structuredClone(jobs.get(values[0]))] : [];
    return { rows, rowCount: rows.length };
  };
  globals.ulpinPool = { connect: async () => ({ query, release() {} }), query };
  const store = (input: DocumentInput) => jobs.set(input.jobId, { payload: input, status: 'succeeded',
    input_fingerprint: fingerprint(input), input_sha256: fingerprint(input), logical_state: 'succeeded',
    result_ref: { sha256: digest } });
  return { store };
}

/** A second document original on the tower's site that no recorded tower fact cites, with an accepted reading. */
async function retainSameSiteDocument(f: SourceFixture, store: (input: DocumentInput) => unknown) {
  const id = randomUUID();
  const jobId = randomUUID();
  const source = { id, case_id: f.memory.sources[0].case_id, family_id: id, revision: 1, sha256: digest, bytes: 1,
    object_key: 'memory-only-no-object-read/boundary', inspection: { documentOriginal: {
      version: 'source-document/1', subject: process.env.ULPIN_LOCAL_OPERATOR_SUBJECT, format: 'pdf',
      sha256: digest, bytes: 1, receivedAt: '2026-10-09T23:19:53Z' },
    documentAccepted: { jobId, sha256: digest } } };
  f.memory.sources.push(source);
  const context = await transaction(client => documentSourceTx(client, source.case_id, id));
  const input = documentInput(context, jobId, 'native_only');
  store(input);
  return { id, input };
}
const sourceMember = (manifest: { members: readonly any[] }, id: string) =>
  manifest.members.find(member => member.pin.ref.namespace === 'source_revision' && member.pin.ref.id === id);

test('a snapshot of a cited target succeeds beside a same-site document whose reader moved on, and says so',
  () => control(async f => {
    const { store } = withJobs(f);
    const boundary = await retainSameSiteDocument(f, store);
    const current = await f.capture();
    assert.equal(sourceMember(current, boundary.id).documentResult, undefined);

    store({ ...boundary.input, readerSha256: movedOnReader });
    const manifest = await f.capture();
    assert.deepEqual(sourceMember(manifest, boundary.id).documentResult,
      { current: false, reasons: ['reader_changed'] });
    assert.equal(sourceMember(manifest, boundary.id).bodySha256, sourceMember(current, boundary.id).bodySha256);
    for (const original of f.memory.sources.slice(0, 4)) {
      assert.equal(sourceMember(manifest, original.id).documentResult, undefined);
    }
    assert(manifest.members.some(member => member.pin.ref.id === f.recorded.spaceId));
    assert.equal((await readManifest(f.ctx, manifest.scope)).digest, manifest.digest);
  }));

test('a write that derives from the same document result still needs current pins', () => control(async f => {
  const { store } = withJobs(f);
  const boundary = await retainSameSiteDocument(f, store);
  store({ ...boundary.input, readerSha256: movedOnReader });
  const source = f.memory.sources.find(item => item.id === boundary.id);
  await assert.rejects(transaction(client => captureDocumentSourceTx(client, source)), errorCode('STALE_REVISION'));
}));

test('an archived case or another operator\'s document result still refuses the snapshot', () => control(async f => {
  const { store } = withJobs(f);
  const boundary = await retainSameSiteDocument(f, store);
  store({ ...boundary.input, readerSha256: movedOnReader, subject: 'another-operator' });
  await assert.rejects(f.capture(), errorCode('DOCUMENT_DENIED'));
  store({ ...boundary.input, readerSha256: movedOnReader });
  f.memory.archived = true;
  await assert.rejects(f.capture(), errorCode('DOCUMENT_DENIED'));
  f.memory.archived = false;
  assert.equal((await f.capture()).selection.kind, 'targets');
}));
