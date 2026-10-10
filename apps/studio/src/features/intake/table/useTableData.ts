import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation, useSearchParams } from 'react-router';
import { tableKey, useMappedChunks, useSourceCase, useTableJobs, useTableProfile } from './queries';
import { useTableStream } from './useTableStream';

export function useTableData(caseId: string, sourceId: string) {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const profile = useTableProfile(caseId, sourceId);
  const sourceCase = useSourceCase(caseId);
  const stream = useTableStream(caseId, sourceId, params.get('rawJobId') ?? '', params.get('mappingJobId') ?? '');
  const { state, fallback } = stream;
  const jobs = useTableJobs(caseId, sourceId, state.rawJobId, state.mappingJobId, fallback);
  const chunks = useMappedChunks(caseId, sourceId, jobs.mapping.data);
  const client = useQueryClient();
  useEffect(() => {
    if (state.refresh) {
      void client.invalidateQueries({ queryKey: tableKey(caseId, sourceId),
        predicate: (query) => query.queryKey[3] !== 'chunk' });
      void client.invalidateQueries({ queryKey: ['source-case', caseId] });
    }
  }, [state.refresh, caseId, sourceId, client]);
  useEffect(() => {
    if (jobs.raw.data?.status === 'failed' || jobs.mapping.data?.status === 'failed') {
      void client.invalidateQueries({ queryKey: ['source-case', caseId] });
    }
  }, [jobs.raw.data?.status, jobs.mapping.data?.status, caseId, client]);
  useEffect(() => {
    const next = new URLSearchParams(params);
    if (state.rawJobId) next.set('rawJobId', state.rawJobId);
    if (state.mappingJobId) next.set('mappingJobId', state.mappingJobId);
    if (state.recipeId) next.set('recipeId', state.recipeId);
    if (next.toString() !== params.toString()) setParams(next, { replace: true, state: location.state });
  }, [state.rawJobId, state.mappingJobId, state.recipeId, params, setParams, location.state]);
  const mappings = chunks.flatMap((chunk) => chunk.data?.payload?.mapping ? [chunk.data.payload.mapping] : []);
  const errors = [sourceCase.error, jobs.raw.error, jobs.mapping.error, ...chunks.map((chunk) => chunk.error)];
  return { profile, sourceCase, stream, jobs, mappings, errors };
}
