import { describe, expect, it } from 'vitest';
import { ApiError } from '@ulpin/api-client';
import { caseQueueRow, caseTables, noTableSentence, unreadCase } from './caseEntry';

// Shape-only sources: every value below is a structural placeholder for the rule under test, not a record.
const source = (id: string, profile: string, createdAt: string) => ({ id, name: `${id}.file`, profile, createdAt });
const table = (id: string, createdAt: string) => source(id, 'tabular-manual-v1', createdAt);

describe('where Continue import leads', () => {
  it('opens the table page of a case whose read lists one table source', () => {
    const sources = [source('s1', 'pdf-reference-v2', '2026-10-01T00:00:00Z'), table('s2', '2026-10-02T00:00:00Z')];
    expect(caseTables('c1', sources).map((entry) => entry.href)).toEqual(['/studio/work/cases/c1/tables/s2']);
  });

  it('lists every table of a case that holds several, newest first', () => {
    const sources = [table('old', '2026-10-01T00:00:00Z'), table('new', '2026-10-03T00:00:00Z')];
    expect(caseTables('c1', sources).map((entry) => entry.sourceId)).toEqual(['new', 'old']);
  });

  it('gives no table page for a case without a table source', () => {
    expect(caseTables('c1', [source('s1', 'geotiff-raster-v1', '2026-10-01T00:00:00Z')])).toEqual([]);
    expect(caseTables('c1', [])).toEqual([]);
  });
});

describe('opening a case from a filtered queue', () => {
  it('keeps that row when the unfiltered first page omits it, without using another case row', () => {
    type Row = NonNullable<ReturnType<typeof caseQueueRow>>;
    const opened = { id: 'c1', kind: 'case', tableSourceIds: ['s1'] } as Row;
    expect(caseQueueRow('c1', [], opened)).toBe(opened);
    expect(caseQueueRow('c2', [], opened)).toBeUndefined();
    const fresh = { ...opened, tableSourceIds: [] };
    expect(caseQueueRow('c1', [fresh], opened)).toBe(fresh);
  });
});

describe('the case row lists its own tables', () => {
  const sources = [table('old', '2026-10-01T00:00:00Z'), table('new', '2026-10-03T00:00:00Z')];

  it('keeps the case-source fallback when the row field is absent', () => {
    expect(caseTables('c1', sources, {}).map((entry) => entry.sourceId)).toEqual(['new', 'old']);
  });

  it('an empty list opens none even when the source read lists tables', () => {
    expect(caseTables('c1', sources, { tableSourceIds: [] })).toEqual([]);
  });

  it('opens the one id the row states, not another table in the case read', () => {
    expect(caseTables('c1', sources, { tableSourceIds: ['old'] }).map((entry) => entry.href))
      .toEqual(['/studio/work/cases/c1/tables/old']);
  });

  it('keeps all five ids in the order stated, including ids whose metadata is not in the case read', () => {
    const ids = ['new', 'id-three', 'old', 'id-two', 'id-one'];
    const tables = caseTables('c1', sources, { tableSourceIds: ids });
    expect(tables.map((entry) => entry.sourceId)).toEqual(ids);
    expect(tables.map((entry) => entry.href)).toEqual(ids.map((id) => `/studio/work/cases/c1/tables/${id}`));
    expect(tables[1]).toMatchObject({ name: 'id-three', retainedAt: null });
  });
});

describe('a case without a table', () => {
  it('says how many sources the case holds and that only a table has an import page', () => {
    const only = 'Only a retained table has an import page in the Studio.';
    expect(noTableSentence(0)).toBe(`This case holds no retained source. ${only}`);
    expect(noTableSentence(1)).toBe(`This case holds 1 retained source and no table. ${only}`);
    expect(noTableSentence(22)).toBe(`This case holds 22 retained sources and no table. ${only}`);
  });
});

describe('a case read that failed', () => {
  const failure = (status: number, code?: string) => new ApiError(status, '/api/v1/cases/c1', {
    error: { code, message: 'Server text that is never shown.', requestId: 'r1' },
  });

  it('says that no case is held for NOT_FOUND and gives any other code, never the message', () => {
    expect(unreadCase(failure(404, 'NOT_FOUND'))).toBe('The server holds no case at this address.');
    expect(unreadCase(failure(409, 'STALE_REVISION'))).toBe('The server did not read this case out · STALE_REVISION');
    expect(unreadCase(new Error('offline'))).toBe('The server did not read this case out.');
  });
});
