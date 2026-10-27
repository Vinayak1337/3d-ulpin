import { useEffect, useRef, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banner, Button, Skeleton } from '@ulpin/ui';
import { EvidenceProvider, useOpenEvidence } from '../evidence/EvidenceContext';
import { pageFailure } from '../evidence/citedPage';
import type { IntakeItem } from './batch-model';
import { useSourceCase } from './table/queries';
import { createPdfOcrRun, docxReadingWords, latestPdfJob, pagesToRead, pdfJobs, pdfJobsLeft, pdfNeedsPageCount,
  pdfNoReadingWords, pdfOcrOffer, pdfOcrPageWords, pdfOcrPressWords, pdfOcrWords, readPdfJob, readPdfOcrRuns,
  readPdfPageCount,
  type OcrPageProgress, type OcrPageRun, type PdfReading } from './pdf-reading';
import styles from './Batch.module.css';

export const isBatchPdf = (item: IntakeItem) => item.format === 'pdf' && Boolean(item.sourceId);

/** Document details share the existing job; only PDFs use the private page viewer. */
export function BatchPdfSection({ caseId, item }: { caseId: string; item: IntakeItem }) {
  if (item.format === 'docx' && item.sourceId) return <DocxReadingSection caseId={caseId} item={item} />;
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
  const jobs = sourceCase.data?.jobs ?? [];
  const jobId = latestPdfJob(jobs, sourceId)?.id ?? '';
  const read = useQuery({ queryKey: ['intake', caseId, 'pdf', sourceId, jobId], enabled: Boolean(jobId),
    retry: false,
    refetchInterval: query => ['queued', 'running'].includes(query.state.data?.status.status ?? '') ? 5000 : false,
    queryFn: () => readPdfJob(caseId, sourceId, jobId),
  });
  return { sourceCase, read, jobs, jobId };
}

/** The page count, each page's newest OCR reading, and one press that reads the selected pages in turn. */
function usePdfOcr(caseId: string, sourceId: string, reading: PdfReading | undefined,
  jobs: Parameters<typeof pdfJobs>[0]) {
  const client = useQueryClient();
  const needed = pdfNeedsPageCount(reading);
  const pageCount = useQuery({ queryKey: ['intake', caseId, 'pdf-pages', sourceId, reading?.sourceSha256 ?? ''],
    enabled: needed, retry: false, staleTime: Infinity, queryFn: () => readPdfPageCount(sourceId, reading!) });
  const finished = pdfJobs(jobs, sourceId).filter(job => job.status === 'succeeded').map(job => job.id);
  const runs = useQuery({ queryKey: ['intake', caseId, 'pdf-ocr', sourceId, finished.join(',')],
    enabled: needed, retry: false, placeholderData: keepPreviousData,
    queryFn: () => readPdfOcrRuns(caseId, sourceId, finished, reading!.sourceRevision) });
  const [progress, setProgress] = useState<OcrPageProgress | null>(null);
  // The officer's pick outlives each page's new job, which replaces the reading shown while it loads.
  const [chosen, setChosen] = useState<number[] | null>(null);
  const [run] = useState(() => createPdfOcrRun(caseId, sourceId));
  const leaving = useRef(new AbortController());
  useEffect(() => () => leaving.current.abort(), []);
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['source-case', caseId] });
    void client.invalidateQueries({ queryKey: ['intake', caseId, 'plan-reader'] });
  };
  const press = useMutation({
    mutationFn: (pages: number[]) => run(reading!, pages, leaving.current.signal, value => {
      setProgress(value);
      if (!['queued', 'running'].includes(value.status)) refresh();
    }),
    onSettled: () => { setProgress(null); refresh(); },
  });
  return { pageCount, runs, progress, press, chosen, setChosen, left: pdfJobsLeft(jobs, sourceId) };
}

function PdfReadingSection({ caseId, item }: { caseId: string; item: IntakeItem }) {
  const { sourceCase, read, jobs, jobId } = usePdfReading(caseId, item.sourceId!, item.updatedAt);
  const status = read.data?.status;
  const ocr = usePdfOcr(caseId, item.sourceId!, status, jobs);
  const error = ocr.press.error ?? read.error ?? sourceCase.error ?? ocr.pageCount.error ?? ocr.runs.error;
  return <section className={styles.question} aria-label={`PDF reading in ${item.name}`}>
    <h2 className="ul-heading">PDF reading · {item.name}</h2>
    {sourceCase.isPending || (jobId && read.isPending) ? <Skeleton /> : null}
    {!jobId && !sourceCase.isPending ? <p>{pdfNoReadingWords(item.sizeBytes)}</p> : null}
    {status ? <p role="status">{pdfOcrWords(status)}</p> : null}
    {error ? <PdfRefusal error={error} /> : null}
    {status ? <PdfOcrPages sourceId={item.sourceId!} reading={status} ocr={ocr} /> : null}
  </section>;
}

