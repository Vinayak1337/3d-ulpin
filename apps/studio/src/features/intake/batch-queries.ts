import { queryOptions, useQuery, type QueryClient, type QueryFilters, type QueryKey } from '@tanstack/react-query';
import { api, ApiError, unwrap } from '@ulpin/api-client';
import type { IntakeItem } from './batch-model';
import type { Recipe } from './layout-model';
import type { AuthorBody } from './question-model';
import type { Schemas } from '@ulpin/api-client';
import { readTargets } from './run/api';
import { runKey } from './run/useTargets';
import type { RetryResult } from './retry-command';
import type { PageImageBody } from './page-image-model';
import type { LayerCrsBody } from './layer-crs-command';
import type { TablePlacementBody } from './table-placement-command';

export const recipeKey = (caseId: string) => ['batch-recipes', caseId];
/** The batch's manifest; the reads of its items' sections sit under the same prefix. */
export const intakeKey = (caseId: string) => ['intake', caseId];

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

export function intakeManifestOptions(caseId: string) {
  return queryOptions({ queryKey: intakeKey(caseId), retry: false,
    queryFn: async () => unwrap(await api.GET('/api/v1/ingestion/cases/{caseId}/intake', {
      params: { path: { caseId } },
    })),
  });
}

export function useIntakeManifest(caseId: string) {
  return useQuery(intakeManifestOptions(caseId));
}

/** TR1. One item as the manifest lists it, by the existing one-item route. */
export async function readIntakeItem(caseId: string, itemId: string): Promise<IntakeItem> {
  return unwrap(await api.GET('/api/v1/ingestion/cases/{caseId}/intake/items/{itemId}', {
    params: { path: { caseId, itemId } },
  }));
}

export async function readIntakeReading(caseId: string, itemId: string) {
  return unwrap(await api.GET('/api/v1/ingestion/cases/{caseId}/intake/items/{itemId}/reading', {
    params: { path: { caseId, itemId } },
  }));
}

/**
 * ZP2. A notification that arrives while a read is in flight asks for one more read after it: that read began
 * before the change, and without a second one its answer would stand as current until the next notification.
 */
export function rereadQuery(client: QueryClient, queryKey: QueryKey, predicate?: QueryFilters['predicate']) {
  const filters = { queryKey, predicate };
  const inFlight = client.isFetching(filters) > 0;
  const read = client.invalidateQueries(filters, { cancelRefetch: false });
  if (inFlight) void read.then(() => client.invalidateQueries(filters, { cancelRefetch: false }));
}

export async function retryStoppedItem(caseId: string, itemId: string, requestKey: string): Promise<RetryResult> {
  return unwrap(await api.POST('/api/v1/ingestion/cases/{caseId}/intake/items/{itemId}/retry', {
    params: { path: { caseId, itemId } }, body: { requestKey },
  }));
}

export async function answerPageImage(caseId: string, itemId: string, body: PageImageBody) {
  return unwrap(await api.POST('/api/v1/ingestion/cases/{caseId}/intake/items/{itemId}/page-image-label', {
    params: { path: { caseId, itemId } }, body,
  }));
}

const PREVIEW = '/api/v1/ingestion/cases/{caseId}/intake/items/{itemId}/page-image-preview';

/** The item's kept preview PNG; the server checks its hash, and its size must be the one kept on the item. */
export async function readPageImagePreview(caseId: string, itemId: string, bytes: number,
  signal: AbortSignal): Promise<Blob> {
  const result = await api.GET(PREVIEW, { params: { path: { caseId, itemId } }, parseAs: 'blob', signal });
  if (!result.response.ok || !result.data) throw new ApiError(result.response.status, PREVIEW, result.error);
  if (result.data.size !== bytes) throw new Error('The preview differs from the size kept on this file.');
  return result.data;
}

export async function placeTableOnMap(caseId: string, itemId: string, body: TablePlacementBody) {
  return unwrap(await api.POST('/api/v1/ingestion/cases/{caseId}/intake/items/{itemId}/table-placement', {
    params: { path: { caseId, itemId } }, body,
  }));
}

export async function stateLayerCrs(caseId: string, itemId: string, body: LayerCrsBody) {
  return unwrap(await api.POST('/api/v1/ingestion/cases/{caseId}/intake/items/{itemId}/layer-crs', {
    params: { path: { caseId, itemId } }, body,
  }));
}
