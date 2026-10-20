import type { GetResponse, Schemas } from '@ulpin/api-client';
import { fieldWords, type IntakeItem } from '../batch-model';
import type { Package, Target } from '../run/model';

export type EvidencePage = GetResponse<'/api/v1/ingestion/cases/{caseId}/intake/evidence'>;
export type Candidate = EvidencePage['candidates'][number];
export type EvidenceSource = EvidencePage['sources'][number];
export type KeyProfile = EvidencePage['profiles'][number];
export type Coverage = NonNullable<EvidenceSource['coverage']>;
export type Outcome = Candidate['outcome'];
export type KeyKind = KeyProfile['input']['kind'];
export type KeyProfileBody =
  Schemas['POST_ingestion_cases_caseId_intake_evidence_key_profiles_Request_application_json'];
export type KeyProfileInput = Omit<KeyProfileBody, 'requestKey'>;
type Selection = KeyProfileInput['tables'][number]['selection'];

/** A kept CSV of the batch whose card lists its header row; its columns are the card's headers, in order. */
export interface TableChoice { itemId: string; name: string; headers: string[] }
/** What the officer has chosen so far; an empty string is not chosen yet. */
export interface Declaration {
  namespace: string; kind: KeyKind; anchorItemId: string; sourcePath: string;
  columns: Record<string, string>; documents: string[];
}

export const blankDeclaration: Declaration = { namespace: '', kind: 'text', anchorItemId: '', sourcePath: '',
  columns: {}, documents: [] };

export const outcomeWords: Record<Outcome, string> = {
  matched: 'Matched one building', no_match: 'No building holds this key', several: 'Several buildings hold this key',
  conflicting: 'Conflicting: the key is on more than one row of this table',
};

const coverageStates: Record<Coverage['state'], string> = { reading: 'Reading', partial: 'Partial', closed: 'Closed' };
/** A CSV is read with its first record as the header row, the one its card lists. */
const csvSelection: Selection = { format: 'csv', sheet: 'csv', table: null, headerRows: [1] };
const pointer = (name: string) => name.replaceAll('~', '~0').replaceAll('/', '~1');

/** A count read from the server; a null count is unknown and never 0. */
export function knownWords(value: number | null) {
  return value === null ? 'not known yet' : value.toLocaleString('en-IN');
}

export function coverageWords(coverage: Coverage | null) {
  if (!coverage) return 'Not read yet: every count is not known yet.';
  return `${coverageStates[coverage.state]}: ${knownWords(coverage.read)} read, ${knownWords(coverage.eligible)} `
    + `with a key, ${knownWords(coverage.keyless)} without a key, ${knownWords(coverage.unread)} unread, `
    + `${knownWords(coverage.failed)} could not be read.`;
}

/** Map items of the batch with drafted buildings: a package of the targets read names the item and counts some. */
export function anchorItems(items: readonly IntakeItem[], packages: readonly Package[]) {
  const drafted = new Set(packages.filter(pkg => Object.values(pkg.counts).some(count => count > 0))
    .map(pkg => pkg.anchorItemId));
  return items.filter(item => item.family === 'vector' && drafted.has(item.itemId));
}

/**
 * The map fields a key can be read from, as the item's card lists them. A drafted building keeps its source
 * properties but not the source feature id, so the server refuses the feature id path and it is not offered.
 */
export function keyPaths(item: IntakeItem | undefined): string[] {
  return (item?.card?.columns ?? []).filter(column => column.inferredType !== 'geometry')
    .map(column => `/features/*/properties/${pointer(column.name)}`);
}

/** The card states a CSV's header row (its first record); a workbook card states sheets but no header row. */
export function tableChoices(items: readonly IntakeItem[]): TableChoice[] {
  return items.filter(item => item.family === 'table' && item.format === 'csv' && item.sourceId
    && item.card?.columns.length)
    .map(item => ({ itemId: item.itemId, name: item.name, headers: item.card!.columns.map(column => column.name) }));
}

export function documentChoices(items: readonly IntakeItem[]) {
  return items.filter(item => item.family === 'document' && item.sourceId);
}

/** The profile as the server takes it, or the words saying what is still missing. */
export function profileInput(declaration: Declaration): KeyProfileInput | string {
  const tables = Object.entries(declaration.columns).filter(([, column]) => column !== '')
    .map(([itemId, column]) => ({ itemId, selection: csvSelection, columnIndex: Number(column) }));
  if (!declaration.namespace.trim()) return 'Name the key in your own words.';
  if (!declaration.anchorItemId || !declaration.sourcePath) return 'Choose the map item and its key field.';
  if (!tables.length && !declaration.documents.length) return 'Choose at least one table column or document.';
  return { version: 'exact-key/1', namespace: declaration.namespace, kind: declaration.kind,
    map: { anchorItemId: declaration.anchorItemId, sourcePath: declaration.sourcePath }, tables,
    documents: declaration.documents };
}

export function profileWords(profile: KeyProfile, items: readonly IntakeItem[]) {
  const anchor = items.find(item => item.itemId === profile.input.map.anchorItemId);
  const kind = profile.input.kind === 'integer' ? 'whole number written as digits' : 'text exactly as written';
  return `${profile.input.namespace} · ${kind} · field ${fieldWords(profile.input.map.sourcePath)} of `
    + `${anchor?.name ?? 'a map item no longer listed'}`;
}

export function evidenceWords(candidate: Candidate, items: readonly IntakeItem[]) {
  const evidence = candidate.evidence;
  const name = items.find(item => item.itemId === evidence.itemId)?.name ?? 'a file no longer listed';
  if (evidence.kind === 'document_part') {
    return `${name}, ${evidence.page === null ? 'page not stated' : `page ${evidence.page}`}: “${evidence.quote}”`;
  }
  const sheet = evidence.window?.sheet ? `, sheet ${evidence.window.sheet}` : '';
  return `${name}, column “${evidence.columnHeader}”, row ${evidence.sourceRow}${sheet}`;
}

/** Each building a candidate names, by its locator in the targets read, else the locator the candidate holds. */
export function buildingWords(candidate: Candidate, targets: readonly Target[]) {
  if (!candidate.anchors.length) return 'None';
  return candidate.anchors.map(anchor =>
    targets.find(target => target.targetId === anchor.targetId)?.locator ?? anchor.locator).join('; ');
}
