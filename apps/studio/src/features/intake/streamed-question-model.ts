import type { GetResponse, Schemas } from '@ulpin/api-client';
import { countWords, fieldWords, type IntakeItem } from './batch-model';
import { identityWords, kindRefusal, kindWords, positionPath, setAsideWords, type Choices, type Kind }
  from './question-model';

export type ProfileStatus =
  GetResponse<'/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/streamed-profile/jobs/{jobId}'>;
export type Inventory = NonNullable<ProfileStatus['latest']>;
export type InventoryPath = Inventory['paths'][number];
export type StreamedAuthorBody =
  Schemas['POST_ingestion_cases_caseId_sources_sourceId_streamed_profile_jobs_jobId_recipes_Request_application_json'];
export type PrefixAuthorBody = Schemas[
  'POST_ingestion_cases_caseId_sources_sourceId_streamed_profile_jobs_jobId_prefix_recipes_Request_application_json'];
export type StreamedPlan = (StreamedAuthorBody | PrefixAuthorBody)['plan'];
/** The case revision the inventory was queued at, as its status publishes it; the server refuses any other. */
export type CasePin = Pick<ProfileStatus, 'caseId' | 'caseRevision'>;
const geometryPath = '/features/*/geometry';
const propertyPrefix = '/features/*/properties/';

/** Words for an inventory the question cannot be answered from yet; null once it is sealed, or at once for a
 * question over the first part. */
export function inventoryWords(status: ProfileStatus, firstPart = false): string | null {
  if (status.status === 'failed') {
    return 'The fields of this file could not be inventoried, so its layout question cannot be answered.';
  }
  if (status.status === 'stale') {
    return 'This file changed after its fields were inventoried, so its layout question cannot be answered.';
  }
  if (!firstPart && (status.status !== 'sealed' || !status.latest)) {
    return 'The fields of this file are still being inventoried.';
  }
  return null;
}

type IdentifierCounts = Pick<InventoryPath, 'types' | 'values' | 'integers' | 'explicitNull' | 'absent'>;

function holdsOnly(path: Pick<InventoryPath, 'types'>, type: InventoryPath['types'][number]): boolean {
  return path.types.length === 1 && path.types[0] === type;
}

/** Every counted value is a whole number; an inventory that did not count them offers no number field. */
export function holdsWholeNumbers(path: Pick<InventoryPath, 'types' | 'integers' | 'values'>): boolean {
  return holdsOnly(path, 'number') && path.integers === path.values;
}

/** Only outline kinds in mixed files use the server's outline identity facts. */
function identifierCounts(inventory: Inventory, path: InventoryPath, kind: Kind | ''): IdentifierCounts {
  const outlines = !kind || ['building', 'parcel', 'public_land'].includes(kind);
  const mixed = inventory.geometryTypes.some(type => !['Polygon', 'MultiPolygon'].includes(type));
  return outlines && mixed ? path.outline ?? path : path;
}

export function streamedIdentifierPaths(inventory: Inventory, kind: Kind | '' = ''): InventoryPath[] {
  const complete = (counts: IdentifierCounts, total: number) => counts.values === total
    && counts.explicitNull === 0 && counts.absent === 0
    && (holdsOnly(counts, 'string') || holdsWholeNumbers(counts));
  return inventory.paths.filter(path => {
    if (!path.path.startsWith(propertyPrefix)) return false;
    const counts = identifierCounts(inventory, path, kind);
    const total = counts === path ? inventory.accepted : counts.values + counts.explicitNull + counts.absent;
    return complete(counts, total) || !kind && complete(path, inventory.accepted);
  });
}

export function streamedNamePaths(inventory: Inventory, kind: Kind | '' = ''): InventoryPath[] {
  return inventory.paths.filter(path => {
    if (!path.path.startsWith(propertyPrefix)) return false;
    const whole = path.values === inventory.accepted && path.explicitNull === 0 && path.absent === 0
      && holdsOnly(path, 'string');
    if (kind && !['building', 'parcel', 'public_land'].includes(kind)) return whole;
    if (!path.outline) return whole;
    const counts = path.outline;
    const drawn = counts.values > 0 && counts.explicitNull === 0 && counts.absent === 0
      && counts.types.length === 1 && counts.types[0] === 'string';
    return kind ? drawn : whole || drawn;
  });
}

export function streamedIdentifierWords(path: InventoryPath): string {
  return fieldWords(path.path) + (holdsWholeNumbers(path) ? ' (whole number)' : '');
}

/** Words for a question over only the first part of a large file; null when it covers the whole file. */
export function prefixWords(item: Pick<IntakeItem, 'layoutProfile'>): string | null {
  if (item.layoutProfile?.coverage !== 'provisional') return null;
  return `This layout is taken from the first ${countWords(item.layoutProfile.recordsSeen)} features read.`;
}

