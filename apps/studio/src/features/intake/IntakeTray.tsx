import { Button, DataTable } from '@ulpin/ui';
import { Link } from 'react-router';
import { useOpenEvidence } from '../evidence/EvidenceContext';
import type { Package } from './run/model';
import { itemTableSource } from './BatchTableSection';
import { needsLayoutAnswer } from './question-model';
import { isPageImage } from './page-image-model';
import { canRetryStopped } from './retry-command';
import { StoppedRetry } from './StoppedRetry';
import { PlanReadingSummary } from './PlanReadingSection';
import { useSourceCase } from './table/queries';
import { LayerCrsAnswers } from './LayerCrsAnswer';
import { countWords, crsWords, familyWords, formatWords, placementWords, sizeClassWords,
  stateWords, packagePath, partProgressWords, opensPages, CELL_BATCHES_WORDS, cellBatchPath } from './batch-model';
import type { CellBatch, IntakeItem } from './batch-model';
import { isIfcItem } from './ifc/structure-model';
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
      { header: 'Reason', cell: (item) => <>
        {item.limitReason ?? null}
        <PlanReadingSummary readings={item.planReadings ?? []} />
      </> },
      { header: 'Next step', cell: (item) => <NextStep caseId={caseId} item={item} items={items} packages={packages}
        choose={choose} refresh={refresh} /> },
    ]} />
  </div>;
}

function NextStep({ caseId, item, items, packages, choose, refresh }: {
  caseId: string; item: IntakeItem; items: readonly IntakeItem[]; packages: readonly Package[];
  choose: (item: IntakeItem) => void;
  refresh: () => void;
}) {
  const path = packagePath(item, packages);
  const packageStep = path ? <Link to={path}>Open package</Link> : <span>Package prepared</span>;
  return <div className={styles.stack}>
    {item.plan?.packageId ? packageStep : null}
    {item.existingAreaId ? <Link to={`/studio/areas/${item.existingAreaId}`}>Open that area</Link> : null}
    {item.sourceId && (item.plan || needsLayoutAnswer(item)) ?
      <Button variant="soft" onClick={() => choose(item)}>View layout</Button> : null}
    {itemTableSource(item, items) ? <Button variant="soft" onClick={() => choose(item)}
      aria-label={`Open the table: ${item.name}`}>Open the table</Button> : null}
    {isIfcItem(item) ? <Button variant="soft" onClick={() => choose(item)}>View structure</Button> : null}
    {isPageImage(item) ? <Button variant="soft" onClick={() => choose(item)}
      aria-label={`View page image: ${item.name}`}>View page image</Button> : null}
    {canRetryStopped(item) ? <StoppedRetry key={item.updatedAt} caseId={caseId} item={item} refresh={refresh} /> : null}
    {opensPages(item) ? <ReviewPages caseId={caseId} item={item} /> : null}
    {item.layerCrs?.length ? <LayerCrsAnswers caseId={caseId} item={item} refresh={refresh} /> : null}
    {item.cellBatches?.length ? <CellBatches item={item} batches={item.cellBatches} /> : null}
  </div>;
}

/** CN1. A wide file's cell files, each its own batch with its own layout and cards; none is on this batch's map. */
function CellBatches({ item, batches }: { item: IntakeItem; batches: readonly CellBatch[] }) {
  return <div className={styles.stack}>
    <p className="ul-help">{CELL_BATCHES_WORDS}</p>
    <ul aria-label={`Separate cell batches of ${item.name}`}>{batches.map((batch) => {
      const path = cellBatchPath(batch);
      const cell = <span className="ul-mono">{batch.cellKey}</span>;
      return <li key={batch.cellKey}>
        {path ? <Link to={path}>Open the batch of cell {cell}</Link> : <>Cell {cell}: a separate batch</>}
        {batch.state && batch.placement
          ? <p className="ul-help">In that batch: {stateWords(batch.state)} · {placementWords(batch.placement)}</p>
          : null}
      </li>;
    })}</ul>
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
