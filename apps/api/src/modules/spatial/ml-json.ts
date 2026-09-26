import type { Request } from 'express';
import { AppError } from '@ulpin/server/infrastructure/errors';
import { readJsonBody } from '../../common/body';

/** Legacy ML operations classify malformed JSON as invalid input (422). */
export async function readMlJson(request: Request, limit: number) {
  try { return await readJsonBody(request, limit); }
  catch (error) {
    if (error instanceof AppError && error.code === 'INVALID_JSON')
      throw new AppError(422, 'INVALID_INPUT', 'The request must contain valid JSON.');
    throw error;
  }
}
