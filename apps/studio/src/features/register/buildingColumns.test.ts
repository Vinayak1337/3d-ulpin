import { describe, expect, it } from 'vitest';
import { IDENTIFIER_HEADERS, NOT_STATED, identifierColumns } from './buildingColumns';

const headers = (codes: (string | null)[]) => identifierColumns(codes).map((column) => IDENTIFIER_HEADERS[column]);

describe('the identifier columns of Register > Buildings', () => {
  it('draws the building identifier alone when no building of the read carries a project code', () => {
    expect(headers([null, null])).toEqual(['Building identifier']);
    expect(headers([])).toEqual(['Building identifier']);
  });

  it('draws the project code beside it, under its own name, when a building of the read carries one', () => {
    expect(headers([null, 'a-project-code'])).toEqual(['Building identifier', 'Project code']);
  });

  it('names no column a ULPIN and words an absent value without an assignment state', () => {
    for (const header of Object.values(IDENTIFIER_HEADERS)) expect(header).not.toMatch(/ulpin/i);
    expect(NOT_STATED).toBe('Not stated');
  });
});
