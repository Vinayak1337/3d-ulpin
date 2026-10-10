import { describe, expect, it } from 'vitest';
import {
  candidateCard, candidateCards, candidateGroups, countByState, decisionHistory, itemIdOf, locatorText,
  planEstimateView, type CanonicalCandidate,
} from './model';

const ITEM = '11111111-1111-4111-8111-111111111111';
const triangle = [[[[0, 0], [4, 0], [0, 3], [0, 0]]]];

const limitations = ['Fixture limitation one.', 'Fixture limitation two, with a comma.'];
const citation = {
  sourceId: 'abcdef12-0000-4000-8000-000000000000',
  sourceSha256: 'a'.repeat(64),
  locator: { kind: 'page', page: 1 },
};

function roofprint(overrides: Record<string, unknown> = {}): CanonicalCandidate {
  return {
    candidateId: 'cand-roof-1',
    task: 'building_roofprints',
    taskVersion: '1',
    inputManifest: 'fixture',
    outputRef: `/api/v1/spatial-ml/items/${ITEM}#components/cand-roof-1`,
    state: 'candidate',
    kind: 'roofprint',
    method: `model:fixture-model@${'b'.repeat(64)}`,
    modelId: 'fixture-model',
    confidence: 0.655462,
    confidenceCalibration: 'uncalibrated',
    limitations,
    citations: [citation],
    polygons: triangle,
    coordinateFrame: 'area:fixture:enu',
    levelId: null,
    ...overrides,
  } as CanonicalCandidate;
}

const region = { kind: 'region', page: 2, x: 443.76, y: 1196.88, width: 71.28, height: 79.8, unit: 'pt' };

function room(overrides: Record<string, unknown> = {}): CanonicalCandidate {
  return roofprint({
    candidateId: 'cand-room-1',
    outputRef: 'candidates.json#/pages/2/candidates/0',
    kind: 'room',
    method: 'deterministic:vector-plan@1',
    modelId: undefined,
    confidence: null,
    confidenceCalibration: 'not_applicable',
    coordinateFrame: 'plan-local:fixture:page2:panel-a',
    labelLiteral: 'FIXTURE ROOM',
    levelLabelLiteral: 'FIXTURE FLOOR PLAN',
    citations: [{ ...citation, locator: region }],
    ...overrides,
  });
}

const decision = (outcome: string, time: string) => ({ outcome, reason: 'fixture reason', actor: 'fixture', time });

describe('candidateCard', () => {
  const card = candidateCard(roofprint())!;

  it('labels the model confidence uncalibrated', () => {
    expect(card.confidence).toBe('0.66 · uncalibrated');
  });

  it('keeps the method, model and limitations exactly as recorded', () => {
    expect(card.method).toBe(`model:fixture-model@${'b'.repeat(64)}`);
    expect(card.modelId).toBe('fixture-model');
    expect(card.limitations).toEqual(limitations);
  });

  it('carries the full source id of a citation, and shows its first characters and locator', () => {
    expect(card.citations).toEqual([
      { sourceId: 'abcdef12-0000-4000-8000-000000000000', source: 'abcdef12', locator: 'p.1' },
    ]);
  });

  it('never gives a candidate the reviewed chip', () => {
    expect(card.state).toBe('candidate');
    expect(card.chip).toEqual({ kind: 'status', word: 'Needs review' });
    expect(card.canDecide).toBe(true);
  });

  it('shows a rejected candidate as rejected even though its record state is reviewed', () => {
    const review = decision('rejected', '2026-10-10T01:50:22.720Z');
    const rejected = candidateCard(roofprint({ state: 'reviewed', review }))!;
    expect(rejected.state).toBe('rejected');
    expect(rejected.chip).toEqual({ kind: 'plain', label: 'Rejected' });
    expect(rejected.decision).toEqual(review);
    expect(rejected.canDecide).toBe(false);
  });

  it('shows Reviewed only for an accepted decision on record', () => {
    const review = decision('accepted', '2026-10-10T01:50:22.720Z');
    const accepted = candidateCard(roofprint({ state: 'reviewed', review }))!;
    expect(accepted.chip).toEqual({ kind: 'status', word: 'Reviewed' });
    expect(accepted.decision).toEqual(review);
    expect(accepted.canDecide).toBe(false);
  });

  it('hides room actions whenever a review exists, even if its state is still candidate', () => {
    const rejected = candidateCard(room({ review: decision('rejected', '2026-10-10T03:00:00.000Z') }))!;
    expect(rejected.state).toBe('rejected');
    expect(rejected.chip).toEqual({ kind: 'plain', label: 'Rejected' });
    expect(rejected.canDecide).toBe(false);
    const accepted = candidateCard(room({ review: decision('accepted', '2026-10-10T02:00:00.000Z') }))!;
    expect(accepted.state).toBe('reviewed');
    expect(accepted.canDecide).toBe(false);
  });

  it('does not invent a score or a level for a room', () => {
    const roomCard = candidateCard(room())!;
    expect(roomCard.confidence).toBe('Not scored');
    expect(roomCard.levelId).toBeNull();
    expect(roomCard.title).toBe('FIXTURE ROOM');
    expect(roomCard.levelLiteral).toBe('FIXTURE FLOOR PLAN');
  });

  it('does not call a score calibrated when the record does not say so', () => {
    const unstated = candidateCard(roofprint({ confidenceCalibration: undefined }))!;
    expect(unstated.confidence).toBe('0.66 · calibration not recorded');
  });

  it('skips an entry without geometry', () => {
    expect(candidateCard(roofprint({ polygons: null }))).toBeNull();
    expect(candidateCards([roofprint({ polygons: null }), roofprint()], 'roofprint').withoutGeometry).toBe(1);
  });

  it('counts only entries of the asked kind as without geometry', () => {
    expect(candidateCards([room(), roofprint()], 'room')).toMatchObject({ withoutGeometry: 0 });
  });
});

