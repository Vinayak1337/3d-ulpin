import { useState } from 'react';
import { itemPendingKinds } from '@ulpin/contracts/usp';
import { Button, DataTable } from '@ulpin/ui';
import { useQuery } from '@tanstack/react-query';
import { readingOptions } from './reading-model';
import { Link } from 'react-router';
import { useOpenEvidence } from '../evidence/EvidenceContext';
import type { Package } from './run/model';
import { itemTableSource } from './BatchTableSection';
import { needsLayoutAnswer } from './question-model';
import { isPageImage } from './page-image-model';
import { canRetryStopped } from './retry-command';
import { StoppedRetry } from './StoppedRetry';
import { PlanReadingSummary } from './PlanReadingSection';
import { StatusChip } from './StatusChip';
import { itemChip } from './status-chip';
import { useSourceCase } from './table/queries';
import { LayerCrsAnswers } from './LayerCrsAnswer';
import { contentsWords, crsWords, placementWords, stateWords, packagePath, partProgressWords, opensPages,
  cellBatchPath, intakeTrayRows } from './batch-model';
import type { CellBatch, IntakeItem } from './batch-model';
import { isIfcItem } from './ifc/structure-model';
import { opensReading } from './native/reading-model';
import { opensPreview } from './surface/preview-model';
import styles from './Batch.module.css';

export function IntakeTray({ caseId, items, packages, choose, selectedId, refresh }: {
  caseId: string; items: IntakeItem[]; packages: readonly Package[]; choose: (item: IntakeItem) => void;
  selectedId?: string; refresh: () => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const rows = intakeTrayRows(items);
  const forced = new Set(rows.filter(row => row.item.itemId === selectedId
    || itemPendingKinds(row.item, items).length).map(row => row.archiveId));
  const open = new Set(rows.filter(row => row.members.length <= 10 || forced.has(row.item.itemId)
    || expanded[row.item.itemId]).map(row => row.item.itemId));
  const hidden = new Set<string>();
  const visible = rows.filter(row => {
    if (!row.archiveId || (open.has(row.archiveId) && !hidden.has(row.archiveId))) return true;
    hidden.add(row.item.itemId);
    return false;
  });
  return <div className={styles.tray} tabIndex={0} role="region" aria-label="Files in this batch">
    <DataTable caption="Files in this batch" rows={visible} rowKey={({ item }) => item.itemId}
      selectedKey={selectedId ?? null} columns={[
      { header: 'File', cell: ({ item, archiveId, members }) => <div className={archiveId ? styles.member : undefined}>
        <button type="button" className="ul-table__rowbtn"
          aria-current={item.itemId === selectedId ? true : undefined} onClick={() => choose(item)}>
          {item.name}
        </button>
        {' '}{members.length > 10 ? <Button variant="ghost" aria-expanded={open.has(item.itemId)}
          aria-label={`${open.has(item.itemId) ? 'Hide' : 'Show'} the ${members.length} files of ${item.name}`}
          disabled={forced.has(item.itemId)}
          onClick={() => setExpanded(prior => ({ ...prior, [item.itemId]: !open.has(item.itemId) }))}>
          {members.length}
        </Button> : members.length ? <span>{members.length}</span> : null}
      </div> },
      { header: 'Contents', cell: ({ item }) => <ReadingContents caseId={caseId} item={item} /> },
      { header: 'Status', cell: ({ item }) => <>
        <StatusChip chip={itemChip(item, items)} />
        {partProgressWords(item) ? <p className="ul-help">{partProgressWords(item)}</p> : null}
        {item.limitReason ? <p className="ul-help">{item.limitReason}</p> : null}
        {item.planReadings?.length ? <div className="ul-help"><PlanReadingSummary readings={item.planReadings} /></div>
          : null}
      </> },
      { header: 'Coordinates', cell: ({ item }) => crsWords(item.card) },
      { header: 'Next step', cell: ({ item }) => <NextStep caseId={caseId} item={item} items={items} packages={packages}
        choose={choose} refresh={refresh} /> },
    ]} />
  </div>;
}

function ReadingContents({ caseId, item }: { caseId: string; item: IntakeItem }) {
  const { data } = useQuery({ ...readingOptions(caseId, item.itemId), enabled: false });
  return <>{data?.what.words ?? contentsWords(item)}</>;
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
    {opensReading(item) ? <Button variant="soft" onClick={() => choose(item)}
      aria-label={`Open the reading: ${item.name}`}>Open the reading</Button> : null}
    {isPageImage(item) ? <Button variant="soft" onClick={() => choose(item)}
      aria-label={`View page image: ${item.name}`}>View page image</Button> : null}
    {opensPreview(item) ? <Button variant="soft" onClick={() => choose(item)}
      aria-label={`View the surface: ${item.name}`}>View the surface</Button> : null}
    {canRetryStopped(item) ? <StoppedRetry key={item.updatedAt} caseId={caseId} item={item} refresh={refresh} /> : null}
    {opensPages(item) ? <ReviewPages caseId={caseId} item={item} /> : null}
    {item.layerCrs?.length ? <LayerCrsAnswers caseId={caseId} item={item} refresh={refresh} /> : null}
    {item.cellBatches?.length ? <CellBatches item={item} batches={item.cellBatches} /> : null}
  </div>;
}

/** CN1. A wide file's cell files, each its own batch with its own layout and cards; none is on this batch's map. */
function CellBatches({ item, batches }: { item: IntakeItem; batches: readonly CellBatch[] }) {
  return <div className={styles.stack}>
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
