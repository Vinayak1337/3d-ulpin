import { describe, expect, it } from 'vitest';
import type { WorkItem } from '../../api/queries';
import { nextAction } from './nextAction';

// Shape-only rows: every value below is a structural placeholder for the rule under test, not a record.
const row = (patch: Partial<WorkItem>): WorkItem => ({
  id: 'id', kind: 'case', name: 'name', areaId: null, areaName: null, dataKind: null, buildingId: null, sourceCount: 0,
  updatedAt: '2026-09-26T00:00:00Z', state: null, jobStatus: null, recordedHistory: false, currentRecorded: false,
  provenance: { classification: 'unknown', basis: 'legacy_default' }, ...patch,
});

describe('nextAction', () => {
  it('waits while a job is processing', () => {
    expect(nextAction(row({ jobStatus: 'running' }))).toMatchObject({ label: 'Processing', href: null });
  });
  it('sends failed jobs to the failed step before anything else', () => {
    expect(nextAction(row({ jobStatus: 'failed', kind: 'import', state: 'READY_FOR_REVIEW' })).label).toBe('Review failed step');
  });
  it('maps import states to one action each', () => {
    expect(nextAction(row({ kind: 'import', state: 'NEEDS_INPUT' })).label).toBe('Answer questions');
    expect(nextAction(row({ kind: 'import', state: 'COMMITTED', areaId: 'a' })).href).toBe('/studio/areas/a');
  });
  it('sends Continue import to the case page, which reads the case and opens its table', () => {
    expect(nextAction(row({ id: 'c1' }))).toMatchObject({ label: 'Continue import', href: '/studio/cases/c1' });
  });
  it('opens the register only for a currently recorded building', () => {
    expect(nextAction(row({ buildingId: 'b', currentRecorded: true })).href).toBe('/studio/properties/b/register');
    expect(nextAction(row({ buildingId: 'b', recordedHistory: true })).label).toBe('Review changes');
  });
});
