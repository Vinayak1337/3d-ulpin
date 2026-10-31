import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import captured from '../../../../../../docs/evidence/gf1/lq1a/controls-second.json';
import { createContractValidator } from '../../../local/contract';
import type { IntakeItem } from '../batch-model';
import { IntakeTray } from '../IntakeTray';
import { api } from '@ulpin/api-client';
import { ModelPreviewBody, NativeReading, OmissionsBody, ReadingBody } from './NativeReading';
import { DxfDrawing, dxfDrawing, type DxfInspection } from './DxfDrawing';
import { modelPreviewPlan, modelView, previewView, readingView, type NativeOmissions,
  type NativeStatus } from './reading-model';
import { hasConvertedLayers, nativeReaderOf, opensReading } from './reader-of';
import { readDxfArtifact, readModelArtifact } from './useNativeReading';

const root = resolve(import.meta.dirname, '../../../../../..');
const openapi = JSON.parse(readFileSync(resolve(root, 'docs/api/openapi.json'), 'utf8'));
const validate = createContractValidator(openapi);
const schemaOf = (path: string) => openapi.paths[path].get.responses['200'].content['application/json'].schema.$ref
  .split('/').at(-1);
const ids = { caseId: '10000000-0000-4000-8000-000000000001', sourceId: '10000000-0000-4000-8000-000000000002',
  jobId: '10000000-0000-4000-8000-000000000003', itemId: '10000000-0000-4000-8000-000000000009' };
const geojson = captured.manifest.items[0] as unknown as IntakeItem;
const dxf = { ...geojson, itemId: ids.itemId, sourceId: ids.sourceId, name: 'site.dxf', format: 'dxf',
  family: 'model3d', card: { ...geojson.card!, format: 'dxf' }, state: 'reading', nativeReaderJobId: ids.jobId } as
  IntakeItem;

const tray = (items: IntakeItem[]) => renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}>
  <MemoryRouter>
    <IntakeTray caseId={ids.caseId} items={items} packages={[]} choose={vi.fn()} refresh={vi.fn()} />
  </MemoryRouter>
</QueryClientProvider>);

it('an item naming its native reading offers Open the reading; the same item without one does not', () => {
  expect(nativeReaderOf(dxf)).toBe('dxf');
  expect(tray([geojson, dxf]).match(/>Open the reading</g)).toHaveLength(1);
  expect(tray([geojson, dxf])).toContain('aria-label="Open the reading: site.dxf"');
  const { nativeReaderJobId: _job, ...unread } = dxf;
  expect(nativeReaderOf(unread)).toBeNull();
  expect(tray([geojson, unread as IntakeItem])).not.toContain('Open the reading');
  // A glTF binary goes to the one glTF reader; a format no reader takes offers nothing.
  expect(nativeReaderOf({ ...dxf, card: { ...dxf.card!, format: 'glb' } })).toBe('gltf');
  expect(nativeReaderOf({ ...dxf, card: { ...dxf.card!, format: 'ifc' } })).toBeNull();
});

it('a read GeoPackage, or the .shp of a set, offers its converted layers; a part, a member or a reading does not', () => {
  const gpkg = { ...geojson, itemId: ids.itemId, name: 'outlines.gpkg', format: 'geopackage', state: 'read',
    card: { ...geojson.card!, format: 'geopackage' } } as IntakeItem;
  expect(hasConvertedLayers(gpkg)).toBe(true);
  expect(opensReading(gpkg)).toBe(true);
  expect(hasConvertedLayers({ ...gpkg, state: 'reading' })).toBe(false);
  expect(hasConvertedLayers({ ...gpkg, parentItemId: ids.jobId })).toBe(false);
  const shp = { ...gpkg, name: 'parcels.shp', card: { ...gpkg.card!, format: 'shapefile' } } as IntakeItem;
  expect(hasConvertedLayers(shp)).toBe(true);
  expect(hasConvertedLayers({ ...shp, name: 'parcels.shx' })).toBe(false);
  expect(opensReading(geojson)).toBe(false);
});

