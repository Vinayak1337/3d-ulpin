import { jsPDF } from 'jspdf';

// Recorded test_only contract shapes with deliberately fictional values. Never used as demo expectations.
export const fixtureId = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
export const fixtureHash = 'a'.repeat(64);
const at = '2026-10-20T12:00:00.000Z';
const selection = { format: 'csv', sheet: 'csv', table: null, headerRows: [1] };
export const fixtureExcerpt = 'fixture_key: FIXTURE-B3\nfixture_use: test_only';
export const fixtureCase = fixtureId(1);
const route = `/api/v1/ingestion/cases/${fixtureCase}`;

function item(number: number, family: string, name: string) {
  return { itemId: fixtureId(number), sourceId: fixtureId(number + 10), caseId: fixtureCase,
    parentItemId: null, memberPath: null, name, family, format: null, sizeBytes: 100, sizeClass: 'S', wave: 1,
    state: 'read', placement: 'on_map', card: null, cardSha256: null, plan: null, streamedProfileJobId: null,
    probeVersion: null, partsPlanned: 1, partsDone: 1, recordsSeen: 1, limitReason: 'test_only fixture read',
    pinnedByOfficer: false, createdAt: at, updatedAt: at };
}

function tableProfile() {
  return { version: 'manual-tabular/1', source: { sourceId: fixtureId(13), familyId: fixtureId(30),
    sourceRevision: 1, sourceSha256: fixtureHash, schemaFingerprint: fixtureHash },
    tabular: { selection, sourceBytes: 100, admission: { kind: 'case_original', issuer: 'test_only fixture',
      origin: 'officer_supplied', licence: 'unconfirmed', containsPersonalData: 'no' } },
    caseId: fixtureCase, workspaceRevision: 1, workspaceFingerprint: fixtureHash, headers: ['fixture_key'], records: 1,
    profile: { version: 'column-profile/1', sourceKind: 'tabular', layoutFingerprint: fixtureHash,
      columns: [{ name: 'fixture_key', inferredType: 'text', valueShapes: { dateDmyRate: null, dateIsoRate: null,
        lakhGroupingRate: null, devanagariDigitRate: null, khasraLikeRate: null, floorLabelRate: null,
        nullRate: null, blankRate: null, absentRate: null, distinctRatio: null }, maskedSamples: [] }],
      sampleShortfall: true }, limitations: ['test_only fixture; not operational data'] };
}

function evidencePage() {
  return { caseId: fixtureCase, profiles: [{ profileId: fixtureId(20), caseId: fixtureCase,
    profileSha256: fixtureHash, input: { requestKey: fixtureId(21), version: 'exact-key/1',
      namespace: 'test_only fixture key', kind: 'text', map: { anchorItemId: fixtureId(2),
        sourcePath: '/features/*/properties/fixture_key' },
      tables: [{ itemId: fixtureId(3), selection, columnIndex: 0 }],
      documents: [] }, subject: 'fixture-officer', createdAt: at }],
    confirmations: [{ confirmationId: fixtureId(22), profileId: fixtureId(20), additions: 'citations', createdAt: at,
      expiresAt: '2026-10-21T12:00:00.000Z', newerSources: [], accepted: [fixtureId(23)] }],
    sources: [{ itemId: fixtureId(3), profileId: fixtureId(20), family: 'table', jobId: fixtureId(24),
      resultSha256: fixtureHash, coverage: { state: 'closed', read: 1, eligible: 1, keyless: 0, unread: 0, failed: 0 },
      sourceId: fixtureId(13), sourceRevision: 1, sourceSha256: fixtureHash, bytes: 100 }],
    candidates: [], counts: { matched: 1, no_match: 0, several: 0, conflicting: 0 }, nextCursor: null };
}

function targetPage() {
  return { caseId: fixtureCase, items: [{ targetId: fixtureId(25), caseId: fixtureCase, anchorItemId: fixtureId(2),
    packageId: fixtureId(26), featureId: fixtureId(27), locator: 'feature FIXTURE-B3', kind: 'building', stage: 8,
    readiness: 'carded', blockedBy: [], reason: null, confirmationId: fixtureId(28), priorityAt: null,
    artefacts: { record: { id: fixtureId(27), revision: 1 }, card: { id: fixtureId(29), revision: 1 },
      evidence: { confirmationIds: [fixtureId(22)], record: { id: fixtureId(27), revision: 2 } },
      verification: 'consistent' }, updatedAt: at }],
    counts: { preparing: 0, ready: 0, needs_answer: 0, held: 0, confirmed: 0, recorded: 0, carded: 1, stopped: 0 },
    nextCursor: null, packages: [], packagesTruncated: false };
}

function verification() {
  return { data: { cardId: fixtureId(29), revision: 1, checkedAt: at, result: 'consistent',
    checks: ['card_body', 'stored_linkage', 'revision_chain', 'artifact_bytes', 'plan_link', 'packet_bytes']
      .map(key => ({ key, state: 'pass', reasonCode: null })),
    lifecycle: { latestRevision: 1, superseded: false, expiresAt: '2026-10-21T12:00:00.000Z',
      expired: false, revocation: null },
    snapshot: { cardTargetRevision: 2, currentTargetRevision: 2, state: 'same_revision' },
    signature: { state: 'not_assessed', reasonCode: 'NO_TRUSTED_KEY_POLICY' } } };
}