/** The item's own words when the complete file no longer matches the first-part layout. */
export function changedPrefixWords(item: Pick<IntakeItem, 'layoutProfile' | 'limitReason'>): string | null {
  const words = item.limitReason ?? '';
  return item.layoutProfile?.coverage === 'sealed' && words.startsWith('A field used by the first-part layout')
    ? words : null;
}

/** The inventory the question names: the sealed latest one, or the provisional generation of the item's pin. */
export function questionInventory(item: Pick<IntakeItem, 'layoutProfile'>, status: ProfileStatus,
  generation: Inventory | undefined): Inventory | null {
  const asked = item.layoutProfile;
  if (asked?.coverage !== 'provisional') return status.latest ?? null;
  return generation?.generation === asked.generation && generation.generationHash === asked.generationHash
    && generation.coverage === 'provisional' ? generation : null;
}

/** A large file's plan names no height; its pins are the inventory's own, and a provisional one's prefix too. */
export function streamedQuestionBody(inventory: Inventory, choices: Choices, pin: CasePin, revision: number,
  requestKey: string): StreamedAuthorBody | PrefixAuthorBody | null {
  if (!choices.kind || kindRefusal(choices.kind, inventory.geometryTypes)) return null;
  const identifiers = streamedIdentifierPaths(inventory, choices.kind);
  const identifier = identifiers.find(path => path.path === choices.identifier);
  const position = choices.identifier === positionPath && identifiers.length === 0;
  if (!identifier && !position) return null;
  if (choices.name && !streamedNamePaths(inventory, choices.kind).some(path => path.path === choices.name)) return null;
  if (!inventory.paths.some(path => path.path === geometryPath)) return null;
  let conversionId: 'feature_position@1' | 'literal_identifier@1' | 'literal_integer_identifier@1'
    = position ? 'feature_position@1' : 'literal_identifier@1';
  if (identifier && holdsWholeNumbers(identifierCounts(inventory, identifier, choices.kind))) {
    conversionId = 'literal_integer_identifier@1';
  }
  const operations = [
    { target: 'feature.sourceKey' as const, sourcePath: choices.identifier, conversionId },
    { target: 'feature.geometry' as const, sourcePath: geometryPath, conversionId: 'geojson_geometry@1' as const },
  ];
  const plan = { mode: 'streamed_mapping' as const, basis: 'officer_stated' as const, source: inventory.source,
    caseId: pin.caseId, caseRevision: pin.caseRevision, rawJobId: inventory.rawJobId, profileJobId: inventory.jobId,
    profileGeneration: inventory.generation, profileHash: inventory.generationHash, semanticEvidence: [],
    kind: choices.kind, operations: choices.name ? [...operations,
      { target: 'feature.name' as const, sourcePath: choices.name, conversionId: 'literal_text@1' as const }]
      : operations };
  if (inventory.coverage === 'sealed') return { requestKey, expectedRecipeRevision: revision,
    plan: { ...plan, version: 'streamed-mapping/1', scope: 'accepted_source_features' } };
  const { rawChunkIndex, rawResultSha256, recordsSeen, accepted } = inventory;
  if (rawChunkIndex === null || rawResultSha256 === null) return null;
  return { requestKey, expectedRecipeRevision: revision, plan: { ...plan, version: 'streamed-prefix-mapping/1',
    scope: 'observed_prefix_and_later_compatible_features',
    prefix: { throughRawChunkIndex: rawChunkIndex, rawResultSha256, recordsSeen, accepted } } };
}

export function streamedSummary(choices: Choices, types: readonly string[] = []): string {
  if (!choices.kind || !choices.identifier) return 'Choose what each feature is and which field identifies it.';
  const name = choices.name ? fieldWords(choices.name) : 'not stated';
  const summary = `Each feature is ${kindWords[choices.kind]}, identified by ${identityWords(choices.identifier)}. `
    + `Name: ${name}. Height: not stated.`;
  return [summary, setAsideWords(choices.kind, types)].filter(Boolean).join(' ');
}

export function isStreamedPlan(plan: { version: string }): plan is StreamedPlan {
  return plan.version === 'streamed-mapping/1' || plan.version === 'streamed-prefix-mapping/1';
}

export function isPrefixPlan(plan: { version: string }): plan is PrefixAuthorBody['plan'] {
  return plan.version === 'streamed-prefix-mapping/1';
}

export function isStreamedBody(body: { plan: { version: string } }): body is StreamedAuthorBody | PrefixAuthorBody {
  return isStreamedPlan(body.plan);
}
