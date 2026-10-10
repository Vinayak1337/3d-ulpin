import { describe, expect, it } from 'vitest';
import controls from '../../../../../../docs/evidence/gf-agent/ui/f2b/responses.json';
import { initialStream, reduceFrame } from './events';

const sourceId = controls.files[0]!.profile.source.sourceId;
const jobId = controls.files[0]!.mapping.jobId;
const metric = controls.files[0]!.chunk.payload.mapping.metrics;
const frame = (sequence: string, change: unknown) => ({ sequence, change });

describe('case ingestion reducer', () => {
  it('resumes by the bound event id and ignores duplicate and older frames', () => {
    const ready = reduceFrame(initialStream(), '1000001', { kind: 'ready' }, sourceId);
    expect(ready.cursor).toBe('1000001');
    const next = reduceFrame(ready, '1000002', frame('1', metric), sourceId);
    expect(next.metrics).toHaveLength(1);
    expect(next.cursor).toBe('1000002');
    expect(reduceFrame(next, '1000002', frame('1', metric), sourceId)).toBe(next);
    expect(reduceFrame(next, '1000002', frame('2', metric), sourceId)).toBe(next);
    expect(reduceFrame(next, '1000001', frame('1', metric), sourceId)).toBe(next);
  });

  it('accepts the unanswered count on a live chunk event, and refuses a bad one', () => {
    const counted = { ...metric, unansweredFields: 3 };
    const next = reduceFrame(initialStream(), '5', frame('1', counted), sourceId);
    expect(next.metrics[0]!.unansweredFields).toBe(3);
    expect(() => reduceFrame(initialStream(), '5', frame('1', { ...metric, unansweredFields: -1 }), sourceId))
      .toThrow('learner frame');
    const old = reduceFrame(initialStream(), '5', frame('1', metric), sourceId);
    expect(old.metrics[0]!.unansweredFields).toBeUndefined();
  });

  it('a failed job refreshes its authoritative status without inventing a reason', () => {
    const next = reduceFrame(initialStream(), '17', frame('2', {
      kind: 'chunk-mapping.changed', sourceId, jobId, status: 'failed',
    }), sourceId);
    expect(next.mappingJobId).toBe(jobId);
    expect(next.refresh).toBe(1);
    expect(next.metrics).toEqual([]);
  });

  it('replay keeps the explicitly selected historical job until approval releases the pin', () => {
    const seed = initialStream('', jobId);
    const change = { kind: 'chunk-mapping.changed', sourceId, jobId: 'new-job', status: 'queued' };
    const pinned = reduceFrame(seed, '19', frame('4', change), sourceId, { mappingJobId: jobId });
    expect(pinned.mappingJobId).toBe(jobId);
    expect(reduceFrame(pinned, '20', frame('5', change), sourceId).mappingJobId).toBe('new-job');
  });

  it('ignores jobs for another source but retains the case resume position', () => {
    const next = reduceFrame(initialStream(), '18', frame('3', {
      kind: 'streaming-vector.changed', sourceId: 'other-source', jobId, status: 'running',
    }), sourceId);
    expect(next.rawJobId).toBe('');
    expect(next.cursor).toBe('18');
  });
});
