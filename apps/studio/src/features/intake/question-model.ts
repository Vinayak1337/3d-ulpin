import type { GetResponse, Schemas } from '@ulpin/api-client';
import { fieldWords } from './batch-model';
export { needsLayoutAnswer } from '@ulpin/contracts/usp/plain';
import type { Recipe } from './layout-model';
import type { Reading } from './reading-model';
import { streamedIdentifierPaths, streamedNamePaths, type Inventory } from './streamed-question-model';

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
/** The geometry inventory path denotes the feature itself, not an identifying attribute. */
export const positionPath = '/features/*/geometry';
export function identityWords(path: string): string {
  return path === positionPath ? 'its position in the file' : fieldWords(path);
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

/** Names follow the chosen kind's completeness rule; a stored profile without outline facts stays conservative. */
export function namePaths(profile: MapProfile, kind: Kind | '' = ''): MapProfile['paths'] {
  return profile.paths.filter(path => {
    if (!path.path.startsWith(propertyPrefix)) return false;
    if (kind && !outlineKinds.includes(kind)) return path.literalTextEligible;
    const drawn = path.outlineLiteralTextEligible ?? path.literalTextEligible;
    return kind ? drawn : path.literalTextEligible || drawn;
  });
}

export function heightPaths(profile: MapProfile): MapProfile['paths'] {
  return profile.paths.filter(path => path.path.startsWith(propertyPrefix) && path.types.length > 0
    && path.types.every(type => ['number', 'string'].includes(type)));
}

export type ChoiceBasis = Partial<Record<keyof Choices, Exclude<Reading['what']['basis'], 'officer'>>>;
export type ReadingChoices = Partial<Choices> & { basis?: ChoiceBasis };

/** Only proposed meanings with a path the question offers; approval and height facts remain the officer's. */
export function choicesFromReading(reading: Reading | undefined, profile: MapProfile | Inventory): ReadingChoices {
  const result: ReadingChoices = {};
  if (!reading) return result;
  const drawing = reading.drawing;
  if (drawing.basis !== 'officer' && Object.hasOwn(kindWords, drawing.as)
    && kindRefusal(drawing.as as Kind, profile.geometryTypes) === null) {
    result.kind = drawing.as as Kind;
    result.basis = { kind: drawing.basis };
  }
  const kind = result.kind ?? '';
  const streamed = profile.version === 'streamed-profile/1';
  const offered = {
    identifier: streamed ? streamedIdentifierPaths(profile, kind) : identifierPaths(profile, kind),
    name: streamed ? streamedNamePaths(profile, kind) : namePaths(profile, kind),
    height: streamed ? [] : heightPaths(profile),
  };
  const targets = { identifier: 'building.sourceKey', name: 'building.name', height: 'building.heightM' };
  for (const choice of ['identifier', 'name', 'height'] as const) {
    const line = reading.fields.find(line => line.basis !== 'officer' && line.target === targets[choice]
      && offered[choice].some(path => path.path === line.field));
    if (!line || line.basis === 'officer') continue;
    result[choice] = line.field;
    result.basis = { ...result.basis, [choice]: line.basis };
  }
  return result;
}

export function questionBody(profile: MapProfile, choices: Choices, revision: number,
  requestKey: string): AuthorBody | null {
  if (!choices.kind || kindRefusal(choices.kind, profile.geometryTypes)) return null;
  const identifiers = identifierPaths(profile, choices.kind);
  const identifier = identifiers.find(path => path.path === choices.identifier);
  const position = choices.identifier === positionPath && identifiers.length === 0;
  if (!identifier && !position) return null;
  if (choices.name && !namePaths(profile, choices.kind).some(path => path.path === choices.name)) return null;
  if (!profile.paths.some(path => path.path === '/features/*/geometry')) return null;
  const height = heightMembers(profile, choices);
  if (height === null) return null;
  let conversionId: 'feature_position@1' | 'literal_identifier@1' | 'literal_integer_identifier@1'
    = position ? 'feature_position@1' : 'literal_identifier@1';
  if (identifier && keyFacts(identifier, choices.kind).integer) conversionId = 'literal_integer_identifier@1';
  const operations = [
    { target: 'feature.sourceKey' as const, sourcePath: choices.identifier, conversionId },
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
  const streamed = plan.version === 'streamed-mapping/1' || plan.version === 'streamed-prefix-mapping/1';
  if (plan.version !== 'manual-geojson/1' && !streamed) return { ...blankChoices };
  const prefix = plan.kind === undefined ? 'building' : 'feature';
  const path = (name: string) => plan.operations
    .find(operation => operation.target === `${prefix}.${name}`)?.sourcePath;
  const stated = { ...blankChoices, kind: plan.kind ?? 'building', identifier: path('sourceKey') ?? '',
    name: path('name') ?? '' };
  if (plan.version !== 'manual-geojson/1') return stated;
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
  const summary = `Each feature is ${kindWords[choices.kind]}, identified by ${identityWords(choices.identifier)}. `
    + `Name: ${name}. Height: ${height}.`;
  return [summary, setAsideWords(choices.kind, types)].filter(Boolean).join(' ');
}
