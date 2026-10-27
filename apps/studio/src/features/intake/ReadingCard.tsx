import { Banner, Button, Skeleton } from '@ulpin/ui';
import type { IntakeItem } from './batch-model';
import { basisWords, useReading, type Reading } from './reading-model';
import { DeclareLink } from './evidence/EvidenceByKey';
import type { LinkDeclaration } from './evidence/model';
import styles from './Batch.module.css';

export function ReadingCard({ caseId, item, onDeclare }: {
  caseId: string; item: IntakeItem; onDeclare?: (initial: LinkDeclaration) => void;
}) {
  const query = useReading(caseId, item.itemId);
  if (!item.sourceId) return null;
  if (query.error) return <Banner tone="danger">{query.error.message}</Banner>;
  if (!query.data) return <Skeleton />;
  const reading = query.data;
  return <section className={styles.question} aria-label={`Reading for ${item.name}`}>
    <h2 className="ul-heading">What</h2>
    <ReadingLine line={reading.what} />
    <h3 className="ul-heading">Holds</h3>
    <ul>{reading.holds.map((line, index) => <li key={index}><ReadingLine line={line} /></li>)}</ul>
    <h3 className="ul-heading">Fields</h3>
    <ul>{reading.fields.map((line, index) => <li key={index}>
      <span>{line.field}</span><ReadingLine line={line} />
    </li>)}</ul>
    <h3 className="ul-heading">Drawing</h3>
    <ReadingLine line={reading.drawing} />
    <h3 className="ul-heading">Links</h3>
    {reading.links.length ? <ul>{reading.links.map((line, index) => <li key={index}>
      <ReadingLine line={line} />
      {line.by !== 'place' && onDeclare ? <DeclareLink caseId={caseId}
        link={{ ...line, fromItemId: item.itemId }} onDeclare={onDeclare} /> : null}
    </li>)}</ul> : <p>No links found</p>}
    {reading.question !== null ? <>
      <p>{reading.question}</p>
      <Button variant="soft" onClick={() => focusAnswer(item)}>Answer</Button>
    </> : null}
  </section>;
}

function ReadingLine({ line }: { line: Reading['what'] }) {
  return <p>{line.words} · {basisWords(line.basis)}{line.basis === 'sarvam' ? ' · Needs review' : ''}</p>;
}

function focusAnswer(item: IntakeItem) {
  let section = 'layout';
  if (item.layerCrs?.some(entry => !entry.answer)) section = 'layer-crs';
  else if (item.pageImage) section = 'page-image';
  else if (item.family === 'table') section = 'table';
  const target = document.getElementById(`intake-${section}-${item.itemId}`);
  if (target) {
    target.setAttribute('tabindex', '-1');
    target.focus();
    target.scrollIntoView?.({ block: 'nearest' });
  }
}