/** A status body in the DXF reader's published shape (protocol control, not a dataset record). */
function dxfStatus(state: 'completed' | 'failed' | 'queued' = 'completed'): NativeStatus {
  const summary = { schemaVersion: 'dxf-native-inspection/1', sourceSha256: 'a'.repeat(64), sourceBytes: 52_114,
    dxfVersion: 'AC1027', recordCount: 812, projectedEntityCount: 640, pointCount: 2_204, unsupportedFindingCount: 3,
    units: { state: 'absent', code: null, name: null }, inspectionFrame: 'source_local',
    geometryValidity: 'not_assessed', globalPlacement: 'not_assessed', unitConversionApplied: false,
    blockExpansion: 'not_performed', analyticEligible: false, operationalRecords: false, trainingLabels: false,
    rights: 'not_assessed' };
  const artifact = { key: `dxf-native/${ids.jobId}/${'b'.repeat(64)}.json`, sha256: 'b'.repeat(64), bytes: 9_000,
    mediaType: 'application/json', profile: 'dxf-native-inspection/1' };
  return { version: 'dxf-native/1', caseId: ids.caseId, sourceId: ids.sourceId, jobId: ids.jobId,
    currentCaseRevision: 4, sourceRevision: 1, sourceSha256: 'a'.repeat(64), status: state,
    code: state === 'failed' ? 'DXF_READ_LIMIT' : null,
    result: state === 'completed' ? { summary, artifact, createdAt: '2026-10-22T10:00:00.000Z' } : null } as NativeStatus;
}

it('the batch page decides on a reading without loading the scene, and loads the reading only when it opens', () => {
  const source = (name: string) => readFileSync(resolve(import.meta.dirname, name), 'utf8');
  expect(source('reader-of.ts')).not.toMatch(/from '(@ulpin\/scene|three)'/);
  expect(source('../BatchPage.tsx')).not.toMatch(/from '\.\/native\/(NativeReading|reading-model)'/);
  expect(source('../IntakeTray.tsx')).not.toMatch(/from '\.\/native\/(NativeReading|reading-model)'/);
});

it('opens the reading with the reader\'s summary fields as stored, and words for a stop or a wait', () => {
  const body = dxfStatus();
  expect(validate(schemaOf('/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/dxf/jobs/{jobId}'), body))
    .toEqual([]);
  const html = renderToStaticMarkup(<ReadingBody view={readingView('dxf', body)} />);
  expect(html).toContain('<dt class="');
  expect(html).toMatch(/Projected entity count<\/dt><dd>640<\/dd>/);
  expect(html).toMatch(/DXF version<\/dt><dd>AC1027<\/dd>/);
  expect(html).toMatch(/Global placement<\/dt><dd>Not assessed<\/dd>/);
  expect(html).toMatch(/Unit conversion applied<\/dt><dd>No<\/dd>/);
  expect(html).not.toMatch(/<button|Confirm|Place on/);
  const stopped = renderToStaticMarkup(<ReadingBody view={readingView('dxf', dxfStatus('failed'))} />);
  expect(stopped).toContain('The DXF reading stopped (DXF_READ_LIMIT); there is no reading to open.');
  expect(renderToStaticMarkup(<ReadingBody view={readingView('dxf', dxfStatus('queued'))} />))
    .toContain('waiting to start');
});

