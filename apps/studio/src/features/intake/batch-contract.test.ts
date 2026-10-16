import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import type { paths } from '@ulpin/api-client';
import controls from '../../../../../docs/evidence/gf1/e3a/controls-qualified.json';
import live from '../../../../../docs/evidence/gf1/lq1a/controls-second.json';
import { createContractValidator } from '../../local/contract';

const openapi = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../../../docs/api/openapi.json'), 'utf8'));
const validate = createContractValidator(openapi);
type MethodPath<Method extends 'get' | 'post'> = {
  [Path in keyof paths]: paths[Path][Method] extends object ? Path : never;
}[keyof paths];

const reads = [
  '/api/v1/work-queue', '/api/v1/cases/{caseId}', '/api/v1/ingestion/cases/{caseId}/intake',
  '/api/v1/ingestion/cases/{caseId}/recipes/{recipeId}', '/api/v1/ingestion/cases/{caseId}/targets',
  '/api/v1/ingestion/cases/{caseId}/events',
] as const satisfies ReadonlyArray<MethodPath<'get'>>;
const writes = [
  '/api/v1/cases', '/api/v1/ingestion/cases/{caseId}/sources',
  '/api/v1/ingestion/cases/{caseId}/intake/items',
  '/api/v1/ingestion/cases/{caseId}/recipes/{recipeId}/approve',
] as const satisfies ReadonlyArray<MethodPath<'post'>>;

it('pins every typed path called by the intake screen and drop', () => {
  for (const path of reads) expect(openapi.paths[path].get).toBeDefined();
  for (const path of writes) expect(openapi.paths[path].post).toBeDefined();
});

it('validates real retained profiles and the batch manifest against the published response schemas', () => {
  for (const profile of controls.profiles) {
    expect(validate('POST_ingestion_cases_caseId_sources_Response_201_application_json', profile)).toEqual([]);
    const readSchema = openapi.paths['/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/profile']
      .get.responses['200'].content['application/json'].schema.$ref.split('/').at(-1);
    expect(validate(readSchema, profile)).toEqual([]);
  }
  // Historic E3a receipt predates E1b and ST1. Keep its evidence unchanged; explicitly adapt the added nullable
  // projections.
  const manifest = { ...controls.manifest, items: controls.manifest.items.map(item => ({ ...item, plan: null,
    streamedProfileJobId: null })) };
  expect(validate('GET_ingestion_cases_caseId_intake_Response_200_application_json', manifest)).toEqual([]);
});

it('validates the live manifest, unmodified recipe history and author body from the stopped walk', () => {
  // The LQ1a manifest predates ST1; only the added nullable projection is adapted.
  const manifest = { ...live.manifest,
    items: live.manifest.items.map(item => ({ ...item, streamedProfileJobId: null })) };
  for (const [path, method, status, body] of [
    ['/api/v1/ingestion/cases/{caseId}/intake', 'get', '200', manifest],
    ['/api/v1/ingestion/cases/{caseId}/recipes/{recipeId}', 'get', '200', live.recipeHistory],
  ] as const) {
    const schema = openapi.paths[path][method].responses[status].content['application/json'].schema;
    expect(validate(schema.$ref.split('/').at(-1), body)).toEqual([]);
  }
  const author = openapi.paths['/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/recipes']
    .post.requestBody.content['application/json'].schema;
  expect(validate(author.$ref.split('/').at(-1), live.authorBody)).toEqual([]);
});

it('uses the published plan projection and never profile-private destination suggestions', () => {
  const item = openapi.components.schemas.GET_ingestion_cases_caseId_intake_Response_200_application_json
    .properties.items.items;
  const resolved = item.$ref ? openapi.components.schemas[item.$ref.split('/').at(-1)] : item;
  expect(resolved.properties.planRef).toBeUndefined();
  expect(resolved.required).toContain('plan');
  for (const profile of controls.profiles) {
    expect(profile).not.toHaveProperty('suggestedIdField');
    expect(profile).not.toHaveProperty('suggestedTitle');
    expect(profile).not.toHaveProperty('suggestedNamespace');
  }
});
