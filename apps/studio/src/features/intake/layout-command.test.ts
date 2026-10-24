import { ApiError } from '@ulpin/api-client';
import { expect, it, vi } from 'vitest';
import captured from '../../../../../docs/evidence/gf1/lq1a/controls-second.json';
import { createLayoutCommand, type LayoutCommandState } from './layout-command';
import { blankChoices, questionBody, type MapProfile } from './question-model';
import type { Recipe } from './layout-model';

const profile = captured.profile as MapProfile;
const receipt = captured.authored as Recipe;
const body = questionBody(profile, { ...blankChoices, kind: 'building',
  identifier: '/features/*/properties/doitt_id' }, 0, captured.authorBody.requestKey)!;

it('authors once then approves the returned revision; a known approval failure leaves a proposed receipt', async () => {
  const states: LayoutCommandState[] = [];
  const author = vi.fn(async () => receipt);
  const approve = vi.fn(async () => {
    throw new ApiError(422, '', { error: { code: 'TEST', message: 'Refused approval.' } });
  });
  const command = createLayoutCommand({ author, approve }, state => states.push(state), vi.fn(), () => 'approval-key');
  await command.use(body);
  expect(author).toHaveBeenCalledTimes(1);
  expect(approve).toHaveBeenCalledWith(receipt, { requestKey: 'approval-key', expectedRecipeRevision: 1 });
  expect(states.at(-1)).toMatchObject({ receipt, phase: 'approve', error: 'Refused approval.', uncertain: false });
  await command.approve(receipt);
  expect(author).toHaveBeenCalledTimes(1);
});

it('lost/5xx author resends the frozen original body/key even if the caller changes choices', async () => {
  const author = vi.fn().mockRejectedValueOnce(new TypeError('Connection lost')).mockResolvedValue(receipt);
  const approve = vi.fn(async () => ({ ...receipt, state: 'approved' as const, revision: 2 }));
  const changed = vi.fn();
  const command = createLayoutCommand({ author, approve }, changed, vi.fn(), () => 'approval-key');
  await command.use(body);
  expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ uncertain: true, phase: 'author' }));
  await command.use({ ...body, requestKey: 'different-key', expectedRecipeRevision: 5 });
  expect(author.mock.calls.map(call => call[0])).toEqual([body, body]);
  expect(approve).toHaveBeenCalledTimes(1);
});

it('uncertain approval resends its same key and receipt without authoring again', async () => {
  const author = vi.fn(async () => receipt);
  const approve = vi.fn().mockRejectedValueOnce(new ApiError(503, '', { message: 'Service unavailable.' }))
    .mockResolvedValue({ ...receipt, revision: 2, state: 'approved' });
  const changed = vi.fn();
  const command = createLayoutCommand({ author, approve }, changed, vi.fn(), () => 'same-key');
  await command.use(body);
  expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({
    uncertain: true, receipt, phase: 'approve',
  }));
  await command.approve(receipt);
  expect(author).toHaveBeenCalledTimes(1);
  expect(approve.mock.calls.map(call => call[1])).toEqual([
    { requestKey: 'same-key', expectedRecipeRevision: 1 }, { requestKey: 'same-key', expectedRecipeRevision: 1 },
  ]);
});

it('a 409 clears pending input and asks for current records; 422 identity words remain beside that choice', async () => {
  const refresh = vi.fn();
  const changed = vi.fn();
  const author = vi.fn().mockRejectedValueOnce(new ApiError(409, '', { message: 'Recipe changed.' }))
    .mockRejectedValueOnce(new ApiError(422, '', { error: { code: 'MAPPING_IDENTITY',
      message: 'Source identity must be complete, unique, nonempty literal text.' } }));
  const command = createLayoutCommand({ author, approve: vi.fn() }, changed, refresh);
  await command.use(body);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ changed: true, uncertain: false, receipt: null }));
  await command.use({ ...body, expectedRecipeRevision: 8 });
  expect(author.mock.calls[1]?.[0].expectedRecipeRevision).toBe(8);
  expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ concern: 'identifier',
    error: 'Source identity must be complete, unique, nonempty literal text.' }));
});
