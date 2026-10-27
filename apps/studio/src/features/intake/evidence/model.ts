import type { GetResponse, Schemas } from '@ulpin/api-client';
import { fieldWords, type IntakeItem } from '../batch-model';
import type { Package, Target } from '../run/model';
import type { Reading } from '../reading-model';

export type EvidencePage = GetResponse<'/api/v1/ingestion/cases/{caseId}/intake/evidence'>;
export type Candidate = EvidencePage['candidates'][number];
type EvidenceSource = EvidencePage['sources'][number];
export type KeyProfile = EvidencePage['profiles'][number];
export type Coverage = NonNullable<EvidenceSource['coverage']>;
export type Outcome = Candidate['outcome'];
type KeyKind = KeyProfile['input']['kind'];
export type KeyProfileBody =
  Schemas['POST_ingestion_cases_caseId_intake_evidence_key_profiles_Request_application_json'];
export type KeyProfileInput = Omit<KeyProfileBody, 'requestKey'>;
export type Selection = KeyProfileInput['tables'][number]['selection'];

/**
 * A kept table of the batch whose header row is known, its columns in order: the headers its read table states, or
 * for a CSV not read yet, the headers its card lists. The selection is the one those headers were read with.
 */
export interface TableChoice { itemId: string; name: string; headers: string[]; selection: Selection }
/** TJ1: a kept CSV or workbook the batch read as a table (N01B), as its table profile states it. */
export interface ReadTable { headers: string[]; selection: Selection }
/** What the officer has chosen so far; an empty string is not chosen yet. */
export interface Declaration {
  namespace: string; kind: KeyKind; anchorItemId: string; sourcePath: string;
  columns: Record<string, string>; documents: string[];
}

export type SourceProfile = GetResponse<'/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/profile'>;
export type ReadingLink = Reading['links'][number] & { fromItemId: string };
export type LinkDeclaration = Declaration & { tables: TableChoice[] };

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
function knownWords(value: number | null) {
  return value === null ? 'not known yet' : value.toLocaleString('en-IN');
}

export function coverageWords(coverage: Coverage | null) {
  if (!coverage) return 'Not read yet: every count is not known yet.';
  return `${coverageStates[coverage.state]}: ${knownWords(coverage.read)} read, ${knownWords(coverage.eligible)} `
    + `with a key, ${knownWords(coverage.keyless)} without a key, ${knownWords(coverage.unread)} unread, `
    + `${knownWords(coverage.failed)} could not be read.`
    + (coverage.failure ? ` Reading ${coverage.failure.state} (${coverage.failure.code}): `
      + coverage.failure.message : '');
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

/**
 * TJ1: a table the batch read (by its source) offers the headers and selection of that read. Otherwise the card
 * states a CSV's header row (its first record); a workbook card states sheets but no header row, so an unread
 * workbook is not offered.
 */
export function tableChoices(items: readonly IntakeItem[],
  read: ReadonlyMap<string, ReadTable> = new Map()): TableChoice[] {
  return items.flatMap((item): TableChoice[] => {
    if (item.family !== 'table' || !item.sourceId || !['csv', 'xlsx', 'ods'].includes(item.format ?? '')) return [];
    const table = read.get(item.sourceId), named = { itemId: item.itemId, name: item.name };
    if (table?.headers.length && table.selection.format === item.format) return [{ ...named, ...table }];
    if (item.format !== 'csv' || !item.card?.columns.length) return [];
    return [{ ...named, headers: item.card.columns.map(column => column.name), selection: csvSelection }];
  });
}

/** Read the compared fields, independent of the link's words; ambiguous or unsupported sources stay manual. */
export function declareFromLink(link: ReadingLink, items: readonly IntakeItem[],
  profiles: ReadonlyMap<string, SourceProfile>): LinkDeclaration | null {
  if (link.by === 'place' || !link.fields) return null;
  const from = items.find(item => item.itemId === link.fromItemId);
  const to = items.find(item => item.itemId === link.itemId);
  if (!from || !to || from === to) return null;
  const anchor = from.family === 'vector' ? from : to;
  const tableItem = anchor === from ? to : from;
  if (anchor.family !== 'vector' || tableItem.family !== 'table' || !anchor.sourceId) return null;
  const profile = profiles.get(anchor.sourceId);
  if (profile?.version !== 'manual-geojson/1') return null;
  const sourcePath = anchor === from ? link.fields.here : link.fields.there;
  const tableHeader = anchor === from ? link.fields.there : link.fields.here;
  const header = fieldWords(sourcePath);
  const paths = profile.paths.filter(path => path.path === sourcePath);
  if (paths.length !== 1 || keyPaths(anchor).filter(path => path === sourcePath).length !== 1) return null;
  const read = new Map<string, ReadTable>();
  for (const [sourceId, value] of profiles) if (value.version === 'manual-tabular/1') {
    read.set(sourceId, { headers: value.headers, selection: value.tabular.selection });
  }
  const table = tableChoices([tableItem], read)[0];
  if (!table || table.headers.filter(name => name === tableHeader).length !== 1) return null;
  const namespace = `${header} · ${table.name}`;
  if (!header.trim() || !tableHeader.trim() || !table.name.trim() || namespace.length > 150) return null;
  return { namespace, kind: paths[0]!.integerIdEligible === true ? 'integer' : 'text',
    anchorItemId: anchor.itemId, sourcePath, columns: { [table.itemId]: String(table.headers.indexOf(tableHeader)) },
    documents: [], tables: [table] };
}

export function documentChoices(items: readonly IntakeItem[]) {
  return items.filter(item => item.family === 'document' && item.sourceId);
}

/** The profile as the server takes it, or the words saying what is still missing. Each table column is read with
 * the selection of its choice. */
export function profileInput(declaration: Declaration, choices: readonly TableChoice[] = []): KeyProfileInput | string {
  const tables = Object.entries(declaration.columns).filter(([, column]) => column !== '')
    .map(([itemId, column]) => ({ itemId,
      selection: choices.find(choice => choice.itemId === itemId)?.selection ?? csvSelection,
      columnIndex: Number(column) }));
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
