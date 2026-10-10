export type BatchColumn = 'batch' | 'stage' | 'next' | 'readiness' | 'updated';

export const COLUMN_HEADERS: Record<BatchColumn, string> = {
  batch: 'Batch', stage: 'Stage', next: 'Next action', readiness: 'Readiness', updated: 'Updated',
};

const BOARD_COLUMNS: readonly BatchColumn[] = ['batch', 'stage', 'next', 'readiness', 'updated'];
const QUEUE_COLUMNS: readonly BatchColumn[] = ['batch', 'next', 'updated'];

/**
 * The columns of Batches for the read that feeds them. Stage and readiness are stated by the work board only,
 * so they are drawn when that read has answered. While it has not, or when the server does not serve it (the
 * read answers null), the rows come from the work queue alone, which holds neither: no column, not an empty one.
 */
export function batchColumns(board: object | null | undefined): readonly BatchColumn[] {
  return board ? BOARD_COLUMNS : QUEUE_COLUMNS;
}
