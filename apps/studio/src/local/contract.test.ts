import { describe, expect, it } from 'vitest';
import openapi from '../../../../docs/api/openapi.json';
import { createContractValidator } from './contract';
import { ROUTES } from './routes';
import { derivedAreas, derivedContexts } from './sources';

const validate = createContractValidator(openapi as never);

describe('local data layer matches the published API contract', () => {
  it('lists only paths that exist in the OpenAPI document', () => {
    const paths = Object.keys((openapi as { paths: Record<string, unknown> }).paths);
    for (const route of ROUTES) expect(paths).toContain(route.path.replace(/:(\w+)/g, '{$1}'));
  });
  it('rejects a response that breaks the contract', () => {
    const [area] = derivedAreas;
    expect(validate('GET_areas_Response_200_application_json', [{ ...area, revision: 'one', dataKind: 'other' }]).length).toBeGreaterThan(0);
  });
  it('GET /areas', () => {
    expect(validate('GET_areas_Response_200_application_json', derivedAreas)).toEqual([]);
  });
  it('GET /areas/{areaId}/context', () => {
    for (const context of Object.values(derivedContexts)) {
      expect(validate('GET_areas_areaId_context_Response_200_application_json', context)).toEqual([]);
    }
  });
});
