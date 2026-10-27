import { describe, expect, it } from 'vitest';
import { BATCH_COLUMNS, COLUMN_HEADERS } from './columns';

describe('the columns of Batches', () => {
  it('draws the batch summary beside the existing name, next action and time', () => {
    expect(BATCH_COLUMNS.map((column) => COLUMN_HEADERS[column]))
      .toEqual(['Batch', 'Step', 'Needs you', 'Next action', 'Updated']);
  });
});
