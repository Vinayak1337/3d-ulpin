import { lazy, Suspense, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useParams, useSearchParams } from 'react-router';
import { Banner, Button, Skeleton } from '@ulpin/ui';
import { EvidenceProvider } from '../evidence/EvidenceContext';
import { AddFilesDialog } from './AddFilesDialog';
import { BatchTableSection } from './BatchTableSection';
import { BatchPdfSection } from './BatchPdfSection';
import { DropOutcomes } from './IntakeDropDialog';
import { EvidenceByKey } from './evidence/EvidenceByKey';
import { evidencePageOptions } from './evidence/api';
import { anchorItems, type LinkDeclaration } from './evidence/model';
import { batchNeeds, primaryPress, type PrimaryPress } from './needs-model';
import { StepStrip } from './StepStrip';
import { NeedsYou } from './NeedsYou';
import { IntakeTray } from './IntakeTray';
import { IfcStructure } from './ifc/IfcStructure';
import { isIfcItem } from './ifc/structure-model';
import { opensReading } from './native/reader-of';
import { SurfacePreview } from './surface/SurfacePreview';
import { opensPreview } from './surface/preview-model';
import { SurfaceMapLink } from '../map/surface/SurfaceMapLink';
import { LayoutQuestion } from './LayoutQuestion';
import { ReadingCard } from './ReadingCard';
import { PageImageQuestion } from './PageImageQuestion';
import { PlanReadingSection } from './PlanReadingSection';
import { isPageImage } from './page-image-model';
import { batchMapPath, isSettled } from './batch-model';
import { needsLayoutAnswer } from './question-model';
import type { IntakeItem } from './batch-model';
import { intakeKey, recipeKey, rereadQuery, useBatchPackages, useIntakeManifest } from './batch-queries';
import { itemRefreshFor } from './item-refresh';
import { IntakeRunPanel } from './run';
import { runKey } from './run/useTargets';
import type { BatchLocationState } from './retain-batch';
import { useSourceCase } from './table/queries';
import { BatchUploadProgress } from './BatchUploadProgress';
import { batchUploadKey, type BatchUpload } from './useRetainBatch';
import { keepWaiting, readWaiting, sizeWords, type UploadEntry, type WaitingFile } from './upload-model';
import { useBatchStream } from './useBatchStream';
import styles from './Batch.module.css';

// The reading draws its model preview with the scene: load both only when an item's reading opens, not with the page.
const NativeReading = lazy(async () => ({ default: (await import('./native/NativeReading')).NativeReading }));

export function BatchPage() {
  const { caseId = '' } = useParams();
  return <IntakeBatch key={caseId} caseId={caseId} />;
}

function useBatchFacts(caseId: string) {
  const manifest = useIntakeManifest(caseId);
  const sourceCase = useSourceCase(caseId);
  const packages = useBatchPackages(caseId);
  const client = useQueryClient();
  // SL1: the one refresh of this batch, shared with the map's layer.
  const itemRefresh = itemRefreshFor(client, caseId);
  const others = () => {
    for (const queryKey of [recipeKey(caseId), [...runKey(caseId), 'summary']]) rereadQuery(client, queryKey);
  };
  const refresh = () => {
    rereadQuery(client, intakeKey(caseId));
    others();
  };
  // TR1: a change naming one item the tray holds reads that item alone; any other change reads the manifest.
  const changed = (itemId?: string) => {
    itemRefresh.changed(itemId);
    others();
  };
  // ZP2: the server lists a ZIP member taken out as its own item once, as that item; every listed row shows.
  const items = manifest.data?.items ?? NO_ITEMS;
  const stream = useBatchStream(caseId, items.some((item) => !isSettled(item)), changed);
  return { caseId, manifest, sourceCase, packages, items, stream, refresh };
}

const NO_FILES: File[] = [];
const NO_ITEMS: IntakeItem[] = [];

