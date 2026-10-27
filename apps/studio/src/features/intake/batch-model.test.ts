import { expect, it } from 'vitest';
import controls from '../../../../../docs/evidence/gf1/e3a/controls-qualified.json';
import { countWords, crsWords, fieldWords, formatWords, holdsWords, isSettled, opensPages, partProgressWords,
  placementWords, stateWords } from './batch-model';
import { intakeRefreshFrame, silenceDelay } from './batch-events';
import type { IntakeItem } from './batch-model';

it('keeps a question distinct from state and renders unknown counts without zero', () => {
  const item = { ...controls.manifest.items[0], archiveItemId: null,
    plan: null, streamedProfileJobId: null } as IntakeItem;
  expect(stateWords(item.state)).toBe('File checked');
  expect(placementWords(item.placement)).toBe('Needs an answer');
  expect(isSettled(item)).toBe(true);
  expect(isSettled({ ...item, state: 'reading', placement: 'undecided' })).toBe(false);
  expect(isSettled({ ...item, state: 'read', placement: 'undecided' })).toBe(true);
  expect(stateWords('read_to_limit')).toBe('Read to the limit');
  expect(stateWords('probe_failed')).toBe('File could not be checked');
  expect(countWords(null)).toBe('Unknown');
  expect(countWords(undefined)).toBe('Unknown');
  expect(countWords(0)).toBe('0');
  expect(crsWords(null)).toBe('Unknown');
  expect(fieldWords('/features/*/properties/doitt_id')).toBe('doitt_id');
  expect(fieldWords('/features/*/properties/a~1b~0c')).toBe('a/b~c');
});

it('names package preparation and shows the item counts without saying it is still reading', () => {
  const item = { ...controls.manifest.items[0], archiveItemId: null,
    plan: null, streamedProfileJobId: null, state: 'preparing',
    placement: 'on_map', partsPlanned: null, partsDone: 1563, recordsSeen: 172409 } as IntakeItem;
  expect(stateWords(item.state)).toBe('Preparing packages');
  expect(partProgressWords(item)).toBe('1,563 packages prepared · 1,72,409 records read');
  expect(partProgressWords({ ...item, partsDone: 0 })).toBe('0 packages prepared · 1,72,409 records read');
  expect(partProgressWords({ ...item, partsDone: 1, recordsSeen: 1 })).toBe('1 package prepared · 1 record read');
  expect(partProgressWords({ ...item, partsDone: 2, recordsSeen: 2 })).toBe('2 packages prepared · 2 records read');
  expect(isSettled(item)).toBe(false);
  expect(partProgressWords({ ...item, state: 'reading' })).toBe('Reading: 1,72,409 records so far');
});

it('refreshes on case intake notifications and waits five quiet seconds', () => {
  expect(intakeRefreshFrame({ kind: 'ready' })).toBe(true);
  expect(intakeRefreshFrame({ kind: 'resync' })).toBe(true);
  expect(intakeRefreshFrame({ change: { kind: 'intake.item' } })).toBe(true);
  expect(intakeRefreshFrame({ change: { kind: 'intake.target' } })).toBe(true);
  expect(intakeRefreshFrame({ change: { kind: 'recipe.changed' } })).toBe(true);
  expect(intakeRefreshFrame({ change: { kind: 'mapping.chunk' } })).toBe(false);
  expect(intakeRefreshFrame(null)).toBe(false);
  expect(silenceDelay(1000, 1000)).toBe(5000);
  expect(silenceDelay(1000, 5999)).toBe(1);
  expect(silenceDelay(1000, 6000)).toBe(0);
});

it('a PDF being read says nothing of records, and only a read, unlocked PDF opens its pages', () => {
  const pdf = { itemId: 'pdf', sourceId: 'source', family: 'document', format: 'pdf', state: 'reading',
    placement: 'undecided', partsPlanned: null, partsDone: 0, recordsSeen: 0 } as IntakeItem;
  expect(partProgressWords(pdf)).toBeNull();
  expect(opensPages(pdf)).toBe(false);
  expect(opensPages({ ...pdf, state: 'read' })).toBe(true);
  expect(opensPages({ ...pdf, state: 'read', placement: 'needs_answer' })).toBe(false);
  expect(opensPages({ ...pdf, state: 'read', format: 'docx' })).toBe(false);
});

// The format keys of the server's extensions map (intake-signatures.ts); a key shown raw is a token, not a name.
const formatKeys = ['geojson', 'geojson-seq', 'ndjson', 'shapefile', 'dbf', 'geopackage', 'sqlite', 'parquet',
  'geoparquet', 'tiff', 'bigtiff', 'xlsx', 'xls', 'docx', 'ods', 'kmz', 'geotiff', 'shapefile-index', 'csv', 'tsv',
  'png', 'jpeg', 'las', 'laz', 'pdf', 'ifc', 'citygml', 'gml', 'kml', 'glb', 'gltf', 'obj', 'zip', 'dwg', 'e57', 'ply',
  '7z', 'rar', 'flatgeobuf', 'dxf'];

it('formatWords names every format key in words, never the raw token', () => {
  for (const key of formatKeys) {
    expect(formatWords(key as IntakeItem['format']), key).not.toBe(key);
  }
  expect(formatWords(null)).toBe('Unknown');
});

it('holdsWords gives each stated count its unit and nothing for a file with no counts', () => {
  const counts: Record<string, number | null> = { features: 1662, rows: null, pages: null, members: null,
    points: null, bands: null };
  const card = (fields: Record<string, number | null>) => ({ counts: { ...counts, ...fields } }) as IntakeItem['card'];
  expect(holdsWords(card({}))).toBe('1,662 features');
  expect(holdsWords(card({ features: 1 }))).toBe('1 feature');
  expect(holdsWords(card({ features: null, pages: 3 }))).toBe('3 pages');
  expect(holdsWords(card({ features: null, rows: 12, points: 5 }))).toBe('12 rows · 5 points');
  expect(holdsWords(card({ features: null }))).toBeNull();
  expect(holdsWords(null)).toBeNull();
});
