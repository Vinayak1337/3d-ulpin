import type { GetResponse } from '@ulpin/api-client';

export type IfcStatus = GetResponse<'/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/ifc/jobs/{jobId}'>;
type CaseJob = GetResponse<'/api/v1/cases/{caseId}'>['jobs'][number];
type Structure = NonNullable<NonNullable<IfcStatus['result']>['summary']['structure']>;
type ReadStructure = Extract<Structure, { state: 'read' }>;
type Node = ReadStructure['nodes'][number];
type LengthUnit = ReadStructure['lengthUnit'];

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