function IntakeBatch({ caseId }: { caseId: string }) {
  const batch = useBatchFacts(caseId);
  const { items, sourceCase, stream, refresh } = batch;
  const [search, setSearch] = useSearchParams();
  const [adding, setAdding] = useState(false);
  const [requested, setRequested] = useState<LinkDeclaration | null>(null);
  const anchors = anchorItems(items, batch.packages.data?.packages ?? []);
  const evidence = useQuery({ ...evidencePageOptions(caseId), enabled: anchors.length > 0 });
  const needs = batchNeeds(items, batch.packages.data, evidence.data);
  const location = useLocation();
  const [opening, setOpening] = useState<{ key: string; itemId: string } | null>(null);
  const selectedId = opening?.key === location.key ? opening.itemId : search.get('item');
  const state = location.state as BatchLocationState | null;
  const [left, setLeft] = useState<{ key: string; files: File[] } | null>(null);
  // D3. The drop's files not yet routed: the navigation's, until the dialog continuing them reports fewer.
  const remainingFiles = left?.key === location.key ? left.files : state?.remainingFiles ?? NO_FILES;
  const waiting = useWaitingFiles(caseId, state, remainingFiles, items);
  const current = items.find((item) => item.itemId === selectedId) ?? (items.length === 1 ? items[0] : null);
  const choose = (item: IntakeItem) => {
    // Needs you focuses the detail before the router's transition commits; the URL takes over on that commit.
    setOpening({ key: location.key, itemId: item.itemId });
    setSearch((previous) => {
      const next = new URLSearchParams(previous);
      next.set('item', item.itemId);
      return next;
    }, { replace: true, state: state ? { ...state, remainingFiles } : null });
  };
  const primary = primaryPress(current, items);
  const mapPath = batchMapPath(items, batch.packages.error ? [] : batch.packages.data?.packages ?? []);
  return <div className={styles.page}>
    <Link to="/studio/work">Batches</Link>
    <header className="ul-row">
      <h1 className="ul-title">{sourceCase.data?.case.name ?? 'Batch'}</h1>
      <Button variant="soft" onClick={() => setAdding(true)}>
        {remainingFiles.length ? 'Continue with other files' : 'Add files to batch'}
      </Button>
      {mapPath ? <Link className="ul-btn ul-btn--soft" to={mapPath}>Open on the map</Link> : null}
    </header>
    <div className={styles.workspace}>
      <div className={styles.stack}>
        {batch.manifest.data ? <>
          <StepStrip steps={needs.steps} current={needs.current} />
          <NeedsYou actions={needs.actions} status={needs.status} choose={choose} />
        </> : null}
        <section id="intake-files" aria-label="Batch files">
          <BatchRecords batch={batch} choose={choose} selectedId={current?.itemId} />
        </section>
      </div>
      <section key={current?.itemId} id="intake-reading" className={styles.reading}
        aria-label="File reading" tabIndex={current ? 0 : undefined}>
        {current ? <ItemDetail caseId={caseId} item={current} items={items} refresh={refresh}
          onDeclare={setRequested} primary={primary} /> : null}
      </section>
    </div>
    {batch.manifest.error ? <Banner tone="danger">
      {batch.manifest.error.message} {batch.manifest.data ? 'The tray shows the last successful read.' : ''}
    </Banner> : null}
    {sourceCase.error ? <Banner tone="warning">{sourceCase.error.message}</Banner> : null}
    {batch.packages.error ? <Banner tone="warning">{batch.packages.error.message}</Banner> : null}
    {stream.disconnected ? <Banner tone="warning">
      {stream.error || 'Live updates are disconnected.'}
      <Button variant="soft" onClick={stream.reconnect}>Reconnect updates</Button>
    </Banner> : null}
    <BatchUploadProgress caseId={caseId} refresh={refresh} settled={waiting.settle} />
    <FilesNotAdded state={state} />
    <WaitingFiles files={waiting.files} dismiss={waiting.dismiss} />
    {items.length ? <EvidenceByKey caseId={caseId} items={items}
      requested={requested} clearRequest={() => setRequested(null)} /> : null}
    <section id="intake-run-panel" aria-label="Batch recording and cards">
      <IntakeRunPanel caseId={caseId} mapPath={mapPath} primary={primary === 'record'} />
    </section>
    {adding ? <AddFilesDialog caseId={caseId} initialFiles={remainingFiles}
      onRemaining={remainingFiles.length ? (files) => setLeft({ key: location.key, files }) : undefined}
      onClose={() => setAdding(false)} /> : null}
  </div>;
}

/** D1. The chosen item's sections, keyed once by the item: a new item starts every section afresh. */
function ItemDetail({ caseId, item, items, refresh, onDeclare, primary }: {
  caseId: string; item: IntakeItem; items: IntakeItem[]; refresh: () => void;
  onDeclare: (initial: LinkDeclaration) => void; primary: PrimaryPress;
}) {
  return <>
    <ReadingCard caseId={caseId} item={item} onDeclare={onDeclare} />
    {item.sourceId && (item.plan || needsLayoutAnswer(item)) ?
      <LayoutQuestion caseId={caseId} item={item} refresh={refresh} primary={primary === 'layout'} /> : null}
    {isIfcItem(item) ? <IfcStructure caseId={caseId} sourceId={item.sourceId} name={item.name} /> : null}
    {isPageImage(item) ? <PageImageQuestion caseId={caseId} item={item} refresh={refresh} /> : null}
    {opensReading(item) ? <Suspense fallback={<Skeleton />}>
      <NativeReading caseId={caseId} item={item} />
    </Suspense> : null}
    {opensPreview(item) ? <SurfacePreview item={item} /> : null}
    <SurfaceMapLink item={item} />
    <BatchPdfSection caseId={caseId} item={item} />
    <PlanReadingSection caseId={caseId} item={item} refresh={refresh} />
    <BatchTableSection caseId={caseId} item={item} items={items} primary={primary === 'table'} />
  </>;
}

