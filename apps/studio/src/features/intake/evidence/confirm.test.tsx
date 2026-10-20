import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { ApiError } from '@ulpin/api-client';
import { afterEach, expect, it, vi } from 'vitest';
import { createContractValidator } from '../../../local/contract';
import type { IntakeItem } from '../batch-model';
import type { Package, Target, TargetPage } from '../run/model';
import { runKey } from '../run/useTargets';
import { createEvidenceConfirmation, evidenceKey, readPackagePins } from './api';
import { blankDraft, ConfirmEvidenceForm, pressConfirm, rereadAfterRefusal, type ConfirmDraft,
  type ConfirmRead } from './ConfirmEvidence';
import { acceptFile, decidable, setAccept, setReject, type ConfirmBody,
  type EvidenceConfirmation } from './confirm-model';
import type { Candidate, EvidencePage, KeyProfile } from './model';

const root = resolve(import.meta.dirname, '../../../../../..');
const validate = createContractValidator(JSON.parse(readFileSync(resolve(root, 'docs/api/openapi.json'), 'utf8')));
const schemas = {
  page: 'GET_ingestion_cases_caseId_intake_evidence_Response_200_application_json',
  confirm: 'POST_ingestion_cases_caseId_intake_evidence_confirmations_Request_application_json',
  stored: 'POST_ingestion_cases_caseId_intake_evidence_confirmations_Response_202_application_json',
};

// test_only: a batch, its buildings and its evidence built to the published contract; no real record is named.
const id = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sha = (c: string) => c.repeat(64);
const caseId = id(99);
const at = '2026-10-21T00:00:00.000Z';
const item = (n: number, name: string, family: string, format: string) => ({ itemId: id(n), sourceId: id(n + 50),
  caseId, parentItemId: null, memberPath: null, name, family, format, sizeBytes: 10, sizeClass: 'S', wave: 1,
  state: 'read', placement: 'undecided', card: null, cardSha256: null, plan: null, streamedProfileJobId: null,
  probeVersion: 'intake-card/1', partsPlanned: null, partsDone: 0, recordsSeen: 0, limitReason: null,
  pinnedByOfficer: false, createdAt: at, updatedAt: at }) as IntakeItem;
const register = item(3, 'register.csv', 'table', 'csv');
const late = item(4, 'late.csv', 'table', 'csv');
const letter = item(6, 'letter.pdf', 'document', 'pdf');
const items = [register, late, letter];
const target = (n: number, locator: string): Target => ({ targetId: id(n), caseId, anchorItemId: id(1),
  packageId: id(n < 21 ? 10 : 11), featureId: id(n + 100), locator, kind: 'building', stage: 3, readiness: 'ready',
  blockedBy: [], reason: null, confirmationId: null, priorityAt: null, artefacts: {}, updatedAt: at });
const targets = [target(20, 'Feature 14 of outlines.geojson'), target(21, 'Feature 15 of outlines.geojson')];

const closed = { state: 'closed', read: 3, eligible: 2, keyless: 1, unread: 0, failed: 0 } as const;
const profile: KeyProfile = { profileId: id(30), caseId, profileSha256: sha('a'), subject: 'local-officer',
  createdAt: at, input: { requestKey: id(31), version: 'exact-key/1', namespace: 'Ward house register number',
    kind: 'text', map: { anchorItemId: id(1), sourcePath: '/features/*/properties/house no' },
    tables: [{ itemId: register.itemId, selection: { format: 'csv', sheet: 'csv', table: null, headerRows: [1] },
      columnIndex: 1 }], documents: [letter.itemId] } as KeyProfile['input'] };
const anchor = (n: number, literal: string) => ({ targetId: id(n), anchorItemId: id(1), packageId: id(n < 21 ? 10 : 11),
  packageRevision: 3, featureId: id(n + 100), locator: `Feature at index ${n}`, sourceId: id(51), sourceRevision: 1,
  sourceSha256: sha('b'), sourcePath: '/features/*/properties/house no', literal });
