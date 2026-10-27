import type { GetResponse } from '@ulpin/api-client';

export type IfcStatus = GetResponse<'/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/ifc/jobs/{jobId}'>;
type CaseJob = GetResponse<'/api/v1/cases/{caseId}'>['jobs'][number];
type Structure = NonNullable<NonNullable<IfcStatus['result']>['summary']['structure']>;
type ReadStructure = Extract<Structure, { state: 'read' }>;
type Node = ReadStructure['nodes'][number];
type LengthUnit = ReadStructure['lengthUnit'];
export type IfcArtifact = NonNullable<IfcStatus['result']>['artifact'];

/** One candidate line, with its STEP id as the locator in the original file. */
export interface CandidateLine {
  stepId: number;
  globalId: string | null;
  title: string;
  kind: string;
}
export interface StoreyLine extends CandidateLine {
  elevation: string;
  spaces: CandidateLine[];
}
export interface BuildingLine extends CandidateLine {
  storeys: StoreyLine[];
  spaces: CandidateLine[];
}
/** The tree as stated in the file; candidates that no building or storey names as parent are kept, never dropped. */
export interface StructureTree {
  buildings: BuildingLine[];
  storeys: StoreyLine[];
  spaces: CandidateLine[];
  counts: string;
}

export type StructureView =
  | { state: 'words'; words: string }
  | { state: 'not_read'; reason: string; code: string }
  | { state: 'read'; tree: StructureTree };

const candidateWords = { building: 'Candidate building', level: 'Candidate level', space: 'Candidate space' };

/** An item of a batch whose original the server probed as an IFC. */
export function isIfcItem<Item extends { format: string | null; sourceId: string | null }>(item: Item):
  item is Item & { sourceId: string } {
  return item.format === 'ifc' && Boolean(item.sourceId);
}

/** The newest native IFC reading of this source among the case's jobs; null when none was run. */
export function latestIfcJob(jobs: readonly CaseJob[], sourceId: string): CaseJob | null {
  return jobs.filter(job => job.sourceId === sourceId && job.operation === 'ifc-native')
    .reduce<CaseJob | null>((latest, job) =>
      !latest || Date.parse(job.createdAt) > Date.parse(latest.createdAt) ? job : latest, null);
}

export function structureView(status: IfcStatus | null): StructureView {
  if (!status) return { state: 'words',
    words: 'No IFC reading has been run for this file, so its structure has not been read.' };
  const pending = { queued: 'The IFC structure is waiting to be read.', running: 'The IFC structure is being read.',
    stale: 'This reading is out of date: the file, the case or the reader changed after it ran.' };
  if (status.status === 'failed') return { state: 'words',
    words: `The IFC reading stopped${status.code ? ` (${status.code})` : ''}. Its structure has not been read.` };
  if (status.status !== 'completed') return { state: 'words', words: pending[status.status] };
  if (!status.result) return { state: 'words', words: 'The reading finished without an accepted result.' };
  const structure = status.result.summary.structure;
  if (!structure) return { state: 'words', words: 'This file was read before the structure scan existed. '
    + 'Its structure has not been read.' };
  if (structure.state === 'not_read') return { state: 'not_read', reason: structure.reason, code: structure.code };
  return { state: 'read', tree: structureTree(structure) };
}

export function structureTree(structure: ReadStructure): StructureTree {
  const children = childIndex(structure.nodes);
  const shown = new Set<number>();
  const spaces = (parent: number) => spacesUnder(children, parent).map(node => line(node, shown));
  const storeys = (nodes: readonly Node[]) => nodes.map(node => ({ ...line(node, shown),
    elevation: elevationWords(node, structure.lengthUnit), spaces: spaces(node.stepId) }));
  const buildings = structure.nodes.filter(node => node.entityType === 'IfcBuilding').map(node => ({
    ...line(node, shown), storeys: storeys(of(children, node.stepId, 'IfcBuildingStorey')),
    spaces: of(children, node.stepId, 'IfcSpace').filter(space => !shown.has(space.stepId))
      .map(space => line(space, shown)) }));
  const loose = (type: Node['entityType']) => structure.nodes.filter(node =>
    node.entityType === type && !shown.has(node.stepId));
  const otherStoreys = storeys(loose('IfcBuildingStorey'));
  const otherSpaces = loose('IfcSpace').map(node => line(node, shown));
  const count = (type: Node['entityType']) => structure.nodes.filter(node => node.entityType === type).length;
  return { buildings, storeys: otherStoreys, spaces: otherSpaces, counts: [
    plural(count('IfcBuilding'), 'building'), plural(count('IfcBuildingStorey'), 'storey'),
    plural(count('IfcSpace'), 'space')].join(' · ') };
}

