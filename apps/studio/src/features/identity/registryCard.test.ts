import { describe, expect, it } from 'vitest';
import { ApiError } from '@ulpin/api-client';
import type { UnitCards } from '../../api/queries';
import {
  cardAction, cardPdfPath, cardVerificationPath, isNotFound, isRouteAbsent, readFailure,
} from './registryCard';

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

  it('states an answer without a code by its status, and no answer at all in fixed words', () => {
    expect(readFailure(new ApiError(502, '/api/v1/usp/property-cards/list', null))).toBe('The server answered 502.');
    expect(readFailure(new TypeError('Failed to fetch'))).toBe('The server gave no answer.');
  });
});

describe('the gate of the Property Card action', () => {
  const none: UnitCards = { snapshotCreatedAt: null, cards: [], truncated: false, searchedAll: true,
    unlisted: false, snapshots: 0, unread: 0 };
  const listed: UnitCards = { ...none, snapshotCreatedAt: '2026-10-10T13:39:30.390Z' };
  const denied = refusal(403, 'USP_LOCAL_ONLY', 'Local operator only.');

  it('is enabled by a card the registry lists alone, and opens the registry cards over a draft', () => {
    expect(cardAction({ data: listed, error: null }, false)).toEqual({ opens: 'registry', unanswered: null });
    expect(cardAction({ data: listed, error: null }, true).opens).toBe('registry');
  });

  it('reaches the draft only when the registry lists none and this browser holds a code', () => {
    expect(cardAction({ data: none, error: null }, true)).toEqual({ opens: 'draft', unanswered: null });
    expect(cardAction({ data: none, error: null }, false)).toEqual({ opens: null, unanswered: null });
  });

  it('states a refusal instead of reading it as none listed', () => {
    const stated = 'The registry could not be asked for the cards of this unit. '
      + 'The server answers this read for its local operator only. (USP_LOCAL_ONLY)';
    expect(cardAction({ error: denied }, false)).toEqual({ opens: null, unanswered: stated });
    expect(cardAction({ error: denied }, true)).toEqual({ opens: 'draft', unanswered: stated });
    expect(cardAction({ error: noRoute }, false).unanswered).toContain('no such route');
  });

  it('takes a server that holds no such building as none listed', () => {
    const noBuilding = refusal(404, 'NOT_FOUND', 'Building not found.');
    expect(cardAction({ error: noBuilding }, false)).toEqual({ opens: null, unanswered: null });
  });

  it('states a search that stopped short of every snapshot', () => {
    const short = cardAction({ data: { ...none, searchedAll: false, unlisted: true }, error: null }, false);
    expect(short.opens).toBeNull();
    expect(short.unanswered).toContain('were not searched');
  });

  it('opens nothing and states nothing while the registry has not answered', () => {
    expect(cardAction({ error: null }, false)).toEqual({ opens: null, unanswered: null });
  });
});
