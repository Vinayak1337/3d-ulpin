import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { createContractValidator } from '../../../local/contract';
import type { IntakeItem } from '../batch-model';
import type { Package, Target } from '../run/model';
import { createDeclaration, evidenceKey, readTables } from './api';
import { DeclareKeyForm, type DeclareChoices } from './DeclareKey';
import { EvidenceRead, type Paging } from './EvidenceRead';
import { expectDisabledReasons } from './disabled-reasons.test-support';
import { anchorItems, blankDeclaration, declareFromLink, documentChoices, keyPaths, profileInput, tableChoices,
  type Candidate, type Declaration, type EvidencePage, type KeyProfileBody, type KeyProfileInput,
  type SourceProfile } from './model';

const root = resolve(import.meta.dirname, '../../../../../..');
const validate = createContractValidator(JSON.parse(readFileSync(resolve(root, 'docs/api/openapi.json'), 'utf8')));
const schemas = {
  manifest: 'GET_ingestion_cases_caseId_intake_Response_200_application_json',
  targets: 'GET_ingestion_cases_caseId_targets_Response_200_application_json',
  declare: 'POST_ingestion_cases_caseId_intake_evidence_key_profiles_Request_application_json',
  profile: 'POST_ingestion_cases_caseId_intake_evidence_key_profiles_Response_201_application_json',
  page: 'GET_ingestion_cases_caseId_intake_evidence_Response_200_application_json',
};

// test_only: a batch, its buildings and its evidence built to the published contract; no real record is named.
const id = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sha = (c: string) => c.repeat(64);
const caseId = id(99);
const at = '2026-10-21T00:00:00.000Z';
function card(family: string, format: string, columns: string[] = [], sheets: string[] = []) {
  return { version: 'intake-card/1', family, format, formatVersion: null, detectedBy: 'bytes', nameDisagrees: false,
    depth: 'structure', encoding: null, crs: { state: 'not_applicable', code: null, sidecarSha256: null },
    extent: { native: null, epsg4326: null },
    counts: { features: null, rows: null, pages: null, members: null, points: null, bands: null },
    geometryTypes: [], layers: [], sheets: sheets.map((name) => ({ name, count: null })),
    columns: columns.map((name) => ({ name, inferredType: 'text', sampledNonEmpty: 1 })), limits: [],
    probeBytesRead: 0, probeMs: 0, drawableHint: false, delimiter: null, encrypted: null, raster: null, point: null,
    citations: [], members: [] };
}
function item(n: number, name: string, family: string, format: string, fields: Partial<IntakeItem> = {}) {
  return { itemId: id(n), sourceId: id(n + 50), caseId, parentItemId: null, memberPath: null, name, family, format,
    sizeBytes: 10, sizeClass: 'S', wave: 1, state: 'read', placement: 'undecided', card: null, cardSha256: null,
    plan: null, streamedProfileJobId: null, probeVersion: 'intake-card/1', partsPlanned: null, partsDone: 0,
    recordsSeen: 0, limitReason: null, pinnedByOfficer: false, createdAt: at, updatedAt: at, ...fields } as IntakeItem;
}
const map = item(1, 'outlines.geojson', 'vector', 'geojson',
  { card: card('vector', 'geojson', ['house no', 'a/b~c']) as never });
const undrafted = item(2, 'roads.geojson', 'vector', 'geojson', { card: card('vector', 'geojson', ['ref']) as never });
const register = item(3, 'register.csv', 'table', 'csv',
  { card: card('table', 'csv', ['Serial', 'House no']) as never });
const workbook = item(4, 'register.xlsx', 'table', 'xlsx', { card: card('table', 'xlsx', [], ['Sheet1']) as never });
const zipped = item(5, 'inner.csv', 'table', 'csv', { sourceId: null, parentItemId: id(9),
  card: card('table', 'csv', ['Serial']) as never });
const letter = item(6, 'letter.pdf', 'document', 'pdf');
const items = [map, undrafted, register, workbook, zipped, letter];
const counts = { preparing: 0, ready: 2, needs_answer: 0, held: 0, confirmed: 0, recorded: 0, carded: 0, stopped: 0 };
const pkg = (n: number, anchorItemId: string, total: typeof counts): Package => ({ packageId: id(n), areaId: id(n + 1),
  anchorItemId, revision: 3, state: 'REVIEWED', reviewFingerprint: sha('e'), findingCounts: null, counts: total });
