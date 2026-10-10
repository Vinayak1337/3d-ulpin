import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import controls from '../../../../../../docs/evidence/gf-agent/ui/f2b/responses.json';
import { createContractValidator } from '../../../local/contract';
import { initialAnswers, recipeBody } from './recipe';
import type { ChunkMapping, TableProfile } from './types';

const path = resolve(import.meta.dirname, '../../../../../../docs/api/openapi.json');
const openapi = JSON.parse(readFileSync(path, 'utf8'));
const validate = createContractValidator(openapi);

it('reasoned officer recipes retain the published null destination and selection pins', () => {
  const profile = controls.files[0]!.profile as TableProfile;
  const mapping = controls.files[0]!.chunk.payload.mapping as ChunkMapping;
  const answers = initialAnswers(profile, mapping);
  for (const column of profile.profile.columns) {
    answers[column.name] = { target: 'unknown', reason: 'Protocol control only; preserve without interpretation.' };
  }
  const body = recipeBody(profile, mapping, answers, controls.caseId, 0);
  expect(validate('POST_ingestion_cases_caseId_sources_sourceId_recipes_Request_application_json', body)).toEqual([]);
});

it('intercepted table responses validate against the published route schemas', () => {
  expect(validate('GET_cases_caseId_Response_200_application_json', controls.detail)).toEqual([]);
  for (const profile of [controls.duplicateProfile, controls.nativeProfile]) {
    expect(validate('POST_ingestion_cases_caseId_sources_Response_201_application_json', profile)).toEqual([]);
  }
  for (const file of controls.files) {
    expect(validate('POST_ingestion_cases_caseId_sources_Response_201_application_json', file.profile)).toEqual([]);
    expect(validate('POST_ingestion_cases_caseId_sources_sourceId_streaming_vector_Response_202_application_json',
      file.raw)).toEqual([]);
    expect(validate('POST_ingestion_cases_caseId_sources_sourceId_chunk_mapping_Response_202_application_json',
      file.mapping)).toEqual([]);
    const schema = 'GET_ingestion_cases_caseId_sources_sourceId_chunk_mapping_jobs_jobId_chunks_chunkIndex_' +
      'Response_200_application_json';
    expect(validate(schema, file.chunk)).toEqual([]);
  }
});
