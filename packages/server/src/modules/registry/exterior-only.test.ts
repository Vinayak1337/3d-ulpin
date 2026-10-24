import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { PoolClient } from 'pg';
import { exteriorOnlySql, isExteriorOnly } from './exterior-only';
import { importRegistryCase } from './registry-seed';
import { bodyOnly, commitRegistryReviewTx, persistRegistryReviewTx, prepareRegistryReview,
  recordBodySchema } from './registry';
import type { assertRegistryDocumentCitationsTx, RegistryDocumentDependencies } from './registry-document-evidence';
import { readRegistryRecordEvidenceTx } from './registry-record-evidence';
import { attributed, subject } from './registry-recorded-source.test-fixture';
import { tableRowCitation } from './registry-table-evidence';
import { rowCells } from '../usp/ingestion/intake-evidence';
import { readTabularSource } from '../usp/ingestion/tabular-source';
import { setPreparationPlacement } from '../officer/officer-preparation';
import { fingerprint } from '../cases/domain';
import { settings } from '../../infrastructure/config';
import { sha256 } from '../../infrastructure/storage';

const stamp = '2026-10-11T00:00:00.000Z';
const frame = { id: 'TEST', horizontalUnit: 'm', verticalUnit: 'm', benchmark: 'unknown' };
const ring = [[0, 0], [2, 0], [2, 2], [0, 2]];
const exterior = {
  alias: 'control', name: 'Technical control', kind: 'building', synthetic: false,
  representation: 'physical_exterior', footprint: [], links: [], rights: [], evidence: [],
};

async function memoryPool<T>(query: (sql: string, args: any[]) => Promise<any>, work: () => Promise<T>) {
  const globals = globalThis as any;
  const previous = globals.ulpinPool;
  globals.ulpinPool = { connect: async () => ({ query, release() {} }) };
  try { return await work(); } finally { globals.ulpinPool = previous; }
}

// A SQL-shape control, not a PostgreSQL execution or durability qualification.
function sqlExterior(body: any, alias = 'r') {
  assert.equal(exteriorOnlySql(alias), `COALESCE(${alias}.body->>'representation' = 'physical_exterior'`
    + ` AND ${alias}.body->'footprint' = '[]'::jsonb`
    + ` AND COALESCE(${alias}.body->'geometry', 'null'::jsonb) = 'null'::jsonb, false)`);
  return body.representation === 'physical_exterior' && JSON.stringify(body.footprint) === '[]'
    && (body.geometry ?? null) === null;
}

test('exterior-only body and SQL conditions agree, including missing fields under NOT', () => {
  for (const [body, expected] of [
    [exterior, true], [{ ...exterior, geometry: null }, true],
    [{ ...exterior, footprint: ring }, false], [{ ...exterior, geometry: {} }, false],
    [{ footprint: [] }, false], [{ representation: 'physical_exterior' }, false],
    [{ ...exterior, footprint: null }, false], [{ ...exterior, representation: null }, false],
    [{ ...exterior, geometry: false }, false],
  ] as const) {
    assert.equal(isExteriorOnly(body), expected);
    assert.equal(sqlExterior(body), expected);
  }
  assert.throws(() => exteriorOnlySql('r; DROP TABLE'), /alias/);
});