function BatchRecords({ batch, choose, selectedId }: {
  batch: ReturnType<typeof useBatchFacts>; choose: (item: IntakeItem) => void; selectedId?: string;
}) {
  const { caseId, manifest, packages, items, refresh } = batch;
  const listedPackages = packages.error ? [] : packages.data?.packages ?? [];
  const { data: upload } = useQuery<BatchUpload | null>({ queryKey: batchUploadKey(caseId),
    queryFn: () => null, enabled: false });
  return <>
    {manifest.isPending ? <Skeleton /> : null}
    {items.length ? <EvidenceProvider>
      <IntakeTray caseId={caseId} items={items} packages={listedPackages} choose={choose}
        selectedId={selectedId} refresh={refresh} />
    </EvidenceProvider> : null}
    {!manifest.isPending && !items.length ? <p role="status">{upload?.pending
      ? 'The dropped files are being kept.'
      : 'No files are enrolled in this batch.'}</p> : null}
  </>;
}

function FilesNotAdded({ state }: { state: BatchLocationState | null }) {
  const rows = state?.outcomes?.filter((row) => row.state !== 'enrolled') ?? [];
  if (!rows.length) return null;
  return <section className={styles.stack} aria-label="Files not added to the tray">
    <h2 className="ul-heading">Files not confirmed in the batch</h2>
    <DropOutcomes rows={rows} />
  </section>;
}

const session = () => sessionStorage;

type ItemFacts = Pick<IntakeItem, 'name' | 'sizeBytes'>;

/** D2. A waiting file is done once an item of its name and size is in the batch: picked again and finished. */
export function stillWaiting(files: WaitingFile[], items: readonly ItemFacts[]): WaitingFile[] {
  return files.filter((file) => !items.some((item) => item.name === file.name
    && (item.sizeBytes == null || item.sizeBytes === file.sizeBytes)));
}

/**
 * D3 (N04). Navigation state is lost on a reload: its files are kept as words under the case id and read back
 * without it. D2: a file leaves the words once it is in the batch or its unfinished upload settles.
 */
function useWaitingFiles(caseId: string, state: BatchLocationState | null, remainingFiles: File[],
  items: readonly ItemFacts[]) {
  const [files, setFiles] = useState(() => state ? [] : readWaiting(session, caseId));
  useEffect(() => {
    if (state) keepWaiting(session, caseId, waitingFiles({ ...state, remainingFiles }));
  }, [caseId, state, remainingFiles]);
  const keep = (done: (file: WaitingFile) => boolean) => {
    const rest = (list: WaitingFile[]) => list.filter((file) => !done(file));
    keepWaiting(session, caseId, rest(readWaiting(session, caseId)));
    setFiles(rest);
  };
  useEffect(() => {
    const finished = (file: WaitingFile) => !stillWaiting([file], items).length;
    if (files.some(finished) || readWaiting(session, caseId).some(finished)) keep(finished);
  }, [caseId, files, items]);
  return {
    files,
    dismiss: () => keep(() => true),
    settle: (entry: UploadEntry) => keep((file) => file.name === entry.filename && file.sizeBytes === entry.bytes),
  };
}

export function waitingFiles(state: BatchLocationState): WaitingFile[] {
  const notAdded = state.outcomes?.filter((row) => row.state !== 'enrolled') ?? [];
  return [...notAdded.map((row) => ({ name: row.name, sizeBytes: row.sizeBytes, words: row.message ?? null })),
    ...(state.remainingFiles ?? []).map((file) => ({ name: file.name, sizeBytes: file.size, words: null }))];
}

/** D1. A stable key from the file's words; a second file of the same name and size is counted. */
function fileKey(files: WaitingFile[], index: number) {
  const file = files[index]!;
  const same = files.slice(0, index)
    .filter((other) => other.name === file.name && other.sizeBytes === file.sizeBytes);
  return `${file.name}:${file.sizeBytes}:${same.length}`;
}

export function WaitingFiles({ files, dismiss }: { files: WaitingFile[]; dismiss: () => void }) {
  if (!files.length) return null;
  const explained = files.filter((file) => file.words);
  return <section className={styles.stack} aria-label="Files waiting before the reload">
    <p>These files were waiting when the page reloaded: {files.map((file) => file.name).join(', ')}. Pick them again
      to add them.</p>
    {explained.length ? <ul>
      {explained.map((file, index) => <li key={fileKey(explained, index)}>
        {file.name}, {sizeWords(file.sizeBytes)}: {file.words}
      </li>)}
    </ul> : null}
    <span className="ul-row"><Button variant="soft" onClick={dismiss}>Dismiss</Button></span>
  </section>;
}
