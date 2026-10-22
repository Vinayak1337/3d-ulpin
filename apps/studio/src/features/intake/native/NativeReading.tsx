import { Banner, Skeleton } from '@ulpin/ui';
import type { IntakeItem } from '../batch-model';
import { hasConvertedLayers, layerWords, nativeReaderOf, positionWords, readerWords, readingView,
  type NativeOmissions, type ReadingView } from './reading-model';
import { useNativeOmissions, useNativeStatus } from './useNativeReading';
import styles from '../ifc/IfcStructure.module.css';

/**
 * NO1. The item's native reading as its reader stored it, and the features its conversion did not write. Both are
 * read-only candidates; nothing here is placed, confirmed or recorded.
 */
export function NativeReading({ caseId, item }: { caseId: string; item: IntakeItem }) {
  const reader = nativeReaderOf(item);
  const converted = hasConvertedLayers(item);
  const status = useNativeStatus(reader, { caseId, sourceId: item.sourceId ?? '', jobId: item.nativeReaderJobId ?? '' });
  const omissions = useNativeOmissions(converted, caseId, item.itemId);
  return <section className={styles.panel} aria-label={`Reading of ${item.name}`}>
    <h2 className="ul-heading">Reading · {item.name}</h2>
    <p className="ul-help">
      What the reader stated about the file, as stored. A reading is a candidate: nothing here is placed on the map,
      confirmed or recorded in the register.
    </p>
    {reader ? <section aria-label={`${readerWords[reader]} reading`}>
      <h3 className="ul-heading">{readerWords[reader]} reading</h3>
      {status.isPending ? <Skeleton /> : null}
      {status.error ? <Banner tone="warning">{status.error.message}</Banner> : null}
      {status.data ? <ReadingBody view={readingView(reader, status.data)} /> : null}
    </section> : null}
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
    <p className="ul-caption">Read {view.createdAt} · result SHA-256 <span className="ul-mono">{view.sha256}</span></p>
    <dl className={styles.list}>
      {view.lines.map(line => <div key={line.label} className={styles.line}>
        <dt className={styles.name}>{line.label}</dt>
        <dd className="ul-mono">{line.value}</dd>
      </div>)}
    </dl>
  </div>;
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
