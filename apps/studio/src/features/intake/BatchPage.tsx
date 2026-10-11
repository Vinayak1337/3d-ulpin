import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useParams } from 'react-router';
import { Banner, Button, Skeleton } from '@ulpin/ui';
import { AddFilesDialog } from './AddFilesDialog';
import { DropOutcomes } from './IntakeDropDialog';
import { IntakeTray } from './IntakeTray';
import { LayoutQuestion } from './LayoutQuestion';
import { isSettled } from './batch-model';
import type { IntakeItem } from './batch-model';
import { recipeKey, useBatchPackages, useIntakeManifest } from './batch-queries';
import { IntakeRunPanel } from './run';
import { runKey } from './run/useTargets';
import type { BatchLocationState } from './retain-batch';
import { useSourceCase } from './table/queries';
import { useBatchStream } from './useBatchStream';
import styles from './Batch.module.css';

export function BatchPage() {
  const { caseId = '' } = useParams();
  return <IntakeBatch key={caseId} caseId={caseId} />;
}

function useBatchFacts(caseId: string) {
  const manifest = useIntakeManifest(caseId);
  const sourceCase = useSourceCase(caseId);
  const packages = useBatchPackages(caseId);
  const client = useQueryClient();
  const refresh = () => {
    for (const queryKey of [['intake', caseId], recipeKey(caseId), [...runKey(caseId), 'summary']]) {
      void client.invalidateQueries({ queryKey }, { cancelRefetch: false });
    }
  };
  const items = manifest.data?.items ?? [];
  const stream = useBatchStream(caseId, items.some((item) => !isSettled(item)), refresh);
  return { manifest, sourceCase, packages, items, stream, refresh };
}

function IntakeBatch({ caseId }: { caseId: string }) {
  const batch = useBatchFacts(caseId);
  const { items, sourceCase, stream, refresh } = batch;
  const [selected, setSelected] = useState<IntakeItem | null>(null);
  const [adding, setAdding] = useState(false);
  const location = useLocation();
  const state = location.state as BatchLocationState | null;
  const remainingFiles = state?.remainingFiles ?? [];
  const current = items.find((item) => item.itemId === selected?.itemId) ?? (items.length === 1 ? items[0] : null);
  return <div className={styles.page}>
    <Link to="/studio/work">Batches</Link>
    <header className="ul-row">
      <h1 className="ul-title">Batch{sourceCase.data ? ` · ${sourceCase.data.case.name}` : ''}</h1>
      <Button variant="soft" onClick={() => setAdding(true)}>
        {remainingFiles.length ? 'Continue with other files' : 'Add files to batch'}
      </Button>
    </header>
    <p className="ul-help">Originals stay unchanged. These files prepare drafts; recording needs your confirmation.</p>
    <BatchRecords batch={batch} choose={setSelected} />
    {stream.disconnected ? <Banner tone="warning">
      Live updates are disconnected. Unfinished files are checked no more than once every five seconds.
      <Button variant="soft" onClick={stream.reconnect}>Reconnect updates</Button>
    </Banner> : null}
    <FilesNotAdded state={state} />
    {current?.sourceId && (current.plan || current.placement === 'needs_answer') ?
      <LayoutQuestion key={`${current.itemId}:${current.plan?.recipeId ?? ''}`} caseId={caseId}
        item={current} refresh={refresh} /> : null}
    <section id="intake-run-panel" aria-label="Batch recording and cards">
      <IntakeRunPanel caseId={caseId} />
    </section>
    {adding ? <AddFilesDialog caseId={caseId} initialFiles={remainingFiles}
      onClose={() => setAdding(false)} /> : null}
  </div>;
}

function BatchRecords({ batch, choose }: {
  batch: ReturnType<typeof useBatchFacts>; choose: (item: IntakeItem) => void;
}) {
  const { manifest, sourceCase, packages, items } = batch;
  const listedPackages = packages.error ? [] : packages.data?.packages ?? [];
  return <>
    {manifest.isPending ? <Skeleton /> : null}
    {manifest.error ? <Banner tone="danger">
      {manifest.error.message} {manifest.data ? 'The tray shows the last successful read.' : ''}
    </Banner> : null}
    {sourceCase.error ? <Banner tone="warning">{sourceCase.error.message}</Banner> : null}
    {packages.error ? <Banner tone="warning">{packages.error.message}</Banner> : null}
    {items.length ? <IntakeTray items={items} packages={listedPackages} choose={choose} /> : null}
    {!manifest.isPending && !items.length ? <p>No files are enrolled in this batch.</p> : null}
  </>;
}

function FilesNotAdded({ state }: { state: BatchLocationState | null }) {
  const rows = state?.outcomes?.filter((row) => row.state !== 'enrolled') ?? [];
  if (!rows.length) return null;
  return <section className={styles.stack} aria-label="Files not added to the tray">
    <h2 className="ul-heading">Files not confirmed in the batch</h2>
    <p className="ul-help">These are this upload's responses, not files confirmed in the batch.</p>
    <DropOutcomes rows={rows} />
  </section>;
}
