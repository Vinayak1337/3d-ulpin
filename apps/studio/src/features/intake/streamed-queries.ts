import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, unwrap, type Schemas } from '@ulpin/api-client';
import type { Recipe } from './layout-model';
import type { ProfileStatus, StreamedAuthorBody } from './streamed-question-model';

type Decision = Schemas['POST_ingestion_cases_caseId_recipes_recipeId_approve_Request_application_json'];

/** Read again whenever the item changes, keeping the last read meanwhile so open answers stay; no polling. */
export function useStreamedProfile(caseId: string, sourceId: string, jobId: string, itemUpdatedAt: string) {
  return useQuery({ queryKey: ['streamed-profile', caseId, sourceId, jobId, itemUpdatedAt], retry: false,
    placeholderData: keepPreviousData,
    queryFn: async () => unwrap(await api.GET(
      '/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/streamed-profile/jobs/{jobId}', {
        params: { path: { caseId, sourceId, jobId } },
      })) as ProfileStatus });
}

export async function authorStreamedLayout(caseId: string, sourceId: string,
  body: StreamedAuthorBody): Promise<Recipe> {
  return unwrap(await api.POST(
    '/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/streamed-profile/jobs/{jobId}/recipes', {
      params: { path: { caseId, sourceId, jobId: body.plan.profileJobId } }, body,
    })) as Recipe;
}

export async function approveStreamedLayout(caseId: string, sourceId: string, jobId: string, recipeId: string,
  body: Decision): Promise<Recipe> {
  return unwrap(await api.POST(
    '/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/streamed-profile/jobs/{jobId}/recipes/{recipeId}/approve', {
      params: { path: { caseId, sourceId, jobId, recipeId } }, body,
    })) as Recipe;
}
