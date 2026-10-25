import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api, ApiError } from '@ulpin/api-client';
import { INTAKE_EVIDENCE_VERSION, IntakeEvidencePageSchema } from '../../../../../../packages/contracts/src/usp/intake';
import capturedConfirmation from '../../../../../../docs/evidence/gf1/e3b/confirmation.json';
import capturedTargets from '../../../../../../docs/evidence/gf1/e3b/targets.json';
import { readTargetByFeature } from '../../intake/run/api';
import { confirmBody, readinessLabels, type Confirmation, type Target,
  type TargetPage } from '../../intake/run/model';
import { useConfirmationCommand } from '../../intake/run/useConfirmationCommand';
import { intakeKey } from '../../intake/batch-queries';
import type { Candidate, EvidencePage } from '../../intake/evidence/model';
import { BuildingCard, BuildingCardDialog, TargetCard, buildingTargetKey } from './BuildingCard';
import { BuildingLinks, featureLinksKey, readFeatureLinks } from './BuildingLinks';
import { linkReview } from './evidence';
import { cardState, followCard, type CardState } from './cardState';
import { WindowedInspector } from '../WindowedArea';
import type { AreaWindowFeature } from '../../../api/queries';

// Captured from the run of 11 October (E3B): a ready building, and the same building carded and verified.
const { choiceIds: _, ...page } = capturedTargets;
const ready = page.items[0] as Target;
const confirmation = capturedConfirmation as Confirmation;
const carded = confirmation.progress[0]!;
// The carded building as it stood after its package was recorded and before any card was asked for.
const recorded: Target = { ...carded, stage: 3, readiness: 'recorded', confirmationId: null,
  reason: 'Recorded with its package; not listed for a card.', artefacts: { record: carded.artefacts.record } };
const listed: Target = { ...recorded, confirmationId: confirmation.confirmationId,
  reason: 'Listed for a card; it is carded in the order listed.' };

afterEach(() => vi.restoreAllMocks());

function shown(node: ReactNode, client = new QueryClient()) {
  return renderToStaticMarkup(<QueryClientProvider client={client}><MemoryRouter>{node}</MemoryRouter>
  </QueryClientProvider>);
}

function answers(...targets: Target[]) {
  const reads: unknown[] = [];
  vi.spyOn(api, 'GET').mockImplementation(async (route, options) => {
    expect(route).toBe('/api/v1/ingestion/intake/targets/by-feature');
    reads.push((options as { params: { query: unknown } }).params.query);
    return { data: targets[reads.length - 1], response: new Response(null, { status: 200 }) } as never;
  });
  return reads;
}

it('a recorded building with no card: one press stores the cards-only confirmation, the run is followed to the '
  + 'card, and the card dialog opens', async () => {
  expect(cardState(recorded)).toBe('make');
  const offer = shown(<TargetCard target={recorded} name="763933" refetch={() => {}} />);
  expect(offer).toContain('Acknowledgement');
  expect(offer).toMatch(/<button[^>]*disabled=""[^>]*>Make card<\/button>/);

  let command: ReturnType<typeof useConfirmationCommand> | undefined;
  let stored = 0;
  function Press() {
    command = useConfirmationCommand(recorded.caseId, () => { stored++; }, () => {});
    return null;
  }
  renderToStaticMarkup(<Press />);
  const post = vi.spyOn(api, 'POST').mockResolvedValue({ data: confirmation,
    response: new Response(null, { status: 202 }) } as never);
  const words = 'I confirm the card of building 763933 only.';
  await command!.pressCards([recorded], words);
  expect(post).toHaveBeenCalledTimes(1);
  const [route, { body }] = post.mock.calls[0] as unknown as [string, { body: ReturnType<typeof confirmBody> }];
  expect(route).toBe('/api/v1/ingestion/cases/{caseId}/confirmations');
  expect(body).toEqual({ requestKey: body.requestKey, acknowledgement: words, packages: [],
    targets: [recorded.targetId] });
  expect(body).toEqual(confirmBody(page as TargetPage, [recorded], words, body.requestKey, true));
  expect(stored).toBe(1);

  const reads = answers(listed, carded);
  let follow = { watched: true, open: false };
  const states: CardState[] = [];
  for (let step = 0; step < 2; step++) {
    const state = cardState(await readTargetByFeature(recorded.featureId));
    states.push(state);
    follow = followCard(follow.watched, state);
  }
  expect(states).toEqual(['making', 'carded']);
  expect(reads).toEqual([{ featureId: recorded.featureId }, { featureId: recorded.featureId }]);
  expect(follow.open).toBe(true);
  const making = shown(<TargetCard target={listed} name="763933" refetch={() => {}} />);
  expect(making).toContain(listed.reason);
  expect(making).toContain('feature 763933');
  expect(making).not.toContain('Make card');

  const dialog = shown(<BuildingCardDialog target={carded} name="763933" onClose={() => {}} />);
  expect(dialog).toContain('role="dialog"');
  expect(dialog).toContain('Property card · 763933');
  expect(dialog).toContain(`/api/v1/usp/property-cards/${carded.artefacts.card!.id}/revisions/1`);
  expect(dialog).toContain(`/verify/card/${carded.artefacts.card!.id}/1`);
  expect(dialog).toContain('Card consistent');
});

