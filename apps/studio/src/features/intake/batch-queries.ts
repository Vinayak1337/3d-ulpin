import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '@ulpin/api-client';
import { approvalBody, type Recipe, type RecipeHistory } from './layout-model';
import { readTargets } from './run/api';
import { runKey } from './run/useTargets';

export const recipeKey = (caseId: string) => ['batch-recipes', caseId];

export function useBatchPackages(caseId: string) {
  return useQuery({ queryKey: [...runKey(caseId), 'summary'], retry: false,
    queryFn: () => readTargets(caseId) });
}

export function useBatchRecipe(caseId: string, recipeId: string) {
  return useQuery({ queryKey: [...recipeKey(caseId), recipeId], enabled: Boolean(recipeId), retry: false,
    queryFn: async () => unwrap(await api.GET('/api/v1/ingestion/cases/{caseId}/recipes/{recipeId}', {
      params: { path: { caseId, recipeId } },
    })) as RecipeHistory });
}

export async function approveLayout(caseId: string, receipt: Recipe) {
  return unwrap(await api.POST('/api/v1/ingestion/cases/{caseId}/recipes/{recipeId}/approve', {
    params: { path: { caseId, recipeId: receipt.id } }, body: approvalBody(receipt, crypto.randomUUID()),
  }));
}

export function useIntakeManifest(caseId: string) {
  return useQuery({ queryKey: ['intake', caseId], retry: false,
    queryFn: async () => unwrap(await api.GET('/api/v1/ingestion/cases/{caseId}/intake', {
      params: { path: { caseId } },
    })),
  });
}
