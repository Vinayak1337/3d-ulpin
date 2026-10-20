import { keepPreviousData, useQueries, useQuery } from '@tanstack/react-query';
import { api, unwrap, type GetResponse } from '@ulpin/api-client';
import { publishedChunkIndexes } from './model';
import type { MappingJob, RawJob, TableProfile, TableRowsPage } from './types';

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

/** G13: a CSV above 16 MiB is read as a stream in windows; its records are paged from the server. */
export const streamedTable = (profile?: Pick<TableProfile, 'tabular'>) =>
  Boolean(profile && profile.tabular.selection.format === 'csv' && profile.tabular.sourceBytes > 16 * 1024 * 1024);
export const TABLE_PAGE_ROWS = 100;

export function useTableRows(caseId: string, sourceId: string, after: number) {
  return useQuery({ queryKey: [...tableKey(caseId, sourceId), 'rows', after], retry: false,
    placeholderData: keepPreviousData,
    queryFn: async () => unwrap(await api.GET('/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/rows', {
      params: { path: { caseId, sourceId }, query: { after, limit: TABLE_PAGE_ROWS } },
    })) as TableRowsPage,
  });
}

/** A streamed table's approved job maps windows, not chunks; only its proposal job has a chunk to read. */
export function useMappedChunks(caseId: string, sourceId: string, job?: MappingJob, windowed = false) {
  const indexes = windowed && job?.route === 'approved_recipe' ? [] : publishedChunkIndexes(job);
  return useQueries({ queries: indexes.map((chunkIndex) => ({
    queryKey: [...tableKey(caseId, sourceId), 'chunk', job!.jobId, chunkIndex],
    staleTime: Infinity, retry: false,
    queryFn: async () => unwrap(await api.GET(
      '/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/chunk-mapping/jobs/{jobId}/chunks/{chunkIndex}', {
        params: { path: { caseId, sourceId, jobId: job!.jobId, chunkIndex } },
      })),
  })) });
}
