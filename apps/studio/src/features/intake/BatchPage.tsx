import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { Banner, Button, Skeleton } from '@ulpin/ui';
import { AddFilesDialog } from './AddFilesDialog';
import { DropOutcomes } from './IntakeDropDialog';
import { IntakeTray } from './IntakeTray';
import { LayoutQuestion } from './LayoutQuestion';
import { isSettled } from './batch-model';
import type { IntakeItem } from './batch-model';
import { useIntakeManifest } from './batch-queries';
import type { BatchLocationState } from './retain-batch';
import { useSourceCase } from './table/queries';
import { useBatchStream } from './useBatchStream';
import styles from './Batch.module.css';

export function BatchPage() {
  const { caseId = '' } = useParams();
  return <IntakeBatch key={caseId} caseId={caseId} />;
}

function IntakeBatch({ caseId }: { caseId: string }) {
  const manifest = useIntakeManifest(caseId);
  const sourceCase = useSourceCase(caseId);
  const items = manifest.data?.items ?? [];
  const stream = useBatchStream(caseId, items.some((item) => !isSettled(item)), manifest.refetch);
  const [selected, setSelected] = useState<IntakeItem | null>(null);
  const [adding, setAdding] = useState(false);
  const location = useLocation();
  const state = location.state as BatchLocationState | null;
  const remainingFiles = state?.remainingFiles ?? [];
  const current = items.find((item) => item.itemId === selected?.itemId);
  return <div className={styles.page}>
    <Link to="/studio/work">Batches</Link>
    <header className="ul-row">
      <h1 className="ul-title">Intake batch{sourceCase.data ? ` · ${sourceCase.data.case.name}` : ''}</h1>
      <Button variant="soft" onClick={() => setAdding(true)}>
        {remainingFiles.length ? 'Continue with other files' : 'Add files to batch'}
      </Button>
    </header>
    <p className="ul-help">Originals stay unchanged. These files prepare drafts; nothing is recorded here.</p>
    {manifest.isPending ? <Skeleton /> : null}
    {manifest.error ? <Banner tone="danger">
      {manifest.error.message} {manifest.data ? 'The tray shows the last successful read.' : ''}
    </Banner> : null}
    {sourceCase.error ? <Banner tone="warning">{sourceCase.error.message}</Banner> : null}
    <BatchContents items={items} loading={manifest.isPending} choose={setSelected} />
    {stream.disconnected ? <Banner tone="warning">
      Live updates are disconnected. Unfinished files are checked no more than once every five seconds.
      <Button variant="soft" onClick={stream.reconnect}>Reconnect updates</Button>
    </Banner> : null}
    <FilesNotAdded state={state} />
    {current?.sourceId && current.placement === 'needs_answer' ?
      <LayoutQuestion key={current.sourceId} caseId={caseId} sourceId={current.sourceId} name={current.name} /> : null}
    {adding ? <AddFilesDialog caseId={caseId} initialFiles={remainingFiles}
      onClose={() => setAdding(false)} /> : null}
  </div>;
}

function FilesNotAdded({ state }: { state: BatchLocationState | null }) {
  const rows = state?.outcomes?.filter((row) => row.state !== 'enrolled') ?? [];
  if (!rows.length) return null;
  return <section className={styles.stack} aria-label="Files not added to the tray">
    <h2 className="ul-heading">Files not confirmed in the batch</h2>
    <p className="ul-help">These are this upload's responses, not retained intake records.</p>
    <DropOutcomes rows={rows} />
  </section>;
}

function BatchContents({ items, loading, choose }: {
  items: IntakeItem[]; loading: boolean; choose: (item: IntakeItem) => void;
}) {
  return <>
    {items.length ? <IntakeTray items={items} choose={choose} /> : null}
    {!loading && !items.length ? <p>No files are enrolled in this batch.</p> : null}
    {/* Merge seam: mount the batch confirmation, targets and cards panel here, below the tray. */}
    <section id="intake-run-panel" aria-label="Batch recording and cards" />
  </>;
}
