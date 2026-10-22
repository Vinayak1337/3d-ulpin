import type { GetResponse, Schemas } from '@ulpin/api-client';
import { fieldWords, type IntakeItem } from './batch-model';
import type { Recipe } from './layout-model';

type ProfileResponse = GetResponse<'/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/profile'>;
export type MapProfile = Extract<ProfileResponse, { version: 'manual-geojson/1' }>;
type AuthorRequest = Schemas['POST_ingestion_cases_caseId_sources_sourceId_recipes_Request_application_json'];
export type AuthorBody = Extract<AuthorRequest, { plan: { version: 'manual-geojson/1' } }>;
export type Kind = 'building' | 'parcel' | 'road' | 'public_land' | 'utility';
export interface Choices {
  kind: Kind | '';
  identifier: string;
  name: string;
  height: string;
  unit: 'm' | 'ft' | '';
  meaning: string;
}
export const blankChoices: Choices = { kind: '', identifier: '', name: '', height: '', unit: '', meaning: '' };
export const kindWords: Record<Kind, string> = {
  building: 'a building', parcel: 'a land parcel', road: 'a road', public_land: 'public land', utility: 'a utility',
};
const geometries = ['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'];
const outlines = ['Polygon', 'MultiPolygon'];
const outlineKinds: readonly Kind[] = ['building', 'parcel', 'public_land'];
const drawnAs: Partial<Record<Kind, string>> = { building: 'buildings', parcel: 'land parcels',
  public_land: 'public land' };
const heldNouns = [['pins', ['Point', 'MultiPoint']], ['lines', ['LineString', 'MultiLineString']]] as const;
const propertyPrefix = '/features/*/properties/';
const questionReasons = [
  'No approved layout matches this file. An officer states what each feature is and which field identifies it.',
  'No approved layout matches this file. An officer chooses the identifier field.',
];

/** A large file's reason may first count the pins and lines it holds; the question follows those words. */
const countedKinds = /^Read [^;]+; they are not footprints\. /;

export function needsLayoutAnswer(item: IntakeItem): boolean {
  return !item.plan && Boolean(item.sourceId) && item.placement === 'needs_answer'
    && questionReasons.includes((item.limitReason ?? '').replace(countedKinds, ''));
}

export function kindRefusal(kind: Kind, types: readonly string[]): string | null {
  const polygonOnly = outlineKinds.includes(kind);
  const accepted = polygonOnly ? outlines : geometries;
  if (types.length && types.every(type => accepted.includes(type))) return null;
  if (polygonOnly && types.some(type => outlines.includes(type))
    && types.every(type => geometries.includes(type))) return null;
  const linesOnly = types.length && types.every(type => ['LineString', 'MultiLineString'].includes(type));
  if (polygonOnly && linesOnly) return `This file holds lines; ${kindWords[kind]} must be an outline.`;
  if (polygonOnly) return `This file does not hold outlines only; ${kindWords[kind]} must be an outline.`;
  return 'The record does not state geometry this kind can use.';
}

type ProfilePath = MapProfile['paths'][number];

/** An outline kind keys only the outlines it draws; the profile states those facts for a file that also holds
 * pins or lines. Before a kind is chosen, a field either rule accepts is offered. */
function keyFacts(path: ProfilePath, kind: Kind | ''): { literal: boolean; integer: boolean } {
  const whole = { literal: path.literalIdEligible, integer: path.integerIdEligible === true };
  if (kind && !outlineKinds.includes(kind)) return whole;
  const drawn = { literal: path.outlineLiteralIdEligible ?? whole.literal,
    integer: (path.outlineIntegerIdEligible ?? path.integerIdEligible) === true };
  if (kind) return drawn;
  return { literal: whole.literal || drawn.literal, integer: whole.integer || drawn.integer };
}

export function identifierPaths(profile: MapProfile, kind: Kind | '' = ''): MapProfile['paths'] {
  return profile.paths.filter(path => {
    const keys = keyFacts(path, kind);
    return keys.literal || keys.integer;
  });
}

export function identifierWords(path: ProfilePath, kind: Kind | '' = ''): string {
  return fieldWords(path.path) + (keyFacts(path, kind).integer ? ' (whole number)' : '');
}

export function heightPaths(profile: MapProfile): MapProfile['paths'] {
  return profile.paths.filter(path => path.path.startsWith(propertyPrefix) && path.types.length > 0
    && path.types.every(type => ['number', 'string'].includes(type)));
}

