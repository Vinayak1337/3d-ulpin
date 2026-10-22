import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PoolClient } from 'pg';
import type { ImportPackage, MapArea } from '@ulpin/contracts';
import { bindRetainedCaseTx } from '../../areas/areas';
import { areaProposals } from '../../areas/area-display-proposals';
import { assertIntakePackagePressureTx, draftIntakePartTx } from './intake-part-draft';
import type { ProvedAreaPartInput } from './proved-area-part';
import { localOperatorSubject } from '../principal';
import { sealedMapReceipt } from './streamed-map-receipt';
import type { StreamingVectorInput } from '@ulpin/contracts/usp';
import { publishIntakePartTx } from './intake-ledger';

test('current one-site source authority blocks a second cell area and its map proposal', async context => {
  const previous = process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = 'cw2-protocol-only';
  context.after(() => {
    if (previous === undefined) delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
    else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = previous;
  });
  const feature = { id: 'protocol-feature', sourceKey: 'protocol-key', areaId: 'protocol-second-area',
    revision: 0, sourceRevisionId: 'protocol-source' };
  const source = { id: 'protocol-source', case_id: 'protocol-case', site_id: 'protocol-first-site', archived: false };
  const client = { query: async (sql: string) => {
    if (sql.startsWith('SELECT id,site_id,archived,frame FROM cases')) return { rows: [{
      id: source.case_id, site_id: source.site_id, archived: false, frame: { id: 'UNASSIGNED' } }] };
    if (sql.startsWith('SELECT id,revision FROM physical_features')) return { rows: [feature] };
    if (sql.startsWith('SELECT s.*,c.archived,c.site_id FROM sources')) return { rows: [source] };
    throw new Error(`Unexpected write or query: ${sql}`);
  } } as unknown as PoolClient;
  await assert.rejects(bindRetainedCaseTx(client, source.case_id, { id: 'protocol-second-site' }),
    { status: 403, code: 'AREA_SOURCE_DENIED' });
  const pkg = { id: 'protocol-package', datasetNamespace: 'protocol-cell', state: 'READY_FOR_REVIEW',
    sourceRevisionIds: [source.id], features: [feature] } as unknown as ImportPackage;
  const area = { id: feature.areaId, siteId: 'protocol-second-site' } as MapArea;
  assert.deepEqual(await areaProposals(client, area, [pkg]), []);
});

test('a file admits seven unfinished package drafts but refuses the ninth', async () => {
  let unfinished = 7;
  const client = { query: async (sql: string) => {
    assert(sql.includes("part.state IN ('queued','running')"));
    assert(sql.includes('IS DISTINCT FROM'));
    return { rows: [{ n: unfinished }] };
  } } as PoolClient;
  await assertIntakePackagePressureTx(client, 'protocol-item');
  unfinished = 8;
  await assert.rejects(assertIntakePackagePressureTx(client, 'protocol-item'),
    (error: any) => error.code === 'INTAKE_PACKAGE_PRESSURE' && error.status === 429);
});

function closureProtocol(sourceId: string, hash: string) {
  const source = { id: sourceId, case_id: sourceId, family_id: sourceId, revision: 1, bytes: 1234,
    sha256: hash, profile: 'large-original-v1', object_key: 'protocol-original', name: 'protocol.geojson',
    status: 'needs_input', inspection: { largeOriginal: { uploadId: sourceId,
      operatorSubject: localOperatorSubject(), objectEtag: 'protocol-etag', verifiedSha256: hash, verifiedBytes: 1234,
      conversion: 'unsupported', bundleCompleteness: 'single_original_only_archive_dependencies_not_assessed',
      provenance: { issuer: 'Protocol test issuer', originalUrl: 'https://example.invalid/protocol',
        acquiredAt: '2026-10-11T00:00:00.000Z', permissionReference: 'Protocol only', limitations: [],
        state: 'caller_declared' } } } };
  const mapped = { source_id: sourceId, source_revision: 1, sealed_chunks: 1, next_publish_index: 1,
    records: 1, unknown_remainder: true, state: 'completed', raw_parts: 1, raw_records: 1,
    raw_unknown: false, raw_state: 'completed', payload: {
      sourceSha256: hash, planHash: hash, route: 'approved_recipe', rawJobId: sourceId } };
  const client = { query: async (sql: string) => {
    if (sql.startsWith('SELECT case_id FROM usp_intake_items')) return { rows: [{ case_id: sourceId }] };
    if (sql.startsWith('SELECT id,revision,archived FROM cases')) return { rows: [{ id: sourceId, revision: 0 }] };
    if (sql.startsWith('SELECT * FROM sources')) return { rows: [source] };
    if (sql.startsWith('SELECT pg_advisory')) return { rows: [] };
    if (sql.startsWith('SELECT * FROM usp_intake_items')) return { rows: [{ source_id: sourceId, case_id: sourceId }] };
    if (sql.startsWith('SELECT m.*')) return { rows: [mapped] };
    if (sql.startsWith('SELECT first_feature_index')) return { rows: [{ first_feature_index: 0,
      later_feature_index: 2001 }] };
    throw new Error(`Unexpected statement before closure or key refusal: ${sql}`);
  } } as PoolClient;
  return { source, mapped, client };
}

