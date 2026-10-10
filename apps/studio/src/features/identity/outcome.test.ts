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

  it('calls a server fault and a lost answer an unknown outcome', () => {
    const fault = commandFailure(refusal(503, 'USP_POSTWRITE_MISSING', 'The write could not be confirmed.'));
    expect(fault.unknown).toBe(true);
    expect(fault.text).toContain('The result is unknown');
    expect(fault.text).toContain('(USP_POSTWRITE_MISSING)');
    expect(commandFailure(new TypeError('Failed to fetch'))).toMatchObject({ unknown: true });
    expect(commandFailure(new ApiError(502, '/x', null)).unknown).toBe(true);
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
