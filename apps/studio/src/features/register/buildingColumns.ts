/**
 * The identifier columns of Register > Buildings, by what the read of an area holds for its buildings.
 *
 * A building feature of the area read has one identity field, `identifier`: the application's building
 * identifier. It is not an official parcel ULPIN and no column calls it one. `projectCode` is a second, different
 * field that only a source carrying project codes adds to a feature; the server's read has no such field. Neither
 * field comes with an assignment state, so an absent value is "Not stated" and never "Not assigned".
 */
export type IdentifierColumn = 'identifier' | 'projectCode';

export const IDENTIFIER_HEADERS: Record<IdentifierColumn, string> = {
  identifier: 'Building identifier', projectCode: 'Project code',
};

export const NOT_STATED = 'Not stated';

/**
 * The building identifier always, since every read has the field. The project code only when a building of this
 * read carries one: a read without the field gets no column for it, not a column of absent values.
 */
export function identifierColumns(projectCodes: readonly (string | null)[]): readonly IdentifierColumn[] {
  return projectCodes.some(Boolean) ? ['identifier', 'projectCode'] : ['identifier'];
}

/** An empty served answer states zero requests; null or undefined states no count at all. */
export function openRequestsColumn(requests: readonly unknown[] | null | undefined): boolean {
  return Array.isArray(requests);
}
