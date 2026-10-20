import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '@ulpin/api-client';
import capturedConfirmation from '../../../../../../docs/evidence/gf1/e3b/confirmation.json';
import capturedTargets from '../../../../../../docs/evidence/gf1/e3b/targets.json';
import { readTargetByFeature } from '../../intake/run/api';
import { cardsOnlyWords, confirmBody, readinessLabels, readinessWords, type Confirmation, type Target,
  type TargetPage } from '../../intake/run/model';
import { useConfirmationCommand } from '../../intake/run/useConfirmationCommand';
import { BuildingCard, BuildingCardDialog, TargetCard, buildingTargetKey } from './BuildingCard';
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
  expect(offer).toContain(cardsOnlyWords(1));
  expect(cardsOnlyWords(1)).toMatch(/^This recorded building will get/);
  expect(offer).toContain('Your acknowledgement');
  expect(offer).toMatch(/<button[^>]*disabled=""[^>]*>Make the property card<\/button>/);

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
  expect(making).not.toContain('Make the property card');

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
  expect(markup).toContain('Open the property card');
  expect(markup).not.toContain('role="dialog"');
  expect(followCard(false, 'carded')).toEqual({ watched: false, open: false });
});

it('a building not recorded states its readiness in words and links its batch; nothing is offered', () => {
  expect(cardState(ready)).toBe('other');
  const markup = shown(<TargetCard target={ready} name="763933" refetch={() => {}} />);
  expect(markup).toContain(readinessLabels.ready);
  expect(markup).toContain(readinessWords.ready);
  expect(markup).toContain(`href="/studio/work/cases/${ready.caseId}/intake"`);
  expect(markup).not.toContain('Make the property card');
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
  expect(markup).toContain(cardsOnlyWords(1));
  expect(markup).toContain('Your acknowledgement');
  expect(markup).toContain('Make the property card');
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
  expect(markup).toContain(readinessWords.ready);
});
