import { expect, it } from 'vitest';
import controls from '../../../../../docs/evidence/gf1/e3a/controls-qualified.json';
import { countWords, crsWords, fieldWords, isSettled, placementWords, stateWords, trayItems } from './batch-model';
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
  expect(fileRoute('plan.pdf')).toBe('unsupported');
});

it('routes every ZIP to the batch except a shapefile ZIP, which keeps direct import', async () => {
  const pack = (files: Record<string, string>) => new Blob([zip(files)]);
  const layers = pack({ 'layers/': '', 'layers/roads.geojson': '{}', 'layers/blocks.json': '{}', 'README.md': '' });
  expect(await zipMemberNames(layers)).toEqual(['layers/', 'layers/roads.geojson', 'layers/blocks.json', 'README.md']);
  expect(await zipRoute(layers)).toBe('intake');
  expect(await zipRoute(pack({ 'a.shp': '', 'a.shx': '', 'a.dbf': '', 'meta.json': '{}' }))).toBe('direct');
  expect(await zipRoute(pack({ 'set/A.SHP': '', 'set/A.dbf': '' }))).toBe('direct');
  expect(await zipRoute(pack({ 'plan.pdf': '', 'dem.tif': '' }))).toBe('intake');
  expect(await zipRoute(pack({ 'site.gpkg': '' }))).toBe('intake');
  // Unreadable bytes join the batch too; the server reads them again and refuses them by code.
  expect(await zipRoute(new Blob(['not a zip']))).toBe('intake');
});

it('settles a fanned-out ZIP: its own row and members left inside carry a reason', () => {
  const base = { ...controls.manifest.items[0], plan: null, streamedProfileJobId: null, state: 'probed',
    placement: 'undecided', limitReason: null } as IntakeItem;
  const archive = { ...base, sourceId: 'zip', parentItemId: null, family: 'archive', format: 'zip' } as IntakeItem;
  const member = { ...base, sourceId: null, parentItemId: 'a', memberPath: 'dem.tif' } as IntakeItem;
  expect(isSettled(archive)).toBe(false);
  expect(isSettled(member)).toBe(false);
  expect(isSettled({ ...archive, limitReason: 'ZIP_LAYERS: 6 of 10 members became their own files, one item each.' }))
    .toBe(true);
  expect(isSettled({ ...member, limitReason: 'ZIP_MEMBER_INSIDE: this member stays inside the archive.' })).toBe(true);
  // A dropped file's own reason does not settle it; its placement still decides.
  expect(isSettled({ ...base, sourceId: 'g', parentItemId: null, format: 'geojson', limitReason: 'x' })).toBe(false);
});

it('lists a kept layer once: its member row under the ZIP gives way to its own item', () => {
  const base = { ...controls.manifest.items[0], plan: null, streamedProfileJobId: null } as IntakeItem;
  const archive = { ...base, itemId: 'a', sourceId: 'zip', parentItemId: null, memberPath: null };
  const kept = { ...base, itemId: 'm1', sourceId: 'layer', parentItemId: 'a', memberPath: 'roads.geojson' };
  const readme = { ...base, itemId: 'm2', sourceId: null, parentItemId: 'a', memberPath: 'README.md' };
  const layer = { ...base, itemId: 'l', sourceId: 'layer', parentItemId: null, memberPath: null };
  expect(trayItems([archive, kept, readme, layer]).map(item => item.itemId)).toEqual(['a', 'm2', 'l']);
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
