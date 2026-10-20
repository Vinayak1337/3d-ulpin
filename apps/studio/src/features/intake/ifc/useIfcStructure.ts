import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '@ulpin/api-client';
import { useSourceCase } from '../table/queries';
import { latestIfcJob, type IfcStatus } from './structure-model';

/** The source's newest native IFC reading, found among the case's jobs, read through its status route. */
export function useIfcStructure(caseId: string, sourceId: string) {
  const sourceCase = useSourceCase(caseId);
  const job = sourceCase.data ? latestIfcJob(sourceCase.data.jobs, sourceId) : null;
  const jobId = job?.id ?? '';
  const status = useQuery({ queryKey: ['intake', caseId, 'ifc', sourceId, jobId], enabled: Boolean(jobId),
    retry: false,
    refetchInterval: query => ['queued', 'running'].includes(query.state.data?.status ?? '') ? 5000 : false,
    queryFn: async () => unwrap(await api.GET('/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/ifc/jobs/{jobId}', {
      params: { path: { caseId, sourceId, jobId } },
    })) as IfcStatus,
  });
  return { sourceCase, jobId, status };
}
