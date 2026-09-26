import { describe, expect, it } from 'vitest';
import { ApiError } from './index';

describe('ApiError', () => {
  it('uses the server message when there is one', () => {
    expect(new ApiError(400, '/api/v1/x', { message: ['a', 'b'] }).message).toBe('a; b');
    expect(new ApiError(503, '/api/v1/x', null).message).toBe('The server answered 503.');
  });
});