test('first detailed datum ignores only citation-only peers; actual and malformed detail still blocks', async () => {
  for (const [peer, blocked] of [[exterior, false], [{ ...exterior, footprint: ring }, true],
    [{ ...exterior, geometry: {} }, true], [{ footprint: [] }, true]] as const) {
    const site = { id: randomUUID(), frame: { ...frame }, revision: 1 };
    const pkg = { id: randomUUID(), areaId: randomUUID(), revision: 1, sourceRevisionIds: [], parts: [], warnings: [] };
    const prep = { id: randomUUID(), areaId: pkg.areaId, caseId: randomUUID(), buildingId: randomUUID(),
      revision: 1, placement: { revision: 1 } };
    let updated = false;
    const query = async (sql: string, args: any[]) => {
      let rows: any[] = [];
      if (sql.includes('FROM building_preparations')) rows = [{ body: structuredClone(prep) }];
      else if (sql.includes('FROM registry_sites')) rows = [structuredClone(site)];
      else if (sql.includes('FROM import_packages')) rows = [{ body: structuredClone(pkg) }];
      else if (sql.includes('SELECT id FROM sources')) rows = [{ id: args[0] }];
      else if (sql.includes('FROM physical_features')) rows = [{ body: { sourceKey: 'control' } }];
      else if (sql.includes('FROM registry_records')) {
        assert(sql.includes(`AND NOT ${exteriorOnlySql('r')}`));
        rows = sqlExterior(peer) ? [] : [{ '?column?': 1 }];
      } else if (sql.startsWith('UPDATE registry_sites')) updated = true;
      else assert(/^(BEGIN|COMMIT|ROLLBACK|SELECT pg_advisory|SELECT id FROM cases|UPDATE|INSERT)/.test(sql), sql);
      return { rows };
    };
    const work = () => setPreparationPlacement(pkg.id, 1, {
      sourceFrame: frame.id, verticalReference: 'technical reviewed datum', verticalOffset: 0,
      evidence: [{ sourceRevisionId: randomUUID(), featureId: 'control' }], reason: 'Technical control',
    });
    await memoryPool(query, async () => {
      if (blocked) await assert.rejects(work, (error: any) => error.code === 'EXISTING_DATUM');
      else assert.equal((await work()).placement.status, 'reviewed');
    });
    assert.equal(updated, !blocked);
  }
});

test('detailed import at revision one keeps identity, rights, metadata and history without the marker', async () => {
  const site = { id: randomUUID(), identifier: 'technical site', frame, revision: 1, synthetic: false };
  const caseId = randomUUID(), sourceId = randomUUID();
  const modelId = randomUUID(), recordId = randomUUID();
  const evidence = { sourceId, locator: 'feature control' };
  const registryMetadata = { address: { country: { state: 'unknown', value: null,
    evidence: [{ sourceId, sourceRevision: 1, sourceSha256: 'a'.repeat(64), locator: 'feature control' }] } } };
  const body = { ...exterior, evidence: [evidence], registryMetadata,
    rights: [{ type: 'ownership_claim', party: 'Technical control', evidence }] };
  const stored = { id: recordId, site_id: site.id, identifier: 'technical identity',
    kind: 'building', revision: 1, body };
  const before = structuredClone(stored);
  const model = { id: modelId, revision: 1, units: [], inputFingerprint: 'technical input',
    context: [{ alias: 'control', kind: 'building', footprint: ring, evidence }] };
  let imported: any[] = [];
  const query = async (sql: string, args: any[]) => {
    let rows: any[] = [];
    if (sql.includes('FROM cases')) rows = [{ id: caseId, revision: 1, site_id: site.id, frame,
      current_snapshot_id: modelId, created_at: stamp, updated_at: stamp }];
    else if (sql.includes('FROM sources')) rows = [{ id: sourceId, family_id: randomUUID(), created_at: stamp }];
    else if (sql.includes('FROM snapshots')) rows = [{ body: model }];
    else if (sql.includes('FROM registry_sites')) rows = [site];
    else if (sql.includes('FROM registry_case_feature_mappings')) rows = [{ record_id: recordId }];
    else if (sql.includes('FROM registry_records')) rows = [stored];
    else if (sql.startsWith('INSERT INTO registry_drafts')) imported = JSON.parse(args[3]);
    else assert(!/^(UPDATE registry_records|INSERT INTO registry_revisions)/.test(sql), sql);
    return { rows };
  };
  await memoryPool(query, () => importRegistryCase(site.id, caseId, 1));
  assert.equal(imported.length, 1);
  assert.equal(imported[0].representation, undefined);
  for (const key of ['id', 'identifier', 'revision']) assert.equal(imported[0][key], (stored as any)[key]);
  assert.deepEqual(imported[0].rights, body.rights);
  assert.deepEqual(imported[0].registryMetadata, body.registryMetadata);
  assert.deepEqual(stored, before);
  assert(recordBodySchema.safeParse(bodyOnly(imported[0])).success);
});

