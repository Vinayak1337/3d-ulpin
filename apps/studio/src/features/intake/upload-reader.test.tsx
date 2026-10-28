import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { CITYJSON_LIMITS, DOCUMENT_LIMITS, GLTF_LIMITS, IFC_LIMITS, INTAKE_TABLE_READER_FORMATS,
  LARGE_ORIGINAL_V2_LIMITS, NATIVE_GIS_LIMITS, OBJ_LIMITS, POINT_BATCH_LIMITS,
  RASTER_WINDOW_LIMITS, STREAMING_VECTOR_LIMITS, TABULAR_LIMITS, TABULAR_STREAM_LIMITS,
} from '@ulpin/contracts/upload-reader-limits';
import { DropOutcomes } from './IntakeDropDialog';
import { SLOT_STOPPED } from './upload-command';
import { readerEligibility, sizeWords, type UploadProgress } from './upload-model';

it('discloses reader eligibility beside each file before retention, without creating any bytes', () => {
  const files = [
    { name: 'ortho.tif', size: 2 * 1024 ** 3 + 1 },
    { name: 'structure.ifc', size: 20 * 1024 ** 2 },
    { name: 'footprints.geojson', size: 5 * 1024 ** 2 },
    { name: 'unrecognised.new-kind', size: 1024 },
  ];
  const html = renderToStaticMarkup(<DropOutcomes readers rows={files.map(file => ({
    name: file.name, sizeBytes: file.size, state: 'waiting',
  }))} />);
  expect(html).toMatch(/<th[^>]*>Reader<\/th>/);
  expect(html).not.toContain('Reader estimate');
  expect(html).toContain('Kept, not read: over 2 GiB');
  expect(html).toContain('IFC structure, up to 32 MiB');
  expect(html).toContain('GeoJSON, up to 1 GiB');
  expect(html).toContain('Kind not known yet');
  expect(html).not.toContain('disabled');
});

it('shows the progress of a retaining row in MiB, with no bytes', () => {
  const upload = { phase: 'uploading', doneBytes: 12 * 1024 ** 2, totalBytes: 40 * 1024 ** 2, part: 2,
    parts: 5 } as const;
  const html = renderToStaticMarkup(<DropOutcomes readers rows={[
    { name: 'footprints.geojson', sizeBytes: 40 * 1024 ** 2, state: 'retaining', upload }]} />);
  expect(html).toContain('12 MiB of 40 MiB; part 2 of 5');
  expect(html).not.toContain('bytes');
});

it.each([
  'Waiting for a free upload slot; 2 of your uploads are open. It starts by itself.',
  'The server has not answered yet while opening the upload. It asks again by itself.',
])('a waiting row shows its words and no part count until the wait stops: %s', words => {
  const upload: UploadProgress = { phase: 'waiting', doneBytes: 0, totalBytes: 40, part: 1, parts: 1, words };
  const row = (progress: UploadProgress) => renderToStaticMarkup(<DropOutcomes rows={[{ name: 'register.csv',
    sizeBytes: 40, state: 'retaining', upload: progress }]} />);
  expect(row(upload)).toContain(words);
  expect(row(upload)).not.toContain('part 1 of 1');
  expect(row({ ...upload, phase: 'stopped', words: SLOT_STOPPED }))
    .toContain(`The upload stopped at part 1 of 1: ${SLOT_STOPPED}.`);
});

// Every extension the readers table names.
const READ_EXTENSIONS = ['geojson', 'geojsons', 'geojsonl', 'jsonseq', 'ndjson', 'jsonl', 'json', 'cityjson', 'dxf',
  'glb', 'gltf', 'obj', 'gml', 'gpkg', 'kml', 'kmz', 'shp', 'shx', 'dbf', 'parquet', 'geoparquet', 'docx', 'zip',
  'ifc', 'pdf', 'tif', 'tiff', 'las', 'laz', 'png', 'jpg', 'jpeg', ...INTAKE_TABLE_READER_FORMATS];

