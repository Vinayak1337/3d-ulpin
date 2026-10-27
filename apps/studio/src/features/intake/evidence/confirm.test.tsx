import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { ApiError } from '@ulpin/api-client';
import { afterEach, expect, it, vi } from 'vitest';
import { createContractValidator } from '../../../local/contract';
import type { IntakeItem } from '../batch-model';
import type { Package, Target, TargetPage } from '../run/model';
import { runKey } from '../run/useTargets';
import { createEvidenceConfirmation, evidenceKey, readPackagePins } from './api';
import { blankDraft, ConfirmEvidence, ConfirmEvidenceForm, pressAcceptFile, pressConfirm, rereadAfterRefusal,
  type ConfirmDraft, type ConfirmRead, type FileAccepts } from './ConfirmEvidence';
import { acceptedIds, acceptFile, confirmedOf, decidable, reconcileChoices, setAccept, setReject, type ConfirmBody,
  type EvidenceConfirmation } from './confirm-model';
import type { Candidate, EvidencePage, KeyProfile } from './model';
import { refreshConfirmation } from './confirm-refresh';
import { EvidenceRead } from './EvidenceRead';
import { expectDisabledReasons } from './disabled-reasons.test-support';
import { container, elements, propsOf, type FakeElement } from '../fake-dom';

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
      coverage: closed, sourceId: id(53), sourceRevision: 2, sourceSha256: sha('c'), bytes: 87,
      source: { state: 'retained' } },
    { itemId: late.itemId, profileId: profile.profileId, family: 'table', jobId: id(43), resultSha256: null,
      coverage: { state: 'reading', read: 40, eligible: null, keyless: null, unread: null, failed: null },
      sourceId: id(54), sourceRevision: 1, sourceSha256: sha('7'), bytes: 900, source: { state: 'retained' } },
    { itemId: letter.itemId, profileId: profile.profileId, family: 'document', jobId: id(41), resultSha256: sha('2'),
      coverage: { state: 'closed', read: 1, eligible: 1, keyless: 0, unread: 0, failed: 0 }, sourceId: id(56),
      sourceRevision: 1, sourceSha256: sha('1'), bytes: 22, source: { state: 'retained' } }],
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
const idle: FileAccepts = { reading: null, words: {}, error: null, accept: vi.fn() };
const form = (draft: ConfirmDraft, extra: Partial<Parameters<typeof ConfirmEvidenceForm>[0]> = {}) =>
  renderToStaticMarkup(<ConfirmEvidenceForm profile={profile} read={read} draft={draft} change={vi.fn()}
    pending={false} submit={vi.fn()} close={vi.fn()} result={null} error={null} files={idle} {...extra} />);
/** The candidates of the page shown, read as one file's matches. */
const pageFile = (itemId: string) => ({ itemId, matches: decidable(page, profile), more: false });
const acceptRegister = () => acceptFile({}, pageFile(register.itemId)).choices;

type Reply = { status: number; body: unknown };
/** A fake server: each evidence read and each confirmation is answered by the given functions. */
function stubEvidence(readPage: (query: URLSearchParams) => EvidencePage, confirm: (body: ConfirmBody) => Reply) {
  const reads: Record<string, string>[] = [], bodies: ConfirmBody[] = [];
  vi.stubGlobal('fetch', async (request: Request) => {
    const url = new URL(request.url);
    if (request.method === 'GET') {
      expect(url.pathname).toBe(`/api/v1/ingestion/cases/${caseId}/intake/evidence`);
      reads.push(Object.fromEntries(url.searchParams));
      return Response.json(readPage(url.searchParams));
    }
    const body = await request.json() as ConfirmBody;
    bodies.push(body);
    const reply = confirm(body);
    return Response.json(reply.body, { status: reply.status });
  });
  return { reads, bodies };
}
const ready: ConfirmDraft = { ...blankDraft, acknowledgement: 'I checked each row against its building.',
  exclusions: { [late.itemId]: 'Its reading is still open; I confirm it later.' } };

