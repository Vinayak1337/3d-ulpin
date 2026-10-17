import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { expect, it, vi } from 'vitest';
import captured from '../../../../../docs/evidence/gf1/lq1a/controls-second.json';
import { isSettled, type IntakeItem } from './batch-model';
import { needsLayoutAnswer } from './question-model';
import { IntakeTray } from './IntakeTray';

// LQ1a's captured manifest row, set to rest because its bytes already made another area.
const words = 'This file is already the source of the area “buildings original”. '
  + 'Open that area; nothing new is prepared from a second copy.';
const areaId = '10000000-0000-4000-8000-000000000009';
const rested = { ...captured.manifest.items[0], state: 'read', placement: 'undecided', plan: null,
  limitReason: words, existingAreaId: areaId } as unknown as IntakeItem;

function tray(item: IntakeItem) {
  return renderToStaticMarkup(<MemoryRouter>
    <IntakeTray caseId={item.caseId} items={[item]} packages={[]} choose={vi.fn()} refresh={vi.fn()} />
  </MemoryRouter>);
}

it('an item already in an area rests settled with its sentence and a link to that area, never a question', () => {
  expect(isSettled(rested)).toBe(true);
  expect(needsLayoutAnswer(rested)).toBe(false);
  const html = tray(rested);
  expect(html).toContain('buildings original');
  expect(html).toContain(`href="/studio/areas/${areaId}"`);
  expect(html).toContain('>Open that area<');
  const { existingAreaId: _area, ...unnamed } = rested;
  expect(tray(unnamed)).toContain(words);
  expect(tray(unnamed)).not.toContain('/studio/areas/');
});
