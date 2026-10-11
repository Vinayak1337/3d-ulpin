import type { GetResponse, Schemas } from '@ulpin/api-client';
import type { IntakeItem } from './batch-model';
import { fieldWords } from './batch-model';

export type RecipeHistory = GetResponse<'/api/v1/ingestion/cases/{caseId}/recipes/{recipeId}'>;
export type Recipe = RecipeHistory[number];
type Decision = Schemas['POST_ingestion_cases_caseId_recipes_recipeId_approve_Request_application_json'];

export const noLayoutWords = 'This file needs an officer to say which field identifies each feature. '
  + 'That question is not on this screen yet.';
export const changedLayoutWords = 'The layout changed. Read the current layout before approving it.';
const notSupplied = 'not supplied by the record';
const origins = {
  memory: 'Remembered from an approved layout of the same columns',
  teacher: 'Proposed by the model',
  officer: 'Written by an officer',
};

export function latestRecipe(history: readonly Recipe[]): Recipe | undefined {
  return history.reduce<Recipe | undefined>((latest, receipt) =>
    !latest || receipt.revision > latest.revision ? receipt : latest, undefined);
}

export function approvalBody(receipt: Pick<Recipe, 'revision'>, requestKey: string): Decision {
  return { requestKey, expectedRecipeRevision: receipt.revision };
}

export function layoutLines(receipt: Recipe, origin: NonNullable<IntakeItem['plan']>['origin']): string[] {
  const plan = receipt.plan;
  const lines = fieldLines(plan);
  const destination = receipt.destination;
  const areaKind = destination?.kind === 'new_area' ? 'new area' : 'existing area';
  lines.push(destination ? `Area: ${destination.name} · ${areaKind}` : `Area: ${notSupplied}`);
  lines.push(origin ? origins[origin] : `Proposal origin: ${notSupplied}`);
  const covered = new Set(['operations', 'heightField', 'heightUnit', 'heightMeaning']);
  const members = Object.keys(plan).filter(name => !covered.has(name));
  if (members.length) lines.push(`This layout also states: ${members.join(', ')}`);
  if ('operations' in plan) {
    lines.push(...plan.operations.map(operation =>
      `Operation: ${operation.target} from ${fieldWords(operation.sourcePath)} using ${operation.conversionId}`));
  }
  if (destination) {
    const members = Object.keys(destination).filter(name => !['kind', 'name'].includes(name));
    if (members.length) lines.push(`This destination also states: ${members.join(', ')}`);
  }
  return lines;
}

function fieldLines(plan: Recipe['plan']): string[] {
  if (plan.version !== 'manual-geojson/1') {
    return [`Identifier: ${notSupplied}`, `Name: ${notSupplied}`, `Height: ${notSupplied}`];
  }
  const identifier = plan.operations.find(operation => operation.target === 'building.sourceKey');
  const name = plan.operations.find(operation => operation.target === 'building.name');
  const lines = [identifier ? `Identifier: ${fieldWords(identifier.sourcePath)}` : `Identifier: ${notSupplied}`,
    name ? `Name: ${fieldWords(name.sourcePath)}` : 'Name: not stated'];
  if (!plan.heightField && !plan.heightUnit && !plan.heightMeaning) lines.push('Height: not stated');
  else if (plan.heightField && plan.heightUnit && plan.heightMeaning) {
    lines.push(`Height: ${plan.heightField}, in ${plan.heightUnit === 'm' ? 'metres' : 'feet'}: ${plan.heightMeaning}`);
  } else lines.push(`Height: ${notSupplied}`);
  return lines;
}
