import type { GetResponse, Schemas } from '@ulpin/api-client';

export type TableProfile = Extract<
  GetResponse<'/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/profile'>,
  { version: 'manual-tabular/1' }
>;
export type RawJob =
  GetResponse<'/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/streaming-vector/jobs/{jobId}'>;
export type MappingJob =
  GetResponse<'/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/chunk-mapping/jobs/{jobId}'>;
export type MappedChunk = GetResponse<
  '/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/chunk-mapping/jobs/{jobId}/chunks/{chunkIndex}'
>;
export type ChunkMapping = NonNullable<NonNullable<MappedChunk['payload']>['mapping']>;
export type Metrics = ChunkMapping['metrics'];
export type Target = ChunkMapping['plan']['fields'][number]['target'];
export type Selection = RecipeBody['plan']['tabular']['selection'];
export type RetainBody = Schemas['POST_ingestion_cases_caseId_sources_Request_multipart_form_data'];
export type RecipeBody = Extract<
  Schemas['POST_ingestion_cases_caseId_sources_sourceId_recipes_Request_application_json'],
  { destination: null }
>;
export type Recipe = Schemas['POST_ingestion_cases_caseId_sources_sourceId_recipes_Response_201_application_json'];
export type RecipeHistory = GetResponse<'/api/v1/ingestion/cases/{caseId}/recipes/{recipeId}'>;
