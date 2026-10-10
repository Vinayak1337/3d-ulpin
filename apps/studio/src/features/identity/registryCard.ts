import { ApiError } from '@ulpin/api-client';
import { refusalOf } from '../review/candidates/commands';

/** The server's refusal codes of the card reads, in words. A code that is not listed is shown as it is. */
const REFUSALS: Record<string, string> = {
  USP_LOCAL_ONLY: 'The server answers this read for its local operator only.',
  USP_ACCESS_CHANGED: 'The server reports that the access view or policy of this snapshot changed.',
  USP_SCOPE_STALE: 'The server reports that the snapshot this read named is not the one it stores.',
  USP_MANIFEST_REFRESH: 'The server reports that the snapshot this read named is not the one it stores.',
  DOCUMENT_DENIED: 'The server refuses a document that this snapshot cites.',
  CARD_ACCESS: 'The server answers for this card to the operator who created it only.',
};

// The API answers a path it has no route for with 404 NOT_FOUND and this message, the code a missing record uses.
const NO_ROUTE_MESSAGE = 'This operation is not available.';
const NO_ROUTE = 'The running server does not serve this read (no such route).';

/** The registry's card PDF of one exact revision: the published route, on the Studio's own origin. */
export function cardPdfPath(cardId: string, revision: number): string {
  return `/api/v1/usp/property-cards/${cardId}/revisions/${revision}`;
}

/** The Studio page that shows the server's verification report of one exact card revision. */
export function cardVerificationPath(cardId: string, revision: number): string {
  return `/verify/card/${cardId}/${revision}`;
}

/** True when the server has no such route at all, as opposed to no such building or card. */
export function isRouteAbsent(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404 && error.message === NO_ROUTE_MESSAGE;
}

/** True when the server answered that it holds no such record (not that it lacks the route). */
export function isNotFound(error: unknown): boolean {
  return refusalOf(error).code === 'NOT_FOUND' && !isRouteAbsent(error);
}

/**
 * Why a card read gave no answer, with the server's code: its mapped words, or its own message for a code that
 * is not mapped. A failure without a code (no connection, a gateway fault) keeps the message it came with.
 */
export function readFailure(error: unknown): string {
  if (isRouteAbsent(error)) return NO_ROUTE;
  const { code, message } = refusalOf(error);
  if (!code) return message;
  return `${REFUSALS[code] ?? message} (${code})`;
}
