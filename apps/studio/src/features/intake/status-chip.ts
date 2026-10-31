import { itemPendingKinds, stoppedReason } from '@ulpin/contracts/usp/plain';
import type { WorkItem } from '../../api/queries';
import { isSettled, type IntakeItem } from './batch-model';

export type ChipState = 'reading' | 'needs_you' | 'ready' | 'kept_only' | 'stopped';
export interface Chip { state: ChipState; percent: number | null }
type IntakeSummary = NonNullable<WorkItem['intakeSummary']>;

/** One file's chip, from the facts it carries; what waits on the officer is the contract's one rule. */
export function itemChip(item: IntakeItem, items: readonly IntakeItem[]): Chip {
  const chip = (state: ChipState, percent: number | null = null) => ({ state, percent });
  if (item.placement === 'not_understood' && item.limitReason === stoppedReason) return chip('stopped');
  if (itemPendingKinds(item, items).length) return chip('needs_you');
  if (!isSettled(item)) return chip('reading', partsPercent(item));
  const placed = item.placement === 'on_map' || item.placement === 'attached';
  return chip(placed || item.plan?.packageId ? 'ready' : 'kept_only');
}

/** Published parts over planned parts, only when the planned count is known. */
function partsPercent({ partsPlanned, partsDone }: Pick<IntakeItem, 'partsPlanned' | 'partsDone'>) {
  return partsPlanned ? Math.min(100, Math.floor((partsDone / partsPlanned) * 100)) : null;
}

/** A batch's chip from its work-queue summary; a step that is no chip state keeps its text (null). */
export function batchChip(summary: IntakeSummary): Chip | null {
  if (summary.waiting > 0) return { state: 'needs_you', percent: null };
  if (summary.step === 'Reading') return { state: 'reading', percent: null };
  if (summary.step === 'Cards') return { state: 'ready', percent: null };
  return null;
}
