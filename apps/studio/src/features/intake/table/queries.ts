import { useQueries, useQuery } from '@tanstack/react-query';
import { api, unwrap, type GetResponse } from '@ulpin/api-client';
import type { MappingJob, RawJob } from './types';

// openapi-fetch's Readable helper drops null-only properties (selection.table); restore published types.
type ProfileResponse = GetResponse<'/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/profile'>;

export const tableKey = (caseId: string, sourceId: string) => ['table', caseId, sourceId];

export function useTableProfile(caseId: string, sourceId: string) {
  return useQuery({ queryKey: [...tableKey(caseId, sourceId), 'profile'], retry: false,
    queryFn: async () => unwrap(await api.GET('/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/profile', {
      params: { path: { caseId, sourceId } },
    })) as ProfileResponse,
  });
}

export function useSourceCase(caseId: string) {
  return useQuery({ queryKey: ['source-case', caseId], retry: false,
    queryFn: async () => unwrap(await api.GET('/api/v1/cases/{caseId}', { params: { path: { caseId } } })),
  });
}

export function useTableJobs(caseId: string, sourceId: string, rawJobId: string, jobId: string, fallback: boolean) {
  const key = tableKey(caseId, sourceId);
  const raw = useQuery({ queryKey: [...key, 'raw', rawJobId], enabled: Boolean(rawJobId), retry: false,
    refetchInterval: fallback ? 2000 : false,
    queryFn: async () => unwrap(await api.GET(
      '/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/streaming-vector/jobs/{jobId}', {
        params: { path: { caseId, sourceId, jobId: rawJobId } },
      })) as RawJob,
  });
  const mapping = useQuery({ queryKey: [...key, 'mapping', jobId], enabled: Boolean(jobId), retry: false,
    refetchInterval: fallback ? 2000 : false,
    queryFn: async () => unwrap(await api.GET(
      '/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/chunk-mapping/jobs/{jobId}', {
        params: { path: { caseId, sourceId, jobId } },
      })) as MappingJob,
  });
  return { raw, mapping };
}

export function useMappedChunks(caseId: string, sourceId: string, job?: MappingJob) {
  return useQueries({ queries: (job?.slots ?? []).filter((slot) => slot.published && slot.ref).map((slot) => ({
    queryKey: [...tableKey(caseId, sourceId), 'chunk', job!.jobId, slot.chunkIndex, slot.resultSha256],
    staleTime: Infinity, retry: false,
    queryFn: async () => unwrap(await api.GET(
      '/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/chunk-mapping/jobs/{jobId}/chunks/{chunkIndex}', {
        params: { path: { caseId, sourceId, jobId: job!.jobId, chunkIndex: slot.chunkIndex } },
      })),
  })) });
}