it('a nested summary value reads as labelled lines in words; fingerprints sit in a closed details', () => {
  const body = dxfStatus();
  const html = renderToStaticMarkup(<ReadingBody view={readingView('dxf', body)} />);
  expect(html).toMatch(/Units · state<\/dt><dd>Absent<\/dd>/);
  expect(html).toMatch(/Units · code<\/dt><dd>Not stated<\/dd>/);
  expect(html).toMatch(/Units · name<\/dt><dd>Not stated<\/dd>/);
  expect(html).not.toMatch(/[{}]|null|result SHA-256|not_assessed|globalPlacement/);
  const details = html.slice(html.indexOf('<details'));
  expect(details).toMatch(/^<details class="[^"]*"><summary>File fingerprints and reader format<\/summary>/);
  expect(details).toMatch(/Source SHA-256<\/dt><dd class="ul-mono">a{64}<\/dd>/);
  expect(details).toMatch(/Stored reading SHA-256<\/dt><dd class="ul-mono">b{64}<\/dd>/);
  expect(details).toContain('Reader format</dt><dd class="ul-mono">dxf-native-inspection/1</dd>');
  expect(html.slice(0, html.indexOf('<details'))).not.toMatch(/a{64}|b{64}|dxf-native-inspection/);
  // test_only: an array of objects, an empty list, a stored null and the state "null" stay apart in words.
  const view = readingView('gltf', { ...body, result: { ...body.result!, summary: {
    companions: [{ kind: 'buffer', state: 'missing', reason: 'NOT_SUPPLIED', sha256: null }], findingCodes: [],
    selectedSceneIndex: null, referenceSystemState: 'null', globalPlacement: 'unknown',
    decodedBounds: { minimum: [1.5, 2, 3], maximum: [4, 5, 6.25] } } } } as unknown as NativeStatus);
  if (view.state !== 'read') throw new Error('Wrong test view');
  expect(view.lines).toEqual([
    { label: 'Companions 1 · kind', value: 'Buffer' }, { label: 'Companions 1 · state', value: 'Missing' },
    { label: 'Companions 1 · reason', value: 'Not supplied' }, { label: 'Finding codes', value: 'None listed' },
    { label: 'Selected scene index', value: 'Not stated' },
    { label: 'Reference system state', value: 'Stated as empty' },
    { label: 'Global placement', value: 'Unknown' }, { label: 'Decoded bounds · minimum', value: '1.5, 2, 3' },
    { label: 'Decoded bounds · maximum', value: '4, 5, 6.25' }]);
  expect(view.hashes[0]).toEqual({ label: 'Companions 1 · SHA-256', value: 'Not stated' });
});

it('lists the features left out per layer with position kind and reason, and says when the list is bounded', () => {
  const omissions: NativeOmissions = { version: 'intake-native-omissions/1', caseId: ids.caseId, itemId: ids.itemId,
    sourceId: ids.sourceId, sourceRevision: 1, sourceSha256: 'a'.repeat(64), words: '123 features of 1 layer were '
      + 'not written.', layers: [
      { layer: 'Copy', ordinal: 0, derivativeSourceId: '10000000-0000-4000-8000-00000000000a', positionKind: null,
        written: 87, notWritten: 0, listed: [], scan: 'none_left_out', sidecarSha256: 'c'.repeat(64) },
      { layer: 'Council_Buildings', ordinal: 1, derivativeSourceId: '10000000-0000-4000-8000-00000000000b',
        positionKind: 'fid', written: 4, notWritten: 123, scan: 'whole', sidecarSha256: 'd'.repeat(64),
        listed: Array.from({ length: 50 }, (_, at) => ({ position: at * 2 + 1, reason: 'geometry_header' })) },
    ] };
  expect(validate(schemaOf('/api/v1/ingestion/cases/{caseId}/intake/items/{itemId}/omissions'), omissions))
    .toEqual([]);
  const html = renderToStaticMarkup(<OmissionsBody omissions={omissions} />);
  expect(html).toContain('87 written, 0 not written · nothing left out');
  expect(html).toContain('4 written, 123 not written · the first 50 of 123 listed');
  expect(html).toContain('<span class="ul-mono">fid 1</span>: geometry_header');
  expect(html).toMatch(/<details class="[^"]*"><summary>50 listed<\/summary>/);
});

// test_only: a unit cube as six faces of four corners, in the shape the Box.glb reading states (2 nodes,
// 1 primitive, 24 positions, 36 indices); a protocol control, not a dataset record.
const boxPositions = [[2, 1], [2, -1], [0, 1], [0, -1], [1, 1], [1, -1]].flatMap(([axis, side]) =>
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([u, v]) => {
    const at = [0, 0, 0];
    at[axis!] = side! * 0.5;
    at[(axis! + 1) % 3] = u! * 0.5;
    at[(axis! + 2) % 3] = v! * 0.5;
    return at;
  }));
