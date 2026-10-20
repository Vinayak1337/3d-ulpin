import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { ApiError } from '@ulpin/api-client';
import { createUploadCommand } from '../upload-command';
import { uploadTransport } from '../upload-api';
import type { UploadProgress } from '../upload-model';
import { createSourceCase, readSourceCase, retainForm, retainTable, streamedImport, tableFromOriginal,
  tableSelection, type TableFromOriginalBody } from './retain';
import type { TableJob } from './types';

type Upload = ReturnType<typeof createUploadCommand>;
type Kept = { current: { caseId: string; sourceId: string; body: TableFromOriginalBody | null } | null };
type Opened = { caseId: string; sourceId: string };
const FOLLOW_MS = 2000;

/** TP1: the server reads a large CSV in a job; the same request, sent again, answers that job until it ends. */
async function followTable(caseId: string, sourceId: string, body: TableFromOriginalBody,
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

/** The original is uploaded once per case; a retry after that only asks the server to read it again, and a read
 * that stopped is asked for again with a new request key. */
async function streamedTable(file: File, caseId: string, selection: TableFromOriginalBody['selection'], kept: Kept,
  started: (command: Upload | null) => void, publish: (progress: UploadProgress) => void,
  seen: (job: TableJob) => void, signal: AbortSignal) {
  if (kept.current?.caseId !== caseId) {
    const command = createUploadCommand({ file, acquiredAt: new Date().toISOString(),
      transport: uploadTransport(caseId), publish });
    started(command);
    const sourceId = await command.run().finally(() => started(null));
    if (!sourceId) throw new Error('The upload was cancelled; nothing was imported.');
    kept.current = { caseId, sourceId, body: null };
  }
  const current = kept.current;
  const body = current.body ??= { requestKey: crypto.randomUUID(),
    expectedWorkspaceRevision: (await readSourceCase(caseId)).revision, selection };
  return followTable(caseId, current.sourceId, body, seen, () => { current.body = null; }, signal);
}

export function useRetainTable(file: File, caseId: string, name: string, mode: 'existing' | 'create',
  sheet: string, rows: string) {
  const navigate = useNavigate();
  const created = useRef<string | null>(null);
  const attempt = useRef<{ signature: string; caseId: string; body: FormData } | null>(null);
  const kept = useRef<Kept['current']>(null);
  const command = useRef<Upload | null>(null);
  const [upload, setUpload] = useState<UploadProgress | null>(null);
  const [job, setJob] = useState<TableJob | null>(null);
  const following = useRef(new AbortController());
  useEffect(() => {
    const controller = new AbortController();
    following.current = controller;
    return () => controller.abort();
  }, []);
  const retain = useMutation({
    mutationFn: async () => {
      const selection = tableSelection(file, sheet, rows);
      let id = caseId;
      if (mode === 'create') {
        if (!created.current) created.current = (await createSourceCase(name)).id;
        id = created.current;
      }
      if (streamedImport(file)) {
        setJob(null);
        return streamedTable(file, id, selection, kept, (value) => { command.current = value; }, setUpload, setJob,
          following.current.signal);
      }
      const signature = JSON.stringify({ id, selection });
      if (!attempt.current || attempt.current.signature !== signature) {
        const sourceCase = await readSourceCase(id);
        const body = retainForm(file, selection, sourceCase.revision, crypto.randomUUID());
        attempt.current = { signature, caseId: id, body };
      }
      // Network/busy retries replay exactly the same pins and key, even if retention already committed.
      const profile = await retainTable(attempt.current.caseId, attempt.current.body);
      return { caseId: profile.caseId, sourceId: profile.source.sourceId };
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        attempt.current = null;
        if (kept.current) kept.current.body = null;
      }
    },
    onSuccess: (opened: Opened) => navigate(`/studio/work/cases/${opened.caseId}/tables/${opened.sourceId}`, {
      state: { queueKeys: { raw: crypto.randomUUID(), mapping: crypto.randomUUID() } },
    }),
  });
  return { retain, created: Boolean(created.current), clearCreated: () => { created.current = null; },
    upload, retryUpload: () => command.current?.retry(), job };
}