/** "Elevation 3.2 (unit: metre, as stated)": the number and unit are copied from the file, never converted. */
export function elevationWords(node: Pick<Node, 'elevation'>, unit: LengthUnit) {
  if (node.elevation?.state !== 'supplied') return 'Elevation not stated';
  return `Elevation ${node.elevation.value} (${unitWords(unit)})`;
}

export function unitWords(unit: LengthUnit) {
  if (unit.state === 'absent') return 'unit not stated';
  if (unit.state === 'conflicting') return 'unit: the file states more than one length unit';
  if (!unit.name) return 'unit: stated without a name';
  return `unit: ${`${unit.prefix ?? ''}${unit.name}`.toLowerCase()}, as stated`;
}

export function plural(count: number, noun: string) {
  return `${count.toLocaleString('en-IN')} ${noun}${count === 1 ? '' : 's'}`;
}

function line(node: Node, shown: Set<number>): CandidateLine {
  shown.add(node.stepId);
  const kind = `${node.candidate ? candidateWords[node.candidate] : node.entityType} from the file`;
  return { stepId: node.stepId, globalId: node.globalId, title: titleWords(node), kind };
}

function titleWords(node: Pick<Node, 'name' | 'longName'>) {
  const names = [...new Set([node.name, node.longName].filter((name): name is string => Boolean(name?.trim())))];
  return names.length ? names.join(' · ') : 'Name not stated';
}

function childIndex(nodes: readonly Node[]) {
  const children = new Map<number, Node[]>();
  for (const node of nodes) for (const parent of node.parentStepIds) {
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent)!.push(node);
  }
  return children;
}

function of(children: Map<number, Node[]>, parent: number, type: Node['entityType']) {
  return (children.get(parent) ?? []).filter(node => node.entityType === type);
}

/** Spaces under a storey, with spaces the file nests inside them; each listed once. */
function spacesUnder(children: Map<number, Node[]>, parent: number) {
  const found = new Map<number, Node>();
  for (const queue = [parent]; queue.length;) {
    for (const space of of(children, queue.shift()!, 'IfcSpace')) {
      if (found.has(space.stepId)) continue;
      found.set(space.stepId, space);
      queue.push(space.stepId);
    }
  }
  return [...found.values()];
}

/** A plan point as the outline pass writes it: the file's own frame and length unit, rounded, never converted. */
export type OutlinePoint = [number, number];
export interface OutlinePolygon {
  exterior: OutlinePoint[];
  interiors: OutlinePoint[][];
}
export interface StoreyOutline {
  stepId: number;
  elementSource: 'IfcSlab' | 'IfcSpace';
  elementStepIds: number[];
  polygons: OutlinePolygon[];
}
/** Storey outlines read from the accepted artifact; `none` leaves the tree as it was before outlines existed. */
export type OutlinesView =
  | { state: 'none' }
  | { state: 'words'; words: string }
  | { state: 'not_read'; reason: string; code: string }
  | { state: 'read'; unit: string; decimalPlaces: number; storeys: Map<number, StoreyOutline>;
    without: Map<number, string> };

export const OUTLINES_MALFORMED = 'The storey outlines in this reading are not in the shape the reader writes, '
  + 'so they are not drawn.';
const withoutWords: Record<string, string> = {
  no_slab_or_space: 'No outline: the file states no slab or space in this storey.' };

/** The accepted artifact to fetch for outlines: only a completed reading whose summary counts at least one. */
export function outlineArtifact(status: IfcStatus | null): IfcArtifact | null {
  const result = status?.status === 'completed' ? status.result : null;
  return result && (result.summary.storeyOutlineCount ?? 0) > 0 ? result.artifact : null;
}

/** The artifact's storeyOutlines, checked field by field; anything off the reader's shape becomes words. */
export function outlinesView(native: unknown): OutlinesView {
  if (isRecord(native) && native.storeyOutlines === undefined) return { state: 'none' };
  try {
    need(isRecord(native));
    return readOutlines(native.storeyOutlines);
  } catch {
    return { state: 'words', words: OUTLINES_MALFORMED };
  }
}