function reviewControl(peerBody: any = exterior, proposedBody?: any) {
  const site = { id: randomUUID(), identifier: 'technical site', name: 'Technical control',
    frame, revision: 1, synthetic: false };
  const caseId = randomUUID(), sourceId = randomUUID();
  const detailedBody = { alias: 'detailed', name: 'Technical detailed control', kind: 'building',
    footprint: ring, synthetic: false, links: [], rights: [], evidence: [{ sourceId, locator: 'feature detailed' }] };
  const proposed = { ...(proposedBody ?? detailedBody), id: randomUUID(), siteId: site.id,
    identifier: 'technical detail', revision: 0 };
  const peer = { id: randomUUID(), site_id: site.id, identifier: 'technical exterior', revision: 1, body: peerBody };
  const draft = { id: randomUUID(), site_id: site.id, case_id: caseId, revision: 1, status: 'draft',
    records: [proposed], created_at: stamp };
  const combined = [proposed];
  const review = { id: randomUUID(), draftId: draft.id, draftRevision: 1, siteRevision: 1,
    records: [proposed], before: [], findings: [], committed: false,
    inputFingerprint: fingerprint({ validatorVersion: 'registry-relationships-v2', records: combined,
      frame, draftRevision: 1, siteRevision: 1 }) };
  const queries: string[] = [];
  const query = async (sql: string, _args: any[]) => {
    queries.push(sql);
    let rows: any[] = [];
    if (sql.includes('FROM registry_sites')) rows = [site];
    else if (sql.includes('FROM registry_drafts')) rows = [draft];
    else if (sql.includes('FROM registry_reviews')) rows = [{ draft_id: draft.id, body: review, committed: false }];
    else if (sql.includes('FROM registry_records')) rows = [peer];
    else if (sql.includes('FROM sources')) rows = [{ id: sourceId, status: 'ready', profile: 'levels-csv-v1',
      case_id: caseId, created_at: stamp }];
    else assert(/^(SELECT|UPDATE|INSERT|DELETE|BEGIN|COMMIT|ROLLBACK|SET)/.test(sql), sql);
    return { rows, rowCount: rows.length };
  };
  const snapshot = { d: { id: draft.id, siteId: site.id, caseId, revision: 1, status: 'draft',
    records: draft.records, createdAt: stamp }, site, combined };
  return { client: { query } as unknown as PoolClient, snapshot, review, peer, queries };
}

/** Answers the registry geo check in memory with no units or findings; `onCheck` sees each payload. */
async function withGeoCheck<T>(onCheck: (payload: any) => void, work: () => Promise<T>) {
  const previous = globalThis.fetch;
  const geoUrl = Object.getOwnPropertyDescriptor(settings, 'geoUrl')!;
  const geoToken = Object.getOwnPropertyDescriptor(settings, 'geoToken')!;
  Object.defineProperty(settings, 'geoUrl', { value: 'http://technical-control.invalid', configurable: true });
  Object.defineProperty(settings, 'geoToken', { value: 'technical-control-only', configurable: true });
  globalThis.fetch = (async (_url: unknown, input: any) => {
    onCheck(JSON.parse(input.body));
    return new Response(JSON.stringify({ units: [], findings: [] }));
  }) as typeof fetch;
  try {
    return await work();
  } finally {
    globalThis.fetch = previous;
    Object.defineProperty(settings, 'geoUrl', geoUrl);
    Object.defineProperty(settings, 'geoToken', geoToken);
  }
}

test('prepare checks only detailed inputs; malformed peers and exterior proposals still fail', async () => {
  let checked = 0;
  await withGeoCheck(payload => {
    assert.equal(payload.records.length, 1);
    assert.equal(payload.records[0].alias, 'detailed');
    checked++;
  }, async () => {
    const control = reviewControl();
    await memoryPool(control.client.query.bind(control.client) as any,
      () => prepareRegistryReview(control.snapshot.d.id, 1, 1));
    for (const invalid of [reviewControl({ ...exterior, footprint: ring }), reviewControl(exterior, exterior)]) {
      await memoryPool(invalid.client.query.bind(invalid.client) as any,
        () => assert.rejects(() => prepareRegistryReview(invalid.snapshot.d.id, 1, 1),
          (error: any) => error.name === 'ZodError'));
    }
  });
  assert.equal(checked, 1);
});