const row = (sourceRow: number, literal: string) => ({ kind: 'table_row', itemId: register.itemId, caseId,
  sourceId: id(53), sourceRevision: 2, sourceSha256: sha('c'), rawJobId: id(40), rawInputSha256: sha('d'),
  rawResultSha256: sha('d'), acceptedFence: 1, selection: { format: 'csv', sheet: 'csv', table: null, headerRows: [1] },
  sourceRow, rowSha256: sha('f'), columnIndex: 1, columnHeader: 'House no',
  cell: { state: 'literal', value: literal } });
const part = { kind: 'document_part', itemId: letter.itemId, caseId, caseRevision: 4, sourceId: id(56),
  sourceRevision: 1, sourceSha256: sha('1'), jobId: id(41), resultSha256: sha('2'), inputSha256: sha('3'),
  readerSha256: sha('4'), acceptedFence: 1, partId: id(42), partSha256: sha('5'), page: 2,
  quote: 'house 12/7 of the ward', quoteStart: 0, quoteEnd: 22 };
function candidate(n: number, outcome: Candidate['outcome'], literal: string, evidence: object,
  anchors: object[]): Candidate {
  return { version: 'intake-evidence/1', candidateId: id(n), caseId, candidateSha256: sha(String(n % 10)),
    key: { profileId: profile.profileId, profileSha256: profile.profileSha256, namespace: profile.input.namespace,
      kind: 'text', literal }, evidence, outcome, anchors,
    conflictGroup: outcome === 'conflicting' ? id(n + 1) : null, sourceCoverage: closed, state: 'candidate',
    qualification: 'not_assessed', createdAt: at } as Candidate;
}
const first = candidate(60, 'matched', '12/4', row(7, '12/4'), [anchor(20, '12/4')]);
const second = candidate(61, 'matched', '12/5', row(8, '12/5'), [anchor(21, '12/5')]);
const conflicting = candidate(62, 'conflicting', '12/6', row(9, '12/6'), [anchor(20, '12/6')]);
const several = candidate(64, 'several', '12/7', part, [anchor(20, '12/7'), anchor(22, '12/7')]);
const absent = candidate(65, 'no_match', '12/8', row(10, '12/8'), []);
const page: EvidencePage = { caseId, confirmations: [], profiles: [profile],
  sources: [
    { itemId: register.itemId, profileId: profile.profileId, family: 'table', jobId: id(40), resultSha256: sha('d'),
      coverage: closed, sourceId: id(53), sourceRevision: 2, sourceSha256: sha('c'), bytes: 87 },
    { itemId: late.itemId, profileId: profile.profileId, family: 'table', jobId: id(43), resultSha256: null,
      coverage: { state: 'reading', read: 40, eligible: null, keyless: null, unread: null, failed: null },
      sourceId: id(54), sourceRevision: 1, sourceSha256: sha('7'), bytes: 900 },
    { itemId: letter.itemId, profileId: profile.profileId, family: 'document', jobId: id(41), resultSha256: sha('2'),
      coverage: { state: 'closed', read: 1, eligible: 1, keyless: 0, unread: 0, failed: 0 }, sourceId: id(56),
      sourceRevision: 1, sourceSha256: sha('1'), bytes: 22 }],
  candidates: [first, second, conflicting, several, absent],
  counts: { matched: 2, no_match: 1, several: 1, conflicting: 1 }, nextCursor: null };
const read: ConfirmRead = { page, items, targets };

const counts = { preparing: 0, ready: 2, needs_answer: 0, held: 0, confirmed: 0, recorded: 0, carded: 0, stopped: 0 };
const pkg = (n: number, revision: number, fingerprint: string | null): Package => ({ packageId: id(n),
  areaId: id(n + 1), anchorItemId: id(1), revision, state: 'REVIEWED', reviewFingerprint: fingerprint,
  findingCounts: null, counts });