export interface OutlineDrawing {
  viewBox: string;
  path: string;
}

/** One storey's rings fitted to their own bounds, y flipped (plan y runs up, SVG y down). Shape only, no scale. */
export function outlineDrawing(outline: StoreyOutline, decimalPlaces: number): OutlineDrawing {
  const rings = outline.polygons.flatMap(polygon => [polygon.exterior, ...polygon.interiors]);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const ring of rings) for (const [x, y] of ring) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const digits = Math.min(Math.max(decimalPlaces, 0), 10);
  const at = (value: number) => String(Number(value.toFixed(digits)));
  const path = rings.map(ring => `M${ring.slice(0, -1).map(([x, y]) => `${at(x - minX)} ${at(maxY - y)}`)
    .join('L')}Z`).join('');
  const width = maxX - minX, height = maxY - minY, margin = Math.max(width, height) / 25 || 1;
  return { viewBox: [-margin, -margin, width + 2 * margin, height + 2 * margin].map(at).join(' '), path };
}

/** The elements an outline was drawn from, as STEP locators in the file; a long list is given as a count. */
export function outlineSources(outline: StoreyOutline) {
  const ids = outline.elementStepIds;
  return { source: outline.elementSource, count: ids.length.toLocaleString('en-IN'),
    steps: ids.length <= 6 ? `STEP ${ids.map(id => `#${id}`).join(', ')}` : null };
}

function readOutlines(value: unknown): OutlinesView {
  need(isRecord(value));
  if (value.state === 'not_read') {
    need(typeof value.reason === 'string' && typeof value.code === 'string');
    return { state: 'not_read', reason: value.reason, code: value.code };
  }
  need(value.state === 'read' && value.frame === 'source_local' && value.globalTransformApplied === false
    && isLengthUnit(value.lengthUnit) && isRecord(value.rounding) && Number.isInteger(value.rounding.decimalPlaces)
    && Array.isArray(value.storeys) && Array.isArray(value.withoutOutline));
  const storeys = new Map<number, StoreyOutline>();
  for (const storey of value.storeys as unknown[]) {
    need(isRecord(storey) && isStepId(storey.stepId) && !storeys.has(storey.stepId)
      && (storey.elementSource === 'IfcSlab' || storey.elementSource === 'IfcSpace')
      && Array.isArray(storey.elementStepIds) && storey.elementStepIds.length > 0
      && storey.elementStepIds.every(isStepId) && Array.isArray(storey.polygons) && storey.polygons.length > 0
      && storey.polygons.every(isPolygon));
    storeys.set(storey.stepId, storey as unknown as StoreyOutline);
  }
  const without = new Map<number, string>();
  for (const storey of value.withoutOutline as unknown[]) {
    need(isRecord(storey) && isStepId(storey.stepId) && !storeys.has(storey.stepId) && !without.has(storey.stepId)
      && typeof storey.reason === 'string' && Object.hasOwn(withoutWords, storey.reason));
    without.set(storey.stepId, withoutWords[storey.reason]!);
  }
  return { state: 'read', unit: unitWords(value.lengthUnit), decimalPlaces: value.rounding.decimalPlaces as number,
    storeys, without };
}

function need(condition: unknown): asserts condition {
  if (!condition) throw new Error(OUTLINES_MALFORMED);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStepId(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

function isLengthUnit(unit: unknown): unit is LengthUnit {
  const text = (value: unknown) => value === null || typeof value === 'string';
  if (!isRecord(unit)) return false;
  if (unit.state === 'absent') return true;
  if (unit.state === 'conflicting') return Array.isArray(unit.stepIds);
  return unit.state === 'supplied' && text(unit.name) && text(unit.prefix);
}

/** A closed ring of at least four finite points, as the reader checks before writing it. */
function isRing(ring: unknown): ring is OutlinePoint[] {
  if (!Array.isArray(ring) || ring.length < 4 || !ring.every(point => Array.isArray(point) && point.length === 2
    && point.every(Number.isFinite))) return false;
  const [first, last] = [ring[0] as OutlinePoint, ring.at(-1) as OutlinePoint];
  return first[0] === last[0] && first[1] === last[1];
}

function isPolygon(polygon: unknown): polygon is OutlinePolygon {
  return isRecord(polygon) && isRing(polygon.exterior) && Array.isArray(polygon.interiors)
    && polygon.interiors.every(isRing);
}
