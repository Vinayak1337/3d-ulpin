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

/** A plan pins its own source; the workspace it was written in is a statement, compared only at the same revision. */
export function compareWorkspacePins(
  now: { workspaceRevision: number; workspaceFingerprint: string },
  pinned: { workspaceRevision: number; workspaceFingerprint: string },
) {
  const advancedBy = now.workspaceRevision - pinned.workspaceRevision;
  return {
    current: advancedBy > 0 || (advancedBy === 0 && now.workspaceFingerprint === pinned.workspaceFingerprint),
    advancedBy,
  };
}