function citation() {
  return { version: 'registry-record-evidence/1', recordId: fixtureId(27), siteId: fixtureId(31),
    recordKind: 'building', recordRevision: 2, recordBodySha256: fixtureHash, siteRevision: 1,
    currentRecordRevision: 2, currentSiteRevision: 1, snapshotState: 'current',
    citations: [{ pin: { version: 'registry-table-row-citation/1', id: fixtureHash,
      row: { kind: 'table_row', itemId: fixtureId(3), caseId: fixtureCase, sourceId: fixtureId(13),
        sourceRevision: 1, sourceSha256: fixtureHash, rawJobId: fixtureId(24), rawInputSha256: fixtureHash,
        rawResultSha256: fixtureHash, acceptedFence: 1, selection, sourceRow: 2, rowSha256: fixtureHash,
        columnIndex: 0, columnHeader: 'fixture_key', cell: { state: 'literal', value: 'FIXTURE-B3' } },
      key: { profileId: fixtureId(20), profileSha256: fixtureHash, namespace: 'test_only fixture key',
        kind: 'text', literal: 'FIXTURE-B3' },
      confirmation: { confirmationId: fixtureId(22), candidateId: fixtureId(23), candidateSha256: fixtureHash },
      excerpt: fixtureExcerpt, target: { recordId: fixtureId(27), revision: 1, bodySha256: fixtureHash },
      selection: { subject: 'fixture-officer', accessSha256: fixtureHash, selectedAt: at },
      associationState: 'operator_selected', qualification: 'not_assessed' } }],
    associationState: 'operator_selected', qualification: 'not_assessed' };
}

function surface(number: number, placed: boolean) {
  const locator = number === 5 ? { operation: 'point-batch', batch: null }
    : { operation: 'raster-window', window: null };
  const corners = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const parts = { caseId: fixtureCase, itemId: fixtureId(number), operation: locator.operation, partsPlanned: 1,
    parts: [{ partIndex: 0, state: 'published', locator, partKey: fixtureHash, jobId: fixtureId(32),
      resultSha256: fixtureHash, issueCode: null }], next: null };
  const display = { version: 'intake-surface/1', caseId: fixtureCase, itemId: fixtureId(number), partIndex: 0,
    jobId: fixtureId(32), original: { sourceId: fixtureId(number + 10), sourceRevision: 1,
      sha256: fixtureHash, bytes: 100 }, locator, read: locator, resultSha256: fixtureHash,
    artifact: { sha256: fixtureHash, bytes: 100,
      mediaType: number === 5 ? 'application/vnd.las.point-records' : 'image/tiff',
      path: '/fixture-only-not-fetched' },
    sourceCrs: { state: 'stated', authority: 'EPSG:4326' }, verticalReference: { status: 'unknown', name: null },
    sourceCorners: corners, placement: placed ? { state: 'placed', areaId: fixtureId(33), areaRevision: 1,
      analysisCrs: 'EPSG:4326', origin: [0, 0], operation: 'test_only fixture', corners }
      : { state: 'not_placed', reason: 'outside_area', words: 'test_only: read, outside this fixture area.' },
    use: 'display_only' };
  return { parts, display };
}

export function fixturePdf(excerpt = fixtureExcerpt) {
  const pdf = new jsPDF({ compress: true });
  pdf.setFontSize(10);
  pdf.text('test_only fixture property card; not a record', 10, 10);
  pdf.text(JSON.stringify(excerpt) + ' (fixture-register.csv, CSV logical row 2).', 10, 20);
  return new Uint8Array(pdf.output('arraybuffer'));
}

export function fixtureResponses(): Record<string, unknown> {
  const first = surface(4, true);
  const second = surface(5, false);
  return {
    '/api/v1/cases': [{ id: fixtureCase, archived: false, createdAt: at }],
    [route + '/intake']: { caseId: fixtureCase, items: [item(2, 'vector', 'fixture-footprints.geojson'),
      item(3, 'table', 'fixture-register.csv'), item(4, 'raster', 'fixture-orthophoto.tif'),
      item(5, 'point_cloud', 'fixture-points.laz')] },
    [route + '/sources/' + fixtureId(13) + '/profile']: tableProfile(),
    [route + '/intake/items/' + fixtureId(4) + '/parts?after=-1']: first.parts,
    [route + '/intake/items/' + fixtureId(4) + '/parts/0/display']: first.display,
    [route + '/intake/items/' + fixtureId(5) + '/parts?after=-1']: second.parts,
    [route + '/intake/items/' + fixtureId(5) + '/parts/0/display']: second.display,
    [route + '/intake/evidence']: evidencePage(),
    [route + '/targets?readiness=carded']: targetPage(),
    ['/api/v1/usp/property-cards/' + fixtureId(29) + '/revisions/1/verification']: verification(),
    ['/api/v1/usp/property-cards/' + fixtureId(29) + '/revisions/1']: fixturePdf(),
    ['/api/v1/registry-records/' + fixtureId(27) + '/revisions/2/document-citations']: citation(),
  };
}
