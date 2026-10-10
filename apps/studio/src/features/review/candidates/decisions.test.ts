import { describe, expect, it } from 'vitest';
import openapi from '../../../../../../docs/api/openapi.json';
import { createContractValidator } from '../../../local/contract';
import {
  attachLevelBody, footprintDecisionPlan, levelChoices, NO_REVIEWED_LEVELS, REJECTION_NEEDS_ACCEPTANCE,
  type StagedDecision,
} from './decisions';

type Levels = Parameters<typeof levelChoices>[0];

const validate = createContractValidator(openapi as never);
const FOOTPRINT_REQUEST = 'POST_spatial_ml_items_itemId_footprint_drafts_Request_application_json';
const CANDIDATES_REQUEST = 'POST_buildings_buildingId_candidates_Request_application_json';

const level = (id: string, value: string | null, state: string) => ({
  levelId: id, order: 0, label: { value, state }, lowerM: {}, upperM: {}, spaces: [],
});
const asLevels = (...levels: ReturnType<typeof level>[]) => levels as unknown as Levels;

const LEVEL_A = '00000000-0000-4000-8000-000000000001';
const LEVEL_B = '00000000-0000-4000-8000-000000000002';

describe('levelChoices', () => {
  it('is disabled with its reason when the building has no levels', () => {
    expect(levelChoices([])).toEqual({ options: [], disabledReason: NO_REVIEWED_LEVELS });
    expect(NO_REVIEWED_LEVELS).toBe('No reviewed levels yet — a level schedule is needed first');
  });

  it('is disabled when no level is reviewed', () => {
    const choices = levelChoices(asLevels(level(LEVEL_A, 'Fixture level', 'candidate')));
    expect(choices.disabledReason).toBe(NO_REVIEWED_LEVELS);
  });

  it('is enabled and offers only reviewed levels when some exist', () => {
    const choices = levelChoices(asLevels(
      level(LEVEL_A, 'Fixture reviewed level', 'reviewed'),
      level(LEVEL_B, 'Fixture candidate level', 'candidate'),
    ));
    expect(choices).toEqual({ options: [{ id: LEVEL_A, label: 'Fixture reviewed level' }], disabledReason: null });
  });
});

describe('footprintDecisionPlan', () => {
  const base = { requestKey: '11111111-2222-4333-8444-555555555555', packageRevision: 2, areaRevision: 0 };
  const itemId = 'item';
  const accept: StagedDecision = {
    itemId, candidateId: 'abcdef123456', outcome: 'accepted', reason: 'Roof is complete',
  };
  const reject: StagedDecision = {
    itemId, candidateId: 'fedcba654321', outcome: 'rejected', reason: ' Clipped at the edge ',
  };

  it('refuses a rejection without an accepted candidate, as the API does', () => {
    const plan = footprintDecisionPlan({ ...base, decisions: [reject] });
    expect(plan).toEqual({ ok: false, reason: REJECTION_NEEDS_ACCEPTANCE });
  });

  it('builds the command K2c used: selections, rejections with reasons and the accepted reason', () => {
    const plan = footprintDecisionPlan({ ...base, decisions: [accept, reject] });
    expect(plan.ok && validate(FOOTPRINT_REQUEST, plan.body)).toEqual([]);
    expect(plan).toEqual({
      ok: true,
      body: {
        requestKey: base.requestKey,
        expectedRevision: 2,
        expectedAreaRevision: 0,
        georeference: 'source_geotiff',
        selections: [{ componentId: 'abcdef123456', subject: 'Roofprint abcdef12' }],
        rejected: [{ componentId: 'fedcba654321', reason: 'Clipped at the edge' }],
        reason: 'Roof is complete',
      },
    });
  });
});

describe('attachLevelBody', () => {
  it('is accepted by the published request schema', () => {
    const body = attachLevelBody({
      requestKey: '11111111-2222-4333-8444-555555555555',
      canonicalRevision: 'c'.repeat(64),
      candidateId: 'candidate-1',
      levelId: LEVEL_A,
      reason: ' Floor title matches ',
    });
    expect(validate(CANDIDATES_REQUEST, body)).toEqual([]);
    expect(body.reason).toBe('Floor title matches');
  });
});
