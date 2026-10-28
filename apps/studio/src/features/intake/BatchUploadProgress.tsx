import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useBeforeUnload, useBlocker } from 'react-router';
import { Banner, Button } from '@ulpin/ui';
import { DropOutcomes } from './IntakeDropDialog';
import { UnfinishedUploads } from './UnfinishedUploads';
import { batchUploadKey, rememberBatchUpload, type BatchUpload } from './useRetainBatch';
import type { UploadEntry } from './upload-model';
import type { FileOutcome } from './retain-batch';
import styles from './Batch.module.css';

export function BatchUploadProgress({ caseId, refresh, settled }: {
  caseId: string;
  refresh: () => void;
  settled: (entry: UploadEntry) => void;
}) {
  const { data: upload } = useQuery<BatchUpload | null>({ queryKey: batchUploadKey(caseId),
    queryFn: () => null, enabled: false });
  const [error, setError] = useState('');
  const completed = upload?.rows.filter(row => row.state !== 'waiting' && row.state !== 'retaining').length ?? 0;
  const previous = useRef(0);
  useUploadNavigation(caseId, upload);
  useEffect(() => {
    if (completed === previous.current) return;
    previous.current = completed;
    refresh();
  }, [completed, refresh]);
  const cancel = async (row: FileOutcome) => {
    setError('');
    try { await row.command?.cancel(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'The server did not answer.'); }
  };
  return <>
    {upload ? <UploadOutcomes upload={upload} cancel={cancel} error={error} /> : null}
    {upload?.pending ? null : <UnfinishedUploads caseId={caseId} refresh={refresh} settled={settled} />}
  </>;
}

function uploadStatus(upload: BatchUpload) {
  if (!upload.pending) return 'This drop has finished.';
  let current = upload.rows.findIndex(row => row.state === 'retaining' && row.upload?.phase !== 'stopped');
  if (current < 0) current = upload.rows.findIndex(row => row.state === 'retaining');
  if (current < 0) return 'Waiting to send the first file.';
  return `File ${current + 1} of ${upload.rows.length}: ${upload.rows[current]!.name}`;
}

function UploadOutcomes({ upload, cancel, error }: {
  upload: BatchUpload;
  cancel: (row: FileOutcome) => Promise<void>;
  error: string;
}) {
  const rows = upload.rows.filter(row => row.state !== 'enrolled');
  if (!rows.length && !upload.pending) return null;
  const stopped = rows.filter(row => row.state === 'retaining' && row.upload?.phase === 'stopped');
  return <section className={styles.stack} aria-label="Files being retained"
    data-upload-phases={rows.map(row => row.upload?.phase ?? row.state).join(' ')}>
    <h2 className="ul-heading">{upload.pending ? 'Retaining files' : 'Upload outcomes'}</h2>
    <p role="status">{uploadStatus(upload)}</p>
    <DropOutcomes rows={rows} />
    {stopped.map(row => <div className="ul-row" key={rows.indexOf(row)}>
      <Button aria-label={`Resume ${row.name}`} onClick={() => row.command?.retry()}>Try again</Button>
      <Button variant="soft" aria-label={`Cancel upload of ${row.name}`} onClick={() => void cancel(row)}>
        Cancel upload
      </Button>
    </div>)}
    {upload.error || error ? <Banner tone="danger">{upload.error || error}</Banner> : null}
  </section>;
}

function useUploadNavigation(caseId: string, upload: BatchUpload | null | undefined) {
  useEffect(() => {
    let current = true;
    // The parent first saves navigation words; then save the live queue, including files not started yet.
    queueMicrotask(() => {
      if (current && upload) rememberBatchUpload(caseId, upload);
    });
    return () => { current = false; };
  }, [caseId, upload]);
  useBeforeUnload(event => {
    if (!upload?.pending) return;
    rememberBatchUpload(caseId, upload);
    event.preventDefault();
    event.returnValue = '';
  });
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    Boolean(upload?.pending) && nextLocation.pathname !== currentLocation.pathname);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    const { pathname, search, hash } = blocker.location;
    blocker.reset();
    // A document navigation preserves the browser's leave question instead of abandoning the active command.
    window.location.assign(pathname + search + hash);
  }, [blocker]);
}