/** The targets read pages its packages; package 11 is on its second package page. */
function targetsRead(second11: Package = pkg(11, 4, sha('9'))) {
  const pages: TargetPage[] = [
    { caseId, items: targets, counts, nextCursor: null, packages: [pkg(10, 3, sha('e'))], packagesTruncated: true,
      packagesNextCursor: 'page-2', packagesTotal: 101 },
    { caseId, items: [], counts, nextCursor: null, packages: [second11], packagesTruncated: true,
      packagesNextCursor: null, packagesTotal: 101 },
  ];
  return vi.fn(async (_caseId: string, _readiness?: unknown, _cursor?: string, packageCursor?: string) =>
    pages[packageCursor === 'page-2' ? 1 : 0]!);
}

type Answer = { status: number; body: unknown } | Error;
function stubServer(answers: ((body: ConfirmBody) => Answer)[]) {
  const bodies: ConfirmBody[] = [];
  vi.stubGlobal('fetch', async (request: Request) => {
    expect(request.method).toBe('POST');
    expect(new URL(request.url).pathname).toBe(`/api/v1/ingestion/cases/${caseId}/intake/evidence/confirmations`);
    const body = await request.json() as ConfirmBody;
    bodies.push(body);
    const answer = answers.shift()!(body);
    if (answer instanceof Error) throw answer;
    return Response.json(answer.body, { status: answer.status });
  });
  return bodies;
}
afterEach(() => vi.unstubAllGlobals());

const note = 'Stored with every pin it names. Nothing was written to the registry: the citation step adds accepted '
  + 'rows and parts to recorded buildings under this confirmation.';
const stored = (body: ConfirmBody): EvidenceConfirmation => ({ confirmationId: id(80), caseId, inputSha256: sha('0'),
  input: body, subject: 'local-officer', expiresAt: at, createdAt: at, registryWritten: false, note });
const form = (draft: ConfirmDraft, extra: Partial<Parameters<typeof ConfirmEvidenceForm>[0]> = {}) =>
  renderToStaticMarkup(<ConfirmEvidenceForm profile={profile} read={read} draft={draft} change={vi.fn()}
    pending={false} submit={vi.fn()} close={vi.fn()} result={null} error={null} {...extra} />);
const ready: ConfirmDraft = { ...blankDraft, acknowledgement: 'I checked each row against its building.',
  exclusions: { [late.itemId]: 'Its reading is still open; I confirm it later.' } };

it('accepts every exact single match of a file in one press; each stays unselectable and no question is selected',
  () => {
    expect(validate(schemas.page, page)).toEqual([]);
    const candidates = decidable(page, profile);
    expect(candidates).toEqual([first, second, conflicting, several]);
    const all = acceptFile({}, candidates, register.itemId);
    expect(Object.keys(all)).toEqual([first.candidateId, second.candidateId]);
    expect(Object.values(all).every((choice) => choice.decision === 'accept')).toBe(true);
    expect(acceptFile({}, candidates, letter.itemId)).toEqual({});
    const one = setAccept(all, first, false);
    expect(Object.keys(one)).toEqual([second.candidateId]);
    const html = form({ ...blankDraft, choices: one });
    expect(html).toContain('>Accept every exact single match of this file</button>');
    expect(html).toContain('<input type="checkbox"/>Accept 12/4 for Feature 14 of outlines.geojson');
    expect(html).toContain('<input type="checkbox" checked=""/>Accept 12/5 for Feature 15 of outlines.geojson');
    expect(html).toContain('Your decisions: 1 accepted, 0 rejected');
    expect(html).toContain('aria-label="Undo the decision on 12/5, register.csv, column “House no”, row 8"');
  });