test('persist and commit exclude unchanged exterior peers but never bypass proposed-body checks', async () => {
  const control = reviewControl();
  const before = structuredClone(control.peer);
  await persistRegistryReviewTx(control.client, control.snapshot as any, control.review as any);
  const result = await commitRegistryReviewTx(control.client, control.review.id, 'Technical control');
  assert.equal(result.committed, true);
  assert.deepEqual(control.peer, before);
  assert.equal(control.queries.filter(sql => sql.startsWith('INSERT INTO registry_revisions')).length, 1);
  const invalid = reviewControl(exterior, exterior);
  await assert.rejects(() => persistRegistryReviewTx(invalid.client, invalid.snapshot as any, invalid.review as any));
  await assert.rejects(() => commitRegistryReviewTx(invalid.client, invalid.review.id, 'Technical control'));
});

test('a malformed non-exterior peer cannot disappear from persisted or committed review inputs', async () => {
  const invalid = reviewControl({ ...exterior, footprint: ring });
  await assert.rejects(() => persistRegistryReviewTx(invalid.client, invalid.snapshot as any, invalid.review as any),
    (error: any) => error.code === 'STALE_REVISION');
  await assert.rejects(() => commitRegistryReviewTx(invalid.client, invalid.review.id, 'Technical control'),
    (error: any) => error.code === 'STALE_REVISION');
});

const digest = 'a'.repeat(64);

/** One register row an officer's evidence confirmation accepted, with the keys read on ulpin-reh-02 (RC2). */
function registerRow(caseId: string) {
  const literal = 'technical-control';
  return {
    row: { kind: 'table_row' as const, itemId: randomUUID(), caseId, sourceId: randomUUID(), sourceRevision: 1,
      sourceSha256: digest, rawJobId: randomUUID(), rawInputSha256: digest, rawResultSha256: digest,
      acceptedFence: 1, selection: { format: 'csv' as const, sheet: 'csv', table: null, headerRows: [1] },
      sourceRow: 168, rowSha256: digest, columnIndex: 0, columnHeader: 'bin',
      cell: { state: 'literal' as const, value: literal } },
    key: { profileId: randomUUID(), profileSha256: digest, namespace: 'technical-control', kind: 'text' as const,
      literal },
    confirmation: { confirmationId: randomUUID(), candidateId: randomUUID(), candidateSha256: digest },
  };
}

/** RC2's act 1 building: recorded exterior-only at revision 1 from its batch-drafted footprints, its correction
 * adding the confirmed register row. Keys and nesting are the real ones; values are protocol-only. */
function citedExterior(footprint: number[][] = []) {
  const site = { id: randomUUID(), identifier: 'technical site', name: 'Technical control',
    frame, revision: 1, synthetic: false };
  const caseId = randomUUID(), sourceId = randomUUID(), recordId = randomUUID();
  const recorded = { ...exterior, evidence: [{ sourceId, locator: 'feature 1087575' }] };
  const current = { id: recordId, site_id: site.id, identifier: 'technical exterior', revision: 1, body: recorded };
  const target = { recordId, revision: 1, bodySha256: fingerprint(recorded) };
  const pin = tableRowCitation(registerRow(caseId), { excerpt: 'bin: technical-control', accessSha256: digest },
    target, 'technical-control');
  const proposed = { ...recorded, footprint, documentCitations: [pin], id: recordId, siteId: site.id,
    identifier: current.identifier, revision: 1 };
  const draft = { id: randomUUID(), site_id: site.id, case_id: caseId, revision: 2, status: 'draft',
    records: [proposed], created_at: stamp };
  const state: { review?: any; written?: any[] } = {};
  const query = async (sql: string, args: any[]) => {
    let rows: any[] = [];
    if (sql.startsWith('INSERT INTO registry_reviews')) {
      state.review = { id: args[0], draft_id: args[1], body: args[2], committed: false };
    } else if (sql.startsWith('UPDATE registry_records')) state.written = args;
    else if (sql.includes('FROM registry_reviews')) rows = [state.review];
    else if (sql.includes('FROM registry_sites')) rows = [site];
    else if (sql.includes('FROM registry_drafts')) rows = [draft];
    else if (sql.includes('FROM registry_records')) rows = [current];
    else if (sql.includes('FROM sources')) rows = [{ id: sourceId, status: 'ready', profile: 'levels-csv-v1',
      case_id: caseId, created_at: stamp }];
    else assert(/^(SELECT|UPDATE|INSERT|DELETE|BEGIN|COMMIT|ROLLBACK|SET)/.test(sql), sql);
    return { rows, rowCount: rows.length };
  };
  return { draft, current, proposed, pin, state, client: { query } as unknown as PoolClient };
}

