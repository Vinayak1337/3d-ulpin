import { describe, expect, it } from 'vitest';
import { ApiError } from '@ulpin/api-client';
import { cardPdfPath, cardVerificationPath, isNotFound, isRouteAbsent, readFailure } from './registryCard';

const refusal = (status: number, code: string, message: string) =>
  new ApiError(status, '/api/v1/usp/property-cards/list', { error: { code, message } });
const noRoute = refusal(404, 'NOT_FOUND', 'This operation is not available.');
const noCard = refusal(404, 'NOT_FOUND', 'The exact property card revision is unavailable.');

describe('registry card reads', () => {
  it('builds the PDF route and the verification page of one exact revision', () => {
    expect(cardPdfPath('6a997624-6c8d-40a9-8215-8a671a74dc1c', 1))
      .toBe('/api/v1/usp/property-cards/6a997624-6c8d-40a9-8215-8a671a74dc1c/revisions/1');
    expect(cardVerificationPath('6a997624-6c8d-40a9-8215-8a671a74dc1c', 1))
      .toBe('/verify/card/6a997624-6c8d-40a9-8215-8a671a74dc1c/1');
  });

  it('tells a server without the route from a server without the record', () => {
    expect([isRouteAbsent(noRoute), isNotFound(noRoute)]).toEqual([true, false]);
    expect([isRouteAbsent(noCard), isNotFound(noCard)]).toEqual([false, true]);
    expect(readFailure(noRoute)).toBe('The running server does not serve this read (no such route).');
  });

  it('words a known refusal and always names the server code', () => {
    expect(readFailure(refusal(409, 'USP_SCOPE_STALE', 'Refresh the scope.')))
      .toBe('The server reports that the snapshot this read named is not the one it stores. (USP_SCOPE_STALE)');
    expect(readFailure(refusal(403, 'CARD_ACCESS', 'Denied.'))).toContain('(CARD_ACCESS)');
  });

  it('keeps the server message and code of a refusal it has no words for', () => {
    expect(readFailure(refusal(404, 'NOT_FOUND', 'Building not found.'))).toBe('Building not found. (NOT_FOUND)');
    expect(readFailure(refusal(409, 'STALE_REVISION', 'The record changed.')))
      .toBe('The record changed. (STALE_REVISION)');
  });

  it('keeps the message of a failure that carries no code', () => {
    expect(readFailure(new ApiError(502, '/api/v1/usp/property-cards/list', null))).toBe('The server answered 502.');
    expect(readFailure(new TypeError('Failed to fetch'))).toBe('Failed to fetch');
  });
});
