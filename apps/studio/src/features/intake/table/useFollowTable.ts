import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { tableFromOriginal, type TableFromOriginalBody } from './retain';
import type { TableJob } from './types';

export type Opened = { caseId: string; sourceId: string };
const FOLLOW_MS = 2000;

/** TP1, XW1: words for the server job reading a large CSV or workbook while Studio follows it. */
export function jobWords(job: TableJob, kind: 'CSV' | 'workbook') {
  if (job.status === 'queued') return `Reading the ${kind}: queued on the server.`;
  if (job.status === 'running') return `Reading the ${kind} on the server…`;
  return job.status === 'succeeded' ? 'Opening the table…' : null;
}

/** TP1: the server reads a large CSV in a job; the same request, sent again, answers that job until it ends. */
export async function followTable(caseId: string, sourceId: string, body: TableFromOriginalBody,
  seen: (job: TableJob) => void, stopped: () => void, signal: AbortSignal): Promise<Opened> {
  for (;;) {
    const answer = await tableFromOriginal(caseId, sourceId, body);
    if (answer.version !== 'table-profile/1') return { caseId, sourceId: answer.source.sourceId };
    seen(answer);
    if (answer.status === 'succeeded') return { caseId, sourceId };
    if (answer.status !== 'queued' && answer.status !== 'running') {
      const words = answer.message ?? 'Reading this table stopped.';
      stopped();
      throw new Error(answer.issueCode ? `${words} (${answer.issueCode})` : words);
    }
    await new Promise((resolve) => setTimeout(resolve, FOLLOW_MS));
    if (signal.aborted) throw new Error('This dialog stopped following the table read; it continues on the server.');
  }
}

export function tablePath(opened: Opened) {
  return `/studio/work/cases/${opened.caseId}/tables/${opened.sourceId}`;
}

/** One table read from a kept original, followed to its end; the import dialog and a batch item share it. `stopped`
 * runs when the server job ends without a table, so the next try sends a new request key. */
export function useFollowTable() {
  const navigate = useNavigate();
  const [job, setJob] = useState<TableJob | null>(null);
  const following = useRef(new AbortController());
  useEffect(() => {
    const controller = new AbortController();
    following.current = controller;
    return () => controller.abort();
  }, []);
  return {
    job,
    reset: () => setJob(null),
    follow: (caseId: string, sourceId: string, body: TableFromOriginalBody, stopped: () => void) =>
      followTable(caseId, sourceId, body, setJob, stopped, following.current.signal),
    open: (opened: Opened) => navigate(tablePath(opened), {
      state: { queueKeys: { raw: crypto.randomUUID(), mapping: crypto.randomUUID() } },
    }),
  };
}
