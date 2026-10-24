import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '@ulpin/api-client';
import { useIntakeManifest } from '../batch-queries';
import { useSourceCase } from '../table/queries';
import { latestIfcJob, type IfcStatus } from './structure-model';

/**
 * The source's native IFC reading, read through its status route: the job its batch item carries when it has one
 * (so a reading queued after the page loaded shows without a reload), else the newest among the case's jobs.
 */
export function useIfcStructure(caseId: string, sourceId: string) {
  const manifest = useIntakeManifest(caseId);
  const sourceCase = useSourceCase(caseId);
  const item = manifest.data?.items.find(entry => entry.sourceId === sourceId && !entry.parentItemId);
  const job = sourceCase.data ? latestIfcJob(sourceCase.data.jobs, sourceId) : null;
  const jobId = item?.ifcJobId ?? job?.id ?? '';
  const status = useQuery({ queryKey: ['intake', caseId, 'ifc', sourceId, jobId], enabled: Boolean(jobId),
    retry: false,
    refetchInterval: query => ['queued', 'running'].includes(query.state.data?.status ?? '') ? 5000 : false,
    queryFn: async () => unwrap(await api.GET('/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/ifc/jobs/{jobId}', {
      params: { path: { caseId, sourceId, jobId } },
    })) as IfcStatus,
  });
  return { sourceCase, jobId, status };
}