/** The citation check runs on every pass; its private reads are qualified by the registry document tests. */
function citationCheck(seen: unknown[]) {
  return (async (_client: PoolClient, _siteId: string, record: { documentCitations?: unknown[] }) => {
    seen.push(record.documentCitations);
    return [];
  }) as unknown as typeof assertRegistryDocumentCitationsTx;
}

test('a recorded exterior-only building gains its confirmed register citation through review and commit',
  () => attributed(async () => {
    const control = citedExterior(), seen: unknown[] = [], checked: unknown[] = [];
    const review = await withGeoCheck(payload => checked.push(payload.records), () => memoryPool(
      control.client.query.bind(control.client) as any, () => prepareRegistryReview(control.draft.id, 2, 1,
        citationCheck(seen))));
    const result = await commitRegistryReviewTx(control.client, review.id, 'Technical control', undefined,
      citationCheck(seen));
    assert.equal(result.committed, true);
    assert.deepEqual(checked, [[]], 'the geo check never receives the exterior-only building');
    assert.deepEqual(seen, Array(3).fill([control.pin]), 'prepare, persist and commit each check the citation');
    const [id, body, revision, footprint] = control.state.written!;
    assert.deepEqual([id, revision, footprint], [control.proposed.id, 2, null]);
    assert.deepEqual(body.footprint, []);
    assert.equal(body.representation, 'physical_exterior');
    assert.deepEqual(body.documentCitations, [control.pin]);
    assert.deepEqual(body.evidence, control.proposed.evidence);
  }));

test('a correction with fewer than three footprint points keeps the strict body check', () => attributed(async () => {
  for (const footprint of [[[0, 0], [2, 0]], ring.slice(0, 1)]) {
    const control = citedExterior(footprint);
    await withGeoCheck(() => assert.fail('no geo check'), () => memoryPool(
      control.client.query.bind(control.client) as any, () => assert.rejects(
        () => prepareRegistryReview(control.draft.id, 2, 1, citationCheck([])),
        (error: any) => error.name === 'ZodError')));
  }
}));

/** The recorded building keeps its outline: only the representation marker goes, as a polygon record holds none. */
function outline(current: { body: Record<string, unknown> }) {
  const { representation: _representation, ...body } = current.body;
  current.body = { ...body, footprint: ring };
}

test('a correction cannot turn a recorded outline into an exterior-only building', () => attributed(async () => {
  const strict = (error: any) => error.name === 'ZodError';
  const refused = citedExterior();
  outline(refused.current);
  await withGeoCheck(() => assert.fail('no geo check'), () => memoryPool(
    refused.client.query.bind(refused.client) as any,
    () => assert.rejects(() => prepareRegistryReview(refused.draft.id, 2, 1, citationCheck([])), strict)));
  const changed = citedExterior();
  const review = await withGeoCheck(() => {}, () => memoryPool(changed.client.query.bind(changed.client) as any,
    () => prepareRegistryReview(changed.draft.id, 2, 1, citationCheck([]))));
  outline(changed.current);
  await assert.rejects(() => commitRegistryReviewTx(changed.client, review.id, 'Technical control', undefined,
    citationCheck([])), strict);
  assert.equal(changed.state.written, undefined, 'commit never nulls a recorded footprint');
}));