it('never accepts a conflicting or several candidate; the officer may reject one with reason words', async () => {
  for (const question of [conflicting, several]) {
    expect(setAccept({}, question, true)).toEqual({});
    expect(setReject({}, first, 'not mine')).toEqual({});
  }
  const html = form({ ...blankDraft, choices: setReject({}, conflicting, '') });
  expect(html).not.toContain('Accept 12/6');
  expect(html).not.toContain('Accept 12/7');
  expect(html).toContain('A question, never accepted. Buildings: Feature 14 of outlines.geojson.');
  expect(html).toContain('<input type="checkbox" checked=""/>Reject 12/6');
  expect(html).toContain('Reason for rejecting 12/6');
  const send = vi.fn();
  const press = (draft: ConfirmDraft) => pressConfirm(caseId, profile, read, draft, send, targetsReadPins());
  expect(await press({ ...ready, choices: setReject({}, conflicting, '  ') }))
    .toEqual({ missing: 'Give your reason for each rejected candidate.' });
  // A forged accept of a question is never sent.
  expect(await press({ ...ready, choices: { [several.candidateId]: { decision: 'accept', candidate: several } } }))
    .toEqual({ missing: '12/7 is a question, not an exact single match; it is never accepted.' });
  expect(send).not.toHaveBeenCalled();
});

const targetsReadPins = (read11?: Package) => {
  const readTargets = targetsRead(read11);
  return (caseValue: string, ids: readonly string[]) => readPackagePins(caseValue, ids, readTargets);
};

