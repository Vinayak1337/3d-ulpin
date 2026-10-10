import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { assertDocumentInputTx } from '../usp/ingestion/document-context';
import { registryRecordedSourceTx, registrySourceTx } from './registry-metadata';
import {
  acceptResult, attributed, citation, digest, movedOnReader, recordedOriginal, recordedSourceControl as control,
  refusal, retainOriginal, storeJob,
} from './registry-recorded-source.test-fixture';

test('a recorded original reads the same after its document reader hash changed, with freshness stated',
  () => attributed(async () => {
    const f = control();
    const { source, input } = recordedOriginal(f);
    const before = await registryRecordedSourceTx(f.client, f.siteId, source.id);
    assert.equal(before.documentResult, undefined);
    storeJob(f, { ...input, readerSha256: movedOnReader });
    const after = await registryRecordedSourceTx(f.client, f.siteId, source.id);
    assert.deepEqual(citation(after), citation(before));
    assert.deepEqual(after.documentResult, { current: false, reasons: ['reader_changed'] });
  }));

test('a recorded original reads the same after a later import advanced its case revision',
  () => attributed(async () => {
    const f = control();
    const { source } = recordedOriginal(f);
    const before = await registryRecordedSourceTx(f.client, f.siteId, source.id);
    retainOriginal(f);
    f.caseRow.revision += 1;
    const after = await registryRecordedSourceTx(f.client, f.siteId, source.id);
    assert.deepEqual(citation(after), citation(before));
    assert.deepEqual(after.documentResult, { current: false, reasons: ['case_advanced'] });
  }));

test('a recorded original that never had an accepted reading is readable and states no freshness',
  () => attributed(async () => {
    const f = control();
    const source = retainOriginal(f);
    f.pinned.add(source.id);
    const read = await registryRecordedSourceTx(f.client, f.siteId, source.id);
    assert.deepEqual(citation(read), citation(source));
    assert.equal(read.documentResult, undefined);
  }));

test('a new derivation or ordinary recording under changed pins is still refused', () => attributed(async () => {
  const f = control();
  const { source, input } = recordedOriginal(f);
  const stale = { ...input, readerSha256: movedOnReader };
  storeJob(f, stale);
  await assert.rejects(() => assertDocumentInputTx(f.client, stale), refusal(409, 'STALE_REVISION'));
  await assert.rejects(() => registrySourceTx(f.client, f.siteId, source.id),
    refusal(409, 'REGISTRY_SOURCE_UNAVAILABLE'));
}));

test('a converted source reads under its parent document result; a write still needs current pins',
  () => attributed(async () => {
    const f = control();
    const parent = retainOriginal(f);
    const input = acceptResult(f, parent);
    storeJob(f, { ...input, readerSha256: movedOnReader });
    const copy = { ...parent, id: randomUUID(), status: 'ready', inspection: { copiedFrom: { caseId: parent.case_id,
      sourceRevisionId: parent.id, sourceHash: parent.sha256, sourceRevision: parent.revision } } };
    f.sources.set(copy.id, copy);
    await assert.rejects(() => registrySourceTx(f.client, f.siteId, copy.id), refusal(409, 'STALE_REVISION'));
    const read = await registryRecordedSourceTx(f.client, f.siteId, copy.id);
    assert.deepEqual(citation(read), citation(copy));
    assert.deepEqual(read.documentResult, { current: false, reasons: ['reader_changed'] });
  }));

test('an archived case, a changed original, another site and another operator still refuse the read',
  () => attributed(async () => {
    const f = control();
    const { source, input } = recordedOriginal(f);
    const read = () => registryRecordedSourceTx(f.client, f.siteId, source.id);
    f.caseRow.archived = true;
    await assert.rejects(read, refusal(403, 'DOCUMENT_DENIED'));
    f.caseRow.archived = false;
    source.sha256 = 'd'.repeat(64);
    await assert.rejects(read, refusal(422, 'DOCUMENT_SOURCE_INTEGRITY'));
    source.sha256 = digest;
    await assert.rejects(() => registryRecordedSourceTx(f.client, randomUUID(), source.id),
      refusal(403, 'SOURCE_BUILDING_DENIED'));
    storeJob(f, { ...input, subject: 'another-operator' });
    await assert.rejects(read, refusal(403, 'DOCUMENT_DENIED'));
    storeJob(f, input);
    assert.deepEqual(citation(await read()), citation(source));
  }));