/** The confirmed register row with pins a real read of a protocol-only CSV gives, so the table check can run. */
function readableRegisterRow(caseId: string) {
  const { row, key, confirmation } = registerRow(caseId);
  const bytes = Buffer.from(`bin
${row.cell.value}
`);
  const table = readTabularSource(bytes, row.selection);
  const pins = { sourceSha256: sha256(bytes), rawResultSha256: fingerprint(table), sourceRow: table.sourceRows[0],
    rowSha256: fingerprint(rowCells(table, 0)) };
  return { bytes, evidence: { row: { ...row, ...pins }, key, confirmation } };
}

/** The SQL the record-evidence read issues for one committed revision, answered from memory. */
function committedQuery(capture: Record<string, any>, recorded: unknown, acceptedFence: number) {
  return async (sql: string, args: any[]) => {
    let rows: any[] = [];
    if (sql.includes('selected_body')) rows = [capture];
    else if (sql.includes('CASE WHEN r.revision=$2')) rows = [{ site_id: capture.site.id, kind: 'building',
      project_status: null, body: args[1] === 1 ? recorded : capture.body }];
    else if (sql.includes('FROM usp_job_metadata')) rows = [{ accepted_fence: acceptedFence }];
    else if (sql.includes('FROM registry_records')) rows = [{ ...capture.record, body: capture.body, project_status: null }];
    else assert(/^SELECT (pg_advisory_xact_lock|id FROM registry_sites)/.test(sql), sql);
    return { rows, rowCount: rows.length };
  };
}

/** RC3's act 1 building once committed: revision 2 is the revision 1 exterior-only body plus its register row. */
function committedExterior(footprint: number[][] = []) {
  const caseId = randomUUID(), recordId = randomUUID(), siteId = randomUUID();
  const recorded = { ...exterior, evidence: [{ sourceId: randomUUID(), locator: 'feature 1087575' }] };
  const { bytes, evidence } = readableRegisterRow(caseId);
  const target = { recordId, revision: 1, bodySha256: fingerprint(recorded) };
  const pin = tableRowCitation(evidence, { excerpt: 'bin: technical-control', accessSha256: digest }, target, subject);
  const body = { ...recorded, footprint, documentCitations: [pin] };
  const capture = { body, selected_body: body, project_status: null,
    record: { id: recordId, site_id: siteId, identifier: 'technical exterior', kind: 'building', revision: 2 },
    history: { record_id: recordId, revision: 2, site_revision: 2 },
    site: { id: siteId, identifier: 'technical site', name: 'Technical control', frame, revision: 2, synthetic: false } };
  const source = { case_id: caseId, revision: 1, sha256: evidence.row.sourceSha256, accessSha256: digest,
    object_key: `sources/${evidence.row.sourceId}`, bytes: bytes.length };
  const unread = async () => assert.fail('a table-row citation reads no native document');
  const dependencies = { source: unread, result: unread, citationSource: unread, registrySource: async () => ({}),
    tableEvidence: { source: async () => source, bytes: async () => bytes } } as unknown as RegistryDocumentDependencies;
  const client = { query: committedQuery(capture, recorded, evidence.row.acceptedFence) } as unknown as PoolClient;
  return { recordId, pin, client, dependencies };
}

test('the evidence of a committed exterior-only building with its register citation can be read', () => attributed(
  async () => {
    const control = committedExterior();
    const read = await readRegistryRecordEvidenceTx(control.client, { recordId: control.recordId, revision: 2 },
      control.dependencies);
    assert.equal(read.recordKind, 'building');
    assert.equal(read.snapshotState, 'current');
    assert.deepEqual(read.citations.map(entry => entry.pin), [control.pin]);
  }));

test('a committed body with a two-point footprint is still refused by the evidence read', () => attributed(
  async () => {
    const control = committedExterior([[0, 0], [2, 0]]);
    await assert.rejects(() => readRegistryRecordEvidenceTx(control.client, { recordId: control.recordId,
      revision: 2 }, control.dependencies), (error: any) => error.name === 'ZodError');
  }));
