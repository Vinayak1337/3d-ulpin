import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useParams } from 'react-router';
import { Banner, Button, Skeleton } from '@ulpin/ui';
import { EvidenceProvider } from '../evidence/EvidenceContext';
import { AddFilesDialog } from './AddFilesDialog';
import { BatchTableSection } from './BatchTableSection';
import { BatchPdfSection, isBatchPdf } from './BatchPdfSection';
import { DropOutcomes } from './IntakeDropDialog';
import { EvidenceByKey } from './evidence/EvidenceByKey';
import { IntakeTray } from './IntakeTray';
import { IfcStructure } from './ifc/IfcStructure';
import { isIfcItem } from './ifc/structure-model';
import { LayoutQuestion } from './LayoutQuestion';
import { PageImageQuestion } from './PageImageQuestion';
import { PlanReadingSection } from './PlanReadingSection';
import { isPageImage } from './page-image-model';
import { isSettled } from './batch-model';
import { needsLayoutAnswer } from './question-model';
import type { IntakeItem } from './batch-model';
import { intakeKey, recipeKey, rereadQuery, useBatchPackages, useIntakeManifest } from './batch-queries';
import { IntakeItemRefresh } from './item-refresh';
import { IntakeRunPanel } from './run';
import { runKey } from './run/useTargets';
import type { BatchLocationState } from './retain-batch';
import { useSourceCase } from './table/queries';
import { BatchUploadProgress } from './BatchUploadProgress';
import { keepWaiting, readWaiting, sizeWords, type UploadEntry, type WaitingFile } from './upload-model';
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
  const itemRefresh = useMemo(() => new IntakeItemRefresh(client, caseId), [client, caseId]);
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
  const [selected, setSelected] = useState<IntakeItem | null>(null);
  const [adding, setAdding] = useState(false);
  const location = useLocation();
  const state = location.state as BatchLocationState | null;
  const [left, setLeft] = useState<{ key: string; files: File[] } | null>(null);
  // D3. The drop's files not yet routed: the navigation's, until the dialog continuing them reports fewer.
  const remainingFiles = left?.key === location.key ? left.files : state?.remainingFiles ?? NO_FILES;
  const waiting = useWaitingFiles(caseId, state, remainingFiles, items);
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
    <BatchUploadProgress caseId={caseId} refresh={refresh} settled={waiting.settle} />
    <FilesNotAdded state={state} />
    <WaitingFiles files={waiting.files} dismiss={waiting.dismiss} />
    {current ? <ItemDetail key={current.itemId} caseId={caseId} item={current} items={items} refresh={refresh} />
      : null}
    {items.length ? <EvidenceByKey caseId={caseId} items={items} /> : null}
    <section id="intake-run-panel" aria-label="Batch recording and cards">
      <IntakeRunPanel caseId={caseId} />
    </section>
    {adding ? <AddFilesDialog caseId={caseId} initialFiles={remainingFiles}
      onRemaining={remainingFiles.length ? (files) => setLeft({ key: location.key, files }) : undefined}
      onClose={() => setAdding(false)} /> : null}
  </div>;
}

/** D1. The chosen item's sections, keyed once by the item: a new item starts every section afresh. */
function ItemDetail({ caseId, item, items, refresh }: {
  caseId: string; item: IntakeItem; items: IntakeItem[]; refresh: () => void;
}) {
  return <>
    {item.sourceId && (item.plan || needsLayoutAnswer(item)) ?
      <LayoutQuestion caseId={caseId} item={item} refresh={refresh} /> : null}
    {isIfcItem(item) ? <IfcStructure caseId={caseId} sourceId={item.sourceId} name={item.name} /> : null}
    {isPageImage(item) ? <PageImageQuestion caseId={caseId} item={item} refresh={refresh} /> : null}
    <BatchPdfSection caseId={caseId} item={item} />
    <PlanReadingSection caseId={caseId} item={item} refresh={refresh} />
    <BatchTableSection caseId={caseId} item={item} items={items} />
  </>;
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
    {items.some(isBatchPdf) ? <nav className="ul-row" aria-label="PDF readings">
      {items.filter(isBatchPdf).map(item => <Button key={item.itemId} variant="soft" onClick={() => choose(item)}>
        View PDF reading · {item.name}
      </Button>)}
    </nav> : null}
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