it('a carded building offers its card and opens it only when asked', () => {
  expect(cardState(carded)).toBe('carded');
  const markup = shown(<TargetCard target={carded} name="763933" refetch={() => {}} />);
  expect(markup).toContain('Open card');
  expect(markup).not.toContain('role="dialog"');
  expect(followCard(false, 'carded')).toEqual({ watched: false, open: false });
});

it('a building not recorded states its readiness in words and links its batch; nothing is offered', () => {
  expect(cardState(ready)).toBe('other');
  const markup = shown(<TargetCard target={ready} name="763933" refetch={() => {}} />);
  expect(markup).toContain(readinessLabels.ready);
  expect(markup).toContain(`href="/studio/work/cases/${ready.caseId}/intake"`);
  expect(markup).not.toContain('Make card');
  expect(cardState({ ...carded, artefacts: {} })).toBe('other');
});

it('a building no target names shows nothing; a server without the read is an error, never "none"', async () => {
  const get = vi.spyOn(api, 'GET').mockResolvedValueOnce({ error: { error: { code: 'NOT_FOUND',
    message: 'No intake target names this building.' } }, response: new Response(null, { status: 404 }) } as never);
  expect(await readTargetByFeature(ready.featureId, ready.packageId)).toBeNull();
  expect((get.mock.calls[0]![1] as { params: { query: unknown } }).params.query)
    .toEqual({ featureId: ready.featureId, packageId: ready.packageId });
  get.mockResolvedValueOnce({ error: { error: { code: 'NOT_FOUND', message: 'This operation is not available.' } },
    response: new Response(null, { status: 404 }) } as never);
  await expect(readTargetByFeature(ready.featureId)).rejects.toThrow('This operation is not available.');

  const client = new QueryClient();
  client.setQueryData(buildingTargetKey(ready.featureId), null);
  expect(shown(<BuildingCard featureId={ready.featureId} name="763933" />, client)).toBe('');
  expect(cardState(null)).toBe('none');
});

it('a recorded building picked in a windowed area offers the same press, read by its feature alone', () => {
  const client = new QueryClient();
  client.setQueryData(buildingTargetKey(recorded.featureId), recorded);
  const feature: AreaWindowFeature = { id: recorded.featureId, identifier: '763933', kind: 'building',
    polygons: [], heightM: null, heightState: 'unknown', displayState: 'recorded' };
  const markup = shown(<WindowedInspector feature={feature} areaName="Area" onClose={() => {}} />, client);
  expect(markup).toContain('>Open register</a>');
  expect(markup).toContain('Acknowledgement');
  expect(markup).toContain('Make card');
  const parcel = shown(<WindowedInspector feature={{ ...feature, kind: 'parcel' }} areaName="Area"
    onClose={() => {}} />, client);
  expect(parcel).not.toContain('Property card');
});

