import { describe, expect, it } from 'vitest';
import { COLUMN_HEADERS, batchColumns } from './columns';

describe('the columns of Batches', () => {
  it('draws Stage and Readiness when the work-board read has answered', () => {
    const headers = batchColumns({ items: [], counts: [] }).map((column) => COLUMN_HEADERS[column]);
    expect(headers).toEqual(['Batch', 'Stage', 'Next action', 'Readiness', 'Updated']);
  });

  it('draws neither when the server does not serve the work board, nor before it answers', () => {
    const queueOnly = ['Batch', 'Next action', 'Updated'];
    expect(batchColumns(null).map((column) => COLUMN_HEADERS[column])).toEqual(queueOnly);
    expect(batchColumns(undefined).map((column) => COLUMN_HEADERS[column])).toEqual(queueOnly);
  });
});
