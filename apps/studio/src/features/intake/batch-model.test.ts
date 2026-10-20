import { expect, it } from 'vitest';
import controls from '../../../../../docs/evidence/gf1/e3a/controls-qualified.json';
import { countWords, crsWords, fieldWords, isSettled, opensPages, partProgressWords, placementWords, stateWords,
  trayItems } from './batch-model';
import { fileRoute, zipMemberNames, zipRoute } from './file-route';
import { zip } from '../register/workbook';
import { intakeRefreshFrame, silenceDelay } from './batch-events';
import type { IntakeItem } from './batch-model';

it('routes map originals to intake, binary maps to direct import and tables to their dialog', () => {
  expect(fileRoute('buildings-original.geojson')).toBe('intake');
  expect(fileRoute('sidewalk.JSON')).toBe('intake');
  expect(fileRoute('boundary.gpkg')).toBe('direct');
  expect(fileRoute('boundary.zip')).toBe('direct');
  expect(fileRoute('register.csv')).toBe('table');
  expect(fileRoute('register.xlsx')).toBe('table');
  for (const name of ['plan.pdf', 'ortho.tif', 'cloud.laz', 'model.ifc', 'unknown'])
    expect(fileRoute(name)).toBe('original');
});

it('routes a shapefile ZIP to direct import and every other ZIP to the batch', async () => {
  const pack = (files: Record<string, string>) => new Blob([zip(files)]);
  const layers = pack({ 'layers/': '', 'layers/roads.geojson': '{}', 'layers/blocks.json': '{}', 'README.md': '' });
  expect(await zipMemberNames(layers)).toEqual(['layers/', 'layers/roads.geojson', 'layers/blocks.json', 'README.md']);
  expect(await zipRoute(layers)).toBe('intake');
  expect(await zipRoute(pack({ 'a.shp': '', 'a.shx': '', 'a.dbf': '', 'meta.json': '{}' }))).toBe('direct');
  expect(await zipRoute(pack({ 'set/ROADS.SHP': '', 'set/ROADS.DBF': '' }))).toBe('direct');
  expect(await zipRoute(pack({ 'register.csv': 'id\n1' }))).toBe('intake');
  expect(await zipRoute(pack({ 'plan.pdf': '' }))).toBe('intake');
  expect(await zipRoute(new Blob(['not a zip']))).toBe('intake');
});

it('lists a kept layer once: its member row under the ZIP gives way to its own item', () => {
  const base = { ...controls.manifest.items[0], plan: null, streamedProfileJobId: null } as IntakeItem;
  const archive = { ...base, itemId: 'a', sourceId: 'zip', parentItemId: null, memberPath: null };
  const kept = { ...base, itemId: 'm1', sourceId: 'layer', parentItemId: 'a', memberPath: 'roads.geojson' };
  const readme = { ...base, itemId: 'm2', sourceId: null, parentItemId: 'a', memberPath: 'README.md' };
  const layer = { ...base, itemId: 'l', sourceId: 'layer', parentItemId: null, memberPath: null };
  expect(trayItems([archive, kept, readme, layer]).map(item => item.itemId)).toEqual(['a', 'm2', 'l']);
  expect(isSettled({ ...archive, state: 'read', placement: 'undecided' })).toBe(true);
});

it('keeps a question distinct from state and renders unknown counts without zero', () => {
  const item = { ...controls.manifest.items[0], plan: null, streamedProfileJobId: null } as IntakeItem;
  expect(stateWords(item.state)).toBe('File checked');
  expect(placementWords(item.placement)).toBe('Needs an answer');
  expect(isSettled(item)).toBe(true);
  expect(isSettled({ ...item, state: 'reading', placement: 'undecided' })).toBe(false);
  expect(stateWords('read_to_limit')).toBe('Read to the limit');
  expect(stateWords('probe_failed')).toBe('File could not be checked');
  expect(countWords(null)).toBe('Not known');
  expect(countWords(undefined)).toBe('Not known');
  expect(countWords(0)).toBe('0');
  expect(crsWords(null)).toBe('Not known');
  expect(fieldWords('/features/*/properties/doitt_id')).toBe('doitt_id');
  expect(fieldWords('/features/*/properties/a~1b~0c')).toBe('a/b~c');
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
