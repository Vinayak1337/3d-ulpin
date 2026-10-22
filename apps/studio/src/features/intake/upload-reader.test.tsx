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
  expect(readerEligibility({ name: 'ambiguous.json', size: 1024 }).reader).toBeNull();
  expect(readerEligibility({ name: 'archive.zip', size: 1024 }).withinCeiling).toBeNull();
  expect(readerEligibility({ name: 'source.__proto__', size: 1024 }).reader).toBeNull();
  expect(readerEligibility({ name: 'source.constructor', size: 1024 }).withinCeiling).toBeNull();
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
