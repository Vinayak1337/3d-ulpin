import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, ApiError, unwrap } from '@ulpin/api-client';
import { Banner, Button, Skeleton } from '@ulpin/ui';
import type { IntakeItem } from './batch-model';
import styles from './Batch.module.css';

type Reading = NonNullable<IntakeItem['planReadings']>[number];

export function planReadingWords(reading: Reading): string {
  const prefix = `Page ${reading.page}: `;
  if (reading.status === 'queued') return prefix + 'candidate room reading is queued.';
  if (reading.status === 'failed') return prefix + `candidate room reading stopped (${reading.error
    ?? 'reason unknown'}). Nothing was recorded.`;
  if (!reading.result) return prefix + 'no candidate room reading is available.';
  const count = reading.result.rooms.length;
  const scale = planScaleWords(reading.result);
  return prefix + `${count} candidate ${count === 1 ? 'room' : 'rooms'} · ${scale}. Review before use.`;
}

function planScaleWords(result: NonNullable<Reading['result']>): string {
  if (result.scale.state === 'no_scale' || result.scale.metresPerPoint === null) return 'no scale';
  const frameUnit = result.sourceCitation.locator.unit === 'pixel' ? 'pixel' : 'point';
  return `scale from page dimensions: ${result.scale.metresPerPoint.toPrecision(6)} m per page ${frameUnit}`;
}

/** The summary comes only from the item's kept candidate result, not a client-side room count guess. */
export function PlanReadingSummary({ readings }: { readings: readonly Reading[] }) {
  if (!readings.length) return null;
  return <ul aria-label="Candidate room readings">{readings.map(reading => <li key={reading.page}>
    {planReadingWords(reading)}
    {reading.result?.overlay ? <> <PlanOverlayLink overlay={reading.result.overlay} /></> : null}
    {reading.result?.gaps.includes('image_ocr_unavailable') ? <p className="ul-help">
      Photo labels were not read by OCR; literal room classes are unknown.
    </p> : null}
  </li>)}</ul>;
}

function PlanOverlayLink({ overlay }: { overlay: NonNullable<NonNullable<Reading['result']>['overlay']> }) {
  const [href, setHref] = useState<string | null>(null);
  useEffect(() => {
    const bytes = Uint8Array.from(atob(overlay.base64), character => character.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: overlay.mediaType }));
    setHref(url);
    return () => URL.revokeObjectURL(url);
  }, [overlay.base64, overlay.mediaType]);
  return href ? <a href={href} target="_blank" rel="noreferrer"
    aria-label="View candidate room overlay (opens a new tab)">View candidate room overlay</a> : null;
}

function usePlanPress(caseId: string, itemId: string, refresh: () => void) {
  const [keys] = useState(() => new Map<number, string>());
  const [requested, setRequested] = useState<number[]>([]);
  const press = useMutation({ mutationFn: async (page: number) => {
    if (!keys.has(page)) keys.set(page, crypto.randomUUID());
    try {
      return unwrap(await api.POST('/api/v1/ingestion/cases/{caseId}/intake/items/{itemId}/plan-readings', {
        params: { path: { caseId, itemId } }, body: { requestKey: keys.get(page)!, page },
      }));
    } catch (error) {
      if (error instanceof ApiError && error.status < 500 && error.status !== 429) keys.delete(page);
      throw error;
    }
  }, onSuccess: receipt => {
    setRequested(current => [...current, receipt.page]);
    refresh();
  } });
  return { press, requested };
}

function canReadPlan(item: IntakeItem) {
  const image = item.family === 'image' && ['png', 'jpeg'].includes(item.format ?? '');
  return Boolean(item.sourceId) && !item.parentItemId && (image || item.format === 'pdf');
}

export function PlanReadingSection(props: { caseId: string; item: IntakeItem; refresh: () => void }) {
  return canReadPlan(props.item) ? <CandidatePlanReading {...props} /> : null;
}

function CandidatePlanReading({ caseId, item, refresh }: {
  caseId: string; item: IntakeItem; refresh: () => void;
}) {
  const offer = useQuery({ queryKey: ['intake', caseId, 'plan-reader', item.itemId, item.updatedAt], retry: false,
    queryFn: async () => unwrap(await api.GET('/api/v1/ingestion/cases/{caseId}/intake/items/{itemId}/plan-reader', {
      params: { path: { caseId, itemId: item.itemId } },
    })) });
  const { press, requested } = usePlanPress(caseId, item.itemId, refresh);
  return <section className={styles.question} aria-label={`Candidate rooms in ${item.name}`}>
    <h2 className="ul-heading">Candidate rooms · {item.name}</h2>
    <p className="ul-help">This separate plan reading proposes room outlines in page pixels. It creates no map
      placement, levels, units or records. A metric scale needs verified page dimension lines; without them
      the reading says no scale.</p>
    {offer.isPending ? <Skeleton /> : null}
    {offer.error ? <p>The plan reader could not be checked. {offer.error.message}</p> : null}
    {offer.data && !offer.data.available ? <p>{offer.data.reason}</p> : null}
    {offer.data?.available ? <PlanPress item={item} pages={offer.data.pages} requested={requested}
      press={press} /> : null}
    {press.error ? <Banner tone="warning">{press.error.message} If the outcome is not known, pressing again
      sends the same request.</Banner> : null}
  </section>;
}

function PlanPress({ item, pages, requested, press }: {
  item: IntakeItem; pages: number[]; requested: number[]; press: ReturnType<typeof usePlanPress>['press'];
}) {
  const [chosen, setChosen] = useState<number | null>(null);
  const page = chosen !== null && pages.includes(chosen) ? chosen : pages[0];
  if (!pages.length) return <p>{item.sizeBytes !== null && item.sizeBytes > 16 * 1024 ** 2
    ? 'This original is above the plan reader\'s 16 MiB limit.'
    : 'Read the words on a selected PDF page (OCR) first. Only an already-read page can propose rooms.'}</p>;
  const already = item.planReadings?.some(reading => reading.page === page)
    || (page !== undefined && requested.includes(page));
  return <>
    <label>Plan page <select value={page} disabled={press.isPending}
      onChange={event => setChosen(Number(event.target.value))}>
      {pages.map(value => <option key={value} value={value}>Page {value}</option>)}
    </select></label>
    <div><Button variant="soft" disabled={press.isPending || already || page === undefined}
      onClick={() => page !== undefined && press.mutate(page)}>
      Read candidate rooms on the selected page
    </Button></div>
    {already ? <p>That page has a candidate room reading; it will not be queued again.</p> : null}
  </>;
}
