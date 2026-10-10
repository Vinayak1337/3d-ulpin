import { ApiError } from '@ulpin/api-client';
import { refusalOf } from '../review/candidates/commands';

/** The server's error codes for a building whose register or ledger it will not read out, in words. */
const ABSENT_REASONS: Record<string, string> = {
  STALE_REVISION: 'The server reports that this record, a source it cites or the reader of that source changed.',
  REGISTRY_SOURCE_UNAVAILABLE: 'The server reports that a source this record cites is not available.',
};

const NO_CODE = 'The server gave no reason.';

/**
 * Why a building has no register to show, when the server answers 409 for it: the mapped words, or the literal
 * code when it is not one we know. Null for every other failure (a 404 or a fault keeps its own page).
 */
export function absentReason(error: unknown): string | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const { code } = refusalOf(error);
  if (!code) return NO_CODE;
  return ABSENT_REASONS[code] ?? code;
}
