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

// CN1: a wide file's line, its cell files kept as separate batches; the second is one this officer may not open.
const opened = { cellKey: 'utm-20-e5-n12-l231-b270', caseId: '10000000-0000-4000-8000-000000000101',
  itemId: '10000000-0000-4000-8000-000000000103', state: 'read', placement: 'on_map' } as const;
const closed = { cellKey: 'utm-20-e6-n12-l231-b270', caseId: null, itemId: null, state: null, placement: null };
const wide = { ...captured.manifest.items[0], state: 'read', placement: 'on_map',
  cellBatches: [opened, closed] } as unknown as IntakeItem;

it('a wide file links each cell batch it may open and says the features there are not on this map', () => {
  const html = tray(wide);
  expect(html).toContain('The features of this file outside its first map area are in these separate batches, '
    + 'each with its own layout and cards.');
  expect(html).toContain(`href="/studio/work/cases/${opened.caseId}/intake"`);
  expect(html).toContain(opened.cellKey);
  expect(html).toContain('In that batch: Read · On the map');
  expect(html).toContain(closed.cellKey);
  expect(html).toContain('a separate batch');
  expect(html.match(/href="\/studio\/work\/cases\//g)).toHaveLength(1);
  expect(html).not.toMatch(/on (this|the current) map/i);
  const { cellBatches: _cells, ...plain } = wide;
  expect(tray(plain as IntakeItem)).not.toContain('separate batches');
});

it('a 2,100-feature ZIP member offers View layout while keeping the archive prefix in its reason', () => {
  const reason = 'No approved layout matches this file. An officer chooses the identifier field.';
  const item = { ...rested, name: 'nyc-footprints-2100.geojson', recordsSeen: 2100,
    state: 'probed', placement: 'needs_answer', existingAreaId: undefined, layoutQuestion: true,
    limitReason: `Taken out of zp1-geojson-kml-csv.zip. ${reason}` } as IntakeItem;
  expect(tray(item)).toContain('>View layout</button>');
  expect(tray(item)).toContain(item.limitReason);
  expect(tray({ ...item, limitReason: reason })).toContain('>View layout</button>');
});
