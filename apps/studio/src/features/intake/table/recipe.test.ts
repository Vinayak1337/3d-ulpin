import { describe, expect, it } from 'vitest';
import controls from '../../../../../../docs/evidence/gf-agent/ui/f2b/responses.json';
import { initialAnswers, recipeBody, targetOptions, unansweredColumns } from './recipe';
import type { ChunkMapping, TableProfile } from './types';

const profile = controls.files[0]!.profile as TableProfile;
const mapping = controls.files[0]!.chunk.payload.mapping as ChunkMapping;
const reason = 'Software protocol control only; preserve as unknown, not a property fact or learning truth.';

describe('officer recipe body', () => {
  it('requires an explicit target and a reason for every column, including unknown', () => {
    const answers = initialAnswers(profile, mapping);
    expect(unansweredColumns(profile, answers)).toHaveLength(profile.headers.length);
    expect(() => recipeBody(profile, mapping, answers, 'request-key', 0)).toThrow('every column');
    for (const column of profile.profile.columns) answers[column.name] = { target: 'unknown', reason: ' ' };
    expect(unansweredColumns(profile, answers)).toHaveLength(profile.headers.length);
  });

  it('authors all decisions in source-column order with no registry destination', () => {
    const answers = initialAnswers(profile, mapping);
    for (const column of [...profile.profile.columns].reverse()) {
      answers[column.name] = { target: 'unknown', reason };
    }
    const body = recipeBody(profile, mapping, answers, controls.caseId, 0);
    expect(body.destination).toBeNull();
    expect(body.plan.version).toBe('manual-tabular/1');
    expect(body.plan.mapping.fields.map((field) => field.sourceField))
      .toEqual(profile.profile.columns.map((column) => column.name));
    expect(body.plan.decisions.map((decision) => decision.reason)).toEqual(profile.headers.map(() => reason));
    expect(body.plan.source).toEqual(profile.source);
    expect(body.plan.tabular.selection.table).toBeNull();
  });

  it('lists candidate targets first and always offers unknown without duplicating targets', () => {
    const options = targetOptions(['building.name', 'building.name']);
    expect(options.first).toEqual(['building.name']);
    expect(options.all).toContain('unknown');
    expect(options.all).not.toContain('building.name');
  });
});
