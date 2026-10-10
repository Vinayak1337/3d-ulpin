import { afterEach, expect, it, vi } from 'vitest';
import controls from '../../../../../../docs/evidence/gf-agent/ui/f2b/responses.json';
import { readRecipe } from './recipe-api';
import { initialAnswers, recipeBody } from './recipe';
import type { ChunkMapping, TableProfile } from './types';

afterEach(() => vi.restoreAllMocks());

it('a saved link cannot approve the recipe belonging to another source in the same case', async () => {
  const profile = controls.files[1]!.profile as TableProfile;
  const mapping = controls.files[1]!.chunk.payload.mapping as ChunkMapping;
  const answers = initialAnswers(profile, mapping);
  for (const column of profile.profile.columns) {
    answers[column.name] = { target: 'unknown', reason: 'Protocol scope control only.' };
  }
  const plan = recipeBody(profile, mapping, answers, controls.caseId, 0).plan;
  const receipt = { id: controls.caseId, revision: 1, state: 'proposed', plan, destination: null,
    planHash: profile.workspaceFingerprint, authoredBy: 'intercepted-local-operator',
    authoredAt: new Date().toISOString(), approval: null, execution: null };
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify([receipt]), {
    headers: { 'content-type': 'application/json' },
  }));
  await expect(readRecipe(controls.caseId, receipt.id, controls.files[0]!.profile.source.sourceId))
    .rejects.toThrow('does not belong');
});
