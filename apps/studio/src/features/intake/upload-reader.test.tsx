import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { DOCUMENT_LIMITS, IFC_LIMITS, NATIVE_GIS_LIMITS, POINT_BATCH_LIMITS,
  RASTER_WINDOW_LIMITS, STREAMING_VECTOR_LIMITS } from '@ulpin/contracts/upload-reader-limits';
import { DropOutcomes } from './IntakeDropDialog';
import { readerEligibility } from './upload-model';

it('discloses reader eligibility beside each file before retention, without creating any bytes', () => {
  const files = [
    { name: 'ortho.tif', size: 2 * 1024 ** 3 },
    { name: 'structure.ifc', size: 20 * 1024 ** 2 },
    { name: 'footprints.geojson', size: 5 * 1024 ** 2 },
    { name: 'unrecognised.new-kind', size: 1024 },
  ];
  const html = renderToStaticMarkup(<DropOutcomes readers rows={files.map(file => ({
    name: file.name, sizeBytes: file.size, state: 'waiting',
  }))} />);
  expect(html).toContain('Will be kept, not read: larger than the 16 MiB raster reader');
  expect(html).toContain('Will be read by the IFC structure reader (within 32 MiB)');
  expect(html).toContain('Will be read by the GeoJSON reader (within 1 GiB)');
  expect(html).toContain('Kind not known yet: will be kept and recognised after upload');
  expect(html).not.toContain('disabled');
});

it('uses each reader ceiling inclusively, including the native PDF limit rather than PDF admission', () => {
  const limits = [
    ['geojson', STREAMING_VECTOR_LIMITS.sourceBytes], ['ifc', IFC_LIMITS.originalBytes],
    ['pdf', DOCUMENT_LIMITS.nativeBytes], ['tif', RASTER_WINDOW_LIMITS.originalBytes],
    ['laz', POINT_BATCH_LIMITS.originalBytes], ['gpkg', NATIVE_GIS_LIMITS.sourceBytes],
  ] as const;
  for (const [extension, bytes] of limits) {
    expect(readerEligibility({ name: `source.${extension.toUpperCase()}`, size: bytes }))
      .toMatchObject({ ceilingBytes: bytes, withinCeiling: true });
    expect(readerEligibility({ name: `source.${extension}`, size: bytes + 1 }).withinCeiling).toBe(false);
  }
  expect(readerEligibility({ name: 'archive.zip', size: 1024 }).withinCeiling).toBeNull();
  expect(readerEligibility({ name: 'source.__proto__', size: 1024 }).reader).toBeNull();
  expect(readerEligibility({ name: 'source.constructor', size: 1024 }).withinCeiling).toBeNull();
});

it('forecasts only what the name and size settle: the point rule, JSON, DXF and GML kinds', () => {
  const words = (name: string, size = 1024) => readerEligibility({ name, size }).words;
  const points = 'Points are read when the file is compressed LAZ of LAS 1.4 point format 6 with at most '
    + '5 million points (within 16 MiB). Other point files are kept, not read.';
  expect(words('scan.laz')).toBe(points);
  expect(words('scan.las')).toBe(points);
  expect(words('scan.laz', POINT_BATCH_LIMITS.originalBytes + 1))
    .toBe('Will be kept, not read: larger than the 16 MiB point cloud reader');
  expect(words('city.json')).toBe('Read as GeoJSON or CityJSON once its bytes are checked (within 1 GiB). '
    + 'A CityJSON is read up to 8 MiB; other JSON is kept, not read.');
  expect(words('plan.dxf')).toBe('Will be read by the DXF reader (within 16 MiB). '
    + 'Its reading is kept as evidence, not placed on the map.');
  expect(words('city.gml')).toBe('Read by the CityGML reader when its bytes show a CityGML city model '
    + '(within 32 MiB). Other GML is kept, not read. A CityGML reading is kept as evidence, not placed on the map.');
  for (const name of ['scan.laz', 'city.json', 'plan.dxf', 'city.gml']) {
    expect(words(name)).not.toContain('Kind not known');
  }
});

it('keeps the exported native conversion ceiling aligned with the processor ceiling', () => {
  const path = resolve(import.meta.dirname, '../../../../../services/geo/geo/native_gis.py');
  const ceiling = /^MAX_SOURCE_BYTES = (\d+) \* 1024 \* 1024$/m.exec(readFileSync(path, 'utf8'));
  expect(ceiling).not.toBeNull();
  expect(NATIVE_GIS_LIMITS.sourceBytes).toBe(Number(ceiling![1]) * 1024 ** 2);
});

// Foreign test_only sources listed in docs/api/datasets.json; only their existing names and sizes are inspected.
const NIAGARA = 'E:/BhuAayam-data/datasets/map-formats/niagara-falls/'
  + 'Niagara_Falls_Building_Footprints_2018_1330698285055863645.geojson';
const NYC = 'E:/BhuAayam-data/datasets/nyc-second-area/nyc-office-of-technology-and-innovation/'
  + '5zhs-2jue-box-w74.025-s40.700-e73.940-n40.800.geojson';

it.skipIf(!existsSync(NIAGARA) || !existsSync(NYC))('forecasts both real multipart GeoJSON originals', () => {
  for (const path of [NIAGARA, NYC]) {
    expect(readerEligibility({ name: basename(path), size: statSync(path).size }))
      .toMatchObject({ reader: 'GeoJSON', ceilingBytes: STREAMING_VECTOR_LIMITS.sourceBytes, withinCeiling: true });
  }
});
