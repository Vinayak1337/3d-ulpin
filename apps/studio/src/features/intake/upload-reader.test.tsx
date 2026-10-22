import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { CITYJSON_LIMITS, DOCUMENT_LIMITS, GLTF_LIMITS, IFC_LIMITS, NATIVE_GIS_LIMITS, OBJ_LIMITS, POINT_BATCH_LIMITS,
  RASTER_WINDOW_LIMITS, STREAMING_VECTOR_LIMITS, TABULAR_LIMITS, TABULAR_STREAM_LIMITS,
} from '@ulpin/contracts/upload-reader-limits';
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

it('uses each reader ceiling inclusively', () => {
  const limits = [
    ['geojson', STREAMING_VECTOR_LIMITS.sourceBytes], ['ifc', IFC_LIMITS.originalBytes],
    ['tif', RASTER_WINDOW_LIMITS.originalBytes], ['cityjson', CITYJSON_LIMITS.originalBytes],
    ['laz', POINT_BATCH_LIMITS.originalBytes], ['gpkg', NATIVE_GIS_LIMITS.sourceBytes],
    ['glb', GLTF_LIMITS.originalBytes], ['gltf', GLTF_LIMITS.originalBytes], ['obj', OBJ_LIMITS.originalBytes],
  ] as const;
  for (const [extension, bytes] of limits) {
    expect(readerEligibility({ name: `source.${extension.toUpperCase()}`, size: bytes }))
      .toMatchObject({ ceilingBytes: bytes, withinCeiling: true });
    expect(readerEligibility({ name: `source.${extension}`, size: bytes + 1 }).withinCeiling).toBe(false);
  }
  expect(readerEligibility({ name: 'archive.zip', size: 1024 }).withinCeiling).toBeNull();
  // Both native workbook formats stream beyond the whole-file ceiling.
  expect(readerEligibility({ name: 'wards.ods', size: TABULAR_LIMITS.bytes + 1 }))
    .toEqual(readerEligibility({ name: 'wards.xlsx', size: TABULAR_LIMITS.bytes + 1 }));
  expect(readerEligibility({ name: 'wards.ods', size: TABULAR_STREAM_LIMITS.bytes + 1 }).withinCeiling).toBe(false);
  expect(readerEligibility({ name: 'wards.xlsx', size: TABULAR_LIMITS.bytes + 1 }).ceilingBytes)
    .toBe(TABULAR_STREAM_LIMITS.bytes);
  expect(readerEligibility({ name: 'old-list.XLS', size: 1024 })).toEqual({ reader: null, ceilingBytes: null,
    withinCeiling: null, words: 'Excel 97-2003 workbook. It is kept as evidence; this version does not read its '
      + 'cells. Save it as XLSX or ODS and add that file to place its rows on the map.' });
  expect(readerEligibility({ name: 'source.__proto__', size: 1024 }).reader).toBeNull();
  expect(readerEligibility({ name: 'source.constructor', size: 1024 }).withinCeiling).toBeNull();
});

it('forecasts a PDF by its text-layer ceiling, then by the OCR ceiling and page rule, then as not read', () => {
  const words = (size: number) => readerEligibility({ name: 'plan.pdf', size }).words;
  expect(readerEligibility({ name: 'plan.PDF', size: DOCUMENT_LIMITS.nativeBytes }))
    .toMatchObject({ reader: 'PDF native text', ceilingBytes: DOCUMENT_LIMITS.nativeBytes, withinCeiling: true });
  expect(words(DOCUMENT_LIMITS.nativeBytes)).toBe('Will be read by the PDF native text reader (within 10 MiB)');
  const ocr = 'Text layer not read above 10 MiB, but its pages can be read by OCR when the PDF has at most 8 pages, '
    + 'checked after upload (within 16 MiB)';
  for (const size of [DOCUMENT_LIMITS.nativeBytes + 1, DOCUMENT_LIMITS.originalBytes]) {
    expect(words(size)).toBe(ocr);
    expect(readerEligibility({ name: 'plan.pdf', size }))
      .toMatchObject({ ceilingBytes: DOCUMENT_LIMITS.originalBytes, withinCeiling: true });
  }
  expect(words(DOCUMENT_LIMITS.originalBytes + 1)).toBe('Will be kept, not read: larger than the 16 MiB PDF '
    + 'document reader');
  expect(readerEligibility({ name: 'plan.pdf', size: DOCUMENT_LIMITS.originalBytes + 1 }).withinCeiling).toBe(false);
  // The 10–16 MiB band never calls the file "not read": OCR may still read its pages.
  expect(words(DOCUMENT_LIMITS.nativeBytes + 1)).not.toContain('kept, not read');
});

it('forecasts only what the name and size settle: points, JSON, CityJSON, DXF, glTF, OBJ and GML kinds', () => {
  const words = (name: string, size = 1024) => readerEligibility({ name, size }).words;
  const points = 'Points are read when the file is compressed LAZ of LAS 1.4 point format 6 with at most '
    + '5 million points (within 16 MiB). Other point files are kept, not read.';
  expect(words('scan.laz')).toBe(points);
  expect(words('scan.las')).toBe(points);
  expect(words('scan.laz', POINT_BATCH_LIMITS.originalBytes + 1))
    .toBe('Will be kept, not read: larger than the 16 MiB point cloud reader');
  expect(words('city.json')).toBe('Read as GeoJSON, CityJSON or glTF JSON once its bytes are checked '
    + '(within 1 GiB). A CityJSON is read up to 8 MiB and glTF JSON up to 16 MiB; other JSON is kept, not read. '
    + 'CityJSON building ground outlines are placed on the map when the file states an EPSG system; otherwise, '
    + 'and for glTF, the reading is kept as evidence.');
  const outlines = 'Building ground outlines are placed on the map when the file states an EPSG system; '
    + 'otherwise its reading is kept as evidence.';
  expect(words('city.cityjson')).toBe('Read by the CityJSON reader when its bytes show a CityJSON city model '
    + `(within 8 MiB). ${outlines}`);
  expect(words('city.cityjson', CITYJSON_LIMITS.originalBytes + 1))
    .toBe('Will be kept, not read: larger than the 8 MiB CityJSON reader');
  expect(words('plan.dxf')).toBe('Will be read by the DXF reader (within 16 MiB). '
    + 'Its reading is kept as evidence, not placed on the map.');
  for (const name of ['model.glb', 'model.gltf']) {
    expect(words(name)).toBe('Will be read by the glTF reader (within 16 MiB). '
      + 'Its reading is kept as evidence, not placed on the map.');
  }
  expect(words('model.glb', GLTF_LIMITS.originalBytes + 1))
    .toBe('Will be kept, not read: larger than the 16 MiB glTF reader');
  expect(words('mesh.obj')).toBe('Will be read by the OBJ reader (within 16 MiB). '
    + 'Its reading is kept as evidence, not placed on the map.');
  expect(words('mesh.obj', OBJ_LIMITS.originalBytes + 1))
    .toBe('Will be kept, not read: larger than the 16 MiB OBJ reader');
  expect(words('city.gml')).toBe('Read by the CityGML reader when its bytes show a CityGML city model '
    + `(within 32 MiB). Other GML is kept, not read. ${outlines}`);
  for (const name of ['scan.laz', 'city.json', 'city.cityjson', 'plan.dxf', 'model.glb', 'model.gltf', 'mesh.obj',
    'city.gml']) {
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
