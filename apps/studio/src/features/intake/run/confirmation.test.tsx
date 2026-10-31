import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '@ulpin/api-client';
import { afterEach, expect, it, vi } from 'vitest';
import captured from '../../../../../../docs/evidence/gf1/e3b/targets.json';
import saved from '../../../../../../docs/evidence/gf1/e3b/confirmation.json';
import { button, container, elements, propsOf } from '../fake-dom';
import { batchMapPath } from '../batch-model';
import { Confirm } from './Confirm';
import { Progress } from './Progress';
import { confirmationFacts, confirmablePackages, type Confirmation, type ConfirmBody, type TargetPage } from './model';
import { useRun } from './useRun';
import { expectDisabledReasons } from '../evidence/disabled-reasons.test-support';

vi.mock('./useRunStream', () => ({ useRunStream() {} }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const { choiceIds: _, ...sample } = captured;
const base = sample as TargetPage;
// test_only: two reviewed packages from distinct files, with 3 and 5 ready buildings.
const packages = [3, 5].map((ready, index) => ({ ...base.packages[0]!,
  packageId: `00000000-0000-4000-8000-00000000000${index}`,
  anchorItemId: `00000000-0000-4000-8000-00000000001${index}`,
  counts: { ...base.packages[0]!.counts, ready } }));
const page: TargetPage = { ...base, packages, nextCursor: null,
  items: [{ ...base.items[0]!, packageId: packages[0]!.packageId }], counts: { ...base.counts, ready: 8 } };

it('summarises only confirmable package counts and distinct files', () => {
  const sameFile = { ...packages[1]!, anchorItemId: packages[0]!.anchorItemId };
  const held = { ...packages[1]!, reviewFingerprint: null };
  expect(confirmationFacts(confirmablePackages({ ...page, packages: [packages[0]!, sameFile, held] }), 0))
    .toEqual({ buildings: '8 buildings', files: '1 file', cards: '0 cards' });
});

it('fills from the page, retains edits across refreshes, blocks blank words and posts exactly the box', async () => {
  vi.spyOn(api, 'GET').mockResolvedValue({ data: page, response: new Response() } as never);
  const post = vi.spyOn(api, 'POST').mockResolvedValue({ data: saved, response: new Response() } as never);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(['intake-run', page.caseId, 'summary'], page);
  let run: ReturnType<typeof useRun>;
  function Screen() {
    run = useRun(page.caseId);
    return <Confirm page={run.targets.packagePage.data!} choice={run.choice} cards={run.cards}
      closeCards={run.closeCards} acknowledgement={run.acknowledgement} setAcknowledgement={run.setAcknowledgement}
      busy={run.command.busy} uncertain={run.command.uncertain} stale={false} error={run.command.error}
      press={() => void run.command.press(page, run.choice, run.acknowledgement)} />;
  }
  const root = container();
  const view = createRoot(root as never);
  await act(async () => view.render(<QueryClientProvider client={client}><Screen /></QueryClientProvider>));
  try {
    await act(async () => run!.toggle(page.items[0]!));
    const label = 'Record 8 buildings and make 1 card';
    expect(root.textContent).toContain('You will record 8 buildings from 2 files and make 1 card');
    const box = () => elements(root).find(node => node.tagName === 'TEXTAREA')!;
    expect(propsOf(box()).value).toBe('I confirm 8 buildings from 2 files for recording, with 1 card; '
      + 'no rights or ownership are set.');
    expect(button(root, label).getAttribute('disabled')).toBeNull();
    expect(root.textContent).not.toContain('Type your acknowledgement');
    await act(async () => { propsOf(box()).onChange?.({ target: { value: '' } }); });
    expect(button(root, label).getAttribute('disabled')).not.toBeNull();
    vi.stubGlobal('document', Object.assign(Object.create(document), {
      getElementById: (id: string) => elements(root).find(node => node.getAttribute('id') === id),
    }));
    await act(async () => propsOf(button(root, 'Type confirmation')).onClick?.({}));
    expect(document.activeElement).toBe(box());
    const words = '  Record these buildings; rights remain unknown.\n';
    await act(async () => { propsOf(box()).onChange?.({ target: { value: words } }); });
    await act(async () => { run!.clear(); run!.refresh(); });
    expect(propsOf(box()).value).toBe(words);
    expect(button(root, 'Record 8 buildings').getAttribute('disabled')).toBeNull();
    await act(async () => run!.toggle(page.items[0]!));
    await act(async () => { await propsOf(button(root, label)).onClick?.({}); });
    expect(post).toHaveBeenCalledTimes(1);
    const body = (post.mock.calls[0]![1] as { body: ConfirmBody }).body;
    expect(body.acknowledgement).toBe(words);
    expect(body.targets).toEqual([page.items[0]!.targetId]);
    expect(propsOf(box()).value).toMatch(/^I confirm /);
  } finally {
    await act(async () => view.unmount());
    client.clear();
  }
});

it('names the first recording blocker, with no reason for an enabled or in-flight press', () => {
  const props = { page, choice: [], cards: null, closeCards: vi.fn(), acknowledgement: 'Confirmed.',
    setAcknowledgement: vi.fn(), press: vi.fn(), busy: false, uncertain: false, stale: false, error: '' };
  const blockers: [Partial<Parameters<typeof Confirm>[0]>, string][] = [
    [{ page: { ...page, packages: [] }, acknowledgement: '' }, 'Choose a package.'],
    [{ cards: [] }, 'No cards chosen.'],
    [{ acknowledgement: ' ' }, 'Type the confirmation.'],
    [{ stale: true }, 'The batch could not be read.'],
  ];
  for (const [patch, reason] of blockers) {
    const html = renderToStaticMarkup(<Confirm {...props} {...patch} />);
    expect(expectDisabledReasons(html)).toBe(1);
    expect(html).toContain(reason);
    if (reason === 'Choose a package.') {
      expect(html.indexOf(reason)).toBeLessThan(html.indexOf('>Record 0 buildings</button>'));
    }
  }
  expect(expectDisabledReasons(renderToStaticMarkup(<Confirm {...props} />))).toBe(0);
  expect(renderToStaticMarkup(<Confirm {...props} busy />)).not.toContain('var(--ui-ink-soft)');
});

const confirmation = saved as Confirmation;
const mapPath = batchMapPath([], base.packages)!;
const progress = (value: Confirmation, path: string | null = mapPath) => renderToStaticMarkup(<MemoryRouter>
  <Progress caseId={page.caseId} confirmation={value} mapPath={path} refresh={() => {}} onOpen={() => {}} />
</MemoryRouter>);

it('finishes with Done, exact first-card links and the batch map, above collapsed building progress', () => {
  const html = progress(confirmation);
  const card = confirmation.progress[0]!.artefacts.card!;
  expect(html).toContain('>Done</h2>');
  expect(html).toContain(`href="/api/v1/usp/property-cards/${card.id}/revisions/${card.revision}"`);
  expect(html).toContain(`href="/verify/card/${card.id}/${card.revision}" data-discover="true">Verify</a>`);
  expect(html).toContain(`href="${mapPath}" data-discover="true">See on the map</a>`);
  expect(html).toContain('Open the card</a>');
  expect(html).toContain('<details><summary>Building progress</summary><ul');
  expect(html.indexOf('See on the map')).toBeLessThan(html.indexOf('Building progress'));
});

it('with no card offers only the map, and never invents a missing map target', () => {
  const stopped = { ...confirmation, progress: [{ ...confirmation.progress[0]!, readiness: 'stopped' as const,
    artefacts: {} }], counts: { recorded: 0, carded: 0, stopped: 1 } };
  const html = progress(stopped);
  expect(html).toContain('>Done</h2>');
  expect(html).toContain('See on the map</a>');
  expect(html).not.toMatch(/Open the card|>Verify<\/a>/);
  expect(progress(stopped, null)).not.toContain('See on the map');
  expect(progress({ ...stopped, progress: [] })).not.toContain('>Done</h2>');
});

it.each(['confirmed', 'recorded'] as const)('does not show Done while a target is %s', readiness => {
  expect(progress({ ...confirmation, progress: [{ ...confirmation.progress[0]!, readiness }] }))
    .not.toContain('>Done</h2>');
});