test('no closure makes no package or target; both duplicate positions refused', async context => {
  const previous = process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = 'lp3a-protocol-only';
  context.after(() => {
    if (previous === undefined) delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
    else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = previous;
  });
  const sourceId = '11111111-1111-4111-8111-111111111111', hash = 'a'.repeat(64);
  const { source, mapped, client } = closureProtocol(sourceId, hash);
  const input = { sourceId, sourceRevision: 1, sourceSha256: hash, layoutHash: hash,
    features: [{ featureIndex: 0 }] } as ProvedAreaPartInput;
  await assert.rejects(draftIntakePartTx(client, sourceId, sourceId, input), /The file is still being read/);
  (source.inspection as Record<string, unknown>).streamedMapReceipt = sealedMapReceipt({
    sourceId, sourceRevision: 1, sourceBytes: 1234, sourceSha256: hash, jobId: sourceId,
    framing: 'feature-collection', version: 'geojson-stream/2',
  } as StreamingVectorInput, { bytes: 1234, sha256: hash, features: 1, metadata: { type: 'FeatureCollection' } },
  [{ chunk_index: 0, first_feature_index: 0, last_feature_index: 0, records: 1, accepted: 1,
    quarantined: 0, published: true, result_sha256: hash }]);
  await assert.rejects(draftIntakePartTx(client, sourceId, sourceId, input), /has not closed/);
  mapped.unknown_remainder = false;
  mapped.raw_unknown = true;
  await assert.rejects(draftIntakePartTx(client, sourceId, sourceId, input), /has not closed/);
  mapped.raw_unknown = false;
  await assert.rejects(draftIntakePartTx(client, sourceId, sourceId, input), /Both occurrences/);
});

test('an exact published-part replay is write-free; changed locator/package is refused', async () => {
  const pkg = { id: 'protocol-package', sourceRevisionIds: ['protocol-source'] } as ImportPackage;
  const locator = { cutIndex: 0, featureIndices: [0, 2], cellResume: {
    version: 'intake-cell-cuts/1', index: 1, previous: 7, open: [[1, 5], [3, 7]] } }, counts = { features: 2 };
  let changed = false, writes = 0;
  const client = { query: async (sql: string) => {
    if (sql.startsWith('SELECT * FROM usp_intake_items')) return { rows: [{ source_id: 'protocol-source' }] };
    if (sql.startsWith('SELECT * FROM usp_intake_parts')) return { rows: [{ state: 'published',
      locator: changed ? { ...locator, cellResume: { ...locator.cellResume, open: [[1], [3, 7]] } } : locator,
      counts, result_ref: { packageId: pkg.id } }] };
    writes++;
    throw new Error('Unexpected write');
  } } as PoolClient;
  await publishIntakePartTx(client, 'protocol-item', 0, pkg, locator, counts);
  assert.equal(writes, 0);
  changed = true;
  await assert.rejects(publishIntakePartTx(client, 'protocol-item', 0, pkg, locator, counts), /exact replay/);
  assert.equal(writes, 0);
});
