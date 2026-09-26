import { AppError } from '../../infrastructure/errors';

export function areaScenarioRetired(): never {
  throw new AppError(410, 'RETIRED_OPERATION', 'Authored area crossing scenarios are no longer available.');
}

/** Historical scenario packages remain readable. Authored crossings are retired. */
export async function createAreaScenario(
  _areaId: string,
  _expectedRevision: number,
  _kind: 'road' | 'utility',
): Promise<never> {
  return areaScenarioRetired();
}