const boxIndices = Array.from({ length: 6 }, (_, face) => [0, 1, 2, 3, 2, 1].map(k => face * 4 + k)).flat();
const gltfArtifact = { schemaVersion: 'gltf-local-inspection/1', status: 'inspected_local',
  geometryProjectionStatus: 'available', representation: 'context_mesh',
  nodes: [{ sourceNodeIndex: 0, declaration: { children: [1],
    matrix: [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1] } }, { sourceNodeIndex: 1, declaration: { mesh: 0 } }],
  primitives: [{ sourceMeshIndex: 0, sourcePrimitiveIndex: 0, mode: { value: 4, origin: 'source' },
    status: 'available_local_projection', projection: { POSITION: { status: 'available', values: boxPositions },
      indices: { status: 'available', values: boxIndices } } }],
  counts: { nodes: 2, primitives: 1, projectedPositions: 24, projectedIndices: 36 },
  qualification: { globalPlacement: 'unknown', measurements: false, rendering: false,
    localFrame: { axes: 'right_handed_Y_up', linearUnit: 'metre', origin: 'glTF_2.0_specification_semantics' },
    coordinates: 'source_accessor_values; node transforms are declarations only' } };

function gltfStatus(bytes: Uint8Array<ArrayBuffer>, sha256: string, projectedPositions = 24): NativeStatus {
  const summary = { schemaVersion: 'gltf-local-inspection/1', sourceSha256: 'a'.repeat(64), sourceBytes: 1_664,
    status: 'inspected_local', geometryProjectionStatus: 'available', representation: 'context_mesh',
    selectedSceneIndex: 0, selectedSceneOrigin: 'source', nodeCount: 2, primitiveCount: 1, projectedPositions,
    projectedIndices: 36, missingCompanionCount: 0, unsupportedPrimitiveCount: 0, globalPlacement: 'unknown',
    accuracy: 'not_assessed', validity: 'not_assessed', canonicalIdentity: 'not_assessed', analyticEligible: false,
    registryAdmission: false, measurements: false, learningLabels: false, rights: 'not_assessed' };
  return { version: 'gltf-native/1', caseId: ids.caseId, sourceId: ids.sourceId, jobId: ids.jobId,
    currentCaseRevision: 4, sourceRevision: 1, sourceSha256: 'a'.repeat(64), status: 'completed', code: null,
    result: { summary, createdAt: '2026-10-22T10:00:00.000Z', artifact: { key: `gltf-native/${ids.jobId}.json`,
      sha256, bytes: bytes.byteLength, mediaType: 'application/json', profile: 'gltf-local-inspection/1' } } } as
    NativeStatus;
}

