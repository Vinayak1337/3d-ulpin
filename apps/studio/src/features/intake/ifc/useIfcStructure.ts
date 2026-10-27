import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError, unwrap } from '@ulpin/api-client';
import { useIntakeManifest } from '../batch-queries';
import { useSourceCase } from '../table/queries';
import { latestIfcJob, outlineArtifact, outlinesView, type IfcArtifact, type IfcStatus,
  type OutlinesView } from './structure-model';

const NATIVE = '/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/ifc/jobs/{jobId}/native';

/**
 * The source's native IFC reading, read through its status route: the job its batch item carries when it has one
 * (so a reading queued after the page loaded shows without a reload), else the newest among the case's jobs.
 * When its summary counts storey outlines, the accepted artifact is fetched once, by its hash, to draw them.
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
  const artifact = outlineArtifact(status.data ?? null);
  const native = useQuery({ queryKey: ['intake', caseId, 'ifc', sourceId, jobId, 'native', artifact?.sha256],
    enabled: Boolean(artifact), retry: false, staleTime: Infinity,
    queryFn: ({ signal }) => readNative({ caseId, sourceId, jobId }, artifact!, signal),
  });
  const outlines = useMemo<OutlinesView>(() => {
    if (!artifact) return { state: 'none' };
    if (native.error) return { state: 'words',
      words: `The storey outlines could not be read from the accepted result: ${native.error.message}` };
    if (native.isPending) return { state: 'words',
      words: 'The storey outlines are being read from the accepted result.' };
    return outlinesView(native.data);
  }, [artifact, native.data, native.error, native.isPending]);
  return { sourceCase, jobId, status, outlines };
}

const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');

/** The accepted native artifact by its existing route; bytes that differ from the reading's pins are refused. */
async function readNative(path: { caseId: string; sourceId: string; jobId: string }, artifact: IfcArtifact,
  signal: AbortSignal): Promise<unknown> {
  const result = await api.GET(NATIVE, { params: { path }, parseAs: 'arrayBuffer', signal });
  if (!result.response.ok || !result.data) throw new ApiError(result.response.status, NATIVE, result.error);
  const bytes = result.data as ArrayBuffer;
  if (bytes.byteLength !== artifact.bytes
    || hex(await crypto.subtle.digest('SHA-256', bytes)) !== artifact.sha256)
    throw new Error('its bytes differ from the size and SHA-256 the reading states.');
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new Error('it is not readable JSON.');
  }
}
