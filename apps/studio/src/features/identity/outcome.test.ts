import { describe, expect, it } from 'vitest';
import { ApiError } from '@ulpin/api-client';
import { commandFailure } from './outcome';

const refusal = (status: number, code: string, message: string) => (
  new ApiError(status, '/api/v1/usp/identity/reviews', { error: { code, message, retryable: status >= 500 } })
);

describe('commandFailure', () => {
  it('states a refusal in the mapped words with the code of the server', () => {
    const said = 'Each identity target needs matching recorded source evidence.';
    const error = refusal(422, 'USP_IDENTITY_EVIDENCE', said);
    expect(commandFailure(error)).toEqual({
      unknown: false,
      text: 'The citation sent is not the one the registry recorded for this unit. (USP_IDENTITY_EVIDENCE)',
    });
  });

  it('prints the sentence of the server for a code it answers for many reasons, and for a code not listed', () => {
    const stale = refusal(409, 'STALE_REVISION', 'This space already has a reserved project code.');
    expect(commandFailure(stale).text).toBe('This space already has a reserved project code. (STALE_REVISION)');
    const other = refusal(422, 'SOMETHING_NEW', 'A sentence of the server.');
    expect(commandFailure(other)).toEqual({ unknown: false, text: 'A sentence of the server. (SOMETHING_NEW)' });
  });

  const unknown = 'The result is unknown: no answer says whether the registry stored anything.';

  it('states no answer at all as the fixed sentence, without the words of the browser', () => {
    expect(commandFailure(new TypeError('Failed to fetch'))).toEqual({ unknown: true, text: unknown });
    expect(commandFailure(new Error('NetworkError when attempting to fetch resource.')).text).toBe(unknown);
  });

  it('states a 502 without a body as the fixed sentence alone', () => {
    expect(commandFailure(new ApiError(502, '/x', null))).toEqual({ unknown: true, text: unknown });
  });

  it('adds the code of a server fault that has one, and not its sentence', () => {
    const fault = commandFailure(refusal(500, 'INTERNAL_ERROR', 'connect ECONNREFUSED 127.0.0.1:5432'));
    expect(fault).toEqual({ unknown: true, text: `${unknown} (INTERNAL_ERROR)` });
    const missing = commandFailure(refusal(503, 'USP_POSTWRITE_MISSING', 'The write could not be confirmed.'));
    expect(missing).toEqual({ unknown: true, text: `${unknown} (USP_POSTWRITE_MISSING)` });
  });

  it('keeps a fault that is answered before any write as a refusal', () => {
    const error = refusal(503, 'LOCAL_OPERATOR_CONFIGURATION', 'The local operator is not configured.');
    expect(commandFailure(error).unknown).toBe(false);
    expect(commandFailure(error).text).toContain('Nothing was written. (LOCAL_OPERATOR_CONFIGURATION)');
  });

  it('says that the running server has no such route', () => {
    const error = refusal(404, 'NOT_FOUND', 'This operation is not available.');
    expect(commandFailure(error)).toEqual({
      unknown: false, text: 'The running server does not serve this request (no such route).',
    });
  });
});