export function questionBody(profile: MapProfile, choices: Choices, revision: number,
  requestKey: string): AuthorBody | null {
  if (!choices.kind || kindRefusal(choices.kind, profile.geometryTypes)) return null;
  const identifier = identifierPaths(profile, choices.kind).find(path => path.path === choices.identifier);
  if (!identifier) return null;
  if (choices.name && !profile.paths.some(path => path.path === choices.name && path.literalTextEligible)) return null;
  if (!profile.paths.some(path => path.path === '/features/*/geometry')) return null;
  const height = heightMembers(profile, choices);
  if (height === null) return null;
  const operations = [
    { target: 'feature.sourceKey' as const, sourcePath: choices.identifier,
      conversionId: keyFacts(identifier, choices.kind).integer
        ? 'literal_integer_identifier@1' as const : 'literal_identifier@1' as const },
    { target: 'feature.geometry' as const, sourcePath: '/features/*/geometry',
      conversionId: 'geojson_geometry@1' as const },
  ];
  return { requestKey, expectedRecipeRevision: revision, plan: {
    version: profile.version, mode: 'manual_mapping', source: profile.source, caseId: profile.caseId,
    workspaceRevision: profile.workspaceRevision, workspaceFingerprint: profile.workspaceFingerprint,
    kind: choices.kind, ...height, operations: choices.name ? [...operations,
      { target: 'feature.name', sourcePath: choices.name, conversionId: 'literal_text@1' }] : operations,
  } };
}

function heightMembers(profile: MapProfile, choices: Choices) {
  if (!choices.height) return {};
  if (!heightPaths(profile).some(path => path.path === choices.height) || !choices.unit
    || !choices.meaning.trim() || choices.meaning.length > 500) return null;
  return { heightField: fieldWords(choices.height), heightUnit: choices.unit, heightMeaning: choices.meaning };
}

export function choicesFromRecipe(receipt: Recipe): Choices {
  const plan = receipt.plan;
  if (plan.version !== 'manual-geojson/1' && plan.version !== 'streamed-mapping/1') return { ...blankChoices };
  const prefix = plan.kind === undefined ? 'building' : 'feature';
  const path = (name: string) => plan.operations
    .find(operation => operation.target === `${prefix}.${name}`)?.sourcePath;
  const stated = { ...blankChoices, kind: plan.kind ?? 'building', identifier: path('sourceKey') ?? '',
    name: path('name') ?? '' };
  if (plan.version === 'streamed-mapping/1') return stated;
  const height = plan.heightField ? propertyPrefix + plan.heightField.replaceAll('~', '~0').replaceAll('/', '~1') : '';
  return { ...stated, height, unit: plan.heightUnit ?? '', meaning: plan.heightMeaning ?? '' };
}

/** An outline kind over a file that also holds pins or lines: those stay in the original, never drawn. */
export function setAsideWords(kind: Kind | '', types: readonly string[]): string | null {
  const drawn = kind ? drawnAs[kind] : undefined;
  if (!drawn || !types.some(type => outlines.includes(type))) return null;
  const named = heldNouns.filter(([, kinds]) => kinds.some(held => types.includes(held))).map(([noun]) => noun);
  if (!named.length) return null;
  const subject = named.join(' and ');
  return `${subject.charAt(0).toUpperCase()}${subject.slice(1)} in this file are kept in the original `
    + `but not drawn as ${drawn}.`;
}

export function answerSummary(choices: Choices, types: readonly string[] = []): string {
  if (!choices.kind || !choices.identifier) return 'Choose what each feature is and which field identifies it.';
  const name = choices.name ? fieldWords(choices.name) : 'not stated';
  let height = 'not stated';
  if (choices.height) {
    let unit = 'unit not stated';
    if (choices.unit) unit = choices.unit === 'm' ? 'metres' : 'feet';
    height = `${fieldWords(choices.height)}, in ${unit}: ${choices.meaning || 'meaning not stated'}`;
  }
  const summary = `Each feature is ${kindWords[choices.kind]}, identified by ${fieldWords(choices.identifier)}. `
    + `Name: ${name}. Height: ${height}. It goes to this batch's area, `
    + 'or to a new area named after the file if the batch has none.';
  return [summary, setAsideWords(choices.kind, types)].filter(Boolean).join(' ');
}