it('S7.13b: every reader, its beyond case and the over-ceiling case are one phrase of at most 60 characters', () => {
  for (const extension of READ_EXTENSIONS) {
    const name = `source.${extension}`;
    let forecast = readerEligibility({ name, size: 1 });
    expect(forecast.reader, extension).not.toBeNull();
    // The ceiling, then the beyond reader's ceiling where there is one, then one byte over the last.
    while (forecast.withinCeiling) {
      expect(forecast.words.length, forecast.words).toBeLessThanOrEqual(60);
      expect(forecast.words, extension).toContain(`, up to ${sizeWords(forecast.ceilingBytes!)}`);
      forecast = readerEligibility({ name, size: forecast.ceilingBytes! + 1 });
    }
    expect(forecast.words, extension).toBe(`Kept, not read: over ${sizeWords(forecast.ceilingBytes!)}`);
  }
  for (const name of ['old-list.xls', 'unrecognised.new-kind']) {
    expect(readerEligibility({ name, size: 1024 }).words.length).toBeLessThanOrEqual(60);
  }
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
  expect(readerEligibility({ name: 'archive.zip', size: 1024 }).withinCeiling).toBe(true);
  // Both native workbook formats stream beyond the whole-file ceiling.
  expect(readerEligibility({ name: 'wards.ods', size: TABULAR_LIMITS.bytes + 1 }))
    .toEqual(readerEligibility({ name: 'wards.xlsx', size: TABULAR_LIMITS.bytes + 1 }));
  expect(readerEligibility({ name: 'wards.ods', size: TABULAR_STREAM_LIMITS.bytes + 1 }).withinCeiling).toBe(false);
  expect(readerEligibility({ name: 'wards.xlsx', size: TABULAR_LIMITS.bytes + 1 }).ceilingBytes)
    .toBe(TABULAR_STREAM_LIMITS.bytes);
  expect(readerEligibility({ name: 'old-list.XLS', size: 1024 })).toEqual({ reader: null, ceilingBytes: null,
    withinCeiling: null, words: 'Excel 97-2003: kept, not read; save as XLSX or ODS' });
  expect(readerEligibility({ name: 'source.__proto__', size: 1024 }).reader).toBeNull();
  expect(readerEligibility({ name: 'source.constructor', size: 1024 }).withinCeiling).toBeNull();
});

const geojsonLines = 'GeoJSON if its lines are features';
const geoparquet = 'GeoParquet if the bytes show it';
const shapefileMember = 'Native GIS with its shapefile set';
it.each([
  ['geojsons', 'GeoJSON', STREAMING_VECTOR_LIMITS.sourceBytes, geojsonLines, '1 GiB'],
  ['geojsonl', 'GeoJSON', STREAMING_VECTOR_LIMITS.sourceBytes, geojsonLines, '1 GiB'],
  ['jsonseq', 'GeoJSON', STREAMING_VECTOR_LIMITS.sourceBytes, geojsonLines, '1 GiB'],
  ['ndjson', 'GeoJSON', STREAMING_VECTOR_LIMITS.sourceBytes, geojsonLines, '1 GiB'],
  ['jsonl', 'GeoJSON', STREAMING_VECTOR_LIMITS.sourceBytes, geojsonLines, '1 GiB'],
  ['parquet', 'native GIS conversion', NATIVE_GIS_LIMITS.sourceBytes, geoparquet, '1 GiB'],
  ['geoparquet', 'native GIS conversion', NATIVE_GIS_LIMITS.sourceBytes, geoparquet, '1 GiB'],
  ['shx', 'native GIS conversion', NATIVE_GIS_LIMITS.sourceBytes, shapefileMember, '1 GiB'],
  ['dbf', 'native GIS conversion', NATIVE_GIS_LIMITS.sourceBytes, shapefileMember, '1 GiB'],
  ['docx', 'DOCX', DOCUMENT_LIMITS.nativeBytes, 'DOCX', '10 MiB'],
  ['zip', 'ZIP', LARGE_ORIGINAL_V2_LIMITS.maxOriginalBytes, 'ZIP, each member on its own', '7 GiB'],
] as const)('forecasts .%s at its ceiling and one byte above', (extension, reader, bytes, read, size) => {
  expect(readerEligibility({ name: `source.${extension.toUpperCase()}`, size: bytes }))
    .toEqual({ reader, ceilingBytes: bytes, withinCeiling: true, words: `${read}, up to ${size}` });
  expect(readerEligibility({ name: `source.${extension}`, size: bytes + 1 }))
    .toEqual({ reader, ceilingBytes: bytes, withinCeiling: false, words: `Kept, not read: over ${size}` });
});

