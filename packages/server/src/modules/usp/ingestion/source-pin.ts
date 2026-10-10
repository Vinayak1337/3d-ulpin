import { fingerprint } from '../../cases/domain';

/** A reader pins its source, context and policies, not the case's edit counter.
 * All other fields must still match; a counter below the queued revision fails closed. */
export function compareSourcePins<Now extends { caseRevision: number }, Pinned extends { caseRevision: number }>(
  now: Now, pinned: Pinned,
) {
  const fields = new Set([...Object.keys(now), ...Object.keys(pinned)]);
  const moved = [...fields].filter(field => field !== 'caseRevision' && (
    Object.hasOwn(now, field) !== Object.hasOwn(pinned, field) ||
    fingerprint({ value: Reflect.get(now, field) }) !== fingerprint({ value: Reflect.get(pinned, field) })
  ));
  return {
    current: moved.length === 0 && now.caseRevision >= pinned.caseRevision,
    moved,
    caseRevisionAdvancedBy: now.caseRevision - pinned.caseRevision,
  };
}