// test_only: LINE XY values from 1_polylines.dxf's pinned offline inspection; origin and hashes in S5.8 evidence.
const realDxfLines = [
  [201.225483582218, 251.704902128348, 207.061034027812, 247.525895035051],
  [207.061034027812, 247.525895035051, 224.866935540639, 255.344722636624],
  [224.866935540639, 255.344722636624, 247.534965141839, 246.671737397904],
  [247.534965141839, 246.671737397904, 263.041211477733, 255.738949238384],
  [263.041211477733, 255.738949238384, 276.676290709657, 251.704902128348],
  [276.676290709657, 251.704902128348, 293.615139611909, 251.704902128348],
  [293.615139611909, 251.704902128348, 293.615139611909, 225.594474159791],
  [293.615139611909, 225.594474159791, 249.280146982913, 225.594474159791],
  [233.630447224849, 225.594474159791, 186.424961635729, 225.594474159791],
  [186.424961635729, 225.594474159791, 186.424961635729, 230.824838265037],
  [186.424961635729, 246.474538023101, 186.424961635729, 251.704902128348],
  [186.424961635729, 251.704902128348, 201.225483582218, 251.704902128348],
  [127.332940443732, 150.140801149637, 127.332940443732, 251.704902128348],
  [127.332940443732, 251.704902128348, 161.963613328344, 251.704902128348],
  [161.963613328344, 251.704902128348, 161.963613328344, 217.449717188127],
  [161.963613328344, 201.800017430063, 161.963613328344, 187.897811298324],
  [161.963613328344, 172.24811154026, 161.963613328344, 142.315951270605],
  [161.963613328344, 142.315951270605, 135.157790322764, 142.315951270605],
  [300.336099275167, 193.86545203698, 343.477630394437, 193.86545203698],
  [343.477630394437, 193.86545203698, 343.477630394437, 143.089065730292],
  [343.477630394437, 143.089065730292, 300.336099275167, 143.089065730292],
  [300.336099275167, 143.089065730292, 300.336099275167, 193.86545203698],
  [282.858719930474, 185.678679607098, 329.035795883295, 185.678679607098],
  [329.035795883295, 185.678679607098, 329.035795883295, 127.175451905913],
  [329.035795883295, 127.175451905913, 282.858719930474, 127.175451905913],
  [282.858719930474, 127.175451905913, 282.858719930474, 185.678679607098],
  [295.092885471759, 163.326031287305, 317.353547584474, 163.326031287305],
  [317.353547584474, 163.326031287305, 317.353547584474, 131.314831224393],
  [317.353547584474, 131.314831224393, 295.092885471759, 131.314831224393],
  [295.092885471759, 131.314831224393, 295.092885471759, 163.326031287305],
  [304.843423421956, 169.489107161487, 322.136830352495, 169.489107161487],
  [322.136830352495, 169.489107161487, 322.136830352495, 148.056320912468],
  [322.136830352495, 148.056320912468, 304.843423421956, 148.056320912468],
  [304.843423421956, 148.056320912468, 304.843423421956, 169.489107161487],
  [286.538168213567, 181.723272702772, 312.66225102353, 181.723272702772],
  [312.66225102353, 181.723272702772, 312.66225102353, 157.162955413124],
  [312.66225102353, 157.162955413124, 286.538168213567, 157.162955413124],
  [286.538168213567, 157.162955413124, 286.538168213567, 181.723272702772],
  [123.833854757663, 283.221918724323, 155.350538639996, 295.650346541175],
  [155.350538639996, 295.650346541175, 186.610052057335, 278.801247110552],
  [186.610052057335, 278.801247110552, 218.091264151393, 292.98996242055],
  [218.091264151393, 292.98996242055, 244.251708004201, 278.025301742037],
  [244.251708004201, 278.025301742037, 292.471170190522, 271.263492102116],
  [292.471170190522, 271.263492102116, 299.122130492083, 293.876757127425],
  [125.988765895369, 319.407576738352, 132.868988647993, 319.407576738352],
  [167.016853282947, 319.407576738352, 178.991086411577, 319.407576738352],
  [142.608602874929, 319.407576738352, 159.008036531843, 319.407576738352],
  [186.496167859144, 319.407576738352, 195.478529603217, 319.407576738352],
  [227.148493422644, 319.407576738352, 244.884451278291, 319.407576738352],
  [204.150320882186, 319.407576738352, 218.593681820253, 319.407576738352],
  [252.735214316785, 319.407576738352, 270.304227492187, 319.407576738352],
  [277.419339041319, 319.407576738352, 301.795816533311, 319.407576738352],
];
const field = (codes: number[], values: number[]) => ({ state: 'supplied',
  tags: codes.map((code, at) => ({ code, value: values[at]! })) });
const realDxf: DxfInspection = { units: { state: 'declared', code: 6, name: 'm' }, entities: [
  ...realDxfLines.map(row => ({ type: 'LINE', status: 'supported', fields: {
    start: field([10, 20], row.slice(0, 2)), end: field([11, 21], row.slice(2)) } })),
  ...Array.from({ length: 22 }, () => ({ type: 'ARC', status: 'supported', fields: {} })),
  ...Array.from({ length: 9 }, () => ({ type: 'TEXT', status: 'supported', fields: {} })),
] };

