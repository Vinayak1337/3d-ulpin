import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { expect, it, vi } from 'vitest';
import captured from '../../../../../../docs/evidence/gf1/lq1a/controls-second.json';
import real from '../../../../../../docs/evidence/gf1/ifc2/real-structures.json';
import outlined from '../../../../../../docs/evidence/step-5/s5-20/result.json';
import { createContractValidator } from '../../../local/contract';
import type { IntakeItem } from '../batch-model';
import { IntakeTray } from '../IntakeTray';
import { StructureBody } from './IfcStructure';
import { isIfcItem, latestIfcJob, OUTLINES_MALFORMED, outlineArtifact, outlineDrawing, outlinesView, structureView,
  type IfcStatus, type OutlinesView } from './structure-model';

const root = resolve(import.meta.dirname, '../../../../../..');
const openapi = JSON.parse(readFileSync(resolve(root, 'docs/api/openapi.json'), 'utf8'));
const validate = createContractValidator(openapi);
const route = openapi.paths['/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/ifc/jobs/{jobId}'].get;
const statusSchema = route.responses['200'].content['application/json'].schema.$ref.split('/').at(-1);
const house = real.files['ifc2x3-building-architecture.ifc'];
const ids = { caseId: '10000000-0000-4000-8000-000000000001', sourceId: '10000000-0000-4000-8000-000000000002',
  jobId: '10000000-0000-4000-8000-000000000003' };

/** A status body around a structure; counts and pins are the retained IFC2X3 run's (real-structures.json). */
function status(structure: unknown, state = 'completed'): IfcStatus {
  const facts = house.retainedNativeFacts;
  const nodes = (structure as { nodes?: { entityType: string }[] }).nodes ?? [];
  const count = (type: string) => nodes.filter(node => node.entityType === type).length;
  const summary = { schemaVersion: 'ulpin-native-ifc/1', sourceSha256: house.sha256, sourceBytes: house.bytes,
    schema: facts.schema, entityCount: facts.sourceEntities, recordCount: facts.projectedRecords,
    buildingCount: count('IfcBuilding'), storeyCount: count('IfcBuildingStorey'), spaceCount: count('IfcSpace'),
    georeferenceState: facts.georeferenceState, inspectionFrame: 'source_local', metadataOnly: true,
    geometry: 'unsupported', globalPlacement: 'not_qualified', unitConversionApplied: false,
    storeysAreLegalUnits: false, rights: 'not_assessed', structure };
  const artifact = { key: `ifc-native/${ids.jobId}/${'b'.repeat(64)}.native.json`, sha256: 'b'.repeat(64),
    bytes: 1795, mediaType: 'application/json', profile: 'ulpin-native-ifc/1' };
  return { version: 'ifc-native/1', ...ids, currentCaseRevision: 4, sourceRevision: 1, sourceSha256: house.sha256,
    status: state, code: null, result: state === 'completed' ? { summary, artifact,
      createdAt: '2026-10-21T00:00:00.000Z' } : null } as IfcStatus;
}

const html = (value: IfcStatus | null, outlines?: OutlinesView) => renderToStaticMarkup(
  <StructureBody view={structureView(value)} outlines={outlines} />).replaceAll('&#x27;', "'");
/** The real AC20-FZK-Haus reading (S5.20 result.json): its structure and storey outlines, copied unchanged. */
const fzk = outlined.realHouse;
const withOutlines = (count?: number) => {
  const body = status(fzk.structure);
  if (count !== undefined) body.result!.summary.storeyOutlineCount = count;
  return body;
};
const paths = (markup: string) => [...markup.matchAll(/<path d="([^"]*)" fill-rule="evenodd"/g)].map(match => match[1]);

