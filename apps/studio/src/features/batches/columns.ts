export type BatchColumn = 'batch' | 'step' | 'waiting' | 'next' | 'updated';

export const COLUMN_HEADERS: Record<BatchColumn, string> = {
  batch: 'Batch', step: 'Step', waiting: 'Needs you', next: 'Next action', updated: 'Updated',
};

/** Progress and pending actions come from the batch-wide work queue summary. */
export const BATCH_COLUMNS: readonly BatchColumn[] = ['batch', 'step', 'waiting', 'next', 'updated'];