it('draws the real inspection as 52 paths, accounts for all 83 entities and shows only the three drawing lines', () => {
  const drawing = dxfDrawing(realDxf);
  expect(drawing.paths).toHaveLength(52);
  expect(drawing.paths.length + Object.values(drawing.notDrawn).reduce((sum, n) => sum + n, 0)).toBe(83);
  expect(drawing.notDrawn).toEqual({ ARC: 22, TEXT: 9 });
  expect(drawing.paths[0]).toBe('M201.225483582218 251.704902128348 L207.061034027812 247.525895035051');
  const client = new QueryClient();
  client.setQueryData(['intake', ids.caseId, 'native-reading', 'dxf', ids.sourceId, ids.jobId], dxfStatus());
  client.setQueryData(['intake', ids.caseId, 'dxf-drawing', ids.sourceId, ids.jobId, 'b'.repeat(64)], realDxf);
  const html = renderToStaticMarkup(<QueryClientProvider client={client}>
    <NativeReading caseId={ids.caseId} item={dxf} />
  </QueryClientProvider>);
  expect(html.match(/<svg/g)).toHaveLength(1);
  expect(html.match(/<path /g)).toHaveLength(52);
  expect(html.match(/<p>/g)).toHaveLength(3);
  expect(html).toContain('$INSUNITS: 6 · m');
  expect(html).toContain('Not drawn · ARC: 22, TEXT: 9');
  expect(html).toContain('The drawing is not placed on the map.');
  expect(html).not.toMatch(/<button|<dl|File fingerprints|CRS|scale inferred/);
  client.clear();
});

it('draws straight closed and WCS polylines but counts OCS, bulges and unsupported types without conversion', () => {
  // test_only: protocol edge cases, not source records.
  const poly = { type: 'LWPOLYLINE', status: 'supported', fields: { flags: field([70], [1]) },
    vertices: [{ position: field([10, 20], [1, 2]) }, { position: field([10, 20], [3, 4]) }] };
  const ocs = { ...poly, fields: { extrusion: field([210, 220, 230], [0, 1, 0]) } };
  const inspection: DxfInspection = { units: { state: 'absent', code: null, name: null }, entities: [poly, ocs,
    { ...poly, vertices: [{ ...poly.vertices[0], bulge: field([42], [0.5]) }, poly.vertices[1]!] },
    { ...poly, type: 'POLYLINE', fields: { flags: field([70], [8]), ...ocs.fields },
      vertices: poly.vertices.map(vertex => ({ fields: vertex })) },
    { ...poly, fields: { extrusion: field([210, 220, 230], [0, 0, 1]) } },
    ...['CIRCLE', 'INSERT', 'TEXT'].map(type => ({ type, status: 'supported', fields: {} })),
  ] };
  const drawing = dxfDrawing(inspection);
  expect(drawing.paths).toEqual(['M1 2 L3 4 Z', 'M1 2 L3 4', 'M1 2 L3 4']);
  expect(drawing.notDrawn).toEqual({ 'LWPOLYLINE (OCS)': 1, 'LWPOLYLINE (bulged)': 1,
    CIRCLE: 1, INSERT: 1, TEXT: 1 });
  expect(renderToStaticMarkup(<DxfDrawing inspection={inspection} />)).toContain('Units not stated');
  const capped = dxfDrawing({ ...inspection, entities: Array.from({ length: 50_001 }, () => realDxf.entities[0]!) });
  expect(capped.segments).toBe(50_000);
  expect(capped.notDrawn).toEqual({ 'LINE (segment limit)': 1 });
  expect(capped.omittedSegments).toBe(1);
});