it('reads the real IFC2X3 tree in an officer\'s words: building, storey with stated elevation and unit, spaces', () => {
  const body = status(house.structure);
  expect(validate(statusSchema, body)).toEqual([]);
  const view = structureView(body);
  if (view.state !== 'read') throw new Error(view.state);
  const [building] = view.tree.buildings;
  expect(view.tree.counts).toBe('1 building · 1 storey · 2 spaces');
  expect(building?.title).toBe('Single-family house · house - building');
  expect(building?.storeys[0]).toMatchObject({ title: '00 groundfloor',
    elevation: 'Elevation 0 (unit: millimetre, as stated)', kind: 'Candidate level from the file', stepId: 36,
    globalId: '1Ano2ZUxnEIvVQ_beukl8b' });
  expect(building?.storeys[0]?.spaces.map(space => [space.title, space.stepId]))
    .toEqual([['living room', 183], ['entry hall', 296]]);
  expect(view.tree.storeys).toEqual([]);
  expect(view.tree.spaces).toEqual([]);
  const markup = html(body);
  expect(markup).toMatch(/<details class="[^"]*group[^"]*" open=""><summary>1 storey<\/summary>/);
  expect(markup).toMatch(/<details class="[^"]*group[^"]*"><summary>2 spaces in this storey<\/summary>/);
  expect(markup).toContain('Candidate space from the file · <span class="ul-mono">STEP #296</span> · '
    + 'GlobalId <span class="ul-mono">18QhMtUIXBvQktPHXXxs7H</span>');
  expect(markup).not.toMatch(/<button|Confirm|Record /);
});

it('the real IFC4 sample: nested sites stay out of the tree and a name stated twice is shown once', () => {
  const view = structureView(status(real.files['ifc4-building-architecture.ifc'].structure));
  if (view.state !== 'read') throw new Error(view.state);
  const spaces = view.tree.buildings[0]?.storeys[0]?.spaces ?? [];
  expect(spaces.map(space => space.title)).toEqual(['living room', 'entry hall']);
  expect(html(status(real.files['ifc4-building-architecture.ifc'].structure))).not.toContain('house - site');
});

it('a structure the real reader did not read shows its reason sentence and code', () => {
  const body = status(house.structureUnderThreeEntityCeiling);
  expect(validate(statusSchema, body)).toEqual([]);
  expect(html(body)).toContain('The structure was not read: The IFC holds more structure entities than the scan '
    + 'keeps. <span class="ul-caption ul-mono">STRUCTURE_ENTITY_LIMIT</span>');
});

it('a long tree (test_only, generated here) starts with storeys collapsed and keeps loose candidates', () => {
  type Node = Record<string, unknown>;
  const node = (stepId: number, entityType: string, candidate: string | null, parentStepIds: number[],
    extra: Node = {}): Node => ({ stepId, entityType, candidate, globalId: null, name: `Test ${stepId}`,
    longName: null, parentStepIds, relationStepIds: [], ...extra });
  const nodes = [node(1, 'IfcBuilding', 'building', [])];
  for (let storey = 0; storey < 12; storey++) {
    const stepId = 100 + storey * 20;
    nodes.push(node(stepId, 'IfcBuildingStorey', 'level', [1], { elevation: storey === 3 ? { state: 'absent' }
      : { state: 'supplied', value: storey * 3.2, literal: `${storey * 3.2}` } }));
    for (let space = 1; space <= 15; space++) nodes.push(node(stepId + space, 'IfcSpace', 'space', [stepId]));
  }
  nodes.push(node(500, 'IfcBuildingStorey', 'level', [], { name: null, elevation: { state: 'absent' } }));
  nodes.push(node(501, 'IfcSpace', 'space', [101]), node(502, 'IfcSpace', 'space', []));
  const structure = { state: 'read', lengthUnit: { state: 'absent' }, nodes };
  // IFC_LIMITS.structureOutputBytes is 48 KiB; the generated tree stays inside it.
  expect(new TextEncoder().encode(JSON.stringify(structure)).length).toBeLessThanOrEqual(48 * 1024);
  const body = status(structure);
  expect(validate(statusSchema, body)).toEqual([]);
  const view = structureView(body);
  if (view.state !== 'read') throw new Error(view.state);
  expect(view.tree.counts).toBe('1 building · 13 storeys · 182 spaces');
  const storeys = view.tree.buildings[0]!.storeys;
  expect(storeys[1]?.elevation).toBe('Elevation 3.2 (unit not stated)');
  expect(storeys[3]?.elevation).toBe('Elevation not stated');
  expect(storeys[0]?.spaces.map(space => space.stepId)).toEqual([...Array(15)].map((_, at) => 101 + at).concat(501));
  expect(view.tree.storeys.map(storey => storey.title)).toEqual(['Name not stated']);
  expect(view.tree.spaces.map(space => space.stepId)).toEqual([502]);
  const markup = html(body);
  expect(markup).toMatch(/<details class="[^"]*group[^"]*"><summary>12 storeys<\/summary>/);
  expect(markup).toContain('<summary>1 space not under a building or storey</summary>');
});

