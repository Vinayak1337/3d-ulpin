import { useEffect, useRef, useState } from 'react';
import { ModelPreview, readPalette, type ModelPreviewInput } from '@ulpin/scene';
import { Banner, Skeleton, formatDateTime } from '@ulpin/ui';
import type { IntakeItem } from '../batch-model';
import { layerWords, positionWords, readerWords, readingView, type ModelView, type NativeOmissions, type ReadingView,
  type SummaryLine } from './reading-model';
import { hasConvertedLayers, nativeReaderOf } from './reader-of';
import { useDxfDrawing, useModelPreview, useNativeOmissions, useNativeStatus } from './useNativeReading';
import { DxfDrawing } from './DxfDrawing';
import styles from '../ifc/IfcStructure.module.css';

/**
 * NO1. The item's native reading as its reader stored it, and the features its conversion did not write. Both are
 * read-only candidates; nothing here is placed, confirmed or recorded.
 */
export function NativeReading({ caseId, item }: { caseId: string; item: IntakeItem }) {
  const reader = nativeReaderOf(item);
  const converted = hasConvertedLayers(item);
  const pins = { caseId, sourceId: item.sourceId ?? '', jobId: item.nativeReaderJobId ?? '' };
  const status = useNativeStatus(reader, pins);
  const model = useModelPreview(reader, pins, status.data);
  const drawing = useDxfDrawing(reader, pins, status.data);
  const omissions = useNativeOmissions(converted, caseId, item.itemId);
  return <section className={styles.panel} aria-label={`Reading of ${item.name}`}>
    <h2 className="ul-heading">Reading · {item.name}</h2>
    {reader ? <section aria-label={`${readerWords[reader]} reading`}>
      <h3 className="ul-heading">{readerWords[reader]} reading</h3>
      {status.isPending ? <Skeleton /> : null}
      {status.error ? <Banner tone="warning">{status.error.message}</Banner> : null}
      {status.data && !(reader === 'dxf' && status.data.status === 'completed' && status.data.result)
        ? <ReadingBody view={readingView(reader, status.data)} /> : null}
      {reader === 'dxf' && status.data?.status === 'completed' && status.data.result ? <>
        {drawing.isPending ? <Skeleton /> : null}
        {drawing.error ? <Banner tone="warning">{drawing.error.message}</Banner> : null}
        {drawing.data ? <DxfDrawing inspection={drawing.data} /> : null}
      </> : null}
    </section> : null}
    <ModelPreviewBody view={model} />
    {converted ? <section aria-label="Features not written">
      <h3 className="ul-heading">Features not written</h3>
      {omissions.isPending ? <Skeleton /> : null}
      {omissions.error ? <Banner tone="warning">{omissions.error.message}</Banner> : null}
      {omissions.data ? <OmissionsBody omissions={omissions.data} /> : null}
    </section> : null}
  </section>;
}

export function ReadingBody({ view }: { view: ReadingView }) {
  if (view.state === 'words') return <p>{view.words}</p>;
  return <div className={styles.tree}>
    <p className="ul-caption">Read {formatDateTime(view.createdAt)}</p>
    <Lines lines={view.lines} />
    <details className={styles.group}>
      <summary>File fingerprints and reader format</summary>
      <Lines lines={view.hashes} mono />
    </details>
  </div>;
}

/** S5.21. The model in its own frame, with the reading's axes and units; words when it cannot be drawn. */
export function ModelPreviewBody({ view }: { view: ModelView }) {
  if (view.state === 'none') return null;
  return <section aria-label="Own frame preview">
    <h3 className="ul-heading">Own frame · display only</h3>
    {view.state === 'words' ? <p>{view.words}</p> : <div className={styles.tree}>
      <ModelCanvas model={view.model} label={view.label} />
      <Lines lines={view.lines} />
    </div>}
  </section>;
}

/** One preview per mount, released on unmount; a browser that cannot draw it gets words instead. */
function ModelCanvas({ model, label }: { model: ModelPreviewInput; label: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let preview: ModelPreview;
    try {
      preview = new ModelPreview(container.current!, model, readPalette());
    } catch {
      setFailed(true);
      return;
    }
    return () => preview.dispose();
  }, [model]);
  if (failed) return <p>This browser could not draw the preview.</p>;
  return <div ref={container} role="img" aria-label={label} style={{ height: '20rem', overflow: 'hidden',
    border: '1px solid var(--ui-divider)', borderRadius: 'var(--ui-radius-8)', cursor: 'grab' }} />;
}

function Lines({ lines, mono = false }: { lines: readonly SummaryLine[]; mono?: boolean }) {
  return <dl className={styles.list}>
    {lines.map(line => <div key={line.label} className={styles.line}>
      <dt className={styles.name}>{line.label}</dt>
      <dd className={mono ? 'ul-mono' : undefined}>{line.value}</dd>
    </div>)}
  </dl>;
}

export function OmissionsBody({ omissions }: { omissions: NativeOmissions }) {
  return <div className={styles.tree}>
    <p>{omissions.words}</p>
    {omissions.layers.length ? <ul className={styles.list}>
      {omissions.layers.map(layer => <li key={layer.derivativeSourceId} className={styles.line}>
        <span className={styles.name}>{layer.layer}</span>
        <span className="ul-caption">{layerWords(layer)}</span>
        {layer.listed.length ? <details className={styles.group} open={layer.listed.length <= 10}>
          <summary>{layer.listed.length} listed</summary>
          <ul className={styles.list}>
            {layer.listed.map((entry, index) => <li key={`${entry.position}:${index}`}>
              <span className="ul-mono">{positionWords(layer, entry.position)}</span>: {entry.reason}
            </li>)}
          </ul>
        </details> : null}
      </li>)}
    </ul> : null}
  </div>;
}
