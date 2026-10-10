import { describe, expect, it } from 'vitest';
import controls from '../../../../../../docs/evidence/gf-agent/ui/f2b/responses.json';
import { columnRows, learnerTotals, mergeMetrics } from './model';
import type { ChunkMapping, Metrics, TableProfile } from './types';

const profile = controls.files[0]!.profile as TableProfile;
const mapping = controls.files[0]!.chunk.payload.mapping as ChunkMapping;

describe('table column presentation', () => {
  it('keeps positional headers, officer confidence and questions distinct', () => {
    const copy = structuredClone(mapping);
    const sources = ['officer', 'memory', 'student'] as const;
    copy.fieldSources.slice(0, 3).forEach((field, index) => { field.source = sources[index]!; });
    const rows = columnRows(profile, copy);
    expect(rows[0]!.header).toBe(profile.headers[0]);
    expect(rows[0]!.position).toBe(1);
    expect(rows[0]!.confidence).toBeNull();
    expect(rows[1]!.origin).toBe('memory');
    expect(rows[2]!.origin).toBe('student');
    expect(rows.find((row) => row.question)?.question?.reason).toBe(copy.questions[0]?.reason);
  });

  it('keeps the real duplicate headers as separate positional columns', () => {
    const duplicate = controls.duplicateProfile as TableProfile;
    const rows = columnRows(duplicate);
    expect(new Set(duplicate.headers).size).toBeLessThan(duplicate.headers.length);
    expect(rows.map((row) => row.header)).toEqual(duplicate.headers);
    expect(new Set(rows.map((row) => row.sourceField)).size).toBe(rows.length);
  });

  it('never invents a proposal or zero confidence before a chunk arrives', () => {
    expect(columnRows(profile).every((row) => row.target === 'unknown' && row.confidence === null)).toBe(true);
  });
});

describe('learner totals', () => {
  it('counts each published chunk once and preserves real zero teacher calls', () => {
    const first = mapping.metrics;
    const second = { ...first, chunkIndex: 1, memoryHits: 1, layout: 'memory' as const };
    const chunks = mergeMetrics([first, second], [mapping], first.jobId);
    expect(chunks).toHaveLength(2);
    expect(learnerTotals(chunks).teacherCalls).toBe(0);
    expect(learnerTotals(chunks).memoryHits).toBe(first.memoryHits + 1);
    expect(learnerTotals(chunks).needsInput).toBe(first.needsInput * 2);
    const other: Metrics = { ...first, jobId: 'another-job' };
    expect(mergeMetrics([other], [], first.jobId)).toEqual([]);
  });
});
