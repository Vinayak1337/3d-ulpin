import { expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import captured from '../../../../../../docs/evidence/gf1/e3b/targets.json';
import { nothingDrafted, nothingDraftedWords, type TargetPage } from './model';

const { choiceIds: _, ...sample } = captured;
const page = sample as TargetPage;
const zero = Object.fromEntries(Object.keys(page.counts).map(key => [key, 0])) as TargetPage['counts'];
const nothing: TargetPage = { ...page, counts: zero, items: [], packages: [], nextCursor: null };
const state = vi.hoisted(() => ({ page: null as unknown, cards: null as unknown, command: {} as unknown }));

vi.mock('./useRun', () => ({
  useRun: () => ({
    targets: { summary: { isPending: false, error: null, data: state.page },
      packagePage: { error: null, data: state.page }, targets: (state.page as TargetPage).items, cursor: null,
      busy: false, first: { isFetching: false, error: null }, error: null, packageCursor: null },
    discovery: { reasons: new Map(), error: null }, confirmations: [], confirmationKeys: [], filter: '',
    setFilter() {}, choice: [], toggle() {}, selectable: () => false, acknowledgement: '', setAcknowledgement() {},
    refresh() {}, command: state.command, priority: { error: '', open() {} }, cards: state.cards,
    closeCards() {}, choosing: false, opening: false, selectionError: null, cardsError: null,
    nextPackages() {}, firstPackages() {}, chooseFirst() {}, clear() {}, openCards() {},
  }),
}));

// The panel reads the batch's file list to name its packages; none is read here.
vi.mock('../batch-queries', async original => ({ ...await original<typeof import('../batch-queries')>(),
  useIntakeManifest: () => ({ data: undefined }) }));

const { IntakeRunPanel } = await import('./IntakeRunPanel');
const show = (shown: TargetPage, cards: unknown = null, command: unknown = {}) => {
  Object.assign(state, { page: shown, cards, command });
  return renderToStaticMarkup(createElement(IntakeRunPanel, { caseId: shown.items[0]?.caseId ?? 'case' }));
};

it('S7.3: a batch with all counts 0 and no package shows one line and no controls or confirmation', () => {
  expect(nothingDrafted(nothing)).toBe(true);
  const shown = show(nothing);
  expect(shown).toContain(nothingDraftedWords);
  for (const absent of ['Choose the first', 'Refresh batch', '<textarea', 'One confirmation', '0 ready to record'])
    expect(shown).not.toContain(absent);
});

it('S7.3: a batch with drafted buildings still shows the counts, the choice controls and the filter', () => {
  expect(nothingDrafted(page)).toBe(false);
  const shown = show(page);
  expect(shown).not.toContain(nothingDraftedWords);
  for (const present of ['Refresh batch', 'Choose the first 100 ready', 'Ready buildings and packages'])
    expect(shown).toContain(present);
});

it('S7.3: the confirmation shows when a package can be confirmed or a cards list is open, and not otherwise', () => {
  const recorded = { ...page, packages: page.packages.map(pkg => ({ ...pkg, state: 'COMMITTED' as const })) };
  expect(show(page)).toContain('One confirmation');
  expect(show(recorded)).not.toContain('One confirmation');
  expect(show(recorded, page.items.slice(0, 1))).toContain('One confirmation');
  expect(show(recorded, null, { uncertain: true })).toContain('One confirmation');
});
