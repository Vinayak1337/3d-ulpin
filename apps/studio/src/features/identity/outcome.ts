import { ApiError } from '@ulpin/api-client';
import { refusalOf } from '../review/candidates/commands';
import { isRouteAbsent } from './registryCard';

/** What a command that was not answered with 200 leaves the dialog able to say. */
export interface CommandFailure {
  /** True when no answer says whether the registry stored anything: no answer at all, or a server fault. */
  unknown: boolean;
  text: string;
}

/**
 * The registry's refusal codes of the identity, plan and card commands, in words. A code that is not listed is
 * printed with the server's own sentence; so are STALE_REVISION, NOT_FOUND and the expiry codes, which the
 * server answers with the reason.
 */
const REFUSALS: Record<string, string> = {
  USP_REQUEST_FAILED: 'The registry did not accept the form of this request. Nothing was written.',
  LOCAL_OPERATOR_CONFIGURATION:
    'The registry has no local operator configured, so it can name no reviewer. Nothing was written.',
  USP_LOCAL_ONLY: 'The registry accepts this from its local operator only.',
  USP_SNAPSHOT_PROFILE: 'The registry takes a snapshot of a recorded site only. Nothing was written.',
  USP_STALE_TARGET: 'The unit changed after this page read it. Read the record again.',
  USP_SELECTION: 'The Studio sent a selection the registry does not take. Nothing was written.',
  USP_SCOPE_LIMIT: 'The site holds more than one snapshot may. Nothing was written.',
  USP_SOURCE_PART_LIMIT: 'The site holds more than one snapshot may. Nothing was written.',
  USP_REVIEW_CAPABILITY: 'The operator of the registry may not review. Nothing was written.',
  unsupported_lineage_kind: 'The registry does not take a review of this form. Nothing was written.',
  USP_IDENTITY_TARGET: 'The registry holds no such recorded unit on this site.',
  USP_IDENTITY_EVIDENCE: 'The citation sent is not the one the registry recorded for this unit.',
  USP_IDENTITY_SELECTION: 'The snapshot does not select this unit.',
  USP_SOURCE_IDENTITY: 'A unit stated by a source takes its own citation and an unqualified location only.',
  PACKET_SOURCE_STATEMENT: "The entry is not this unit's own recorded citation. Nothing was written.",
  PACKET_PLAN_ACCESS: "The registry's operator may not plan for this unit.",
  PACKET_PLAN_TARGET_ACCESS: "The registry's operator may not plan for this unit.",
  PACKET_PLAN_BLOCKED: "The plan does not hold the unit's citation, so it cannot be confirmed.",
  CARD_EXECUTED_PLAN_REQUIRED: 'The plan was not executed. Prepare starts again.',
  CARD_ACCESS: 'The server answers for this card to the operator who created it only.',
  CARD_ARTIFACT_INTEGRITY: 'The stored card file does not match its receipt.',
  CARD_REVISION_CONTEXT: 'A revision keeps the plan and snapshot of its card. Issue a new card instead.',
};

// A server fault that is answered before anything is written: it is a refusal, not an unknown outcome.
const WRITES_NOTHING = new Set(['LOCAL_OPERATOR_CONFIGURATION']);
const NO_ROUTE = 'The running server does not serve this request (no such route).';
const UNKNOWN = 'The result is unknown: no answer says whether the registry stored anything.';

function serverFault(error: unknown, code: string | null): boolean {
  if (!(error instanceof ApiError)) return true;
  return error.status >= 500 && !(code && WRITES_NOTHING.has(code));
}

/**
 * Why a command was not carried out, as the dialog states it. A refusal is the mapped words or the server's
 * sentence, with its code. No answer and every other 5xx is an unknown outcome: one fixed sentence, with the
 * server's code when it gave one and never the words the failure came with (the browser's "Failed to fetch", a
 * gateway's status line). The caller then offers a read of the record, never a resend.
 */
export function commandFailure(error: unknown): CommandFailure {
  if (isRouteAbsent(error)) return { unknown: false, text: NO_ROUTE };
  const { code, message } = refusalOf(error);
  if (serverFault(error, code)) return { unknown: true, text: code ? `${UNKNOWN} (${code})` : UNKNOWN };
  return { unknown: false, text: code ? `${REFUSALS[code] ?? message} (${code})` : message };
}