function DocxReadingSection({ caseId, item }: { caseId: string; item: IntakeItem }) {
  const { sourceCase, read, jobId } = usePdfReading(caseId, item.sourceId!, item.updatedAt);
  const status = read.data?.status;
  const error = read.error ?? sourceCase.error;
  return <section className={styles.question} aria-label={`Word document reading in ${item.name}`}>
    <h2 className="ul-heading">Word document reading · {item.name}</h2>
    {sourceCase.isPending || (jobId && read.isPending) ? <Skeleton /> : null}
    {!jobId && !sourceCase.isPending && item.limitReason ? <p>{item.limitReason}</p> : null}
    {status ? <p role="status">{docxReadingWords(status)}</p> : null}
    {error ? <PdfRefusal error={error} /> : null}
    {status?.status === 'completed' && status.native?.format === 'docx' ?
      <ul aria-label="Candidate document passages">{status.parts.map(part => <li key={part.id}>
        <blockquote>{part.text}</blockquote>
        <span>{part.locator.label}</span>
      </li>)}</ul> : null}
  </section>;
}

function PdfOcrPages({ sourceId, reading, ocr }: {
  sourceId: string; reading: PdfReading; ocr: ReturnType<typeof usePdfOcr>;
}) {
  const offer = pdfOcrOffer(reading, ocr.pageCount.data);
  const runs = ocr.runs.data ?? [];
  if (offer.refusal) return <p>{offer.refusal}</p>;
  if (!offer.pages.length) return null;
  if (ocr.runs.isPending) return <Skeleton />;
  const selected = ocr.chosen ?? (offer.singlePage ? [] : pagesToRead(offer.pages, runs).slice(0, ocr.left));
  const toggle = (page: number, on: boolean) => ocr.setChosen(on ? [...selected, page] : selected
    .filter(value => value !== page));
  return <div className={styles.stack}>
    {offer.singlePage ? <SingleOcrPage count={ocr.pageCount.data!} selected={selected}
      eligible={offer.pages} choose={page => ocr.setChosen(page)} pending={ocr.press.isPending} runs={runs}
      progress={ocr.progress} /> : <ul aria-label="Pages OCR can read">{offer.pages.map(page => <li key={page}>
        <label><input type="checkbox" checked={selected.includes(page)} disabled={ocr.press.isPending}
          onChange={event => toggle(page, event.target.checked)} /> {pdfOcrPageWords(page,
          runs.find(run => run.page === page), ocr.progress?.page === page ? ocr.progress : undefined)}</label>
      </li>)}</ul>}
    <OcrPress selected={selected.filter(page => offer.pages.includes(page))} runs={runs} left={ocr.left}
      pending={ocr.press.isPending} submit={pages => ocr.press.mutate(pages)} />
    {runs.filter(run => run.reading.ocr?.outputStatus !== 'failed').map(run => <OcrPassages key={run.page}
      sourceId={sourceId} run={run} />)}
  </div>;
}

function SingleOcrPage({ count, selected, eligible, choose, pending, runs, progress }: {
  count: number; selected: number[]; eligible: number[]; choose: (pages: number[]) => void;
  pending: boolean; runs: OcrPageRun[]; progress: OcrPageProgress | null;
}) {
  const page = selected[0];
  const valid = page !== undefined && Number.isInteger(page) && eligible.includes(page);
  return <>
    <label>Page number, 1 to {count} <input type="number" min={1} max={count} step={1} value={page ?? ''}
      disabled={pending} aria-invalid={page !== undefined && !valid}
      onChange={event => choose(event.target.value === ''
        ? [] : [Number(event.target.value)])} /></label>
    {page !== undefined ? <p role="status">{valid ? pdfOcrPageWords(page, runs.find(run => run.page === page),
      progress?.page === page ? progress : undefined)
      : `Choose a page number from 1 to ${count} without a text-layer reading.`}</p>
      : null}
  </>;
}

function OcrPress({ selected, runs, left, pending, submit }: {
  selected: number[]; runs: OcrPageRun[]; left: number; pending: boolean; submit: (pages: number[]) => void;
}) {
  const pages = pagesToRead(selected, runs);
  return <>
    <p>{pdfOcrPressWords(pages.length, left)}</p>
    <div><Button variant="soft" disabled={pending || !pages.length || pages.length > left}
      onClick={() => submit(pages)}>Read the selected pages (OCR)</Button></div>
  </>;
}

function PdfRefusal({ error }: { error: Error }) {
  const failure = pageFailure(error);
  return <Banner tone="warning">{failure.message}
    {failure.code ? <span className="ul-mono"> {failure.code}</span> : null}
  </Banner>;
}

function OcrPassages({ sourceId, run }: { sourceId: string; run: OcrPageRun }) {
  const open = useOpenEvidence();
  const { reading, passages } = run;
  return <ul aria-label={`Candidate OCR passages on page ${run.page}`}>{passages.map((passage, index) => <li
    key={index}>
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
