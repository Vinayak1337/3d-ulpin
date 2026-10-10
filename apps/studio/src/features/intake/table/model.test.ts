import { describe, expect, it } from 'vitest';
import controls from '../../../../../../docs/evidence/gf-agent/ui/f2b/responses.json';
import fresh from '../../../../../../docs/evidence/gf1/ui/f3a/table-responses.json';
import { columnRows, learnerTotals, mergeMetrics, reviewControls, reviewMapping, staleReasons } from './model';
import type { ChunkMapping, Freshness, Metrics, TableProfile } from './types';

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

describe('review across chunks', () => {
  function chunk(chunkIndex: number, questions: ChunkMapping['questions']) {
    const copy = structuredClone(mapping);
    copy.metrics.chunkIndex = chunkIndex;
    copy.questions = structuredClone(questions);
    return copy;
  }

  it('keeps questions asked only in the first chunk and takes the plan from the latest', () => {
    const latest = chunk(2, []);
    latest.fieldSources[0]!.source = 'memory';
    const review = reviewMapping([latest, chunk(0, mapping.questions), chunk(1, [])])!;
    expect(review.questions).toEqual(mapping.questions);
    expect(review.fieldSources).toEqual(latest.fieldSources);
    expect(review.plan).toEqual(latest.plan);
    expect(columnRows(profile, review).filter((row) => row.question)).toHaveLength(mapping.questions.length);
  });

  it('reads the same review from a server that repeats questions; the first occurrence wins', () => {
    const repeated = chunk(1, mapping.questions);
    repeated.questions[0]!.reason = 'A later wording of the same question.';
    const review = reviewMapping([chunk(0, mapping.questions), repeated, chunk(2, mapping.questions)])!;
    expect(review.questions).toEqual(mapping.questions);
    expect(reviewMapping([])).toBeUndefined();
  });
});

describe('result freshness', () => {
  function responsesOf(file: object) {
    const { raw, mapping: job, chunk } = file as Record<'raw' | 'mapping' | 'chunk', Freshness>;
    return [raw, job, chunk];
  }

  it('a stale result names its reasons and hides approve; a current result shows it', () => {
    const stale = staleReasons(responsesOf(fresh.stale));
    expect(stale).toEqual(['case advanced']);
    expect(reviewControls(Boolean(stale), 'proposed', false)).toEqual({ approve: false, sharedReason: false });
    const current = staleReasons([...responsesOf(fresh.files[0]!), undefined]);
    expect(current).toBeNull();
    expect(reviewControls(Boolean(current), 'proposed', false)).toEqual({ approve: true, sharedReason: true });
    expect(reviewControls(false, 'proposed', true).approve).toBe(false);
  });

  it('reports one stale chunk among current responses, each reason once', () => {
    const chunk: Freshness = { current: false, reasons: ['reader_changed', 'source_superseded'] };
    expect(staleReasons([...responsesOf(fresh.files[0]!), chunk, chunk]))
      .toEqual(['reader changed', 'source superseded']);
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
