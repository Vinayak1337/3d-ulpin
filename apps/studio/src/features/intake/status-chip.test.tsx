import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import captured from '../../../../../docs/evidence/gf1/lq1a/controls-second.json';
import type { IntakeItem } from './batch-model';
import { stoppedReason } from './retry-command';
import { batchChip, itemChip, type ChipState } from './status-chip';
import { StatusChip } from './StatusChip';

// LQ1a's captured manifest row; each row sets only the facts that give its state, as the intake tests do.
const row = (facts: Partial<Record<keyof IntakeItem, unknown>>) =>
  ({ ...captured.manifest.items[0], ...facts }) as unknown as IntakeItem;

it.each<[ChipState, Partial<Record<keyof IntakeItem, unknown>>]>([
  ['reading', { state: 'reading', placement: 'undecided', partsPlanned: null }],
  ['needs_you', { layoutQuestion: true }],
  ['ready', { state: 'read', placement: 'on_map', plan: null }],
  ['kept_only', { state: 'read', placement: 'undecided', plan: null }],
  ['stopped', { placement: 'not_understood', limitReason: stoppedReason }],
])('the captured row reads %s from %j', (state, facts) => {
  const item = row(facts);
  expect(itemChip(item, [item])).toEqual({ state, percent: null });
});

it.each(['ready for your review', 'proposing its field meanings failed (MAPPING_SOURCE_WAIT)',
  'No proposer is available'])('a read table needing meanings says Needs you: %s', words => {
  const item = row({ family: 'table', state: 'read', placement: 'needs_answer', plan: null,
    layoutQuestion: false, limitReason: `The table is read. ${words}.`,
    card: { family: 'table', format: 'csv', sheets: [] } });
  const chip = itemChip(item, [item]);
  expect(chip).toEqual({ state: 'needs_you', percent: null });
  expect(renderToStaticMarkup(<StatusChip chip={chip} />)).toContain('Needs you');
});

it('a reading row with known parts carries its percent, shown after the word', () => {
  const item = row({ state: 'reading', placement: 'undecided', partsDone: 198, partsPlanned: 211 });
  const chip = itemChip(item, [item]);
  expect(chip).toEqual({ state: 'reading', percent: 93 });
  expect(renderToStaticMarkup(<StatusChip chip={chip} />)).toMatch(/ul-badge--info.*Reading 93%<\/span>$/);
});

it('a batch summary gives a chip only for a chip state; other steps keep their text', () => {
  expect(batchChip({ step: 'Your answers', waiting: 2 })).toEqual({ state: 'needs_you', percent: null });
  expect(batchChip({ step: 'Reading', waiting: 0 })).toEqual({ state: 'reading', percent: null });
  expect(batchChip({ step: 'Files', waiting: 0 })).toBeNull();
  expect(batchChip({ step: 'Cards', waiting: 0 })).toEqual({ state: 'ready', percent: null });
  expect(batchChip({ step: 'Confirm', waiting: 0 })).toBeNull();
  expect(batchChip({ step: 'Your answers', waiting: 0 })).toBeNull();
});
