import { ApiError, type GetResponse } from '@ulpin/api-client';
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

/**
 * The checks that block or need review, for the Checks tab. Undefined when the ledger holds no check at all:
 * nothing was assessed, so there is no number to show, and 0 would read as "all clear".
 */
export function openCheckCount(checks: readonly { state: string }[] | undefined): number | undefined {
  if (!checks?.length) return undefined;
  return checks.filter((check) => check.state === 'blocking' || check.state === 'needs_review').length;
}

type Canonical = GetResponse<'/api/v1/buildings/{buildingId}/canonical'>;

/**
 * The storey labels the sources state against each other, as literals in the record's order, while the record
 * holds the building's storey label as conflicting. Empty when it does not: no conflict is made up.
 */
export function conflictingStoreys(building: Pick<Canonical, 'storeyLabel' | 'conflicts'> | undefined): string[] {
  if (building?.storeyLabel.state !== 'conflicting') return [];
  const conflict = building.conflicts.find((entry) => entry.property === 'building.storeyLabel');
  const values = conflict?.alternatives.map((alternative) => alternative.value) ?? [];
  return values.filter((value): value is string => typeof value === 'string');
}

type RegisterRead = GetResponse<'/api/v1/buildings/{buildingId}/register'>;
/** The facts-only profile of the register read: the one whose sources carry the server's `documentResult`. */
type ConsolidatedRegister = Extract<RegisterRead, { schemaVersion: 'building-registry-summary/1' }>;
type DocumentResult = NonNullable<ConsolidatedRegister['sources'][number]['documentResult']>;
/** The statement as it arrives: a newer server may give a reason this build's types do not list yet. */
type StatedReading = Pick<DocumentResult, 'current'> & { readonly reasons: readonly string[] };
/** Source id to what the server states about the document reading retained beside it; only stated sources. */
export type ReadingStatements = ReadonlyMap<string, string>;
/** No source stated: before the read answers, when it fails, and for a building that is not asked. */
export const NO_READING_STATEMENTS: ReadingStatements = new Map();

/** The server's reasons for a document reading that is no longer current, in words. */
const READING_REASONS: Record<string, string> = {
  reader_changed: 'Read by an earlier version of the document reader',
  case_advanced: 'The case has received newer sources since this reading',
  policy_changed: 'The reading policy changed since this reading',
  source_superseded: 'A newer version of this source exists',
};

const NO_REASON = 'No longer current; the server gave no reason';

/**
 * What the server states about the document reading retained beside a cited source: its reasons in words, in the
 * server's order, an unknown reason as its literal code. Null when the server states nothing (the field is absent)
 * or states that the reading is current: absence is not a statement, so neither prints anything.
 */
export function readingStatement(result: StatedReading | undefined): string | null {
  if (!result || result.current) return null;
  if (!result.reasons.length) return NO_REASON;
  return result.reasons.map((reason) => READING_REASONS[reason] ?? reason).join(' · ');
}

/** The statements of every source of a consolidated register that carries one, by source id. */
export function readingStatements(
  sources: readonly { id: string; documentResult?: StatedReading }[],
): ReadingStatements {
  const statements = new Map<string, string>();
  for (const source of sources) {
    const statement = readingStatement(source.documentResult);
    if (statement) statements.set(source.id, statement);
  }
  return statements;
}

const UNSTATED = 'The server did not state whether these readings are current';

/**
 * The one caption for a read of those statements that failed: the words, then the server's code when it gives
 * one. Null while the read has not failed, and for a 404: the server holds no record to state anything about.
 */
export function unstatedReadings(error: unknown): string | null {
  if (!error) return null;
  if (error instanceof ApiError && error.status === 404) return null;
  const { code } = refusalOf(error);
  return code ? `${UNSTATED} · ${code}` : UNSTATED;
}
