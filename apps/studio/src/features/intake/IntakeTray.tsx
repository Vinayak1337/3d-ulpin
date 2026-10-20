import { Button, DataTable } from '@ulpin/ui';
import { Link } from 'react-router';
import { useOpenEvidence } from '../evidence/EvidenceContext';
import type { Package } from './run/model';
import { needsLayoutAnswer } from './question-model';
import { canRetryStopped } from './retry-command';
import { StoppedRetry } from './StoppedRetry';
import { useSourceCase } from './table/queries';
import { countWords, crsWords, familyWords, formatWords, placementWords, sizeClassWords,
  stateWords, packagePath, partProgressWords, opensPages } from './batch-model';
import type { IntakeItem } from './batch-model';
import styles from './Batch.module.css';

export function IntakeTray({ caseId, items, packages, choose, refresh }: {
  caseId: string; items: IntakeItem[]; packages: readonly Package[]; choose: (item: IntakeItem) => void;
  refresh: () => void;
}) {
  return <div className={styles.tray} tabIndex={0} role="region" aria-label="Files in this batch">
    <DataTable caption="Files in this batch" rows={items} rowKey={(item) => item.itemId} columns={[
      { header: 'File', cell: (item) => item.name },
      { header: 'Contents', cell: (item) => <>
        {familyWords(item.family)} · {formatWords(item.format)}
      </> },
      { header: 'Size', numeric: true, cell: (item) => <>
        {item.sizeBytes == null ? 'Not known' : `${countWords(item.sizeBytes)} bytes`}
        {item.sizeClass ? ` · ${sizeClassWords(item.sizeClass)}` : ''}
      </> },
      { header: 'State', cell: (item) => <>
        {stateWords(item.state)}
        {partProgressWords(item) ? <p className="ul-help">{partProgressWords(item)}</p> : null}
      </> },
      { header: 'Features', numeric: true, cell: (item) => countWords(item.card?.counts.features) },
      { header: 'Coordinate system', cell: (item) => crsWords(item.card) },
      { header: 'Extent as stated', cell: (item) => item.card?.extent.native?.join(', ') ?? 'Not known' },
      { header: 'Placement', cell: (item) => placementWords(item.placement) },
      { header: 'Reason', cell: (item) => item.limitReason ?? null },
      { header: 'Next step', cell: (item) => <NextStep caseId={caseId} item={item} packages={packages}
        choose={choose} refresh={refresh} /> },
    ]} />
  </div>;
}

function NextStep({ caseId, item, packages, choose, refresh }: {
  caseId: string; item: IntakeItem; packages: readonly Package[]; choose: (item: IntakeItem) => void;
  refresh: () => void;
}) {
  const path = packagePath(item, packages);
  const packageStep = path ? <Link to={path}>Open package</Link> : <span>Package prepared</span>;
  return <div className={styles.stack}>
    {item.plan?.packageId ? packageStep : null}
    {item.existingAreaId ? <Link to={`/studio/areas/${item.existingAreaId}`}>Open that area</Link> : null}
    {item.sourceId && (item.plan || needsLayoutAnswer(item)) ?
      <Button variant="soft" onClick={() => choose(item)}>View layout</Button> : null}
    {canRetryStopped(item) ? <StoppedRetry key={item.updatedAt} caseId={caseId} item={item} refresh={refresh} /> : null}
    {opensPages(item) ? <ReviewPages caseId={caseId} item={item} /> : null}
  </div>;
}

/** G10. The read PDF opens at its first page in the page viewer, pinned to the original revision the batch read. */
function ReviewPages({ caseId, item }: { caseId: string; item: IntakeItem }) {
  const open = useOpenEvidence();
  const source = useSourceCase(caseId).data?.sources.find((row) => row.id === item.sourceId);
  if (!source) return null;
  return <Button variant="soft" onClick={() => open({ sourceId: source.id, label: item.name,
    locator: { kind: 'page', page: 1, text: 'Page 1' }, pin: { revision: source.revision, sha256: source.sha256 } })}>
    Review pages
  </Button>;
}
