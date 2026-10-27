import type { RequestContext } from '@ulpin/contracts/usp';
import type { PacketPlanInput } from '../../../../../contracts/src/usp/packets';
import { transaction } from '../../../infrastructure/db';
import { scopedManifestTx } from '../commands';
import { fingerprint } from '../../cases/domain';
import { equalPin } from '../declarations/authority';
import { readSelectedDeclaration } from '../declarations/service';

export type SharedAuthority = Map<string, Awaited<ReturnType<typeof readSelectedDeclaration>>>;
export const sharedKey = (input: PacketPlanInput, selection: PacketPlanInput['entries'][number]) =>
  fingerprint([input.scope, input.target, selection.review]);
/** Read-only accepted reader uses its own transactions. Release the mutation client/locks
 * before loading it, so concurrent plans cannot exhaust the pool while holding the recording mutex.
 * The final mutation rechecks all contributing pins on its one client. */
export class SharedAuthorityNeeded extends Error {
  constructor(readonly input: PacketPlanInput) { super('Load the existing accepted shared authority before final mutation.'); }
}
export async function prepareSharedAuthority(ctx: RequestContext, input: PacketPlanInput) {
  const result: SharedAuthority = new Map();
  const manifest = await transaction(client => scopedManifestTx(client, ctx, input.scope));
  if (input.purpose !== 'declared_share') return result;
  for (const selection of input.entries) {
    const review = selection.review;
    if (review.kind !== 'shared' || !review.validAt || !manifest.members.some(m => equalPin(m.pin, review.declaration))) continue;
    const key = sharedKey(input, selection);
    if (!result.has(key)) result.set(key, await readSelectedDeclaration(ctx, {
      scope: input.scope, target: input.target, declaration: review.declaration, validAt: review.validAt,
    }));
  }
  return result;
}
