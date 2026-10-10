import { describe, expect, it } from 'vitest';
import { ApiError } from '@ulpin/api-client';
import { absentReason } from './registerState';

const SERVER_TEXT = 'Server text that is never shown.';
const failure = (status: number, code?: string) => new ApiError(status, '/api/v1/buildings/b/register', {
  error: { code, message: SERVER_TEXT, requestId: 'r1' },
});

describe('absentReason', () => {
  it('maps the two codes the demo answers 409 with to words, not to the server message', () => {
    expect(absentReason(failure(409, 'STALE_REVISION')))
      .toBe('The server reports that this record, a source it cites or the reader of that source changed.');
    expect(absentReason(failure(409, 'REGISTRY_SOURCE_UNAVAILABLE')))
      .toBe('The server reports that a source this record cites is not available.');
  });

  it('shows an unknown code as the literal code, and a missing code as no reason', () => {
    expect(absentReason(failure(409, 'SOMETHING_NEW'))).toBe('SOMETHING_NEW');
    expect(absentReason(failure(409))).toBe('The server gave no reason.');
    expect(absentReason(new ApiError(409, '/x', null))).toBe('The server gave no reason.');
  });

  it('leaves a 404, another status and a non-API error to their own pages', () => {
    expect(absentReason(failure(404, 'NOT_FOUND'))).toBeNull();
    expect(absentReason(failure(500, 'STALE_REVISION'))).toBeNull();
    expect(absentReason(new Error('offline'))).toBeNull();
    expect(absentReason(null)).toBeNull();
  });
});
