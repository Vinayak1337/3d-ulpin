import { useState } from 'react';
import { FileX, WarningCircle } from '@phosphor-icons/react';
import { Button, Dialog, EmptyState, Skeleton } from '@ulpin/ui';
import { usePageImage } from '../../api/queries';
import { pageFailure, pageViewState, useCitedPage, type CitedPage } from './citedPage';
import { placeWords, regionOutline } from './pageGeometry';
import { citedPageState, regionImageFrame, useCitedRegion, type RegionProvenance } from './citedRegion';
import type { EvidenceRef, Locator, SourcePin } from './refs';
import { SourceReadingNote } from '../register/SourceReadingNote';
import styles from './EvidenceViewer.module.css';

export type Place = Extract<Locator, { kind: 'page' | 'region' }>;
interface CitedProps {
  evidence: EvidenceRef;
  place: Place;
  pin: SourcePin;
  onClose: () => void;
  openFile: () => void;
}

/**
 * A citation opens at its page: the page raster the server returns for the citation's own pins, with the cited
 * region outlined when its unit says where it is. Without a page runtime it says so and offers the file view.
 */
export function CitedPageViewer({ evidence, place, pin, onClose, openFile }: CitedProps) {
  const read = useCitedPage(evidence.sourceId, place.page, pin);
  return (
    <Dialog title={`${evidence.label} · p.${place.page}`} onClose={onClose}
      footer={<Button onClick={onClose}>Close</Button>}>
      <div className="ul-stack">
        <CitationWords evidence={evidence} place={place} pin={pin} />
        {read.isPending ? <Skeleton width="100%" height={320} /> : null}
        {read.error ? <PageRefusal error={read.error} retry={() => void read.refetch()} openFile={openFile} /> : null}
        {read.data ? <CitedPage key={JSON.stringify([evidence.sourceId, pin, place])}
          page={read.data} place={place} openFile={openFile} /> : null}
      </div>
    </Dialog>
  );
}

/** The page, region and source of the citation in words, as the record carries them. */
function CitationWords({ evidence, place, pin }: { evidence: EvidenceRef; place: Place; pin: SourcePin }) {
  return (
    <dl className={styles.words}>
      <dt>Cited place</dt>
      <dd>{placeWords(place)}</dd>
      <dt>Source</dt>
      <dd className="ul-row">
        <span className="ul-mono">{evidence.sourceId} · revision {pin.revision}</span>
        <SourceReadingNote sourceId={evidence.sourceId} />
        {!evidence.pin ? <span className="ul-help">
          This citation names no revision. The preview uses the retained source revision in the loaded register.
        </span> : null}
        <Button variant="ghost" onClick={() => void navigator.clipboard.writeText(evidence.sourceId)}>
          Copy source ID
        </Button>
      </dd>
    </dl>
  );
}

function PageRefusal({ error, retry, openFile, regionRead = false }: {
  error: Error; retry: () => void; openFile: () => void; regionRead?: boolean;
}) {
  const failure = pageFailure(error);
  const detail = failure.code ? `${failure.message} (${failure.code})` : failure.message;
  if (failure.kind === 'unavailable' && !regionRead) {
    return (
      <EmptyState icon={FileX} title="Page preview is not available on this runtime" action={(
        <div><Button onClick={openFile}>Open the file view</Button></div>
      )}>
        {detail}
      </EmptyState>
    );
  }
  if (failure.kind === 'changed' && !regionRead) {
    return (
      <EmptyState icon={WarningCircle} title="The original changed after this was cited">
        {detail} The page is not shown.
      </EmptyState>
    );
  }
  return (
    <EmptyState icon={WarningCircle} title="The page could not be read"
      action={<div><Button onClick={retry}>Try again</Button></div>}>
      {detail}
    </EmptyState>
  );
}

