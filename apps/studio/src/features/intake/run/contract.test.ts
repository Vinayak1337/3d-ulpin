import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import type { paths } from '@ulpin/api-client';
import captured from '../../../../../../docs/evidence/gf1/e3b/targets.json';
import confirmation from '../../../../../../docs/evidence/gf1/e3b/confirmation.json';
import { createContractValidator } from '../../../local/contract';
import { confirmBody, type TargetPage } from './model';

const calls = [
  ['/api/v1/ingestion/cases/{caseId}/targets', 'get', 200],
  ['/api/v1/ingestion/cases/{caseId}/confirmations', 'post', 202],
  ['/api/v1/ingestion/cases/{caseId}/confirmations/{confirmationId}', 'get', 200],
  ['/api/v1/ingestion/cases/{caseId}/confirmations/{confirmationId}/retry', 'post', 202],
  ['/api/v1/ingestion/cases/{caseId}/targets/{targetId}/priority', 'post', 200],
] as const satisfies readonly (readonly [keyof paths, 'get' | 'post', number])[];

type CalledOperations = [
  paths[typeof calls[0][0]]['get'], paths[typeof calls[1][0]]['post'], paths[typeof calls[2][0]]['get'],
  paths[typeof calls[3][0]]['post'], paths[typeof calls[4][0]]['post'],
];
type Present<Operation> = Operation extends { responses: unknown } ? true : never;
const operationTypesExist: [Present<CalledOperations[0]>, Present<CalledOperations[1]>,
  Present<CalledOperations[2]>, Present<CalledOperations[3]>, Present<CalledOperations[4]>] =
  [true, true, true, true, true];
const documentPath = resolve(import.meta.dirname, '../../../../../../docs/api/openapi.json');
const openapi = JSON.parse(readFileSync(documentPath, 'utf8'));
const validate = createContractValidator(openapi);
const sample = { ...captured };
delete (sample as Partial<typeof captured>).choiceIds;
const page = sample as TargetPage;

it('the typed client and published document have all five operations the panel calls', () => {
  expect(operationTypesExist).toHaveLength(5);
  for (const [path, method, status] of calls) {
    expect(openapi.paths[path][method].responses[String(status)]).toBeDefined();
  }
});

it('captured HTTP targets, confirmation and priority projection match each called response contract', () => {
  const values = [page, confirmation, confirmation, confirmation, confirmation.progress[0]];
  calls.forEach(([path, method, status], index) => {
    const reference = openapi.paths[path][method].responses[String(status)].content['application/json'].schema.$ref;
    expect(validate(reference.split('/').at(-1), values[index])).toEqual([]);
  });
});

it('the confirmation body and empty retry/priority controls match the published request schemas', () => {
  const body = confirmBody(page, page.items, confirmation.acknowledgement, confirmation.requestKey);
  for (const [path, method] of calls.filter(call => call[1] === 'post')) {
    const reference = openapi.paths[path][method].requestBody.content['application/json'].schema.$ref;
    expect(validate(reference.split('/').at(-1), path.endsWith('/confirmations') ? body : {})).toEqual([]);
  }
});
