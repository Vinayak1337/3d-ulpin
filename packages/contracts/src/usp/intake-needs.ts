import type { z } from 'zod';
import type { IntakeItemSchema } from './intake';

type ContractItem = z.infer<typeof IntakeItemSchema>;
// Only fields these rules read: generated clients widen unrelated coordinate tuples to arrays.
type IntakeItem = Pick<ContractItem, 'itemId' | 'name' | 'sourceId' | 'parentItemId' | 'family' | 'state' | 'placement'
  | 'plan' | 'layoutQuestion' | 'limitReason' | 'layerCrs' | 'pageImage'> & {
  card: Pick<NonNullable<ContractItem['card']>, 'family' | 'format' | 'sheets'> | null;
};
type PageImageItem = Pick<IntakeItem, 'state'> & { pageImage: NonNullable<IntakeItem['pageImage']> };
export interface ItemTableSource { sourceId: string; format: 'csv' | 'xlsx' | 'ods'; sheets: string[] }
export type ItemPendingKind = { kind: 'layout' | 'page_image' | 'table_placement' | 'retry' }
  | { kind: 'layer_crs'; layer: string };
export type IntakeBatchStep = 'Files' | 'Reading' | 'Your answers' | 'Confirm' | 'Cards';
/** Table card formats a batch item is read from with "Open the table"; a TSV takes the delimited reader. */
export const INTAKE_TABLE_READER_FORMATS: readonly string[] = Object.freeze(['csv', 'tsv', 'xlsx', 'ods']);

export function needsLayoutAnswer(item: IntakeItem): boolean {
  return !item.plan && Boolean(item.sourceId) && item.placement === 'needs_answer' && item.layoutQuestion === true;
}

// The server's sentence for a large file stopped after repeated step errors; only this one can be tried again.
export const stoppedReason = 'Preparing this file stopped after repeated errors; '
  + 'the steps already done are kept. Nothing more was prepared from it.';

export function canRetryStopped(item: IntakeItem): boolean {
  return Boolean(item.sourceId) && item.placement === 'not_understood' && item.limitReason === stoppedReason;
}

export function isPageImage<T extends Pick<IntakeItem, 'pageImage'>>(item: T | null | undefined):
  item is T & { pageImage: NonNullable<IntakeItem['pageImage']> } {
  return Boolean(item?.pageImage);
}

/** The officer can answer only while the item rests read; the server refuses any other state. */
export function canAnswer(item: PageImageItem): boolean {
  return item.state === 'read';
}

/** The kept table original, or the parent workbook for one sheet. An unretained ZIP member is not offered. */
export function itemTableSource(item: IntakeItem, items: readonly IntakeItem[]): ItemTableSource | null {
  const card = item.card;
  if (card?.family !== 'table' || !INTAKE_TABLE_READER_FORMATS.includes(card.format)) return null;
  const parent = items.find(row => row.itemId === item.parentItemId);
  const sourceId = item.sourceId ?? (['xlsx', 'ods'].includes(parent?.card?.format ?? '') ? parent?.sourceId : null);
  // A TSV is read by the delimited reader, as a CSV is.
  return sourceId ? { sourceId, format: card.format === 'xlsx' || card.format === 'ods' ? card.format : 'csv',
    sheets: card.sheets.map(sheet => sheet.name) } : null;
}

/** Pending kinds only; labels, controls and focus targets belong to the caller. */
export function itemPendingKinds(item: IntakeItem, items: readonly IntakeItem[]): ItemPendingKind[] {
  const pending: ItemPendingKind[] = [];
  if (needsLayoutAnswer(item)) pending.push({ kind: 'layout' });
  for (const entry of item.layerCrs ?? []) {
    if (!entry.answer) pending.push({ kind: 'layer_crs', layer: entry.layer });
  }
  if (isPageImage(item) && canAnswer(item) && !item.pageImage.label) pending.push({ kind: 'page_image' });
  if (item.family === 'table' && item.placement === 'needs_answer' && itemTableSource(item, items)) {
    pending.push({ kind: 'table_placement' });
  }
  if (canRetryStopped(item)) pending.push({ kind: 'retry' });
  return pending;
}

export function isIntakeReading(item: IntakeItem): boolean {
  return ['received', 'probed', 'reading', 'preparing'].includes(item.state);
}

/** First unfinished step; answers include evidence, confirmations count eligible packages. */
export function batchStep({ items, answers, confirmations }: {
  items: readonly IntakeItem[]; answers: number; confirmations: number;
}): IntakeBatchStep {
  if (!items.length) return 'Files';
  if (items.some(isIntakeReading)) return 'Reading';
  if (answers) return 'Your answers';
  if (confirmations) return 'Confirm';
  return 'Cards';
}