const encoded = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const sha = async (bytes: Uint8Array<ArrayBuffer>) => Array.from(
  new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
const served = (bytes: Uint8Array<ArrayBuffer>) => ({ response: new Response(null, { status: 200 }),
  data: bytes.slice().buffer, error: undefined }) as never;

it('reads a DXF inspection and its pinned pages, refusing changed bytes before drawing', async () => {
  const signal = new AbortController().signal;
  const bytes = encoded(realDxf);
  const pin = { bytes: bytes.byteLength, sha256: await sha(bytes) };
  const get = vi.spyOn(api, 'GET').mockResolvedValue(served(bytes));
  try {
    expect(await readDxfArtifact(ids, pin, signal)).toEqual(realDxf);
    expect(get.mock.calls[0]![0]).toBe('/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/dxf/jobs/{jobId}/native');
    await expect(readDxfArtifact(ids, { ...pin, sha256: '0'.repeat(64) }, signal)).rejects.toThrow('SHA-256');
    const page = encoded({ schemaVersion: 'dxf-native-entity-page/1', sourceSha256: 'a'.repeat(64),
      pageIndex: 0, firstOrdinal: 0, entities: realDxf.entities });
    const pagePin = { bytes: page.byteLength, sha256: await sha(page), pageIndex: 0, firstOrdinal: 0,
      entityCount: realDxf.entities.length };
    const head = encoded({ units: realDxf.units, sourceSha256: 'a'.repeat(64), pages: [pagePin] });
    const headPin = { bytes: head.byteLength, sha256: await sha(head) };
    get.mockReset().mockResolvedValueOnce(served(head)).mockResolvedValueOnce(served(page));
    expect((await readDxfArtifact(ids, headPin, signal)).entities).toEqual(realDxf.entities);
    expect(get.mock.calls[1]![0]).toContain('/native/pages/{pageIndex}');
    expect(get).toHaveBeenLastCalledWith(
      '/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/dxf/jobs/{jobId}/native/pages/{pageIndex}',
      expect.objectContaining({ params: { path: { ...ids, pageIndex: 0 } } }));
    get.mockReset().mockResolvedValueOnce(served(head)).mockResolvedValueOnce(served(bytes));
    await expect(readDxfArtifact(ids, headPin, signal)).rejects.toThrow('SHA-256');
  } finally {
    get.mockRestore();
  }
});

it('a Box-shaped glTF result is read once by its pins and drawn as 12 triangles in its own frame', async () => {
  const bytes = encoded(gltfArtifact);
  const status = gltfStatus(bytes, await sha(bytes));
  expect(validate(schemaOf('/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/gltf/jobs/{jobId}'), status))
    .toEqual([]);
  const plan = modelPreviewPlan('gltf', status);
  if (plan.state !== 'read') throw new Error('Wrong test plan');
  const get = vi.spyOn(api, 'GET').mockResolvedValue(served(bytes));
  const native = await readModelArtifact('gltf', ids, plan.artifact, new AbortController().signal);
  expect(get).toHaveBeenCalledOnce();
  expect(get.mock.calls[0]![0]).toBe('/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/gltf/jobs/{jobId}/native');
  get.mockRestore();
  const view = previewView(plan, { data: native, error: null, isPending: false });
  if (view.state !== 'mesh') throw new Error('Wrong test view');
  expect(view.model.positions).toEqual(boxPositions);
  expect(view.model.polygons).toHaveLength(12);
  expect(view.model.polygons.every(polygon => polygon.length === 3)).toBe(true);
  const html = renderToStaticMarkup(<ModelPreviewBody view={view} />);
  expect(html).toContain('Own frame · display only');
  expect(html).toContain('role="img" aria-label="glTF model in its own frame, 12 triangles"');
  expect(html).toMatch(/Axes as the reading states<\/dt><dd>Right handed Y up<\/dd>/);
  expect(html).toMatch(/Unit as the reading states<\/dt><dd>Metre<\/dd>/);
  expect(html).toMatch(/Drawn<\/dt><dd>12 triangles from 24 stored positions<\/dd>/);
  expect(html).toMatch(/Node transforms<\/dt><dd>Not applied<\/dd>/);
  expect(html).toMatch(/Drawn as up<\/dt><dd>The second value \(y\)<\/dd>/);
  expect(html).not.toMatch(/<button|Confirm|Place on/);
});

it('an OBJ result with two faces gives two polygons; axes and units stay Unknown as the reading states', () => {
  // test_only: two quads sharing an edge, in the OBJ reader's artifact shape.
  const vertex = (index: number, values: number[]) => ({ directive: 'v', index, values, status: 'source_values',
    cartesianProjectionEligible: true });
  const face = (index: number, corners: number[]) => ({ directive: 'f', index, projectionEligible: true,
    projectionReasons: [], references: corners.map(at => ({ form: 'v', vertex: { literal: String(at + 1),
      sourceIndex: at + 1, resolvedIndex: at }, texture: null, normal: null })) });
  const artifact = { schemaVersion: 'obj-source-context/1', vertices: [vertex(0, [0, 0, 0]), vertex(1, [4, 0, 0]),
    vertex(2, [4, 0, 3]), vertex(3, [0, 0, 3]), vertex(4, [4, 2.5, 0]), vertex(5, [0, 2.5, 0])],
  faces: [face(0, [0, 1, 2, 3]), face(1, [0, 1, 4, 5])] };
  const view = modelView('obj', artifact, { axes: 'unknown', units: 'unknown' });
  if (view.state !== 'mesh') throw new Error('Wrong test view');
  expect(view.model.polygons).toEqual([[0, 1, 2, 3], [0, 1, 4, 5]]);
  expect(view.model.positions).toEqual(artifact.vertices.map(entry => entry.values));
  const html = renderToStaticMarkup(<ModelPreviewBody view={view} />);
  expect(html).toContain('aria-label="OBJ model in its own frame, 2 polygons"');
  expect(html).toMatch(/Axes as the reading states<\/dt><dd>Unknown<\/dd>/);
  expect(html).toMatch(/Units as the reading states<\/dt><dd>Unknown<\/dd>/);
  expect(html).toMatch(/Drawn<\/dt><dd>2 polygons from 6 stored positions<\/dd>/);
  expect(html).toContain('2, filled as fans for display');
  // A face the reader did not project is counted, not drawn.
  const partial = modelView('obj', { ...artifact, faces: [artifact.faces[0], { ...artifact.faces[1],
    projectionEligible: false }] }, {});
  if (partial.state !== 'mesh') throw new Error('Wrong test view');
  expect(partial.model.polygons).toHaveLength(1);
  expect(partial.lines).toContainEqual({ label: 'Not drawn', value: '1 face the reader did not project' });
  expect(partial.lines).toContainEqual({ label: 'Drawn', value: '1 polygon from 4 stored positions' });
});

it('a pin mismatch, a malformed result and a model past the cap show words, never a drawing', async () => {
  const bytes = encoded(gltfArtifact);
  const status = gltfStatus(bytes, 'c'.repeat(64));
  const plan = modelPreviewPlan('gltf', status);
  if (plan.state !== 'read') throw new Error('Wrong test plan');
  const get = vi.spyOn(api, 'GET').mockResolvedValue(served(bytes));
  const error = await readModelArtifact('gltf', ids, plan.artifact, new AbortController().signal)
    .catch((caught: Error) => caught);
  get.mockRestore();
  const refused = previewView(plan, { data: undefined, error: error as Error, isPending: false });
  expect(refused).toEqual({ state: 'words', words: 'The model could not be read from the accepted result: its '
    + 'bytes differ from the size and SHA-256 the reading states.' });
  expect(renderToStaticMarkup(<ModelPreviewBody view={refused} />)).not.toContain('role="img"');
  const broken = { ...gltfArtifact, primitives: [{ ...gltfArtifact.primitives[0], projection: { POSITION: {
    status: 'available', values: boxPositions }, indices: { status: 'available', values: [0, 1, 99] } } }] };
  expect(previewView(plan, { data: broken, error: null, isPending: false })).toEqual({ state: 'words',
    words: 'The accepted result is not in the shape its reader writes, so no preview is drawn.' });
  expect(previewView(plan, { data: 'not an object', error: null, isPending: false }).state).toBe('words');
  expect(previewView(plan, { data: undefined, error: null, isPending: true })).toEqual({ state: 'words',
    words: 'The model is being read from the accepted result.' });
  expect(modelPreviewPlan('gltf', gltfStatus(bytes, 'c'.repeat(64), 60_000))).toEqual({ state: 'words',
    words: 'This reading states 60,000 positions; the preview draws a model of at most 50,000, so it is not drawn.' });
  // A reader with no mesh, or a reading not completed, plans nothing.
  expect(modelPreviewPlan('dxf', dxfStatus())).toEqual({ state: 'none' });
  expect(modelPreviewPlan('gltf', { ...status, status: 'running', result: null } as NativeStatus))
    .toEqual({ state: 'none' });
});