it('says in words when there is no reading, a reading in progress, a stop or an older result', () => {
  expect(html(null)).toContain('No IFC reading has been run for this file');
  expect(html(status(house.structure, 'queued'))).toContain('waiting to be read');
  expect(html({ ...status(house.structure, 'failed'), code: 'IFC_READ_LIMIT' }))
    .toContain('The IFC reading stopped (IFC_READ_LIMIT).');
  expect(html(status(house.structure, 'stale'))).toContain('out of date');
  const older = status(house.structure);
  delete older.result!.summary.structure;
  expect(validate(statusSchema, older)).toEqual([]);
  expect(html(older)).toContain('read before the structure scan existed');
});

it("the real AC20-FZK-Haus outlines draw two closed paths beside their storeys, in the file's own frame", () => {
  const body = withOutlines(2);
  expect(validate(statusSchema, body)).toEqual([]);
  expect(outlineArtifact(body)).toBe(body.result!.artifact);
  const outlines = outlinesView({ storeyOutlines: fzk.storeyOutlines });
  if (outlines.state !== 'read') throw new Error(outlines.state);
  expect([...outlines.storeys.keys()]).toEqual([479, 35065]);
  const markup = html(body, outlines);
  expect(paths(markup)).toEqual(['M12 10L0 10L0 0L12 0Z', 'M0 0L13 0L13 5.5L13 11L0 11L0 5.5Z']);
  expect(markup).toContain('viewBox="-0.48 -0.48 12.96 10.96"');
  expect(markup).toContain('Storey outlines: own frame (unit: metre, as stated), each to its own size, '
    + 'not on the map.');
  expect(markup).toContain('aria-label="Outline of storey Erdgeschoss · ACID00000001-0000-0000-0000-000000000000 '
    + `in the file's own frame, not placed on the map"`);
  expect(markup).toContain('From IfcSlab <span class="ul-mono">STEP #59290, #59553, #59753</span>');
  expect(markup.match(/role="img"/g)).toHaveLength(2);
  expect(markup).not.toMatch(/m²|sq|area/i);
});

it('a reading or artifact without outlines shows the tree as today', () => {
  const today = html(status(fzk.structure));
  expect(outlineArtifact(status(fzk.structure))).toBeNull();
  expect(outlineArtifact(withOutlines(0))).toBeNull();
  expect(outlineArtifact({ ...withOutlines(2), status: 'stale' })).toBeNull();
  const { storeyOutlines: _, ...older } = { storeyOutlines: null, schemaVersion: 'ulpin-native-ifc/1' };
  expect(outlinesView(older)).toEqual({ state: 'none' });
  expect(html(withOutlines(2), outlinesView(older))).toBe(today);
  expect(today).not.toContain('<svg');
});

it('a not_read outline pass shows its reason; a storey without slab or space says so in words', () => {
  const notRead = outlinesView({ storeyOutlines: { state: 'not_read', code: 'OUTLINE_LENGTH_UNIT',
    reason: 'The file does not state one supported length unit.' } });
  const markup = html(withOutlines(2), notRead);
  expect(markup).toContain('The storey outlines were not read: The file does not state one supported length unit. '
    + '<span class="ul-caption ul-mono">OUTLINE_LENGTH_UNIT</span>');
  expect(markup).not.toContain('<svg');
  // Test-only variant of the real reading: the upper storey listed as the reader lists one with no slab or space.
  const [ground] = fzk.storeyOutlines.storeys;
  const partial = outlinesView({ storeyOutlines: { ...fzk.storeyOutlines, storeys: [ground],
    withoutOutline: [{ stepId: 35065, reason: 'no_slab_or_space' }] } });
  const drawn = html(withOutlines(1), partial);
  expect(paths(drawn)).toHaveLength(1);
  expect(drawn).toContain('No outline: the file states no slab or space in this storey.');
});