describe('planEstimateView', () => {
  const basis = { method: 'polygon_area_in_plan_metres@1', scaleState: 'candidate', metresPerPdfPoint: 0.034 };
  const estimated = { state: 'estimated', areaM2: 6.55, extentM: [2.42, 2.71], basis, limitations: [] };
  const unknown = { state: 'unknown', areaM2: null, extentM: null, basis: null, limitations: ['No plan frame.'] };

  it('prints the extent and area the read states, at one decimal', () => {
    expect(planEstimateView(room({ planEstimate: estimated }))).toEqual(
      { state: 'estimated', extent: '2.4 × 2.7 m', area: '6.6 m²' });
  });

  it('keeps an unknown estimate unknown, never 0', () => {
    expect(planEstimateView(room({ planEstimate: unknown }))).toEqual({ state: 'unknown' });
  });

  it('states nothing when the read carries no estimate', () => {
    expect(planEstimateView(room())).toBeNull();
    expect(candidateCard(room())!.planEstimate).toBeNull();
  });
});

describe('locatorText', () => {
  it('writes a drawing region with its unit', () => {
    expect(locatorText(region as never)).toBe('p.2 · x 443.8, y 1196.9 · 71.3 × 79.8 pt');
  });
});

describe('queue helpers', () => {
  const accepted = decision('accepted', '2026-10-10T02:00:00.000Z');
  const rejected = decision('rejected', '2026-10-10T03:00:00.000Z');
  const cards = [
    candidateCard(roofprint())!,
    candidateCard(roofprint({ candidateId: 'cand-roof-2', state: 'reviewed', review: accepted }))!,
    candidateCard(roofprint({ candidateId: 'cand-roof-3', state: 'reviewed', review: rejected }))!,
  ];

  it('reads the inference item from the output reference', () => {
    expect(itemIdOf(`/api/v1/spatial-ml/items/${ITEM}#components/x`)).toBe(ITEM);
    expect(itemIdOf('candidates.json#/pages/2/candidates/0')).toBeNull();
  });

  it('groups roofprints by image and counts states', () => {
    expect(candidateGroups(cards)).toHaveLength(1);
    expect(countByState(cards)).toEqual({ candidate: 1, reviewed: 1, rejected: 1 });
  });

  it('lists decisions newest first', () => {
    expect(decisionHistory(cards).map((c) => c.id)).toEqual(['cand-roof-3', 'cand-roof-2']);
  });
});
