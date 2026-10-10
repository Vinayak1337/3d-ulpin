import { api, unwrap } from '@ulpin/api-client';
import type { Schemas } from '@ulpin/api-client';
import type { RecipeBody, Recipe, RecipeHistory } from './types';

export async function authorRecipe(body: RecipeBody): Promise<Recipe> {
  const path = { caseId: body.plan.caseId, sourceId: body.plan.source.sourceId };
  // Writable<T> incorrectly excludes destination:null and selection.table:null.
  return unwrap(await api.POST('/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/recipes', {
    params: { path }, body: body as never,
  })) as Recipe;
}

export async function approveRecipe(caseId: string, recipeId: string,
  body: Schemas['POST_ingestion_cases_caseId_recipes_recipeId_approve_Request_application_json']): Promise<Recipe> {
  return unwrap(await api.POST('/api/v1/ingestion/cases/{caseId}/recipes/{recipeId}/approve', {
    params: { path: { caseId, recipeId } }, body,
  })) as Recipe;
}

export async function readRecipe(caseId: string, recipeId: string, sourceId: string): Promise<RecipeHistory> {
  const revisions = unwrap(await api.GET('/api/v1/ingestion/cases/{caseId}/recipes/{recipeId}', {
    params: { path: { caseId, recipeId } },
  })) as RecipeHistory;
  if (!revisions.length || revisions.some((revision) => revision.plan.source.sourceId !== sourceId ||
      revision.plan.version !== 'manual-tabular/1')) {
    throw new Error('This recipe does not belong to this retained table. Open its own source page.');
  }
  return revisions;
}