function CitedPage({ page, place, openFile }: { page: CitedPage; place: Place; openFile: () => void }) {
  const image = usePageImage(page.url);
  const state = pageViewState(page, place.kind === 'region');
  if (state.kind === 'unsupported') return <SheetRegion page={page} place={place} openFile={openFile} />;
  if (image.isPending) return <Skeleton width="100%" height={320} />;
  if (image.error) return <PageRefusal error={image.error} retry={() => void image.refetch()} openFile={openFile} />;
  return (
    <div className="ul-stack">
      <PageWithRegion page={page} place={place} href={image.data} />
      {state.kind === 'reduced' ? <SheetRegion page={page} place={place} openFile={openFile}
        reducedStatement={state.statement!} /> : null}
    </div>
  );
}

function SheetRegion({ page, place, openFile, reducedStatement }: {
  page: CitedPage; place: Place; openFile: () => void; reducedStatement?: string;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const read = useCitedRegion(page, place, acknowledged);
  const state = citedPageState(page, place, Boolean(read.error));
  const view = pageViewState(page, place.kind === 'region');
  if (state === 'refused') {
    return <PageRefusal error={read.error!} retry={() => void read.refetch()} openFile={openFile} regionRead />;
  }
  return (
    <div className="ul-stack">
      {reducedStatement ? (
        <section className="ul-row" aria-label="Reduced sheet preview">
          <p className="ul-help" role="status">{reducedStatement}</p>
          {view.offersRegion && read.canRequest ? <LargeSheetAction fileOnly={false}
            acknowledged={acknowledged} openFile={openFile} acknowledge={() => setAcknowledged(true)} /> : null}
        </section>
      ) : <section className={styles.largeSheet} aria-label="Large sheet preview">
        <h3>This sheet is too large to show whole</h3>
        <p role="status">
          The sheet is {page.frame.width} × {page.frame.height} pt.{' '}
          {largeSheetWords(state === 'page-only', Boolean(read.image))}
          {state === 'region' && !read.canRequest ? ' Its coordinates do not identify a supported page region.' : null}
        </p>
        <LargeSheetAction fileOnly={state === 'page-only' || !read.canRequest} acknowledged={acknowledged}
          openFile={openFile} acknowledge={() => setAcknowledged(true)} />
      </section>}
      {acknowledged && read.isPending ? <Skeleton width="100%" height={320} /> : null}
      {read.image ? <PageWithRegion page={page} place={place} href={read.image.href}
        provenance={read.image.result.provenance} sha256={read.image.result.sha256} /> : null}
    </div>
  );
}

function largeSheetWords(pageOnly: boolean, shown: boolean): string {
  if (pageOnly) return 'This citation names the page, not a region.';
  if (shown) return 'The cited region is shown on its own.';
  return 'The cited region is not shown yet.';
}

function LargeSheetAction({ fileOnly, acknowledged, openFile, acknowledge }: {
  fileOnly: boolean; acknowledged: boolean; openFile: () => void; acknowledge: () => void;
}) {
  if (fileOnly) return <div><Button onClick={openFile}>Open the file view</Button></div>;
  if (acknowledged) return null;
  return <div><Button onClick={acknowledge}>Show the cited region</Button></div>;
}

function PageWithRegion({ page, place, href, provenance, sha256 }: {
  page: CitedPage; place: Place; href: string; provenance?: RegionProvenance; sha256?: string;
}) {
  const { frame } = page;
  const outline = place.kind === 'region' ? regionOutline(place.region, frame) : null;
  const box = outline?.drawn ? outline.box : null;
  const crop = provenance ? regionImageFrame(provenance) : null;
  return (
    <figure className={styles.cited}>
      <svg viewBox={crop?.viewBox ?? `0 0 ${frame.width} ${frame.height}`} className={styles.citedSvg} role="img"
        aria-label={`${page.name}, page ${page.page}${box ? ', cited region outlined' : ''}`}>
        <image href={href} width={crop?.width ?? frame.width} height={crop?.height ?? frame.height}
          transform={crop?.matrix} />
        {box ? <rect x={box.x} y={box.y} width={box.width} height={box.height} className={styles.region} /> : null}
      </svg>
      <figcaption className="ul-help">
        {provenance ? <>
          Region of page {provenance.page}, drawn by the server from the original ·{' '}
          <span className="ul-mono">{sha256?.slice(0, 8)}</span><br />
        </> : null}
        {outline ? outline.note : 'The citation names this page, not a region.'}
      </figcaption>
    </figure>
  );
}
