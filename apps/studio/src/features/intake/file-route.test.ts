import { expect, it } from 'vitest';
import { batchOrder, batchRouteWords, dropState, fileRoute, routeWords, tablesJoin } from './file-route';

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
  expect(['site.JPG', 'ortho.tif', 'dem.TIFF', 'cloud.laz', 'cloud.LAS', 'tower.ifc', 'wards.kml', 'wards.kmz',
    'roads.shp', 'roads.DBF', 'roads.shx', 'roads.prj', 'roads.CPG'].map(routeWords)).toEqual([
    'Image · joins the batch', 'Image or raster · joins the batch', 'Image or raster · joins the batch',
    'Point cloud · joins the batch', 'Point cloud · joins the batch', 'Building model · joins the batch',
    'Map file · joins the batch', 'Map file · joins the batch',
    ...Array(5).fill('Shapefile part · read with its other parts as one shapefile'),
  ]);
});

it('TJ1: on the batch page a CSV or XLSX joins the batch; dropped alone with no batch it keeps its import', () => {
  expect(['register.csv', 'floors.XLSX', 'buildings.geojson'].map(name => dropState(name, false, true)))
    .toEqual(['intake', 'intake', 'intake']);
  expect(dropState('register.csv', false)).toBe('not-gis');
  expect(batchRouteWords('register.csv')).toBe('Table · kept in the batch, then read there as a table');
  expect(batchRouteWords('plan.pdf')).toBe(routeWords('plan.pdf'));
});

it('TJ1: a table dropped with footprints stays an item of their batch, kept before the footprints', () => {
  // File handles only; no bytes are read for the route.
  const [footprints, register, earlier] = ['footprints.geojson', 'register.csv', 'earlier.csv']
    .map(name => new File([], name));
  const drop = [footprints!, register!];
  const picked = [{ file: earlier!, state: dropState('earlier.csv', false) },
    ...drop.map(file => ({ file, state: dropState(file.name, false) }))];
  expect(picked.map(file => file.state)).toEqual(['not-gis', 'intake', 'not-gis']);
  const joined = tablesJoin(picked, drop);
  expect(joined.map(file => file.state), 'a file of an earlier drop keeps its state')
    .toEqual(['not-gis', 'intake', 'intake']);
  expect(batchOrder(joined.filter(file => file.state === 'intake').map(file => file.file)).map(file => file.name))
    .toEqual(['register.csv', 'footprints.geojson']);
});
