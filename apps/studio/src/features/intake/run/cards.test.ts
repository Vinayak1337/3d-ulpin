import { afterEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { api } from '@ulpin/api-client';
import { IntakeConfirmSchema } from '../../../../../../packages/contracts/src/usp/intake';
import captured from '../../../../../../docs/evidence/gf1/e3b/targets.json';
import { readNextRecorded } from './api';
import { Confirm } from './Confirm';
import { CardsAction } from './IntakeRunPanel';
import { cardsOnlyWords, confirmBody, nextRecorded, noCardWords, type Target, type TargetPage } from './model';

const { choiceIds: _, ...sample } = captured;
const page = sample as TargetPage;
const base = page.items[0]!;
const committed: TargetPage = { ...page, counts: { ...page.counts, recorded: 250 },
  packages: page.packages.map(pkg => ({ ...pkg, state: 'COMMITTED' as const })) };
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const recorded = (n: number, confirmationId: string | null = null): Target =>
  ({ ...base, targetId: uuid(n), locator: `feature ${n}`, readiness: 'recorded', confirmationId });

afterEach(() => vi.restoreAllMocks());

it('lists the next recorded buildings no confirmation names, in stored order, at most 100', () => {
  const rows = [recorded(1), { ...recorded(2), readiness: 'carded' as const }, recorded(3, uuid(900)),
    ...Array.from({ length: 150 }, (_row, index) => recorded(10 + index))];
  const next = nextRecorded(rows);
  expect(next).toHaveLength(100);
  expect(next.slice(0, 3).map(row => row.targetId)).toEqual([uuid(1), uuid(10), uuid(11)]);
});

it('reads recorded pages until it has the next 100 and asks for nothing else', async () => {
  const pages = [Array.from({ length: 200 }, (_row, index) => recorded(index, index % 4 ? uuid(900) : null)),
    Array.from({ length: 200 }, (_row, index) => recorded(200 + index))];
  const get = vi.spyOn(api, 'GET').mockImplementation(async (_route, options) => {
    const query = (options as { params: { query: { readiness: string; cursor?: string } } }).params.query;
    expect(query.readiness).toBe('recorded');
    const items = pages[query.cursor ? 1 : 0]!;
    return { data: { ...committed, items, nextCursor: query.cursor ? null : items.at(-1)!.targetId },
      response: new Response() } as never;
  });
  const next = await readNextRecorded(base.caseId);
  expect(get).toHaveBeenCalledTimes(2);
  expect(next).toHaveLength(100);
  expect(next[0]!.targetId).toBe(uuid(0));
  expect(next.at(-1)!.targetId).toBe(uuid(249));
});

it('shows the count and the action only once a package is recorded and buildings have no card', () => {
  const run = { targets: { summary: { error: null } }, openCards: () => {} } as never;
  const shown = renderToStaticMarkup(createElement(CardsAction, { run, page: committed, locked: false }));
  expect(shown).toContain(noCardWords(committed.counts));
  expect(noCardWords(committed.counts)).toBe('250 recorded buildings have no card yet.');
  expect(shown).toContain('Make cards for the next 100');
  expect(renderToStaticMarkup(createElement(CardsAction, { run, page, locked: false }))).toBe('');
  const none = { ...committed, counts: { ...committed.counts, recorded: 0 } };
  expect(renderToStaticMarkup(createElement(CardsAction, { run, page: none, locked: false }))).toBe('');
});

it('the confirmation screen lists the buildings and states what will be made; nothing is pressed', () => {
  const cards = [recorded(3), recorded(1), recorded(2)];
  const props = { page: committed, choice: [], cards, closeCards: () => {}, acknowledgement: '',
    setAcknowledgement: () => {}, press: () => {}, busy: false, uncertain: false, stale: false, error: '' };
  const html = renderToStaticMarkup(createElement(Confirm, props));
  expect(html).toContain(cardsOnlyWords(3));
  expect(html.indexOf('feature 3')).toBeLessThan(html.indexOf('feature 1'));
  expect(html).toContain('Make these cards');
  expect(html).not.toContain('Recording cannot be undone.');
  expect(html).toContain('disabled=""');
  const typed = renderToStaticMarkup(createElement(Confirm, { ...props, acknowledgement: 'Cards for these.' }));
  expect(typed).not.toMatch(/<button[^>]*disabled=""[^>]*>Make these cards/);
});

it('a cards-only body names no package and the buildings in the order listed', () => {
  const cards = [recorded(3), recorded(1)];
  const body = confirmBody(committed, cards, 'Cards for these.', uuid(7), true);
  expect(body).toEqual({ requestKey: uuid(7), acknowledgement: 'Cards for these.', packages: [],
    targets: [uuid(3), uuid(1)] });
  expect(IntakeConfirmSchema.safeParse(body).success).toBe(true);
});
