/**
 * The titles of the record actions an officer takes in the workspace, as the building's history lists them.
 * A title holds the words and, for a level, the level's label. It never holds a revision number: only the
 * server states a revision, and one the Studio worked out ahead of it (the read's revision plus one) is a guess.
 */

/** The building's reviewed details are recorded. */
export const RECORDED_TITLE = 'Reviewed details recorded';

/** A level whose limits are estimated is kept as provisional. */
export function provisionalTitle(levelLabel: string): string {
  return `${levelLabel} kept provisional: estimate stays flagged`;
}
