import { FileX, WarningCircle } from '@phosphor-icons/react';
import { Button, Dialog, EmptyState, Skeleton } from '@ulpin/ui';
import { usePageImage } from '../../api/queries';
import { pageFailure, useCitedPage, type CitedPage } from './citedPage';
import { placeWords, regionOutline } from './pageGeometry';
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
        {read.data ? <CitedPage page={read.data} place={place} openFile={openFile} /> : null}
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
        <Button variant="ghost" onClick={() => void navigator.clipboard.writeText(evidence.sourceId)}>
          Copy source ID
        </Button>
      </dd>
    </dl>
  );
}

function PageRefusal({ error, retry, openFile }: { error: Error; retry: () => void; openFile: () => void }) {
  const failure = pageFailure(error);
  const detail = failure.code ? `${failure.message} (${failure.code})` : failure.message;
  if (failure.kind === 'unavailable') {
    return (
      <EmptyState icon={FileX} title="Page preview is not available on this runtime" action={(
        <div><Button onClick={openFile}>Open the file view</Button></div>
      )}>
        {detail}
      </EmptyState>
    );
  }
  if (failure.kind === 'changed') {
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
  if (!page.url) {
    return (
      <EmptyState icon={FileX} title="The server cannot render this page"
        action={<div><Button onClick={openFile}>Open the file view</Button></div>}>
        The page is listed with a {page.frame.width} × {page.frame.height} pt frame but has no raster.
      </EmptyState>
    );
  }
  if (image.isPending) return <Skeleton width="100%" height={320} />;
  if (image.error) return <PageRefusal error={image.error} retry={() => void image.refetch()} openFile={openFile} />;
  return <PageWithRegion page={page} place={place} href={image.data} />;
}

function PageWithRegion({ page, place, href }: { page: CitedPage; place: Place; href: string }) {
  const { frame } = page;
  const outline = place.kind === 'region' ? regionOutline(place.region, frame) : null;
  const box = outline?.drawn ? outline.box : null;
  return (
    <figure className={styles.cited}>
      <svg viewBox={`0 0 ${frame.width} ${frame.height}`} className={styles.citedSvg} role="img"
        aria-label={`${page.name}, page ${page.page}${box ? ', cited region outlined' : ''}`}>
        <image href={href} width={frame.width} height={frame.height} />
        {box ? <rect x={box.x} y={box.y} width={box.width} height={box.height} className={styles.region} /> : null}
      </svg>
      <figcaption className="ul-help">
        {outline ? outline.note : 'The citation names this page, not a region.'}
      </figcaption>
    </figure>
  );
}