it('a proposal picked in a windowed area reads its target by feature in the package the window names', async () => {
  const reads = answers(ready);
  const client = new QueryClient();
  const proposal: AreaWindowFeature = { id: ready.featureId, identifier: '763933', kind: 'building', polygons: [],
    heightM: null, heightState: 'unknown', displayState: 'unrecorded_proposal', caseId: ready.caseId,
    packageId: ready.packageId };
  const inspector = <WindowedInspector feature={proposal} areaName="Area" onClose={() => {}} />;
  shown(inspector, client);
  const [query, ...others] = client.getQueryCache().getAll();
  expect(others).toEqual([]);
  expect(query!.queryKey).toEqual(buildingTargetKey(ready.featureId, ready.packageId));
  await query!.fetch();
  expect(reads).toEqual([{ featureId: ready.featureId, packageId: ready.packageId }]);
  const markup = shown(inspector, client);
  expect(markup).toContain('Open batch to confirm');
  expect(markup).toContain(readinessLabels.ready);
});

// test_only: an evidence page built to the published contract for the captured carded building. The row is the real
// gpmc-yuvp.csv logical row 444 (header row 1), whose bin cell reads 1084419; every pin and id is a test value.
const sha = (c: string) => c.repeat(64);
const linkId = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const registerItem = { itemId: linkId(1), name: 'gpmc-yuvp.csv' };
const closed = { state: 'closed', read: 1, eligible: 1, keyless: 0, unread: 0, failed: 0 } as const;
const linkAt = '2026-10-25T00:00:00.000Z';
const anchor = { targetId: carded.targetId, anchorItemId: carded.anchorItemId, packageId: carded.packageId,
  packageRevision: 1, featureId: carded.featureId, locator: carded.locator, sourceId: linkId(2), sourceRevision: 1,
  sourceSha256: sha('a'), sourcePath: '/features/*/properties/bin', literal: '1084419' };
const row = { version: INTAKE_EVIDENCE_VERSION, candidateId: linkId(3), caseId: carded.caseId,
  candidateSha256: sha('b'),
  key: { profileId: linkId(4), profileSha256: sha('c'), namespace: 'Building identification number', kind: 'integer',
    literal: '1084419' },
  evidence: { kind: 'table_row', itemId: registerItem.itemId, caseId: carded.caseId, sourceId: linkId(5),
    sourceRevision: 1, sourceSha256: sha('d'), rawJobId: linkId(6), rawInputSha256: sha('e'), rawResultSha256: sha('f'),
    acceptedFence: 1, selection: { format: 'csv', sheet: 'csv', table: null, headerRows: [1] }, sourceRow: 444,
    rowSha256: sha('1'), columnIndex: 0, columnHeader: 'bin', cell: { state: 'literal', value: '1084419' } },
  outcome: 'matched', anchors: [anchor], conflictGroup: null, sourceCoverage: closed, state: 'candidate',
  qualification: 'not_assessed', createdAt: linkAt } as Candidate;
const evidenceConfirmation = { confirmationId: linkId(7), profileId: linkId(4), additions: 'citations' as const,
  createdAt: linkAt, expiresAt: linkAt, newerSources: [], accepted: [row.candidateId] };
const linkPage = (candidates: Candidate[], confirmations = [evidenceConfirmation]): EvidencePage =>
  ({ caseId: carded.caseId, profiles: [], confirmations, sources: [], candidates,
    counts: { matched: 612, no_match: 60, several: 0, conflicting: 81 }, nextCursor: null }) as EvidencePage;
const cited: Target = { ...carded, artefacts: { ...carded.artefacts,
  evidence: { confirmationIds: [evidenceConfirmation.confirmationId], record: carded.artefacts.record! } } };

