import { describe, expect, it } from 'vitest';
import { retainedSourcePin } from '../../evidence/citedPage';
import type { BuildingRegister } from '../../../api/queries';
import {
  candidateCard, candidateCards, candidateEvidenceRef, candidateGroups, candidateLevel,
  citationOpenLabel, countByState, decisionHistory,
  itemIdOf, locatorText, planEstimateView, statedSizeView, type CanonicalCandidate,
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
    expect(card.citations).toMatchObject([
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
    expect(roomCard.level).toEqual({ text: 'Not attached to a level', stated: false });
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

describe('the target a citation opens', () => {
  const target = (candidate: CanonicalCandidate) => {
    const card = candidateCard(candidate)!;
    return candidateEvidenceRef(card.title, card.citations[0]!);
  };

  it('is the cited source at its page and region, with the numbers and unit the record carries', () => {
    const { x, y, width, height, unit } = region;
    expect(target(room())).toMatchObject({
      sourceId: citation.sourceId,
      label: 'FIXTURE ROOM',
      locator: { kind: 'region', page: 2, region: { x, y, width, height, unit } },
    });
  });

  it('is the cited source at its page when the citation names no region', () => {
    expect(target(roofprint())).toMatchObject({ sourceId: citation.sourceId, locator: { kind: 'page', page: 1 } });
  });

  it('pins the original only when the citation records its revision; none is assumed', () => {
    expect(target(roofprint()).pin).toBeUndefined();
    expect(target(roofprint()).sourceSha256).toBe(citation.sourceSha256);
    const pinned = roofprint({ citations: [{ ...citation, sourceRevision: 3 }] });
    expect(target(pinned).pin).toEqual({ revision: 3, sha256: citation.sourceSha256 });
  });

  const source = { id: citation.sourceId, revision: 7, sha256: citation.sourceSha256 } as
    BuildingRegister['sources'][number];

  it('opens the cited page with the revision and hash its retained source read states', () => {
    expect(retainedSourcePin(target(room()), [source]))
      .toEqual({ revision: 7, sha256: citation.sourceSha256 });
  });

  it('has no page pin when the read does not pin the candidate source', () => {
    expect(retainedSourcePin(target(room()), [])).toBeUndefined();
    expect(retainedSourcePin(target(room()), [{ ...source, id: 'another-source' }])).toBeUndefined();
  });

  it('has no page pin when two reads disagree about revision or hash', () => {
    expect(retainedSourcePin(target(room()), [source, { ...source, revision: 8 }])).toBeUndefined();
    expect(retainedSourcePin(target(room()), [source, { ...source, sha256: 'b'.repeat(64) }])).toBeUndefined();
  });

  it('does not replace the cited original with a different original named by a retained read', () => {
    expect(retainedSourcePin(target(room()), [{ ...source, sha256: 'b'.repeat(64) }])).toBeUndefined();
  });

  it('names the control by what it opens', () => {
    expect(citationOpenLabel(candidateCard(roofprint())!.citations[0]!)).toBe('Open cited source abcdef12 at p.1');
    expect(citationOpenLabel(candidateCard(room())!.citations[0]!))
      .toBe('Open cited source abcdef12 at p.2 · x 443.8, y 1196.9 · 71.3 × 79.8 pt');
  });

  it('keeps two citations of one source apart', () => {
    const twice = candidateCard(roofprint({ citations: [citation, citation] }))!;
    expect(new Set(twice.citations.map((item) => item.key)).size).toBe(2);
  });
});

describe('candidateLevel', () => {
  const LEVEL = '5a1d717b-0000-4000-8000-000000000000';
  const level = (value: string | null, state: string) => ({ levelId: LEVEL, order: 7, label: { value, state } });
  const read = (levelId: string | null, levels: unknown[]) => candidateLevel(levelId, levels as never);
  const stated = (text: string) => ({ text, stated: true });
  const notStated = (text: string) => ({ text, stated: false });

  it('prints a reviewed level by the label the read states', () => {
    expect(read(LEVEL, [level('FIXTURE FLOOR PLAN', 'reviewed')])).toEqual(stated('FIXTURE FLOOR PLAN'));
    const card = candidateCard(room({ levelId: LEVEL }), [level('FIXTURE FLOOR PLAN', 'reviewed')] as never)!;
    expect(card.level).toEqual(stated('FIXTURE FLOOR PLAN'));
  });

  it('says in words when the level label is not reviewed', () => {
    expect(read(LEVEL, [level('FIXTURE FLOOR PLAN', 'candidate')]))
      .toEqual(stated('FIXTURE FLOOR PLAN (candidate)'));
    expect(read(LEVEL, [level('FIXTURE FLOOR PLAN', 'source_supported')]))
      .toEqual(stated('FIXTURE FLOOR PLAN (source supported)'));
  });

  it('never makes a label from an id or an order when the read states none', () => {
    expect(read(LEVEL, [level(null, 'unknown')])).toEqual(notStated('Label unknown'));
  });

  it('says a level the read does not list is not listed, with the start of its id', () => {
    const notListed = notStated('Level not listed in this record · 5a1d717b');
    expect(read(LEVEL, [])).toEqual(notListed);
    const other = { ...level('OTHER FLOOR', 'reviewed'), levelId: 'another-level' };
    expect(read(LEVEL, [other])).toEqual(notListed);
  });

  it('says so when the candidate names no level', () => {
    expect(read(null, [level('FIXTURE FLOOR PLAN', 'reviewed')])).toEqual(notStated('Not attached to a level'));
  });
});

describe('planEstimateView', () => {
  const basis = { method: 'polygon_area_in_plan_metres@1', scaleState: 'candidate', metresPerPdfPoint: 0.034 };
  const estimated = { state: 'estimated', areaM2: 6.55, extentM: [2.42, 2.71], basis, limitations: [] };
  const unknown = { state: 'unknown', areaM2: null, extentM: null, basis: null, limitations: ['No plan frame.'] };

  it('prints the extent and area as the read states them, to the hundredth', () => {
    expect(planEstimateView(room({ planEstimate: estimated }))).toEqual(
      { state: 'estimated', extent: '2.42 × 2.71 m', area: '6.55 m²' });
  });

  it('keeps an unknown estimate unknown, never 0', () => {
    expect(planEstimateView(room({ planEstimate: unknown }))).toEqual({ state: 'unknown' });
  });

  it('states nothing when the read carries no estimate', () => {
    expect(planEstimateView(room())).toBeNull();
    expect(candidateCard(room())!.planEstimate).toBeNull();
  });
});

describe('statedSizeView', () => {
  const literal = "(8' X 8'11\")";
  const line = { kind: 'region', page: 2, x: 472.16, y: 1256.7, width: 20.09, height: 4.16, unit: 'pt' };
  const statedSize = { literal, citation: { ...citation, locator: line } };

  it('keeps the text of the sheet exactly as read, with the place it was read from', () => {
    const view = candidateCard(room({ statedSize }))!.statedSize!;
    expect(view.literal).toBe(literal);
    expect(view.citation).toMatchObject({ sourceId: citation.sourceId, place: line });
    expect(candidateEvidenceRef('FIXTURE ROOM', view.citation).locator).toMatchObject({ kind: 'region', page: 2 });
  });

  it('leaves the estimate in its own words beside it', () => {
    const basis = { method: 'polygon_area_in_plan_metres@1', scaleState: 'candidate', metresPerPdfPoint: 0.034 };
    const planEstimate = { state: 'estimated', areaM2: 6.55, extentM: [2.42, 2.71], basis, limitations: [] };
    const card = candidateCard(room({ statedSize, planEstimate }))!;
    expect(card.planEstimate).toEqual(candidateCard(room({ planEstimate }))!.planEstimate);
  });

  it('states nothing when the record holds none: not from the label, not from the estimate', () => {
    expect(statedSizeView(room({ labelLiteral: `KITCHEN ${literal}` }))).toBeNull();
    expect(candidateCard(room())!.statedSize).toBeNull();
    expect(candidateCard(roofprint())!.statedSize).toBeNull();
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
