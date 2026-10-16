import { describe, expect, it } from 'vitest';
import { BATCH_COLUMNS, COLUMN_HEADERS } from './columns';

describe('the columns of Batches', () => {
  it('draws batch, next action and time, the columns the work queue states', () => {
    expect(BATCH_COLUMNS.map((column) => COLUMN_HEADERS[column])).toEqual(['Batch', 'Next action', 'Updated']);
  });
});