it('accepts every exact single match of a file in one press; each stays unselectable and no question is selected',
  () => {
    expect(validate(schemas.page, page)).toEqual([]);
    const candidates = decidable(page, profile);
    expect(candidates).toEqual([first, second, conflicting, several]);
    const all = acceptRegister();
    expect(Object.keys(all)).toEqual([first.candidateId, second.candidateId]);
    expect(Object.values(all).every((choice) => choice.decision === 'accept')).toBe(true);
    expect(acceptFile({}, pageFile(letter.itemId))).toEqual({ choices: {},
      words: 'This file has no exact single match under this key.' });
    const one = setAccept(all, first, false);
    expect(Object.keys(one)).toEqual([second.candidateId]);
    const html = form({ ...blankDraft, choices: one });
    expect(html).toContain('>Accept every exact single match of this file</button>');
    expect(html).toContain('<input type="checkbox"/>Accept 12/4 for Feature 14 of outlines.geojson');
    expect(html).toContain('<input type="checkbox" checked=""/>Accept 12/5 for Feature 15 of outlines.geojson');
    expect(html).toContain('Your decisions: 1 accepted, 0 rejected');
    expect(html).toContain('aria-label="Undo the decision on 12/5, register.csv, column “House no”, row 8"');
  });

it('lists an unavailable file without accept or exclude controls and never sends its confirmation', async () => {
  const reason = 'The item no longer has a retained source in this batch.';
  const unavailable: EvidencePage = { ...page, sources: page.sources.map((source) =>
    source.itemId === register.itemId ? { ...source, sourceId: null, sourceRevision: null, sourceSha256: null,
      bytes: null, source: { state: 'unavailable', reason } } : source) };
  expect(validate(schemas.page, unavailable)).toEqual([]);
  expect(decidable(unavailable, profile)).toEqual([several]);
  const readUnavailable = { ...read, page: unavailable };
  const html = form(ready, { read: readUnavailable });
  expectDisabledReasons(html);
  expect(html).toContain(reason);
  expect(html).not.toContain('Accept 12/4');
  expect(html).not.toContain('Accept 12/5');
  expect(html).not.toContain('Exclude register.csv');
  expect(html.match(/>Accept every exact single match of this file<\/button>/g)).toHaveLength(2);
  expect(html).toContain('>Exclude letter.pdf');
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Confirm the evidence<\/button>/);
  const send = vi.fn();
  const draft = { ...ready, choices: acceptRegister() };
  expect(await pressConfirm(caseId, profile, readUnavailable, draft, send, targetsReadPins()))
    .toEqual({ missing: 'register.csv: this key cannot be confirmed while a source is unavailable.' });
  expect(await pressConfirm(caseId, profile, readUnavailable,
    { ...draft, exclusions: { ...draft.exclusions, [register.itemId]: 'Source gone.' } }, send, targetsReadPins()))
    .toEqual({ missing: 'register.csv: this key cannot be confirmed while a source is unavailable.' });
  expect(send).not.toHaveBeenCalled();
});

// S1.3 run 3: pressed with words typed while late.csv was still being read; no request was sent and nothing showed.
it('EV2: holds the press while an included file is still being read and says why in plain words', () => {
  const typed = { ...ready, choices: acceptRegister(), exclusions: {} };
  const html = form(typed);
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>\s*Confirm the evidence\s*<\/button>/);
  expectDisabledReasons(html);
  expect(html).toContain('late.csv is still being read.');
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Accept every exact single match of this file<\/button>/);
  expect(html).toMatch(/late\.csv<\/strong>\. [^<]* Still being read\./);
  const excluded = form({ ...typed, exclusions: ready.exclusions });
  expect(excluded).not.toMatch(/<button[^>]*disabled=""[^>]*>\s*Confirm the evidence\s*<\/button>/);
  expectDisabledReasons(excluded);
  expect(excluded).not.toContain('late.csv is still being read.');
});