const packages = [pkg(10, map.itemId, counts), pkg(12, undrafted.itemId, { ...counts, ready: 0 })];
const target = (n: number, locator: string): Target => ({ targetId: id(n), caseId, anchorItemId: map.itemId,
  packageId: id(10), featureId: id(n + 100), locator, kind: 'building', stage: 3, readiness: 'ready', blockedBy: [],
  reason: null, confirmationId: null, priorityAt: null, artefacts: {}, updatedAt: at });
const targets = [target(20, 'Feature 14 of outlines.geojson'), target(21, 'Feature 15 of outlines.geojson')];

const declared: Declaration = { namespace: 'Ward house register number', kind: 'text', anchorItemId: map.itemId,
  sourcePath: '/features/*/properties/a~1b~0c', columns: { [register.itemId]: '1' }, documents: [letter.itemId] };

it('offers drafted map items, their card fields, kept CSVs with a header row and kept documents', () => {
  expect(validate(schemas.manifest, { caseId, items })).toEqual([]);
  expect(validate(schemas.targets, { caseId, items: targets, counts, nextCursor: null, packages,
    packagesTruncated: false })).toEqual([]);
  expect(anchorItems(items, packages)).toEqual([map]);
  expect(keyPaths(map)).toEqual(['/features/*/properties/house no', '/features/*/properties/a~1b~0c']);
  expect(tableChoices(items)).toEqual([{ itemId: register.itemId, name: 'register.csv',
    headers: ['Serial', 'House no'], selection: { format: 'csv', sheet: 'csv', table: null, headerRows: [1] } }]);
  expect(documentChoices(items)).toEqual([letter]);
  const choices: DeclareChoices = { anchors: [map], tables: tableChoices(items), documents: [letter] };
  const html = renderToStaticMarkup(<DeclareKeyForm choices={choices} declaration={declared} change={vi.fn()}
    pending={false} submit={vi.fn()} cancel={vi.fn()} missing={null} error={null} />);
  expect(html).toContain('<option value="/features/*/properties/a~1b~0c" selected="">a/b~c</option>');
  expect(html).not.toContain('/features/*/id');
  expect(html).toContain('<option value="1" selected="">House no</option>');
  expect(html).toContain('<span class="ul-label">Key namespace, in your words</span>');
  expect(html).not.toContain('class="ul-help"');
});

it('TJ1: a table read in the batch is offered with the headers and selection of its read', () => {
  // The table profile the server answered for the real mi-d10-02.csv (docs/evidence/gf1/ui/f3a).
  const answered = JSON.parse(readFileSync(resolve(root, 'docs/evidence/gf1/ui/f3a/table-responses.json'), 'utf8'))
    .files[0].profile;
  const sheet = { format: 'xlsx' as const, sheet: 'Sheet1', table: null, headerRows: [2] };
  const workbookProfile = { ...answered, headers: ['Plot', 'Holder'],
    tabular: { ...answered.tabular, selection: sheet } };
  const read = readTables([register.sourceId!, workbook.sourceId!, letter.sourceId!],
    [answered, workbookProfile, undefined]);
  expect([...read.keys()], 'a source not read as a table is left out').toEqual([register.sourceId, workbook.sourceId]);
  expect(read.get(register.sourceId!)).toEqual({ headers: answered.headers, selection: answered.tabular.selection });
  const tables = tableChoices(items, read);
  expect(tables).toEqual([
    { itemId: register.itemId, name: 'register.csv', headers: answered.headers, selection: answered.tabular.selection },
    { itemId: workbook.itemId, name: 'register.xlsx', headers: ['Plot', 'Holder'], selection: sheet },
  ]);
  const input = profileInput({ ...declared, columns: { [workbook.itemId]: '1' }, documents: [] }, tables);
  expect(input).toMatchObject({ tables: [{ itemId: workbook.itemId, selection: sheet, columnIndex: 1 }] });
  const linked = declareFromLink({ fromItemId: map.itemId, itemId: workbook.itemId, by: 'address', basis: 'rule',
    fields: { here: declared.sourcePath, there: 'Holder' },
    words: 'A link may be declared to register.xlsx: a/b~c (rule) here and Holder (rule) there both mean Address.' },
    items, new Map<string, SourceProfile>([
      [map.sourceId!, { version: 'manual-geojson/1', paths: [{ path: declared.sourcePath,
        integerIdEligible: false }] } as unknown as SourceProfile],
      [workbook.sourceId!, workbookProfile],
    ]));
  expect(linked).toMatchObject({ kind: 'text', sourcePath: declared.sourcePath,
    columns: { [workbook.itemId]: '1' }, namespace: 'a/b~c · register.xlsx' });
  expect(profileInput(linked!, linked!.tables)).toMatchObject({ tables: [{ itemId: workbook.itemId,
    selection: sheet, columnIndex: 1 }] });
  expect(validate(schemas.declare, { ...input as KeyProfileInput, requestKey: id(40) })).toEqual([]);
  const html = renderToStaticMarkup(<DeclareKeyForm choices={{ anchors: [map], tables, documents: [] }}
    declaration={declared} change={vi.fn()} pending={false} submit={vi.fn()} cancel={vi.fn()} missing={null}
    error={null} />);
  expect(html).toContain('<span class="ul-label">register.xlsx</span>');
  expect(html).toContain('<option value="1">Holder</option>');
});

