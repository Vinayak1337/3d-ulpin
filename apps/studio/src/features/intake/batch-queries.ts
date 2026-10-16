import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '@ulpin/api-client';
import type { Recipe } from './layout-model';
import type { AuthorBody } from './question-model';
import type { Schemas } from '@ulpin/api-client';
import { readTargets } from './run/api';
import { runKey } from './run/useTargets';
import type { RetryResult } from './retry-command';

export const recipeKey = (caseId: string) => ['batch-recipes', caseId];

export function useBatchPackages(caseId: string) {
  return useQuery({ queryKey: [...runKey(caseId), 'summary'], retry: false,
    queryFn: () => readTargets(caseId) });
}

export function useBatchRecipe(caseId: string, recipeId: string) {
  return useQuery({ queryKey: [...recipeKey(caseId), recipeId], enabled: Boolean(recipeId), retry: false,
    queryFn: async () => unwrap(await api.GET('/api/v1/ingestion/cases/{caseId}/recipes/{recipeId}', {
      params: { path: { caseId, recipeId } },
    })) as Recipe[] });
}

export async function authorLayout(caseId: string, sourceId: string, body: AuthorBody): Promise<Recipe> {
  return unwrap(await api.POST('/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/recipes', {
    params: { path: { caseId, sourceId } }, body,
  })) as Recipe;
}

export async function approveLayout(caseId: string, receipt: Recipe,
  body: Schemas['POST_ingestion_cases_caseId_recipes_recipeId_approve_Request_application_json']): Promise<Recipe> {
  return unwrap(await api.POST('/api/v1/ingestion/cases/{caseId}/recipes/{recipeId}/approve', {
    params: { path: { caseId, recipeId: receipt.id } }, body,
  })) as Recipe;
}

export function useIntakeManifest(caseId: string) {
  return useQuery({ queryKey: ['intake', caseId], retry: false,
    queryFn: async () => unwrap(await api.GET('/api/v1/ingestion/cases/{caseId}/intake', {
      params: { path: { caseId } },
    })),
  });
}

export async function retryStoppedItem(caseId: string, itemId: string, requestKey: string): Promise<RetryResult> {
  return unwrap(await api.POST('/api/v1/ingestion/cases/{caseId}/intake/items/{itemId}/retry', {
    params: { path: { caseId, itemId } }, body: { requestKey },
  }));
}