it('forecasts a PDF by its text-layer ceiling, then by the OCR ceiling and page rule, then as not read', () => {
  const words = (size: number) => readerEligibility({ name: 'plan.pdf', size }).words;
  expect(readerEligibility({ name: 'plan.PDF', size: DOCUMENT_LIMITS.nativeBytes }))
    .toMatchObject({ reader: 'PDF native text', ceilingBytes: DOCUMENT_LIMITS.nativeBytes, withinCeiling: true });
  expect(words(DOCUMENT_LIMITS.nativeBytes)).toBe('PDF native text, up to 10 MiB');
  const ocr = 'PDF OCR if at most 400 pages, up to 1 GiB';
  for (const size of [DOCUMENT_LIMITS.nativeBytes + 1, DOCUMENT_LIMITS.originalBytes]) {
    expect(words(size)).toBe(ocr);
    expect(readerEligibility({ name: 'plan.pdf', size }))
      .toMatchObject({ ceilingBytes: DOCUMENT_LIMITS.originalBytes, withinCeiling: true });
  }
  expect(words(DOCUMENT_LIMITS.originalBytes + 1)).toBe('Kept, not read: over 1 GiB');
  expect(readerEligibility({ name: 'plan.pdf', size: DOCUMENT_LIMITS.originalBytes + 1 }).withinCeiling).toBe(false);
  // Above the native-text bound, OCR may still read a selected page within the original bound.
  expect(words(DOCUMENT_LIMITS.nativeBytes + 1)).not.toContain('Kept, not read');
});

it('forecasts only what the name and size settle: points, JSON, CityJSON, DXF, glTF, OBJ and GML kinds', () => {
  const words = (name: string, size = 1024) => readerEligibility({ name, size }).words;
  const points = 'LAS 1.2–1.4, formats 0–3 or 6–8, 500M points, up to 1 GiB';
  expect(words('scan.laz')).toBe(points);
  expect(words('scan.las')).toBe(points);
  expect(words('scan.laz', POINT_BATCH_LIMITS.originalBytes + 1)).toBe('Kept, not read: over 1 GiB');
  expect(words('city.json')).toBe('GeoJSON, CityJSON or glTF, by its bytes, up to 1 GiB');
  expect(words('city.cityjson')).toBe('CityJSON if the bytes show it, up to 8 MiB');
  expect(words('city.cityjson', CITYJSON_LIMITS.originalBytes + 1)).toBe('Kept, not read: over 8 MiB');
  expect(words('plan.dxf')).toBe('DXF, up to 16 MiB');
  for (const name of ['model.glb', 'model.gltf']) expect(words(name)).toBe('glTF, up to 16 MiB');
  expect(words('model.glb', GLTF_LIMITS.originalBytes + 1)).toBe('Kept, not read: over 16 MiB');
  expect(words('mesh.obj')).toBe('OBJ, up to 16 MiB');
  expect(words('mesh.obj', OBJ_LIMITS.originalBytes + 1)).toBe('Kept, not read: over 16 MiB');
  expect(words('city.gml')).toBe('CityGML if the bytes show it, up to 33 MiB');
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