it('a malformed outline pass shows words and keeps the tree; nothing throws', () => {
  const good = fzk.storeyOutlines;
  const [ground] = good.storeys;
  const openRing = { ...ground, polygons: [{ exterior: ground!.polygons[0]!.exterior.slice(0, -1), interiors: [] }] };
  for (const storeyOutlines of [
    'read', null, { ...good, globalTransformApplied: true }, { ...good, frame: 'map' },
    { ...good, storeys: [openRing] }, { ...good, storeys: [ground, ground] },
    { ...good, storeys: [{ ...ground, polygons: [{ exterior: [[0, 0], [1, 0], [0, Infinity], [0, 0]],
      interiors: [] }] }] },
    { ...good, withoutOutline: [{ stepId: 479, reason: 'no_slab_or_space' }] },
    { ...good, withoutOutline: [{ stepId: 9, reason: 'guessed' }] }, { ...good, rounding: {} },
    { state: 'not_read', code: 'OUTLINE_GEOMETRY' },
  ]) expect(outlinesView({ storeyOutlines })).toEqual({ state: 'words', words: OUTLINES_MALFORMED });
  expect(outlinesView([])).toEqual({ state: 'words', words: OUTLINES_MALFORMED });
  const markup = html(withOutlines(2), outlinesView({ storeyOutlines: { ...good, storeys: [openRing] } }));
  expect(markup).toContain(OUTLINES_MALFORMED);
  expect(markup).toContain('Erdgeschoss');
  expect(markup).not.toContain('<svg');
});

it("a hole is its own subpath for evenodd, and y is flipped inside the outline's own bounds", () => {
  // test_only, generated here: a square with a square hole; not a reading of any file.
  const square = (low: number, high: number) => [[low, low], [high, low], [high, high], [low, high], [low, low]] as
    [number, number][];
  const drawing = outlineDrawing({ stepId: 1, elementSource: 'IfcSpace', elementStepIds: [2],
    polygons: [{ exterior: square(100, 110), interiors: [square(102, 104)] }] }, 3);
  expect(drawing.path).toBe('M0 10L10 10L10 0L0 0ZM2 8L4 8L4 6L2 6Z');
  expect(drawing.viewBox).toBe('-0.4 -0.4 10.8 10.8');
});

it('finds the newest native IFC reading of this source only', () => {
  const job = (id: string, sourceId: string | null, operation: string, createdAt: string) => ({ id, caseId: ids.caseId,
    sourceId, operation, status: 'succeeded' as const, createdAt, completedAt: null, error: null,
    inputFingerprint: 'f' });
  const jobs = [job('a', ids.sourceId, 'ifc-native', '2026-10-20T10:00:00Z'),
    job('b', ids.sourceId, 'ifc-native', '2026-10-21T10:00:00Z'), job('c', ids.sourceId, 'inspect',
      '2026-10-22T10:00:00Z'), job('d', 'other', 'ifc-native', '2026-10-23T10:00:00Z')];
  expect(latestIfcJob(jobs, ids.sourceId)?.id).toBe('b');
  expect(latestIfcJob(jobs.slice(2, 3), ids.sourceId)).toBeNull();
});

it('only an IFC item of the batch tray offers View structure', () => {
  const geojson = captured.manifest.items[0] as unknown as IntakeItem;
  const ifc = { ...geojson, itemId: '10000000-0000-4000-8000-000000000009', name: 'model.ifc', format: 'ifc',
    family: 'model3d' } as IntakeItem;
  expect(isIfcItem(ifc)).toBe(true);
  expect(isIfcItem({ ...ifc, sourceId: null })).toBe(false);
  const tray = renderToStaticMarkup(<MemoryRouter>
    <IntakeTray caseId={ifc.caseId} items={[geojson, ifc]} packages={[]} choose={vi.fn()} refresh={vi.fn()} />
  </MemoryRouter>);
  expect(tray.match(/>View structure</g)).toHaveLength(1);
});
