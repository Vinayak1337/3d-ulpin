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
    expect(reduceFrame(next, '1000001', frame('1', metric), sourceId)).toBe(next);
  });

  it('a failed job refreshes its authoritative status without inventing a reason', () => {
    const next = reduceFrame(initialStream(), '17', frame('2', {
      kind: 'chunk-mapping.changed', sourceId, jobId, status: 'failed',
    }), sourceId);
    expect(next.mappingJobId).toBe(jobId);
    expect(next.refresh).toBe(1);
    expect(next.metrics).toEqual([]);
  });

  it('ignores jobs for another source but retains the case resume position', () => {
    const next = reduceFrame(initialStream(), '18', frame('3', {
      kind: 'streaming-vector.changed', sourceId: 'other-source', jobId, status: 'running',
    }), sourceId);
    expect(next.rawJobId).toBe('');
    expect(next.cursor).toBe('18');
  });
});