it('sends closed sources with every pin, named buildings with fingerprints and the decisions, but no manifest hash',
  async () => {
    const choices = setReject(acceptFile({}, decidable(page, profile), register.itemId), several,
      'The letter names two houses; it is not one building.');
    const bodies = stubServer([(body) => ({ status: 202, body: stored(body) })]);
    const readTargets = targetsRead();
    const send = createEvidenceConfirmation(caseId);
    const press = (draft: ConfirmDraft) => pressConfirm(caseId, profile, read, draft, send,
      (caseValue, ids) => readPackagePins(caseValue, ids, readTargets));
    expect(await press({ ...ready, choices, exclusions: {} })).toEqual({ missing: 'late.csv can be confirmed when '
      + 'its reading closes. Exclude it with your reason to confirm this key without it.' });
    expect(await press({ ...ready, choices, exclusions: { [late.itemId]: '' } }))
      .toEqual({ missing: 'Give your reason for excluding late.csv.' });
    const result = await press({ ...ready, choices });
    expect(bodies).toHaveLength(1);
    const body = bodies[0]!;
    expect(validate(schemas.confirm, body)).toEqual([]);
    expect(body.requestKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(body).toMatchObject({ acknowledgement: ready.acknowledgement, profileId: profile.profileId,
      profileSha256: profile.profileSha256 });
    expect(body.included).toEqual([
      { itemId: register.itemId, sourceId: id(53), sourceRevision: 2, sourceSha256: sha('c'), bytes: 87,
        jobId: id(40), resultSha256: sha('d'), coverage: closed },
      { itemId: letter.itemId, sourceId: id(56), sourceRevision: 1, sourceSha256: sha('1'), bytes: 22,
        jobId: id(41), resultSha256: sha('2'), coverage: page.sources[2]!.coverage }]);
    expect(body.excluded).toEqual([{ itemId: late.itemId, sourceId: id(54), sourceRevision: 1, sourceSha256: sha('7'),
      bytes: 900, reason: ready.exclusions[late.itemId] }]);
    // The accepted candidates name buildings 20 and 21; package 11 is found on the read's second package page.
    expect(body.targets).toEqual([
      { targetId: id(20), packageId: id(10), packageRevision: 3, reviewFingerprint: sha('e') },
      { targetId: id(21), packageId: id(11), packageRevision: 4, reviewFingerprint: sha('9') }]);
    // Each press reads the packages afresh: the first page, then the second.
    expect(readTargets.mock.calls.map((call) => call[3]).slice(-2)).toEqual([undefined, 'page-2']);
    expect(body.additions).toEqual({ kind: 'citations', decisions: [
      { decision: 'accept', candidateId: first.candidateId, candidateSha256: first.candidateSha256, targetId: id(20),
        evidence: first.evidence },
      { decision: 'accept', candidateId: second.candidateId, candidateSha256: second.candidateSha256,
        targetId: id(21), evidence: second.evidence },
      { decision: 'reject', candidateId: several.candidateId, candidateSha256: several.candidateSha256,
        reason: 'The letter names two houses; it is not one building.' }] });
    expect('linkManifestSha256' in body.additions).toBe(false);
    expect(validate(schemas.stored, stored(body))).toEqual([]);

    const html = form(ready, { result });
    expect(html).toContain(`<p>${note}</p>`);
    expect(html).toContain(`Confirmation <span class="ul-mono">${id(80)}</span>.`);
    expect(html).toContain('The citations are written when the building is carried to its card.');
  });

it('confirms no additions only when asked, naming the buildings of the key\'s candidates; an unreviewed package is '
  + 'named in words', async () => {
  const bodies = stubServer([(body) => ({ status: 202, body: stored(body) })]);
  const send = createEvidenceConfirmation(caseId);
  expect(await pressConfirm(caseId, profile, read, ready, send, targetsReadPins()))
    .toEqual({ missing: 'Accept or reject a candidate, or confirm that this key adds no citations.' });
  expect(await pressConfirm(caseId, profile, read, { ...ready, noAdditions: true }, send,
    targetsReadPins(pkg(11, 4, null)))).toEqual({ missing: 'Feature at index 21: its package has no current review, '
    + 'so it cannot be named yet.' });
  const result = await pressConfirm(caseId, profile, read, { ...ready, noAdditions: true }, send, targetsReadPins());
  expect(bodies[0]!.additions).toEqual({ kind: 'no_additions' });
  expect(validate(schemas.confirm, bodies[0])).toEqual([]);
  expect(bodies[0]!.targets.map((row) => row.targetId)).toEqual([id(20), id(21), id(22)]);
  expect(form(ready, { result })).not.toContain('citations are written');
});

it('a refusal shows the server\'s words and code and reads the evidence again; the next press is a new request',
  async () => {
    const refusals = [
      { code: 'INTAKE_EVIDENCE_STALE',
        message: `Source item ${register.itemId} has another reading under this profile.` },
      { code: 'INTAKE_EVIDENCE_NOT_MATCHED', message: `Candidate ${first.candidateId} is several: only a matched `
        + 'candidate becomes a citation; several, conflicting and no_match are never written.' },
      { code: 'INTAKE_CONFIRMATION_PENDING', message: `Package ${id(10)} is already being recorded.` },
    ];
    const bodies = stubServer([...refusals.map((error) => () => ({ status: 409, body: { error } })),
      () => new TypeError('Network response was lost.'), (body) => ({ status: 202, body: stored(body) })]);
    const send = createEvidenceConfirmation(caseId);
    const draft = { ...ready, choices: acceptFile({}, decidable(page, profile), register.itemId) };
    const client = { invalidateQueries: vi.fn(async () => undefined) };
    for (const refusal of refusals) {
      const error = await pressConfirm(caseId, profile, read, draft, send, targetsReadPins())
        .then(() => null, (value: Error) => value);
      expect(error).toBeInstanceOf(ApiError);
      const html = form(draft, { error });
      expect(html).toContain('role="alert"');
      expect(html).toContain(`${refusal.message} (${refusal.code})`);
      expect(html).toContain('The evidence and the buildings were read again; check them and confirm again.');
      client.invalidateQueries.mockClear();
      rereadAfterRefusal(client, caseId, error);
      expect(client.invalidateQueries.mock.calls).toEqual([[{ queryKey: evidenceKey(caseId) }],
        [{ queryKey: runKey(caseId) }]]);
    }
    await expect(pressConfirm(caseId, profile, read, draft, send, targetsReadPins()))
      .rejects.toThrow('Network response was lost.');
    await pressConfirm(caseId, profile, read, draft, send, targetsReadPins());
    const keys = bodies.map((body) => body.requestKey);
    expect(new Set(keys.slice(0, 4)).size).toBe(4);
    expect(keys[4]).toBe(keys[3]);
    client.invalidateQueries.mockClear();
    rereadAfterRefusal(client, caseId, new ApiError(500, '/api', null));
    expect(client.invalidateQueries).not.toHaveBeenCalled();
  });
