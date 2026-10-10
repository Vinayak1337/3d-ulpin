import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import controls from '../../../../../../docs/evidence/gf-agent/ui/f2b/responses.json';
import { createContractValidator } from '../../../local/contract';

const path = resolve(import.meta.dirname, '../../../../../../docs/api/openapi.json');
const openapi = JSON.parse(readFileSync(path, 'utf8'));
const validate = createContractValidator(openapi);

it('intercepted table responses validate against the published route schemas', () => {
  expect(validate('GET_cases_caseId_Response_200_application_json', controls.detail)).toEqual([]);
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
