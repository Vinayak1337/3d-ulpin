import { describe, expect, it } from 'vitest';
import { noFloorsState } from './floorState';

type Register = Parameters<typeof noFloorsState>[0];
type Building = NonNullable<Parameters<typeof noFloorsState>[1]>;

const LABELS = ['GROUND FLOOR PLAN', 'FIRST FLOOR PLAN', 'SECOND FLOOR PLAN'];

// Magnolia's reads on the demo (10 October): one plan file, a reviewed three-level schedule, 18 room candidates.
const magnoliaRegister = { sources: [{ id: '10946c4c' }] } as unknown as Register;
const magnolia = {
  levelSchedule: { state: 'reviewed', levels: LABELS.map((labelLiteral) => ({ labelLiteral })) },
  candidates: [
    ...Array.from({ length: 16 }, () => ({ kind: 'room', state: 'candidate' })),
    ...Array.from({ length: 2 }, () => ({ kind: 'room', state: 'reviewed' })),
  ],
} as unknown as Building;
const empty = { candidates: [] } as unknown as Building;
const noFiles = { sources: [] } as unknown as Register;

describe('noFloorsState', () => {
  it('states what the reads hold instead of advising a plan that is already added', () => {
    expect(noFloorsState(magnoliaRegister, magnolia)).toEqual({
      advise: false,
      lines: [
        'The register of this building lists no floor yet.',
        '1 file added.',
        '3 reviewed levels from a level schedule: GROUND FLOOR PLAN, FIRST FLOOR PLAN, SECOND FLOOR PLAN.',
        '18 room candidates, 16 waiting for review.',
      ],
    });
  });

  it('advises adding a plan only when both reads say there is no file, level or room candidate', () => {
    expect(noFloorsState(noFiles, empty)).toEqual({ advise: true, lines: ['No floors recorded. Add a plan.'] });
  });

  it('does not advise while the canonical read has not answered', () => {
    expect(noFloorsState(noFiles, undefined)).toEqual({
      advise: false,
      lines: ['The register of this building lists no floor yet.'],
    });
  });
});
