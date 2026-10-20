import type { Target } from '../../intake/run/model';

/**
 * What the inspector offers for a building's property card, from its intake target only: make it (recorded, no
 * card, in no confirmation), wait for it (listed in a confirmation), open it (carded), or say where the building
 * stands in its batch. A building no target names is `none`, and nothing is shown.
 */
export type CardState = 'none' | 'make' | 'making' | 'carded' | 'other';

export function cardState(target: Target | null | undefined): CardState {
  if (!target) return 'none';
  if (target.readiness === 'carded' && target.artefacts.card) return 'carded';
  if (target.readiness !== 'recorded') return 'other';
  return target.confirmationId ? 'making' : 'make';
}

/** The batch page of the case that holds the target, where every building of the batch is confirmed. */
export function batchPath(caseId: string): string {
  return `/studio/work/cases/${caseId}/intake`;
}

/**
 * A card this inspector watched being made (pressed here, or listed when it was picked) opens once it is made;
 * one already made opens only when asked. A press is watched until its target reads back as listed.
 */
export function followCard(watched: boolean, state: CardState): { watched: boolean; open: boolean } {
  if (state === 'making') return { watched: true, open: false };
  if (state === 'carded') return { watched: false, open: watched };
  return { watched: watched && state === 'make', open: false };
}
