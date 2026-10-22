import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { expect, it, vi } from 'vitest';
import captured from '../../../../../../docs/evidence/gf1/lq1a/controls-second.json';
import { createContractValidator } from '../../../local/contract';
import type { IntakeItem } from '../batch-model';
import { IntakeTray } from '../IntakeTray';
import { OmissionsBody, ReadingBody } from './NativeReading';
import { hasConvertedLayers, nativeReaderOf, opensReading, readingView, type NativeOmissions,
  type NativeStatus } from './reading-model';

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

const tray = (items: IntakeItem[]) => renderToStaticMarkup(<MemoryRouter>
  <IntakeTray caseId={ids.caseId} items={items} packages={[]} choose={vi.fn()} refresh={vi.fn()} />
</MemoryRouter>);

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

it('opens the reading with the reader\'s summary fields as stored, and words for a stop or a wait', () => {
  const body = dxfStatus();
  expect(validate(schemaOf('/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/dxf/jobs/{jobId}'), body))
    .toEqual([]);
  const html = renderToStaticMarkup(<ReadingBody view={readingView('dxf', body)} />);
  expect(html).toContain('<dt class="');
  expect(html).toMatch(/Projected entity count<\/dt><dd class="ul-mono">640<\/dd>/);
  expect(html).toMatch(/Units<\/dt><dd class="ul-mono">\{&quot;state&quot;:&quot;absent&quot;/);
  expect(html).toMatch(/Global placement<\/dt><dd class="ul-mono">not_assessed<\/dd>/);
  expect(html).not.toMatch(/<button|Confirm|Place on/);
  const stopped = renderToStaticMarkup(<ReadingBody view={readingView('dxf', dxfStatus('failed'))} />);
  expect(stopped).toContain('The DXF reading stopped (DXF_READ_LIMIT); there is no reading to open.');
  expect(renderToStaticMarkup(<ReadingBody view={readingView('dxf', dxfStatus('queued'))} />))
    .toContain('waiting to start');
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