it('describes a missing map choice or missing key fields, and removes the reason for a usable map', () => {
  for (const declaration of [blankDeclaration, { ...declared, anchorItemId: undrafted.itemId }, declared]) {
    const html = renderToStaticMarkup(<DeclareKeyForm choices={{ anchors: [map, { ...undrafted, card: null }],
      tables: [], documents: [] }} declaration={declaration} change={vi.fn()} pending={false}
      submit={vi.fn()} cancel={vi.fn()} missing={null} error={null} />);
    expect(expectDisabledReasons(html)).toBe(declaration === declared ? 0 : 1);
    if (declaration === blankDeclaration) expect(html).toContain('Choose a map item.');
    else if (declaration !== declared) expect(html).toContain('Its card lists no key fields.');
    else expect(html).not.toContain('var(--ui-ink-soft)');
  }
});

it('states what is missing before any request', () => {
  expect(profileInput(blankDeclaration)).toBe('Name the key in your own words.');
  expect(profileInput({ ...declared, sourcePath: '' })).toBe('Choose the map item and its key field.');
  expect(profileInput({ ...declared, columns: { [register.itemId]: '' }, documents: [] }))
    .toBe('Choose at least one table column or document.');
});

type Answer = { status: number; body: unknown } | Error;
function stubServer(answers: ((body: KeyProfileBody) => Answer)[]) {
  const bodies: KeyProfileBody[] = [];
  vi.stubGlobal('fetch', async (request: Request) => {
    expect(request.method).toBe('POST');
    expect(new URL(request.url).pathname).toBe(`/api/v1/ingestion/cases/${caseId}/intake/evidence/key-profiles`);
    const body = await request.json() as KeyProfileBody;
    bodies.push(body);
    const answer = answers.shift()!(body);
    if (answer instanceof Error) throw answer;
    return Response.json(answer.body, { status: answer.status });
  });
  return bodies;
}
afterEach(() => vi.unstubAllGlobals());

