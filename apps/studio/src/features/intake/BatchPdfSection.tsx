import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banner, Button, Skeleton } from '@ulpin/ui';
import { DOCUMENT_LIMITS } from '@ulpin/contracts/upload-reader-limits';
import { EvidenceProvider, useOpenEvidence } from '../evidence/EvidenceContext';
import { pageFailure } from '../evidence/citedPage';
import type { IntakeItem } from './batch-model';
import { useSourceCase } from './table/queries';
import { createPdfOcrPress, latestPdfJob, pdfOcrChoice, pdfOcrWords, readPdfJob,
  type PdfReading } from './pdf-reading';
import styles from './Batch.module.css';

export const isBatchPdf = (item: IntakeItem) => item.format === 'pdf' && Boolean(item.sourceId);

/** PDF details share the existing document job and private page viewer; they never propose record fields. */
export function BatchPdfSection({ caseId, item }: { caseId: string; item: IntakeItem }) {
  return isBatchPdf(item) ? <EvidenceProvider>
    <PdfReadingSection caseId={caseId} item={item} />
  </EvidenceProvider> : null;
}

function usePdfReading(caseId: string, sourceId: string, updatedAt: string) {
  const sourceCase = useSourceCase(caseId);
  const client = useQueryClient();
  // The batch can gain its document job after the page first cached the case's job list.
  useEffect(() => {
    void client.invalidateQueries({ queryKey: ['source-case', caseId] });
  }, [client, caseId, sourceId, updatedAt]);
  const [send] = useState(() => createPdfOcrPress(caseId, sourceId));
  const press = useMutation({
    mutationFn: ({ reading, selection }: { reading: PdfReading; selection: { page: number } }) =>
      send(reading, selection),
    onSuccess: () => { void client.invalidateQueries({ queryKey: ['source-case', caseId] }); },
  });
  const latest = latestPdfJob(sourceCase.data?.jobs ?? [], sourceId);
  const jobId = press.data?.jobId ?? latest?.id ?? '';
  const read = useQuery({ queryKey: ['intake', caseId, 'pdf', sourceId, jobId], enabled: Boolean(jobId),
    retry: false,
    refetchInterval: query => ['queued', 'running'].includes(query.state.data?.status.status ?? '') ? 5000 : false,
    queryFn: () => readPdfJob(caseId, sourceId, jobId),
  });
  return { sourceCase, read, press, jobId };
}

function PdfReadingSection({ caseId, item }: { caseId: string; item: IntakeItem }) {
  const { sourceCase, read, press, jobId } = usePdfReading(caseId, item.sourceId!, item.updatedAt);
  const status = read.data?.status;
  const error = press.error ?? read.error ?? sourceCase.error;
  const ocrJob = status?.ocr || press.data || item.state === 'read';
  const words = status && (!['queued', 'running'].includes(status.status) || ocrJob)
    ? pdfOcrWords(status, read.data!.passages.length) : 'The PDF text-layer reading is waiting or running.';
  return <section className={styles.question} aria-label={`PDF reading in ${item.name}`}>
    <h2 className="ul-heading">PDF reading · {item.name}</h2>
    <p className="ul-help">OCR reads words only. Passages are candidates, not record fields. No rooms, levels or
      units are created; the original stays unchanged.</p>
    {sourceCase.isPending || (jobId && read.isPending) ? <Skeleton /> : null}
    {!jobId && !sourceCase.isPending ? <p>No document reading is available for this file yet.</p> : null}
    {status ? <p role="status">{words}</p> : null}
    {press.isPending ? <p role="status">Checking the private document runtime before requesting OCR.</p> : null}
    {error ? <PdfRefusal error={error} /> : null}
    {status ? <PdfOcrAction reading={status} pending={press.isPending}
      submit={selection => press.mutate({ reading: status, selection })} /> : null}
    {status?.ocr && status.ocr.outputStatus !== 'failed' ? <>
      <p>{Math.max(0, pdfOcrChoice(status).scanned.length - 1)} other scanned pages remain unread by this OCR job.</p>
      {status.ocr.issues.length ? <p>{status.ocr.issues.join(' ')}</p> : null}
      <OcrPassages sourceId={item.sourceId!} reading={status} passages={read.data!.passages} />
    </> : null}
  </section>;
}

function PdfOcrAction({ reading, pending, submit }: {
  reading: PdfReading; pending: boolean; submit: (selection: { page: number }) => void;
}) {
  if (reading.status !== 'completed' || (reading.ocr && reading.ocr.outputStatus !== 'failed')) return null;
  const { scanned, selection } = pdfOcrChoice(reading);
  if (!scanned.length) return null;
  if (!selection) return <p>{scanned.length} scanned pages remain unread. OCR supports pages
    1–{DOCUMENT_LIMITS.ocrMaxPage} only.</p>;
  const remaining = scanned.length - 1;
  return <div className={styles.stack}>
    <p>Read page {selection.page}. This OCR job reads at most {DOCUMENT_LIMITS.ocrPages} scanned page.
      {' '}{remaining} scanned {remaining === 1 ? 'page is' : 'pages are'} left unread by this request.
      Only pages 1–{DOCUMENT_LIMITS.ocrMaxPage} are supported.</p>
    <div><Button variant="soft" disabled={pending} onClick={() => submit(selection)}>
      Read the words on the scanned pages (OCR)
    </Button></div>
  </div>;
}

function PdfRefusal({ error }: { error: Error }) {
  const failure = pageFailure(error);
  return <Banner tone="warning">{failure.message}
    {failure.code ? <span className="ul-mono"> {failure.code}</span> : null}
  </Banner>;
}

function OcrPassages({ sourceId, reading, passages }: {
  sourceId: string; reading: PdfReading; passages: NonNullable<PdfReading['ocrItems']>;
}) {
  const open = useOpenEvidence();
  return <ul aria-label="Candidate OCR passages">{passages.map((passage, index) => <li key={index}>
    <blockquote>{passage.text}</blockquote>
    {passage.sourcePageBoxes.map((citation, at) => {
      const [x, y, right, bottom] = citation.box as [number, number, number, number];
      const text = `Page ${citation.pageNumber} · region [${citation.box.map(n => n.toFixed(2)).join(', ')}] pt`;
      return <Button key={at} variant="soft" onClick={() => open({ sourceId, label: 'Candidate OCR passage',
        pin: { revision: reading.sourceRevision, sha256: reading.sourceSha256 }, locator: { kind: 'region',
          page: citation.pageNumber, text, region: { x, y, width: right - x, height: bottom - y, unit: 'pt' } } })}>
        {text}
      </Button>;
    })}
  </li>)}</ul>;
}
