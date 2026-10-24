import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, unwrap, type Schemas } from '@ulpin/api-client';
import type { Recipe } from './layout-model';
import { isPrefixPlan, type Inventory, type PrefixAuthorBody, type ProfileStatus, type StreamedAuthorBody,
  type StreamedPlan } from './streamed-question-model';

type Decision = Schemas['POST_ingestion_cases_caseId_recipes_recipeId_approve_Request_application_json'];
const base = '/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/streamed-profile/jobs/{jobId}' as const;

/** Read again whenever the item changes, keeping the last read meanwhile so open answers stay; no polling. */
export function useStreamedProfile(caseId: string, sourceId: string, jobId: string, itemUpdatedAt: string) {
  return useQuery({ queryKey: ['streamed-profile', caseId, sourceId, jobId, itemUpdatedAt], retry: false,
    placeholderData: keepPreviousData,
    queryFn: async () => unwrap(await api.GET(
      '/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/streamed-profile/jobs/{jobId}', {
        params: { path: { caseId, sourceId, jobId } },
      })) as ProfileStatus });
}

/** One generation is immutable, so it is read once; a question over the first part names it. */
export function useStreamedGeneration(caseId: string, sourceId: string, jobId: string, generation: number | null) {
  return useQuery({ queryKey: ['streamed-generation', caseId, sourceId, jobId, generation], retry: false,
    enabled: generation !== null, staleTime: Infinity,
    queryFn: async () => unwrap(await api.GET(
      '/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/streamed-profile/jobs/{jobId}/generations/{generation}', {
        params: { path: { caseId, sourceId, jobId, generation: generation ?? 0 } },
      })) as Inventory });
}

/** A layout over the first part is authored on the prefix route; one over the sealed inventory on its own. */
export async function authorStreamedLayout(caseId: string, sourceId: string,
  body: StreamedAuthorBody | PrefixAuthorBody): Promise<Recipe> {
  const path = { caseId, sourceId, jobId: body.plan.profileJobId };
  return unwrap(await (isPrefixBody(body)
    ? api.POST(`${base}/prefix-recipes` as const, { params: { path }, body })
    : api.POST(`${base}/recipes` as const, { params: { path }, body }))) as Recipe;
}

export async function approveStreamedLayout(caseId: string, sourceId: string, plan: StreamedPlan, recipeId: string,
  body: Decision): Promise<Recipe> {
  const path = { caseId, sourceId, jobId: plan.profileJobId, recipeId };
  return unwrap(await (isPrefixPlan(plan)
    ? api.POST(`${base}/prefix-recipes/{recipeId}/approve` as const, { params: { path }, body })
    : api.POST(`${base}/recipes/{recipeId}/approve` as const, { params: { path }, body }))) as Recipe;
}

function isPrefixBody(body: StreamedAuthorBody | PrefixAuthorBody): body is PrefixAuthorBody {
  return isPrefixPlan(body.plan);
}
