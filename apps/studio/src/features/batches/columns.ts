export type BatchColumn = 'batch' | 'next' | 'updated';

export const COLUMN_HEADERS: Record<BatchColumn, string> = {
  batch: 'Batch', next: 'Next action', updated: 'Updated',
};

/** The columns of Batches. The work queue states neither stage nor readiness, so neither has a column. */
export const BATCH_COLUMNS: readonly BatchColumn[] = ['batch', 'next', 'updated'];