it('declares in one request; a refusal shows its words and makes the next press new, a lost answer keeps its key',
  async () => {
    const input = profileInput(declared) as KeyProfileInput;
    const refusal = { error: { code: 'INTAKE_EVIDENCE_ANCHOR_NOT_DRAFTED',
      message: 'No drafted building of the map item holds this field as written yet.' } };
    const profile = (body: KeyProfileBody) => ({ profileId: id(30), caseId, profileSha256: sha('a'), input: body,
      subject: 'local-officer', createdAt: at });
    const created = (body: KeyProfileBody) => ({ status: 201, body: profile(body) });
    const bodies = stubServer([() => ({ status: 409, body: refusal }),
      () => new TypeError('Network response was lost.'), created, created]);
    const send = createDeclaration(caseId);
    const error = await send(input).then(() => null, (value: Error) => value);
    if (!error) throw new Error('The refusal was not raised.');
    const html = renderToStaticMarkup(<DeclareKeyForm choices={{ anchors: [map], tables: [], documents: [] }}
      declaration={declared} change={vi.fn()} pending={false} submit={vi.fn()} cancel={vi.fn()} missing={null}
      error={error} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain(`${refusal.error.message} (${refusal.error.code})`);
    await expect(send(input)).rejects.toThrow('Network response was lost.');
    expect((await send(input)).input).toEqual(bodies[2]);
    await send({ ...input, kind: 'integer' });
    for (const body of bodies) expect(validate(schemas.declare, body)).toEqual([]);
    expect(validate(schemas.profile, profile(bodies[2]!))).toEqual([]);
    expect(bodies[0]).toEqual({ ...input, requestKey: bodies[0]!.requestKey });
    expect(bodies[0]).toMatchObject({ version: 'exact-key/1', namespace: 'Ward house register number',
      map: { anchorItemId: map.itemId, sourcePath: '/features/*/properties/a~1b~0c' },
      tables: [{ itemId: register.itemId, selection: { format: 'csv', sheet: 'csv', table: null, headerRows: [1] },
        columnIndex: 1 }], documents: [letter.itemId] });
    const keys = bodies.map((body) => body.requestKey);
    expect(keys[1]).not.toBe(keys[0]);
    expect(keys[2]).toBe(keys[1]);
    expect(keys[3]).not.toBe(keys[2]);
  });

const coverage = { state: 'closed', read: 3, eligible: 2, keyless: 1, unread: 0, failed: 0 } as const;
const anchor = (n: number) => ({ targetId: id(n), anchorItemId: map.itemId, packageId: id(10), packageRevision: 3,
  featureId: id(n + 100), locator: `Feature at index ${n}`, sourceId: id(51), sourceRevision: 1,
  sourceSha256: sha('b'), sourcePath: declared.sourcePath, literal: '12/4' });
const key = { profileId: id(30), profileSha256: sha('a'), namespace: declared.namespace, kind: 'text',
  literal: '12/4' } as const;
const row = (sourceRow: number, sheet?: string) => ({ kind: 'table_row', itemId: register.itemId, caseId,
  sourceId: id(53), sourceRevision: 1, sourceSha256: sha('c'), rawJobId: id(40), rawInputSha256: sha('d'),
  rawResultSha256: sha('d'), acceptedFence: 1, selection: { format: 'csv', sheet: 'csv', table: null, headerRows: [1] },
  sourceRow, rowSha256: sha('f'), columnIndex: 1, columnHeader: 'House no', cell: { state: 'literal', value: '12/4' },
  ...(sheet ? { window: { index: 0, record: 0, byteStart: 0, byteEnd: 10, sha256: sha('9'), sheet,
    physicalRow: sourceRow, sheetSha256: sha('8') } } : {}) }) as const;
const part = { kind: 'document_part', itemId: letter.itemId, caseId, caseRevision: 4, sourceId: id(56),
  sourceRevision: 1, sourceSha256: sha('1'), jobId: id(41), resultSha256: sha('2'), inputSha256: sha('3'),
  readerSha256: sha('4'), acceptedFence: 1, partId: id(42), partSha256: sha('5'), page: 2,
  quote: 'house 12/4 of the ward', quoteStart: 0, quoteEnd: 22 } as const;
function candidate(n: number, outcome: Candidate['outcome'], evidence: object, anchors: object[]): Candidate {
  return { version: 'intake-evidence/1', candidateId: id(n), caseId, candidateSha256: sha('6'), key, evidence,
    outcome, anchors, conflictGroup: outcome === 'conflicting' ? id(n + 1) : null, sourceCoverage: coverage,
    state: 'candidate', qualification: 'not_assessed', createdAt: at } as Candidate;
}
const page: EvidencePage = {
  caseId, confirmations: [],
  profiles: [{ profileId: id(30), caseId, profileSha256: sha('a'), subject: 'local-officer', createdAt: at,
    input: { ...(profileInput(declared) as KeyProfileInput), requestKey: id(31) } }],
  sources: [{ itemId: register.itemId, profileId: id(30), family: 'table', jobId: id(40), resultSha256: sha('d'),
    coverage, sourceId: id(53), sourceRevision: 1, sourceSha256: sha('c'), bytes: 10, source: { state: 'retained' } },
  { itemId: letter.itemId, profileId: id(30), family: 'document', jobId: id(41), resultSha256: null,
    coverage: { state: 'partial', read: 0, eligible: null, keyless: null, unread: null, failed: null },
    sourceId: id(56), sourceRevision: 1, sourceSha256: sha('1'), bytes: 10, source: { state: 'retained' } }],
  candidates: [candidate(60, 'matched', row(7), [anchor(20)]), candidate(61, 'several', row(9, 'Sheet1'),
    [anchor(21), anchor(22)]), candidate(62, 'conflicting', part, [anchor(20)])],
  counts: { matched: 1, no_match: 0, several: 1, conflicting: 1 }, nextCursor: id(62),
};
const paging: Paging = { outcome: '', setOutcome: vi.fn(), first: true, firstPage: vi.fn(), nextPage: vi.fn(),
  loading: false };

it('reads coverage in words, a null count as not known yet, the counts and a page of candidates', () => {
  expect(validate(schemas.page, page)).toEqual([]);
  const html = renderToStaticMarkup(<EvidenceRead page={page} items={items} targets={targets} paging={paging} />);
  expect(html).toContain('Key · Ward house register number · text exactly as written · field a/b~c of '
    + 'outlines.geojson');
  expect(html).toContain('register.csv (Table). Closed: 3 read, 2 with a key, 1 without a key, 0 unread, '
    + '0 could not be read.');
  expect(html).toContain('letter.pdf (Document). Partial: 0 read, not known yet with a key, not known yet without '
    + 'a key, not known yet unread, not known yet could not be read.');
  expect(html).toContain('<li>Matched one building: 1</li>');
  expect(html).toContain('<li>No building holds this key: 0</li>');
  expect(html).toContain('register.csv, column “House no”, row 7');
  expect(html).toContain('register.csv, column “House no”, row 9, sheet Sheet1');
  expect(html).toContain('letter.pdf, page 2: “house 12/4 of the ward”');
  expect(html).toContain('Feature 14 of outlines.geojson');
  expect(html).toContain('Feature 15 of outlines.geojson; Feature at index 22');
  expect(html).toMatch(/<button type="button"[^>]*>Next page<\/button>/);
  expect(html).not.toContain('First page');
});

it('shows a stopped reading’s state, code and server words beside that source’s unknown counts', () => {
  const failure = { state: 'failed' as const, code: 'INTAKE_SOURCE_INTEGRITY',
    message: 'The retained original differs from its pinned byte count or SHA-256. Nothing was read.' };
  const failed: EvidencePage = { ...page, sources: [page.sources[0]!, { ...page.sources[1]!,
    coverage: { ...page.sources[1]!.coverage!, failure } }] };
  expect(validate(schemas.page, failed)).toEqual([]);
  const html = renderToStaticMarkup(<EvidenceRead page={failed} items={items} targets={targets} paging={paging} />);
  expect(html).toContain('Reading failed (INTAKE_SOURCE_INTEGRITY): ' + failure.message);
  expect(html).toContain('letter.pdf (Document). Partial: 0 read, not known yet with a key');
  expect(html).toContain('register.csv (Table). Closed: 3 read');
});

it('keeps both coverage rows and the candidates visible when one retained source is unavailable', () => {
  const reason = 'The item no longer has a retained source in this batch.';
  const mixed: EvidencePage = { ...page, sources: [page.sources[0]!, { ...page.sources[1]!,
    sourceId: null, sourceRevision: null, sourceSha256: null, bytes: null,
    source: { state: 'unavailable', reason } }] };
  expect(validate(schemas.page, mixed)).toEqual([]);
  const html = renderToStaticMarkup(<EvidenceRead page={mixed} items={items} targets={targets} paging={paging} />);
  expect(html).toContain('register.csv (Table). Closed: 3 read');
  expect(html).toContain('letter.pdf (Document). Partial: 0 read, not known yet with a key');
  expect(html).toContain(reason);
  expect(html).toContain('register.csv, column “House no”, row 7');
  expect(html).toContain('>Next page</button>');
});

it('says when no key is declared, and keeps the evidence under the batch key its live updates refresh', () => {
  const html = renderToStaticMarkup(<EvidenceRead page={{ ...page, profiles: [] }} items={items} targets={[]}
    paging={paging} />);
  expect(html).toBe('<p>No key is declared for this batch yet.</p>');
  expect(evidenceKey(caseId).slice(0, 2)).toEqual(['intake', caseId]);
});
