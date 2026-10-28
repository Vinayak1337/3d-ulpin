import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Banner, Button, formatDateTime } from '@ulpin/ui';
import { abortReceipt, cleanupReceipt, createUploadCommand } from './upload-command';
import { enrolSource, listUploads, uploadTransport } from './upload-api';
import { sizeWords, uploadWords, type UploadEntry, type UploadProgress } from './upload-model';
import styles from './Batch.module.css';

/** Under the batch's own key, so every batch refresh reads the receipts again. */
export const uploadsKey = (caseId: string) => ['intake', caseId, 'uploads'];

/**
 * N04. Receipts a reload left open stay resumable until expiry, even after an idle v2 receipt frees its slot.
 * `settled` hears of a receipt whose file finished and joined the batch, or whose upload was cancelled.
 */
export function UnfinishedUploads({ caseId, refresh, settled }: {
  caseId: string; refresh: () => void; settled?: (entry: UploadEntry) => void;
}) {
  const uploads = useQuery({ queryKey: uploadsKey(caseId), retry: false, queryFn: () => listUploads(caseId) });
  if (uploads.error) return <Banner tone="warning">{uploads.error.message}</Banner>;
  const entries = uploads.data?.uploads ?? [];
  if (!entries.length) return null;
  return <section className={styles.stack} aria-label="Uploads not finished">
    <h2 className="ul-heading">Uploads not finished</h2>
    <ul className={styles.stack}>
      {entries.map((entry) => <UnfinishedUpload key={entry.id} caseId={caseId} entry={entry} settle={refresh}
        settled={() => settled?.(entry)} />)}
    </ul>
  </section>;
}

export function receiptWords(entry: UploadEntry): string {
  const parts = `${entry.receivedParts} of ${entry.partCount} parts received`;
  if (entry.state === 'aborting') return `${parts}. Being cancelled.`;
  if (entry.state === 'finalizing') return `${parts}. Being verified.`;
  return `${parts}. Expires on ${formatDateTime(entry.expiresAt)}.`;
}

const failureWords = (failure: unknown) => failure instanceof Error ? failure.message : 'The server did not answer.';

function UnfinishedUpload({ caseId, entry, settle, settled }: {
  caseId: string; entry: UploadEntry; settle: () => void; settled: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const command = useRef<ReturnType<typeof createUploadCommand> | null>(null);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState('');
  const resume = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    command.current = createUploadCommand({ file, resume: entry, transport: uploadTransport(caseId),
      publish: setProgress });
    try {
      const sourceId = await command.current.run();
      if (sourceId) await enrolSource(caseId, sourceId);
      // Finished and enrolled, or cancelled while it ran: either way the file no longer waits.
      settled();
    } catch (failure) {
      setError(failureWords(failure));
    } finally {
      command.current = null;
      setProgress(null);
      settle();
    }
  };
  const send = async (action: () => Promise<unknown>) => {
    setError('');
    try {
      await action();
      settled();
    } catch (failure) {
      setError(failureWords(failure));
    }
    settle();
  };
  const cancel = () => send(() => command.current?.cancel() ?? abortReceipt(uploadTransport(caseId), entry));
  const finish = () => send(() => cleanupReceipt(uploadTransport(caseId), entry));
  const stopped = progress?.phase === 'stopped';
  return <li className="ul-stack">
    <span><span className="ul-id">{entry.filename}</span>, {sizeWords(entry.bytes)}. {receiptWords(entry)}</span>
    {progress ? <span role="status">{uploadWords(progress)}</span> : null}
    {entry.state === 'aborting' ? <span className="ul-row">
      <Button variant="soft" aria-label={`Finish cancelling ${entry.filename}`} onClick={() => void finish()}>
        Finish cancelling
      </Button>
    </span> : null}
    {entry.state !== 'aborting' && (!progress || stopped) ? <span className="ul-row">
      {stopped ? <Button onClick={() => command.current?.retry()}>Try again</Button>
        : <Button aria-label={`Resume ${entry.filename}`} onClick={() => input.current?.click()}>Resume</Button>}
      <Button variant="soft" aria-label={`Cancel upload of ${entry.filename}`} onClick={() => void cancel()}>
        Cancel upload
      </Button>
    </span> : null}
    <input ref={input} type="file" className="ul-visually-hidden" tabIndex={-1} aria-hidden="true"
      onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        void resume(file);
      }} />
    {error ? <p role="alert">{error}</p> : null}
  </li>;
}
