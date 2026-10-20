import { expect, it } from 'vitest';
import { dropState, fileRoute, routeWords } from './file-route';

// One drop of mixed kinds. The route is chosen from the name alone; no file's bytes are read for it.
const drop = ['buildings.geojson', 'wards.gpkg', 'parcels-shapefile.zip', 'layers.zip', 'plan.pdf', 'scan.bin',
  'register.csv', 'floors.xlsx'];

it('N01: every file of one drop joins the batch of one case; only CSV and XLSX keep their table import', () => {
  const batch = drop.filter(name => dropState(name, false) === 'intake');
  expect(batch).toEqual(['buildings.geojson', 'wards.gpkg', 'parcels-shapefile.zip', 'layers.zip', 'plan.pdf',
    'scan.bin']);
  expect(drop.filter(name => dropState(name, false) === 'not-gis')).toEqual(['register.csv', 'floors.xlsx']);
});

it('routes difficult names by their last extension, in any case', () => {
  for (const name of ['SIDEWALK.JSON', 'Wards.GPKG', 'plan.pdf.zip', 'register.csv.gz', 'README', '.zip'])
    expect(fileRoute(name)).toBe('intake');
  for (const name of ['REGISTER.CSV', 'floors.XLSX']) expect(fileRoute(name)).toBe('table');
});

it('the opt-in profile reads map files and LAZ/TIFF first; a table keeps its import and the rest join the batch', () => {
  expect(['wards.gpkg', 'layers.zip', 'cloud.laz', 'ortho.TIF'].map(name => dropState(name, true)))
    .toEqual(['inspecting', 'inspecting', 'inspecting', 'inspecting']);
  expect(dropState('register.csv', true)).toBe('not-gis');
  expect(dropState('plan.pdf', true)).toBe('intake');
});

it('words what will happen to each file, never "Not imported" for a kind the batch keeps', () => {
  expect(drop.map(routeWords)).toEqual([
    'Map file · joins the batch', 'Map file · joins the batch', 'ZIP · the batch reads what it holds',
    'ZIP · the batch reads what it holds', 'Document · joins the batch', 'Original · kept in the batch',
    'Table · opens the table import', 'Table · opens the table import',
  ]);
  expect(routeWords('site.JPG')).toBe('Image · joins the batch');
});
