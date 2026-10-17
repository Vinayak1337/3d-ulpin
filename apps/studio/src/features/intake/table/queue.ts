import { api, unwrap } from '@ulpin/api-client';
import type { Schemas } from '@ulpin/api-client';
import type { TableProfile, RawJob, MappingJob } from './types';

type RawBody = Extract<
  Schemas['POST_ingestion_cases_caseId_sources_sourceId_streaming_vector_Request_application_json'],
  { framing: 'tabular' }
>;
type MappingBody = Schemas['POST_ingestion_cases_caseId_sources_sourceId_chunk_mapping_Request_application_json'];

export async function queueRawRows(profile: TableProfile, requestKey: string): Promise<RawJob> {
  const body: RawBody = { requestKey, expectedCaseRevision: profile.workspaceRevision,
    expectedSourceRevision: profile.source.sourceRevision, sourceSha256: profile.source.sourceSha256,
    framing: 'tabular', tabular: profile.tabular };
  // Writable<T> rejects selection.table:null; retain the exact generated request body at the boundary.
  return unwrap(await api.POST('/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/streaming-vector', {
    params: { path: { caseId: profile.caseId, sourceId: profile.source.sourceId } }, body: body as never,
  })) as RawJob;
}

export async function queueMapping(profile: TableProfile, rawJobId: string, requestKey: string): Promise<MappingJob> {
  const body: MappingBody = { requestKey, rawJobId, expectedCaseRevision: profile.workspaceRevision,
    expectedSourceRevision: profile.source.sourceRevision, sourceSha256: profile.source.sourceSha256,
    tabular: profile.tabular };
  return unwrap(await api.POST('/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/chunk-mapping', {
    params: { path: { caseId: profile.caseId, sourceId: profile.source.sourceId } }, body: body as never,
  })) as MappingJob;
}