function linksShown(target: Target | null, page?: EvidencePage) {
  const client = new QueryClient();
  client.setQueryData(buildingTargetKey(carded.featureId), target);
  client.setQueryData(intakeKey(carded.caseId), { caseId: carded.caseId, items: [registerItem] });
  if (page) client.setQueryData(featureLinksKey(carded.caseId, carded.featureId), page);
  return shown(<BuildingLinks featureId={carded.featureId} />, client);
}

it('the inspector lists a building\'s register link: the file, the row in words, the key as written, the outcome '
  + 'and the officer\'s confirmation, read by the building\'s feature', async () => {
  expect(IntakeEvidencePageSchema.safeParse(linkPage([row])).success).toBe(true);
  const get = vi.spyOn(api, 'GET').mockResolvedValue({ data: linkPage([row]),
    response: new Response(null, { status: 200 }) } as never);
  await readFeatureLinks(carded.caseId, carded.featureId);
  expect(get.mock.calls[0]).toEqual(['/api/v1/ingestion/cases/{caseId}/intake/evidence',
    { params: { path: { caseId: carded.caseId }, query: { featureId: carded.featureId } } }]);

  const markup = linksShown(carded, linkPage([row]));
  expect(markup).toContain('Links to register rows and pages');
  expect(markup).toContain('<b>gpmc-yuvp.csv</b>');
  expect(markup).toContain('CSV logical row 444');
  expect(markup).toContain('Key <span class="ul-mono">bin 1084419</span>');
  expect(markup).toContain('Matched');
  expect(markup).toContain('Confirmed, not cited yet.');
  expect(markup).not.toContain(row.candidateId);
  expect(markup).not.toContain('612');

  expect(linksShown(cited, linkPage([row])))
    .toContain('Cited on the record, revision 1.');
  expect(linkReview(row, [{ ...evidenceConfirmation, superseded: true }], carded)).toEqual({ state: 'reread' });
  expect(linksShown(carded, linkPage([row], [])))
    .toContain('Candidate');
});

it('a conflicting row names its outcome and the other buildings that hold the key', () => {
  const other = { ...anchor, targetId: linkId(8), featureId: linkId(9), locator: 'Feature 15 of buildings.geojson' };
  const conflict = { ...row, outcome: 'conflicting', conflictGroup: linkId(10), anchors: [anchor, other] } as Candidate;
  expect(IntakeEvidencePageSchema.safeParse(linkPage([conflict])).success).toBe(true);
  const markup = linksShown(carded, linkPage([conflict], []));
  expect(markup).toContain('Conflicting');
  expect(markup).toContain('Also names Feature 15 of buildings.geojson');
  expect(markup).not.toContain(`Also names ${carded.locator}`);
});

it('a building no register row or page names says so plainly, with or without a batch', () => {
  expect(linksShown(carded, linkPage([]))).toContain('No links.');
  expect(linksShown(null)).toContain('No links.');
});

it('a failed read of the links, or of the batch that holds the building, says so in its own section', async () => {
  // A static render mounts once: a failed read is shown as it stands, without the retry a mount would start.
  const failing = () => Promise.reject(new ApiError(503, '/api/v1/ingestion/cases/{caseId}/intake/evidence',
    { error: { code: 'UNAVAILABLE', message: 'The evidence store is not reachable.' } }));
  for (const failed of ['links', 'target'] as const) {
    const client = new QueryClient({ defaultOptions: { queries: { retryOnMount: false } } });
    if (failed === 'links') client.setQueryData(buildingTargetKey(carded.featureId), carded);
    await client.prefetchQuery({ retry: false, queryFn: failing, queryKey: failed === 'links'
      ? featureLinksKey(carded.caseId, carded.featureId) : buildingTargetKey(carded.featureId) });
    const markup = shown(<BuildingLinks featureId={carded.featureId} />, client);
    expect(markup).toContain('Links to register rows and pages');
    expect(markup).toContain('Links could not be read.');
    expect(markup).toContain('The evidence store is not reachable.');
    expect(markup).toContain('role="alert"');
    expect(markup).not.toContain('No links.');
  }
});
