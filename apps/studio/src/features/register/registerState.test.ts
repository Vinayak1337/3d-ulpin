import { describe, expect, it } from 'vitest';
import { ApiError } from '@ulpin/api-client';
import controls from '../../../../../docs/evidence/gf1/ui/f3a/responses.json';
import type { BuildingCanonical } from '../review/recorded/model';
import {
  absentReason, conflictingStoreys, openCheckCount, readingStatement, readingStatements, registerNotFound,
  unreadRegister, unrecordedStatement, unstatedReadings,
} from './registerState';

const SERVER_TEXT = 'Server text that is never shown.';
const failure = (status: number, code?: string) => new ApiError(status, '/api/v1/buildings/b/register', {
  error: { code, message: SERVER_TEXT, requestId: 'r1' },
});

describe('absentReason', () => {
  it('maps the two codes the demo answers 409 with to words, not to the server message', () => {
    expect(absentReason(failure(409, 'STALE_REVISION')))
      .toBe('The server reports that this record, a source it cites or the reader of that source changed.');
    expect(absentReason(failure(409, 'REGISTRY_SOURCE_UNAVAILABLE')))
      .toBe('The server reports that a source this record cites is not available.');
  });

  it('shows an unknown code as the literal code, and a missing code as no reason', () => {
    expect(absentReason(failure(409, 'SOMETHING_NEW'))).toBe('SOMETHING_NEW');
    expect(absentReason(failure(409))).toBe('The server gave no reason.');
    expect(absentReason(new ApiError(409, '/x', null))).toBe('The server gave no reason.');
  });

  it('leaves a 404, another status and a non-API error to their own pages', () => {
    expect(absentReason(failure(404, 'NOT_FOUND'))).toBeNull();
    expect(absentReason(failure(500, 'STALE_REVISION'))).toBeNull();
    expect(absentReason(new Error('offline'))).toBeNull();
    expect(absentReason(null)).toBeNull();
  });
});

describe('a building with no register', () => {
  it('reads "no register" from the code NOT_FOUND, not from the status or the message', () => {
    expect(registerNotFound(failure(404, 'NOT_FOUND'))).toBe(true);
    expect(registerNotFound(failure(404))).toBe(false);
    expect(registerNotFound(failure(409, 'STALE_REVISION'))).toBe(false);
    expect(registerNotFound(new Error('offline'))).toBe(false);
  });

  it('says what the canonical record is: a candidate with nothing recorded, or a reviewed record', () => {
    expect(unrecordedStatement({ recordState: 'candidate' }, null)).toBe(
      'The server holds this building as a candidate from its sources. '
      + 'Nothing of it is recorded in the registry, so there is no register to open.',
    );
    expect(unrecordedStatement({ recordState: 'reviewed' }, null))
      .toBe('The server holds a reviewed record of this building and no register for it.');
  });

  it('says that no record is held, or gives the code, when the canonical read failed; never the message', () => {
    expect(unrecordedStatement(undefined, failure(404, 'NOT_FOUND')))
      .toBe('The server holds no record of this building.');
    expect(unrecordedStatement(undefined, failure(409, 'STALE_REVISION')))
      .toBe('The record of this building could not be read · STALE_REVISION');
    expect(unrecordedStatement(undefined, new Error(SERVER_TEXT)))
      .toBe('The record of this building could not be read.');
  });

  it('words any other failed register read with the code, never the message', () => {
    expect(unreadRegister(failure(500, 'INTERNAL'))).toBe('The server did not read this register out · INTERNAL');
    expect(unreadRegister(new Error(SERVER_TEXT))).toBe('The server did not read this register out.');
  });
});