it('describes a failed evidence refresh, offers retry, and removes the reason when enabled', () => {
  const closedRead = { ...read, page: { ...page, sources: [page.sources[0]!] } };
  const blocked = form(ready, { read: closedRead, blocked: true, retry: vi.fn() });
  expect(expectDisabledReasons(blocked)).toBe(1);
  expect(blocked).toContain('The current evidence could not be read.');
  expect(blocked).toContain('Try again</button>');
  const enabled = form(ready, { read: closedRead });
  expect(expectDisabledReasons(enabled)).toBe(0);
  expect(enabled).not.toContain('var(--ui-ink-soft)');
});

it('never accepts a conflicting or several candidate; the officer may reject one with reason words', async () => {
  for (const question of [conflicting, several]) {
    expect(setAccept({}, question, true)).toEqual({});
    expect(setReject({}, first, 'not mine')).toEqual({});
  }
  const html = form({ ...blankDraft, choices: setReject({}, conflicting, '') });
  expect(html).not.toContain('Accept 12/6');
  expect(html).not.toContain('Accept 12/7');
  expect(html).toContain('Question · Feature 14 of outlines.geojson');
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

it('EV2: a newer reading is offered again and can be confirmed against the committed package review', async () => {
  const newer: EvidencePage = { ...page, confirmations: [{ confirmationId: id(80), profileId: profile.profileId,
    additions: 'citations', createdAt: at, expiresAt: at, newerSources: [], accepted: [first.candidateId],
    superseded: true }], sources: page.sources.map(source => source.itemId === register.itemId
      ? { ...source, jobId: id(90), resultSha256: sha('8') } : source) };
  expect(validate(schemas.page, newer)).toEqual([]);
  const show = (current: EvidencePage) => renderToStaticMarkup(<EvidenceRead page={current} items={items}
    targets={targets} paging={{ outcome: '', first: true, loading: false, setOutcome: vi.fn(),
      firstPage: vi.fn(), nextPage: null }} />);
  expect(show(newer)).toContain('A file has a newer evidence reading; confirm its matches again.');
  expect(show({ ...newer, confirmations: [...newer.confirmations, { ...newer.confirmations[0]!,
    confirmationId: id(93), superseded: false }] })).not.toContain('A file has a newer evidence reading');
  const choices = acceptFile({}, { itemId: register.itemId, matches: [first], more: false },
    confirmedOf(newer, profile)).choices;
  expect(Object.keys(choices)).toEqual([first.candidateId]);
  const earlierBody: ConfirmBody = { requestKey: id(92), acknowledgement: ready.acknowledgement,
    profileId: profile.profileId, profileSha256: profile.profileSha256,
    included: [{ itemId: register.itemId, sourceId: id(53), sourceRevision: 2, sourceSha256: sha('c'), bytes: 87,
      jobId: id(40), resultSha256: sha('d'), coverage: closed }], excluded: [],
    targets: [{ targetId: first.anchors[0]!.targetId, packageId: id(10), packageRevision: 3,
      reviewFingerprint: sha('e') }],
    additions: { kind: 'citations', decisions: [{ decision: 'accept', candidateId: first.candidateId,
      candidateSha256: first.candidateSha256, targetId: first.anchors[0]!.targetId,
      evidence: first.evidence as never }] } };
  expect(confirmedOf(newer, profile, [stored(earlierBody)]).has(first.candidateId)).toBe(false);
  const committed: Package = { ...pkg(10, 4, sha('e')), state: 'COMMITTED' };
  const send = vi.fn(async (input) => stored({ ...input, requestKey: id(91) }));
  const result = await pressConfirm(caseId, profile, { ...read, page: newer }, { ...ready, choices }, send,
    async () => new Map([[committed.packageId, committed]]));
  expect(result).toHaveProperty('confirmation');
  expect(send).toHaveBeenCalledOnce();
  expect(send.mock.calls[0]![0].targets).toEqual([{ targetId: first.anchors[0]!.targetId,
    packageId: committed.packageId, packageRevision: 3, reviewFingerprint: sha('e') }]);
  expect(send.mock.calls[0]![0].included[0].jobId).toBe(id(90));
});

it('sends closed sources with every pin, named buildings with fingerprints and the decisions, but no manifest hash',
  async () => {
    const choices = setReject(acceptRegister(), several,
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
    const draft = { ...ready, choices: acceptRegister() };
    const client = { invalidateQueries: vi.fn(async () => undefined) };
    for (const refusal of refusals) {
      const error = await pressConfirm(caseId, profile, read, draft, send, targetsReadPins())
        .then(() => null, (value: Error) => value);
      expect(error).toBeInstanceOf(ApiError);
      const html = form(draft, { error });
      expect(html).toContain('role="alert"');
      expect(html).toContain(`${refusal.message} (${refusal.code})`);
      expect(html).toContain('Read the current evidence, check your selections and confirm again.');
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

it('a file on one page is accepted as before: one read names the key, the file and the matched outcome', async () => {
  const { reads } = stubEvidence(() => ({ ...page, candidates: [first, second] }), () => ({ status: 500, body: {} }));
  const press = await pressAcceptFile(caseId, profile, register.itemId, {}, new Set());
  expect(press).toEqual({ choices: acceptRegister(), words: null });
  expect(reads).toEqual([{ outcome: 'matched', profileId: profile.profileId, itemId: register.itemId }]);
  // Every file read under the key has the button, as a match may sit on a later page.
  expect(form(blankDraft).match(/>Accept every exact single match of this file<\/button>/g)).toHaveLength(3);
});

it('accepts a file\'s matches over every page, 100 at a time; the next press continues after a stored confirmation',
  async () => {
    const many = Array.from({ length: 250 }, (_, n) => candidate(1000 + n, 'matched', `H-${n}`,
      row(n + 2, `H-${n}`), [anchor(20, `H-${n}`)]));
    const cut = many[199]!.candidateId;
    const pages: EvidencePage[] = [{ ...page, candidates: many.slice(0, 200), nextCursor: cut },
      { ...page, candidates: many.slice(200), nextCursor: null }];
    for (const one of pages) expect(validate(schemas.page, one)).toEqual([]);
    const { reads, bodies } = stubEvidence((query) => pages[query.get('cursor') === cut ? 1 : 0]!,
      (body) => ({ status: 202, body: stored(body) }));
    const ids = (from: number, to: number) => many.slice(from, to).map((match) => match.candidateId);
    const words = 'This file has 250 exact single matches; one confirmation takes 100. Confirm these, then accept '
      + 'the next 100.';
    const confirmed = new Set<string>();

    const once = await pressAcceptFile(caseId, profile, register.itemId, {}, confirmed);
    expect(Object.keys(once.choices)).toEqual(ids(0, 100));
    expect(once.words).toBe(words);
    const filter = { outcome: 'matched', profileId: profile.profileId, itemId: register.itemId };
    expect(reads).toEqual([filter, { ...filter, cursor: cut }]);
    const html = form({ ...ready, choices: once.choices }, { files: { ...idle, words: { [register.itemId]: words } } });
    expect(html).toContain(`<p role="status">${words}</p>`);
    expect(html).toContain('Your decisions: 100 accepted, 0 rejected');

    const send = createEvidenceConfirmation(caseId);
    const result = await pressConfirm(caseId, profile, read, { ...ready, choices: once.choices }, send,
      targetsReadPins());
    if (!('confirmation' in result)) throw new Error(result.missing);
    expect(validate(schemas.confirm, bodies[0])).toEqual([]);
    expect(bodies[0]!.additions.kind === 'citations' && bodies[0]!.additions.decisions.length).toBe(100);
    for (const candidateId of acceptedIds(result.confirmation)) confirmed.add(candidateId);

    const next = await pressAcceptFile(caseId, profile, register.itemId, {}, confirmed);
    expect(Object.keys(next.choices)).toEqual(ids(100, 200));
    expect(next.words).toBe(`${words} 100 were confirmed already here and are not offered again.`);
    for (const candidateId of ids(100, 200)) confirmed.add(candidateId);
    const last = await pressAcceptFile(caseId, profile, register.itemId, {}, confirmed);
    expect(Object.keys(last.choices)).toEqual(ids(200, 250));
    expect(last.words).toBe('200 were confirmed already here and are not offered again.');
    // Decisions already made on other candidates leave less room in the same confirmation.
    const shared = await pressAcceptFile(caseId, profile, register.itemId,
      setReject({}, several, 'Two houses.'), new Set());
    expect(Object.keys(shared.choices)).toHaveLength(100);
    expect(shared.words).toBe(`${words} 1 other decision is already made, so 99 are selected.`);
  });

it('after a reload the stored confirmations the read lists for the key are not offered again; the press continues',
  async () => {
    const many = Array.from({ length: 250 }, (_, n) => candidate(3000 + n, 'matched', `R-${n}`,
      row(n + 2, `R-${n}`), [anchor(20, `R-${n}`)]));
    const ids = (from: number, to: number) => many.slice(from, to).map((match) => match.candidateId);
    const state = (n: number, profileId: string, accepted: string[]) => ({ confirmationId: id(n), profileId,
      additions: 'citations' as const, createdAt: at, expiresAt: at, newerSources: [], accepted });
    // As read after a reload: this key's confirmation of the first 100, and another key's that names the next ten.
    const reloaded: EvidencePage = { ...page, candidates: many.slice(0, 200), nextCursor: many[199]!.candidateId,
      confirmations: [state(81, profile.profileId, ids(0, 100)), state(82, id(32), ids(100, 110)),
        { ...state(83, profile.profileId, []), additions: 'no_additions' }] };
    expect(validate(schemas.page, reloaded)).toEqual([]);
    stubEvidence((query) => query.get('cursor') ? { ...reloaded, candidates: many.slice(200), nextCursor: null }
      : reloaded, () => ({ status: 500, body: {} }));
    const confirmed = confirmedOf(reloaded, profile);
    expect([...confirmed]).toEqual(ids(0, 100));
    const next = await pressAcceptFile(caseId, profile, register.itemId, {}, confirmed);
    expect(Object.keys(next.choices)).toEqual(ids(100, 200));
    expect(next.words).toContain('100 were confirmed already here and are not offered again.');
    // A confirmation stored since the read is merged with the read's own.
    const since = await pressAcceptFile(caseId, profile, register.itemId, {},
      confirmedOf(reloaded, profile, [stored({ requestKey: id(92), profileId: profile.profileId,
        profileSha256: profile.profileSha256, included: [], excluded: [], targets: [], acknowledgement: 'Checked.',
        additions: { kind: 'citations', decisions: many.slice(100, 200).map(candidate => ({ decision: 'accept',
          candidateId: candidate.candidateId, candidateSha256: candidate.candidateSha256,
          targetId: candidate.anchors[0]!.targetId, evidence: candidate.evidence as never })) } })]));
    expect(Object.keys(since.choices)).toEqual(ids(200, 250));
  });

it('refreshes selected candidates from later pages, keeps re-pinned evidence and drops disappeared rows in words',
  async () => {
    const repinned = { ...first, candidateSha256: sha('8'), anchors: [{ ...first.anchors[0]!, packageRevision: 4 }] };
    const changed = { ...page, candidates: [repinned], nextCursor: null };
    const reads = vi.fn(async (_case: string, _outcome?: unknown, cursor?: string, filter?: unknown) => {
      if (!filter) return { ...changed, candidates: [], nextCursor: 'other-page' };
      return cursor ? changed : { ...changed, candidates: [], nextCursor: 'selected-page' };
    });
    const draft = { ...ready, choices: acceptRegister() };
    const visible = { ...read, query: { outcome: 'matched' as const, cursor: 'visible-page' } };
    const refreshed = await refreshConfirmation(caseId, profile, draft, visible, reads, targetsReadPins());
    expect(refreshed.choices).toEqual({ [first.candidateId]: { decision: 'accept', candidate: repinned } });
    expect(refreshed.words).toContain('The package review or evidence reading changed for: 12/4');
    expect(refreshed.words).toContain('Selections removed: 12/5');
    expect(refreshed.words).toContain('candidate disappeared');
    expect(reads.mock.calls.map(call => call[2])).toEqual(['visible-page', undefined, 'selected-page']);
    expect(reads.mock.calls[0]![1]).toBe('matched');
  });

it('drops a former match if its row, building or outcome changed instead of transferring the decision', () => {
  const choices = setAccept({}, first, true);
  const changed = [
    { ...first, evidence: row(99, '12/4') } as Candidate,
    { ...first, anchors: [anchor(21, '12/4')] },
    { ...first, outcome: 'several' as const },
  ];
  for (const candidate of changed) {
    expect(reconcileChoices(choices, [candidate]).choices).toEqual({});
  }
});

const flushForm = () => act(() => new Promise(resolve => setTimeout(resolve, 20)));
const pressNode = (node: FakeElement) => act(async () => { propsOf(node).onClick?.({}); });
const namedButton = (root: FakeElement, words: string) => elements(root)
  .find(node => node.tagName === 'BUTTON' && node.textContent === words)!;
const acknowledgement = (root: FakeElement) => elements(root).find(node => node.tagName === 'TEXTAREA')!;
const checkFile = (root: FakeElement, words: string) => elements(root)
  .find(node => node.tagName === 'LABEL' && node.textContent === words)!
  .childNodes.find(node => node.nodeName === 'INPUT') as FakeElement;
const typeAcknowledgement = (root: FakeElement) => act(async () => {
  propsOf(acknowledgement(root)).onChange?.({ target: { value: ready.acknowledgement } });
});
const submitForm = (root: FakeElement) => act(async () => {
  const form = elements(root).find(node => node.tagName === 'FORM')!;
  propsOf(form).onSubmit?.({ preventDefault() {} });
});

/** An offline server that may advance its reading while the officer form stays open. */
function advancingEvidence(refuseOnce: boolean) {
  let currentPage = page;
  const bodies: ConfirmBody[] = [];
  vi.stubGlobal('fetch', async (request: Request) => {
    const url = new URL(request.url);
    if (request.method === 'POST') {
      const body = await request.json() as ConfirmBody;
      bodies.push(body);
      if (refuseOnce && bodies.length === 1) {
        currentPage = { ...page, candidates: page.candidates.map(candidate => ({ ...candidate,
          candidateSha256: sha('8'), anchors: candidate.anchors.map(anchor => ({ ...anchor, packageRevision: 4 })) })) };
        return Response.json({ error: { code: 'INTAKE_EVIDENCE_STALE', message: 'The package review changed.' } },
          { status: 409 });
      }
      return Response.json(stored(body), { status: 202 });
    }
    if (url.pathname.endsWith('/targets')) return Response.json({ caseId, items: targets, counts, nextCursor: null,
      packages: [pkg(10, currentPage === page ? 3 : 4, sha('e')), pkg(11, 4, sha('9'))],
      packagesTruncated: false, packagesNextCursor: null });
    expect(url.pathname).toBe(`/api/v1/ingestion/cases/${caseId}/intake/evidence`);
    return Response.json({ ...currentPage, candidates: currentPage.candidates.filter(candidate =>
      (!url.searchParams.has('itemId') || candidate.evidence.itemId === url.searchParams.get('itemId'))
      && (!url.searchParams.has('outcome') || candidate.outcome === url.searchParams.get('outcome'))) });
  });
  return { bodies, changePage: (value: EvidencePage) => { currentPage = value; } };
}

async function liveForm(refuseOnce: boolean) {
  const server = advancingEvidence(refuseOnce);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = container();
  const view = createRoot(root as never);
  await act(async () => view.render(<QueryClientProvider client={client}>
    <ConfirmEvidence caseId={caseId} profile={profile} read={read} close={vi.fn()} confirmed={new Set()}
      stored={vi.fn()} />
  </QueryClientProvider>));
  await flushForm();
  await pressNode(namedButton(root, 'Accept every exact single match of this file'));
  await flushForm();
  await act(async () => propsOf(checkFile(root, 'Exclude late.csv')).onChange?.({ target: { checked: true } }));
  const reason = elements(root).find(node => node.tagName === 'INPUT'
    && node.parentNode?.textContent === 'Reason for excluding late.csv')!;
  await act(async () => propsOf(reason).onChange?.({ target: { value: ready.exclusions[late.itemId] } }));
  await typeAcknowledgement(root);
  return { root, client, ...server,
    unmount: () => act(async () => { view.unmount(); client.clear(); }) };
}

it('a stale 409 rereads the mounted form, preserves selections and requires a new press with fresh pins', async () => {
  const form = await liveForm(true);
  try {
    await submitForm(form.root);
    await flushForm();
    await flushForm();
    expect(form.bodies).toHaveLength(1);
    expect(form.root.textContent).toContain('The package review or evidence reading changed for: 12/4, 12/5');
    expect(form.root.textContent).toContain('Check your selections and confirm again');
    expect(form.root.textContent).toContain('Your decisions: 2 accepted, 0 rejected');
    expect(propsOf(acknowledgement(form.root)).value).toBe('');
    await typeAcknowledgement(form.root);
    await submitForm(form.root);
    await flushForm();
    expect(form.bodies).toHaveLength(2);
    const body = form.bodies[1]!;
    expect(body.requestKey).not.toBe(form.bodies[0]!.requestKey);
    expect(body.targets[0]!.packageRevision).toBe(4);
    expect(body.additions.kind === 'citations' && body.additions.decisions.every(decision =>
      decision.candidateSha256 === sha('8'))).toBe(true);
    expect(form.root.textContent).toContain('Confirmation');
  } finally { await form.unmount(); }
});

it('an unrelated batch update does not erase the officer acknowledgement or change selections', async () => {
  const form = await liveForm(false);
  try {
    await act(async () => { await form.client.invalidateQueries({ queryKey: ['intake', caseId] }); });
    await flushForm();
    expect(propsOf(acknowledgement(form.root)).value).toBe(ready.acknowledgement);
    expect(form.root.textContent).toContain('Your decisions: 2 accepted, 0 rejected');
    expect(form.root.textContent).not.toContain('nothing was confirmed automatically');
    expect(form.bodies).toHaveLength(0);
  } finally { await form.unmount(); }
});

const rehearsalRead = 'E:/BhuAayam-data/task-data/reh15/final-act1.json';
it.skipIf(!existsSync(rehearsalRead))('keeps the real rehearsal register row and drops it if its evidence is gone',
  () => {
    const saved = JSON.parse(readFileSync(rehearsalRead, 'utf8')).evidence as EvidencePage;
    const candidate = saved.candidates.find(single => single.outcome === 'matched' && single.anchors.length === 1)!;
    expect(candidate.evidence.kind).toBe('table_row');
    const choices = setAccept({}, candidate, true);
    expect(reconcileChoices(choices, [candidate])).toEqual({ choices, words: '' });
    const removed = reconcileChoices(choices, []);
    expect(removed.choices).toEqual({});
    expect(removed.words).toContain(`Selections removed: ${candidate.key.literal}`);
  });

it('a batch-stream refresh drops a disappeared selection and asks the officer again without sending', async () => {
  const form = await liveForm(false);
  try {
    form.changePage({ ...page, candidates: [first] });
    await act(async () => { await form.client.invalidateQueries({ queryKey: ['intake', caseId] }); });
    await flushForm();
    expect(form.bodies).toHaveLength(0);
    expect(form.root.textContent).toContain('Selections removed: 12/5');
    expect(form.root.textContent).toContain('candidate disappeared');
    expect(form.root.textContent).toContain('Your decisions: 1 accepted, 0 rejected');
    expect(form.root.textContent).toContain('confirm again');
    expect(propsOf(acknowledgement(form.root)).value).toBe('');
  } finally { await form.unmount(); }
});
