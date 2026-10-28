import type { GetResponse, Schemas } from '@ulpin/api-client';
import type { IntakeItem } from './batch-model';
import { countWords, fieldWords } from './batch-model';
import { kindWords } from './question-model';
import { isStreamedPlan } from './streamed-question-model';

export type RecipeHistory = GetResponse<'/api/v1/ingestion/cases/{caseId}/recipes/{recipeId}'>;
/** The history publishes a large file's streamed receipts beside the manual and tabular ones. */
export type Recipe = RecipeHistory[number];
type Decision = Schemas['POST_ingestion_cases_caseId_recipes_recipeId_approve_Request_application_json'];

export const changedLayoutWords = 'The layout changed. Read the current layout before approving it.';
const notSupplied = 'not supplied by the record';
const origins = {
  memory: 'Remembered from an approved layout of the same columns',
  teacher: 'Proposed by the model',
  officer: 'Written by an officer',
  parent_file: 'Approved on the file this cell was cut from',
};

export function latestRecipe(history: readonly Recipe[]): Recipe | undefined {
  return history.reduce<Recipe | undefined>((latest, receipt) =>
    !latest || receipt.revision > latest.revision ? receipt : latest, undefined);
}

export function approvalBody(receipt: Pick<Recipe, 'revision'>, requestKey: string): Decision {
  return { requestKey, expectedRecipeRevision: receipt.revision };
}

export function recipeStateWords(state: Recipe['state']): string {
  if (state === 'approved') return 'Approved.';
  if (state === 'executed') return "This layout has prepared the file's package and can no longer be changed.";
  return 'Proposed.';
}

export function layoutLines(receipt: Recipe, origin: NonNullable<IntakeItem['plan']>['origin']): string[] {
  const lines = fieldLines(receipt.plan);
  const destination = 'destination' in receipt ? receipt.destination : undefined;
  const areaKind = destination?.kind === 'new_area' ? 'new area' : 'existing area';
  lines.push(destination ? `Area: ${destination.name} · ${areaKind}` : `Area: ${notSupplied}`);
  lines.push(origin ? origins[origin] : 'The record does not say who proposed this layout.');
  return lines;
}

function fieldLines(plan: Recipe['plan']): string[] {
  if (plan.version !== 'manual-geojson/1' && !isStreamedPlan(plan)) {
    return [`Each feature is: ${notSupplied}`, `Identifier: ${notSupplied}`, `Name: ${notSupplied}`,
      `Height: ${notSupplied}`];
  }
  const prefix = plan.kind === undefined ? 'building' : 'feature';
  const identifier = plan.operations.find(operation => operation.target === `${prefix}.sourceKey`);
  const name = plan.operations.find(operation => operation.target === `${prefix}.name`);
  const feature = plan.kind ? kindWords[plan.kind] : 'a building (the older layout form states nothing else)';
  let identity = identifier ? `Identifier: ${fieldWords(identifier.sourcePath)}` : `Identifier: ${notSupplied}`;
  if (identifier?.conversionId === 'feature_position@1') identity = 'Identified by its position in the file';
  const lines = [`Each feature is: ${feature}`, identity,
    name ? `Name: ${fieldWords(name.sourcePath)}` : 'Name: not stated'];
  if (plan.version === 'streamed-prefix-mapping/1') {
    lines.push(`Taken from the first ${countWords(plan.prefix.recordsSeen)} features read`);
  }
  if (isStreamedPlan(plan)) lines.push('Height: not stated');
  else if (!plan.heightField && !plan.heightUnit && !plan.heightMeaning) lines.push('Height: not stated');
  else if (plan.heightField && plan.heightUnit && plan.heightMeaning) {
    lines.push(`Height: ${plan.heightField}, in ${plan.heightUnit === 'm' ? 'metres' : 'feet'}: ${plan.heightMeaning}`);
  } else lines.push(`Height: ${notSupplied}`);
  return lines;
}
