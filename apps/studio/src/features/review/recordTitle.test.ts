import { describe, expect, it } from 'vitest';
import { RECORDED_TITLE, provisionalTitle } from './recordTitle';

// "r6", "r 6", "revision 6": any form a worked-out revision number could take in a title.
const REVISION_NUMBER = /\b(r|rev|revision)\s*\d+\b/i;

describe('the titles of record actions', () => {
  it('names the recorded review in words only, with no revision number', () => {
    expect(RECORDED_TITLE).toBe('Reviewed details recorded');
    expect(RECORDED_TITLE).not.toMatch(REVISION_NUMBER);
    expect(RECORDED_TITLE).not.toMatch(/\d/);
  });

  it('holds the words and the level\'s label for a level kept provisional, and adds no number of its own', () => {
    expect(provisionalTitle('2ND FLOOR PLAN')).toBe('2ND FLOOR PLAN kept provisional: estimate stays flagged');
    expect(provisionalTitle('Terrace')).not.toMatch(/\d/);
    expect(provisionalTitle('Terrace')).not.toMatch(REVISION_NUMBER);
  });
});
