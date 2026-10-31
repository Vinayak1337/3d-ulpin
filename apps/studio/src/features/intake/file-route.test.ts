import { expect, it } from 'vitest';
import { batchOrder, dropState, fileRoute, routeWords } from './file-route';

// One drop of mixed kinds. The route is chosen from the name alone; no file's bytes are read for it.
const drop = ['buildings.geojson', 'wards.gpkg', 'parcels-shapefile.zip', 'layers.zip', 'plan.pdf', 'scan.bin',
  'register.csv', 'floors.xlsx'];

it('N01, S7.13a: every file of one drop joins the batch of one case, the tables the batch reads included', () => {
  expect(drop.filter(name => dropState(name, false) === 'intake')).toEqual(drop);
  expect(['register.TSV', 'wards.ods', 'old-list.xls'].map(name => dropState(name, false)))
    .toEqual(['intake', 'intake', 'intake']);
});

it('routes difficult names by their last extension, in any case', () => {
  for (const name of ['SIDEWALK.JSON', 'Wards.GPKG', 'plan.pdf.zip', 'register.csv.gz', 'README', '.zip'])
    expect(fileRoute(name)).toBe('intake');
  for (const name of ['REGISTER.CSV', 'register.TSV', 'floors.XLSX']) expect(fileRoute(name)).toBe('table');
});

it('the opt-in profile reads map files and LAZ/TIFF first; a table and the rest join the batch', () => {
  expect(['wards.gpkg', 'layers.zip', 'cloud.laz', 'ortho.TIF'].map(name => dropState(name, true)))
    .toEqual(['inspecting', 'inspecting', 'inspecting', 'inspecting']);
  expect(dropState('register.csv', true)).toBe('intake');
  expect(dropState('plan.pdf', true)).toBe('intake');
});

it('words what will happen to each file, never "Not imported" for a kind the batch keeps', () => {
  expect(drop.map(routeWords)).toEqual([
    'Map file · joins the batch', 'Map file · joins the batch', 'ZIP · joins the batch',
    'ZIP · joins the batch', 'Document · joins the batch', 'Original · kept in the batch',
    'Table · joins the batch', 'Table · joins the batch',
  ]);
  expect(['site.JPG', 'ortho.tif', 'dem.TIFF', 'cloud.laz', 'cloud.LAS', 'tower.ifc', 'wards.kml', 'wards.kmz',
    'roads.shp', 'roads.DBF', 'roads.shx', 'roads.prj', 'roads.CPG'].map(routeWords)).toEqual([
    'Image · joins the batch', 'Image or raster · joins the batch', 'Image or raster · joins the batch',
    'Point cloud · joins the batch', 'Point cloud · joins the batch', 'Building model · joins the batch',
    'Map file · joins the batch', 'Map file · joins the batch',
    ...Array(5).fill('Shapefile part · joins the batch'),
  ]);
});

it('TJ1, S7.13a: a CSV or XLSX joins the batch, on the batch page or dropped alone', () => {
  expect(['register.csv', 'floors.XLSX', 'buildings.geojson'].map(name => dropState(name, false)))
    .toEqual(['intake', 'intake', 'intake']);
  expect(['register.csv', 'floors.XLSX'].map(routeWords)).toEqual(['Table · joins the batch',
    'Table · joins the batch']);
});

it('XL1: an ODS joins the batch as an XLSX does; a legacy .xls is kept, its cells unread', () => {
  expect(['wards.ods', 'Wards.ODS', 'old-list.xls', 'OLD.XLS'].map(fileRoute)).toEqual(['table', 'table', 'intake',
    'intake']);
  expect(['wards.ods', 'old-list.XLS'].map(routeWords)).toEqual(['Table · joins the batch',
    'Excel 97-2003 workbook · kept as evidence; its cells are not read']);
  expect(dropState('wards.ods', false)).toBe('intake');
});

it('TJ1: a table dropped with footprints stays an item of their batch, kept before the footprints', () => {
  // File handles only; no bytes are read for the route.
  const drop = ['footprints.geojson', 'register.csv'].map(name => new File([], name));
  expect(drop.map(file => dropState(file.name, false))).toEqual(['intake', 'intake']);
  expect(batchOrder(drop).map(file => file.name)).toEqual(['register.csv', 'footprints.geojson']);
});
