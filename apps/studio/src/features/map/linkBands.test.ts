import { describe, expect, it } from 'vitest';
import type { FootprintInput } from '@ulpin/scene';
import type { Candidate, EvidencePage, Outcome } from '../intake/evidence/model';
import { linkFootprints, linkKey, linkOutcomes } from './linkBands';

const footprint = (id: string): FootprintInput => ({ id, polygons: [], heightM: null, heightState: 'unknown' });
const candidate = (outcome: Outcome, ...featureIds: string[]) =>
  ({ outcome, anchors: featureIds.map((featureId) => ({ featureId })) }) as unknown as Candidate;
/** The token itself stands in for its computed value. */
const resolve = (token: string) => token;
const counts: EvidencePage['counts'] = { matched: 17, several: 2, conflicting: 9, no_match: 4 };

describe('Colour by link', () => {
  const candidates = [candidate('matched', 'B-1'), candidate('conflicting', 'B-2'), candidate('several', 'B-3', 'B-4'),
    candidate('no_match')];
  const drawn = linkFootprints(['B-1', 'B-2', 'B-3', 'B-4', 'B-5'].map(footprint), linkOutcomes(candidates), resolve);
  const colour = (id: string) => drawn.find((f) => f.id === id)!.color;

  it('gives matched, conflicting and several buildings three distinct colours', () => {
    expect(new Set([colour('B-1'), colour('B-2'), colour('B-3')]).size).toBe(3);
    expect(colour('B-3')).toBe(colour('B-4'));
  });
  it('takes the warning tone, never red, for a conflict', () => {
    expect(colour('B-2')).toBe('--ui-mark-warning');
    expect(drawn.map((f) => f.color)).not.toContain('--ui-mark-critical');
  });
  it('keeps the default colour for a building no candidate names; an unmatched row names none', () => {
    expect(drawn.find((f) => f.id === 'B-5')).not.toHaveProperty('color');
    expect(linkOutcomes([candidate('no_match')]).size).toBe(0);
  });
  it('colours a building named by several candidates by the one most in need of review', () => {
    const outcomes = linkOutcomes([candidate('matched', 'B-1'), candidate('conflicting', 'B-1'),
      candidate('matched', 'B-1')]);
    expect(outcomes.get('B-1')).toBe('conflicting');
  });
});

describe('linkKey', () => {
  it('shows the page counts exactly as given, with an icon and a word for each outcome', () => {
    const key = linkKey({ state: 'read', counts, candidates: [], reading: false, more: false }, 3);
    expect(key.items.map((item) => [item.label, item.count])).toEqual([
      ['Matched', 17], ['Several buildings', 2], ['Conflicting', 9], ['Unmatched', 4], ['No link', undefined],
    ]);
    expect(key.items.slice(0, 4).every((item) => item.icon)).toBe(true);
    expect(key.note).toBe('3 buildings coloured from 32 candidates. Unmatched rows and pages name no building.');
  });
  it('says how many buildings were coloured from how many candidates read when pages remain', () => {
    const read = Array.from({ length: 5 }, () => candidate('matched', 'B-1'));
    expect(linkKey({ state: 'read', counts, candidates: read, reading: false, more: true }, 1).note)
      .toBe('1 building coloured from 5 of 32 candidates read; the rest are listed in the batch.');
    expect(linkKey({ state: 'read', counts, candidates: read, reading: true, more: false }, 1).note)
      .toBe('1 building coloured from 5 of 32 candidates read.');
  });
  it('colours nothing and says why when no batch names a building or the read fails', () => {
    expect(linkKey({ state: 'none' }, 0)).toMatchObject({ items: [],
      note: 'No batch names a building of this area.' });
    expect(linkKey({ state: 'failed', message: 'Refused.' }, 0).note).toBe('The links could not be read. Refused.');
  });
});
