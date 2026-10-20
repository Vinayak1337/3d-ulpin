import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useParams } from 'react-router';
import { Banner, Button, Skeleton } from '@ulpin/ui';
import { EvidenceProvider } from '../evidence/EvidenceContext';
import { AddFilesDialog } from './AddFilesDialog';
import { DropOutcomes } from './IntakeDropDialog';
import { IntakeTray } from './IntakeTray';
import { IfcStructure } from './ifc/IfcStructure';
import { isIfcItem } from './ifc/structure-model';
import { LayoutQuestion } from './LayoutQuestion';
import { PageImageQuestion } from './PageImageQuestion';
import { isPageImage } from './page-image-model';
import { isSettled, trayItems } from './batch-model';
import { needsLayoutAnswer } from './question-model';
import type { IntakeItem } from './batch-model';
import { recipeKey, useBatchPackages, useIntakeManifest } from './batch-queries';
import { IntakeRunPanel } from './run';
import { runKey } from './run/useTargets';
import type { BatchLocationState } from './retain-batch';
import { useSourceCase } from './table/queries';
import { UnfinishedUploads } from './UnfinishedUploads';
import { keepWaiting, readWaiting, sizeWords, type WaitingFile } from './upload-model';
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
  const items = trayItems(manifest.data?.items ?? []);
  const stream = useBatchStream(caseId, items.some((item) => !isSettled(item)), refresh);
  return { caseId, manifest, sourceCase, packages, items, stream, refresh };
}

function IntakeBatch({ caseId }: { caseId: string }) {
  const batch = useBatchFacts(caseId);
  const { items, sourceCase, stream, refresh } = batch;
  const [selected, setSelected] = useState<IntakeItem | null>(null);
  const [adding, setAdding] = useState(false);
  const location = useLocation();
  const state = location.state as BatchLocationState | null;
  const remainingFiles = state?.remainingFiles ?? [];
  const waiting = useWaitingFiles(caseId, state);
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
      {stream.error || 'Live updates are disconnected.'} The batch is checked no more than once every five seconds.
      <Button variant="soft" onClick={stream.reconnect}>Reconnect updates</Button>
    </Banner> : null}
    <UnfinishedUploads caseId={caseId} refresh={refresh} />
    <FilesNotAdded state={state} />
    <WaitingFiles files={waiting.files} dismiss={waiting.dismiss} />
    {current?.sourceId && (current.plan || needsLayoutAnswer(current)) ?
      <LayoutQuestion key={current.itemId} caseId={caseId}
        item={current} refresh={refresh} /> : null}
    {current && isIfcItem(current) ?
      <IfcStructure key={current.itemId} caseId={caseId} sourceId={current.sourceId} name={current.name} /> : null}
    {isPageImage(current) ? <PageImageQuestion key={current.itemId} caseId={caseId} item={current}
      refresh={refresh} /> : null}
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
  const { caseId, manifest, sourceCase, packages, items, refresh } = batch;
  const listedPackages = packages.error ? [] : packages.data?.packages ?? [];
  return <>
    {manifest.isPending ? <Skeleton /> : null}
    {manifest.error ? <Banner tone="danger">
      {manifest.error.message} {manifest.data ? 'The tray shows the last successful read.' : ''}
    </Banner> : null}
    {sourceCase.error ? <Banner tone="warning">{sourceCase.error.message}</Banner> : null}
    {packages.error ? <Banner tone="warning">{packages.error.message}</Banner> : null}
    {items.length ? <EvidenceProvider>
      <IntakeTray caseId={caseId} items={items} packages={listedPackages} choose={choose} refresh={refresh} />
    </EvidenceProvider> : null}
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

const session = () => sessionStorage;

/** D3. Navigation state is lost on a reload: its files are kept as words under the case id and read back without it. */
function useWaitingFiles(caseId: string, state: BatchLocationState | null) {
  const [files, setFiles] = useState(() => state ? [] : readWaiting(session, caseId));
  useEffect(() => {
    if (state) keepWaiting(session, caseId, waitingFiles(state));
  }, [caseId, state]);
  return { files, dismiss: () => {
    keepWaiting(session, caseId, []);
    setFiles([]);
  } };
}

export function waitingFiles(state: BatchLocationState): WaitingFile[] {
  const notAdded = state.outcomes?.filter((row) => row.state !== 'enrolled') ?? [];
  return [...notAdded.map((row) => ({ name: row.name, sizeBytes: row.sizeBytes, words: row.message ?? null })),
    ...(state.remainingFiles ?? []).map((file) => ({ name: file.name, sizeBytes: file.size, words: null }))];
}

export function WaitingFiles({ files, dismiss }: { files: WaitingFile[]; dismiss: () => void }) {
  if (!files.length) return null;
  const explained = files.filter((file) => file.words);
  return <section className={styles.stack} aria-label="Files waiting before the reload">
    <p>These files were waiting when the page reloaded: {files.map((file) => file.name).join(', ')}. Pick them again
      to add them.</p>
    {explained.length ? <ul>
      {explained.map((file, index) => <li key={index}>{file.name}, {sizeWords(file.sizeBytes)}: {file.words}</li>)}
    </ul> : null}
    <span className="ul-row"><Button variant="soft" onClick={dismiss}>Dismiss</Button></span>
  </section>;
}
