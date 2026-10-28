import { useRef, useState } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useBeforeUnload, useNavigate } from 'react-router';
import { batchCase, initialOutcomes, retainBatch, type FileOutcome } from './retain-batch';
import { keepWaiting, type WaitingFile } from './upload-model';

export const batchUploadKey = (caseId: string) => ['intake', caseId, 'retention'];
export interface BatchUpload {
  rows: FileOutcome[];
  pending: boolean;
  remaining: WaitingFile[];
  error: string | null;
}

/** Words and per-file commands live in the cache; the retain loop owns files while paused rows stay resumable. */
export function rememberBatchUpload(caseId: string, upload: BatchUpload) {
  const waiting = upload.rows.filter(row => row.state !== 'enrolled')
    .map(row => ({ name: row.name, sizeBytes: row.sizeBytes,
      words: row.upload?.phase === 'stopped' ? row.upload.words ?? row.message ?? null : row.message ?? null }));
  keepWaiting(() => sessionStorage, caseId, [...waiting, ...upload.remaining]);
}

async function runBatchUpload(client: QueryClient, caseId: string, files: File[], acquiredAt: string) {
  const update = (changes: Partial<BatchUpload>) => {
    const upload = client.setQueryData<BatchUpload>(batchUploadKey(caseId), prior => ({ ...prior!, ...changes }))!;
    rememberBatchUpload(caseId, upload);
  };
  try {
    await retainBatch(caseId, files, rows => update({ rows }), { acquiredAt });
  } catch (failure) {
    update({ error: failure instanceof Error ? failure.message : 'The batch could not be retained.' });
  } finally {
    update({ pending: false });
  }
}

export function useRetainBatch(files: File[], remainingFiles: File[], mode: 'existing' | 'create',
  caseId: string, name: string, onClose: () => void, routed: boolean) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const rows = initialOutcomes(files);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const created = useRef('');
  const inFlight = useRef(false);
  const acquiredAt = useRef(new Date().toISOString());
  useBeforeUnload(event => {
    if (!inFlight.current) return;
    event.preventDefault();
    event.returnValue = '';
  });
  const retain = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const id = created.current || await batchCase(mode, caseId.trim(), name);
      created.current = id;
      if (client.getQueryData<BatchUpload>(batchUploadKey(id))?.pending)
        throw new Error('This batch is already uploading files. Wait for them to finish before adding more.');
      client.setQueryData<BatchUpload>(batchUploadKey(id), { rows, pending: true, error: null,
        remaining: remainingFiles.map(file => ({ name: file.name, sizeBytes: file.size, words: null })) });
      inFlight.current = false;
      if (!routed) onClose();
      navigate(`/studio/work/cases/${id}/intake`, { replace: routed, state: { remainingFiles } });
      void runBatchUpload(client, id, files, acquiredAt.current);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The batch could not be opened.');
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };
  return { rows, pending, error, retain,
    created: Boolean(created.current),
    clearCreated: () => { created.current = ''; } };
}
