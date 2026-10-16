import type { GetResponse, Schemas } from '@ulpin/api-client';
import { fieldWords } from './batch-model';
import { kindRefusal, kindWords, type Choices } from './question-model';

export type ProfileStatus =
  GetResponse<'/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/streamed-profile/jobs/{jobId}'>;
export type Inventory = NonNullable<ProfileStatus['latest']>;
export type InventoryPath = Inventory['paths'][number];
export type StreamedAuthorBody =
  Schemas['POST_ingestion_cases_caseId_sources_sourceId_streamed_profile_jobs_jobId_recipes_Request_application_json'];
/** The case revision the inventory was queued at, as its status publishes it; the server refuses any other. */
export type CasePin = Pick<ProfileStatus, 'caseId' | 'caseRevision'>;
const geometryPath = '/features/*/geometry';
const propertyPrefix = '/features/*/properties/';

/** Words for an inventory the question cannot be answered from yet; null once it is sealed. */
export function inventoryWords(status: ProfileStatus): string | null {
  if (status.status === 'failed') {
    return 'The fields of this file could not be inventoried, so its layout question cannot be answered.';
  }
  if (status.status === 'stale') {
    return 'This file changed after its fields were inventoried, so its layout question cannot be answered.';
  }
  if (status.status !== 'sealed' || !status.latest) {
    return 'The fields of this file are still being inventoried. The question opens here when every record is read.';
  }
  return null;
}

function holdsOnly(path: InventoryPath, type: InventoryPath['types'][number]): boolean {
  return path.types.length === 1 && path.types[0] === type;
}

/** Every counted value is a whole number; an inventory that did not count them offers no number field. */
export function holdsWholeNumbers(path: InventoryPath): boolean {
  return holdsOnly(path, 'number') && path.integers === path.values;
}

export function streamedIdentifierPaths(inventory: Inventory): InventoryPath[] {
  return inventory.paths.filter(path => path.path.startsWith(propertyPrefix)
    && (holdsOnly(path, 'string') || holdsWholeNumbers(path)));
}

export function streamedNamePaths(inventory: Inventory): InventoryPath[] {
  return inventory.paths.filter(path => holdsOnly(path, 'string'));
}

export function streamedIdentifierWords(path: InventoryPath): string {
  return fieldWords(path.path) + (holdsWholeNumbers(path) ? ' (whole number)' : '');
}

/** A large file's plan names no height; its pins are the sealed inventory's own. */
export function streamedQuestionBody(inventory: Inventory, choices: Choices, pin: CasePin, revision: number,
  requestKey: string): StreamedAuthorBody | null {
  if (!choices.kind || kindRefusal(choices.kind, inventory.geometryTypes)) return null;
  const identifier = streamedIdentifierPaths(inventory).find(path => path.path === choices.identifier);
  if (!identifier) return null;
  if (choices.name && !streamedNamePaths(inventory).some(path => path.path === choices.name)) return null;
  if (!inventory.paths.some(path => path.path === geometryPath)) return null;
  const operations = [
    { target: 'feature.sourceKey' as const, sourcePath: identifier.path,
      conversionId: holdsWholeNumbers(identifier)
        ? 'literal_integer_identifier@1' as const : 'literal_identifier@1' as const },
    { target: 'feature.geometry' as const, sourcePath: geometryPath, conversionId: 'geojson_geometry@1' as const },
  ];
  return { requestKey, expectedRecipeRevision: revision, plan: {
    version: 'streamed-mapping/1', mode: 'streamed_mapping', scope: 'accepted_source_features',
    basis: 'officer_stated', source: inventory.source, caseId: pin.caseId, caseRevision: pin.caseRevision,
    rawJobId: inventory.rawJobId, profileJobId: inventory.jobId, profileGeneration: inventory.generation,
    profileHash: inventory.generationHash, semanticEvidence: [], kind: choices.kind,
    operations: choices.name ? [...operations,
      { target: 'feature.name', sourcePath: choices.name, conversionId: 'literal_text@1' }] : operations,
  } };
}

export function streamedSummary(choices: Choices): string {
  if (!choices.kind || !choices.identifier) return 'Choose what each feature is and which field identifies it.';
  const name = choices.name ? fieldWords(choices.name) : 'not stated';
  return `Each feature is ${kindWords[choices.kind]}, identified by ${fieldWords(choices.identifier)}. `
    + `Name: ${name}.`;
}

export function isStreamedBody(body: { plan: { version: string } }): body is StreamedAuthorBody {
  return body.plan.version === 'streamed-mapping/1';
}