describe('conflictingStoreys', () => {
  // The canonical read of Tower 3 as retained in the F3a evidence: its sources state G+41 and G+42.
  const tower = controls.withCode as BuildingCanonical;

  it('gives the literals the sources state against each other, in the record\'s order', () => {
    expect(tower.storeyLabel.state).toBe('conflicting');
    expect(conflictingStoreys(tower)).toEqual(['G+41', 'G+42']);
  });

  it('gives none when the storey label is not conflicting, or the read has not answered', () => {
    const reviewed = { ...tower, storeyLabel: { ...tower.storeyLabel, state: 'reviewed' as const } };
    expect(conflictingStoreys(reviewed)).toEqual([]);
    expect(conflictingStoreys({ ...tower, conflicts: [] })).toEqual([]);
    expect(conflictingStoreys(undefined)).toEqual([]);
  });
});

describe('openCheckCount', () => {
  it('gives no number when the ledger holds no check: not assessed is not 0', () => {
    expect(openCheckCount([])).toBeUndefined();
    expect(openCheckCount(undefined)).toBeUndefined();
  });

  it('counts the checks that block or need review, and 0 when every check passed', () => {
    const checks = [{ state: 'blocking' }, { state: 'needs_review' }, { state: 'passed' }, { state: 'not_assessed' }];
    expect(openCheckCount(checks)).toBe(2);
    expect(openCheckCount([{ state: 'passed' }])).toBe(0);
  });
});

describe('readingStatement', () => {
  it('maps each reason the server gives for a reading that is not current to words', () => {
    const words = (reason: string) => readingStatement({ current: false, reasons: [reason] });
    expect(words('reader_changed')).toBe('Read by an earlier version of the document reader');
    expect(words('case_advanced')).toBe('The case has received newer sources since this reading');
    expect(words('policy_changed')).toBe('The reading policy changed since this reading');
    expect(words('source_superseded')).toBe('A newer version of this source exists');
  });

  it('joins several reasons in the order the server gave them', () => {
    expect(readingStatement({ current: false, reasons: ['policy_changed', 'reader_changed'] }))
      .toBe('The reading policy changed since this reading · Read by an earlier version of the document reader');
  });

  it('shows an unknown reason as the literal code, and no reason as no reason', () => {
    expect(readingStatement({ current: false, reasons: ['reader_changed', 'something_new'] }))
      .toBe('Read by an earlier version of the document reader · something_new');
    expect(readingStatement({ current: false, reasons: [] })).toBe('No longer current; the server gave no reason');
  });

  it('says nothing when the reading is current or the server states nothing', () => {
    expect(readingStatement({ current: true, reasons: [] })).toBeNull();
    expect(readingStatement({ current: true, reasons: ['reader_changed'] })).toBeNull();
    expect(readingStatement(undefined)).toBeNull();
  });
});

describe('readingStatements', () => {
  it('keeps only the sources the server states a not-current reading for', () => {
    const statements = readingStatements([
      { id: 'stated', documentResult: { current: false, reasons: ['source_superseded'] } },
      { id: 'current', documentResult: { current: true, reasons: [] } },
      { id: 'silent' },
    ]);
    expect([...statements]).toEqual([['stated', 'A newer version of this source exists']]);
  });
});

describe('unstatedReadings', () => {
  const UNSTATED = 'The server did not state whether these readings are current';

  it('states a failed read in the same words whatever failed, followed by the code the server gives', () => {
    expect(unstatedReadings(failure(409, 'REGISTRY_SOURCE_UNAVAILABLE')))
      .toBe(`${UNSTATED} · REGISTRY_SOURCE_UNAVAILABLE`);
    expect(unstatedReadings(failure(500, 'SOMETHING_NEW'))).toBe(`${UNSTATED} · SOMETHING_NEW`);
    expect(unstatedReadings(failure(500))).toBe(UNSTATED);
    expect(unstatedReadings(new Error('offline'))).toBe(UNSTATED);
  });

  it('never shows the server message', () => {
    expect(unstatedReadings(failure(409, 'STALE_REVISION'))).not.toContain(SERVER_TEXT);
  });

  it('says nothing while the read has not failed, and for a building the server holds no record of', () => {
    expect(unstatedReadings(null)).toBeNull();
    expect(unstatedReadings(undefined)).toBeNull();
    expect(unstatedReadings(failure(404, 'NOT_FOUND'))).toBeNull();
  });
});
