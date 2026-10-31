import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { CaretDown, CheckCircle, FileArrowUp, Trash, Warning } from '@phosphor-icons/react';
import type { FileDetection, ImportBatch } from '@ulpin/api-client/draft';
import type { Schemas } from '@ulpin/api-client';
import { Badge, Banner, Button, DataTable, Dialog, Icon, Skeleton, StatusBadge, formatCount, formatDateTime } from '@ulpin/ui';
import { demoImportEnabled, inspectDemoFile, startDemoImport } from '../../api/demo-import';
import { detectBuildingFiles, startBuildingImport, useBuildingRegister, useImportBatch } from '../../api/queries';
import { useBuildingActions, useClearAction, useRecordAction } from '../workflow/useWorkflow';
import styles from './AddFilesDialog.module.css';
import { batchOrder, dropState, routeWords } from './file-route';
import { IntakeDropDialog } from './IntakeDropDialog';

type Inspection = Schemas['POST_import_packages_inspect_Response_200_application_json'] & { demoContents?: string };

interface Picked {
  file: File;
  /** `ready`: answered by the opt-in NYC upload profile, the only reader in this dialog. */
  state: 'inspecting' | 'ready' | 'intake';
  inspection?: Inspection;
}

/** The Detected column's words for one picked file. */
function detected(f: Picked) {
  if (f.state === 'ready') return formatLabel(f.inspection!.format);
  return f.state === 'inspecting' ? 'Reading…' : routeWords(f.file.name);
}

const STEPS = ['Drop files', 'Check what we found', 'Confirm'] as const;

/**
 * S2 Add files. N01: every file of one drop joins the batch of one case, a GeoPackage and any ZIP included; S7.13a: a
 * table the batch reads included, and the opt-in NYC profile keeps its separate development transport. TJ1: a table
 * dropped on the batch page, or with a file that makes a batch, joins that batch as its own item.
 */
export function AddFilesDialog({ onClose, batchId, buildingId, routed = false, caseId, initialFiles, onRemaining }: {
  onClose: () => void; batchId?: string | null; buildingId?: string | null; routed?: boolean; caseId?: string;
  initialFiles?: File[]; onRemaining?: (files: File[]) => void;
}) {
  if (batchId) return <SavedBatch batchId={batchId} onClose={onClose} />;
  if (buildingId) return <BuildingFiles buildingId={buildingId} onClose={onClose} routed={routed} />;
  return <NewFiles onClose={onClose} routed={routed} openCaseId={caseId} initialFiles={initialFiles}
    onRemaining={onRemaining} />;
}

/** G10. A PDF is kept in a batch and read there by the server's page reader; the name only routes the drop. */
const isPdf = (file: File) => /\.pdf$/i.test(file.name);

/**
 * Add files to one building: plans, level schedules, unit inventories and deeds. A PDF goes to a batch, where the
 * server reads its pages; each other file is recognised, then Start import records the building's levels and units.
 */
function BuildingFiles({ buildingId, onClose, routed }: { buildingId: string; onClose: () => void; routed: boolean }) {
  const register = useBuildingRegister(buildingId).data;
  const navigate = useNavigate();
  const client = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const [found, setFound] = useState<FileDetection[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pdfs, setPdfs] = useState<File[]>([]);
  const add = async (list: FileList | null) => {
    const picked = [...list ?? []];
    if (picked.some(isPdf)) setPdfs((prior) => [...prior, ...picked.filter(isPdf)]);
    const others = picked.filter((file) => !isPdf(file));
    if (!others.length) return;
    const next = [...files, ...others];
    setFiles(next);
    try { setFound(await detectBuildingFiles(buildingId, next)); } catch (e) { setError((e as Error).message); }
  };
  const start = useMutation({
    mutationFn: () => startBuildingImport(buildingId, files),
    onSuccess: async (imp) => {
      await client.invalidateQueries();
      // As a route the dialog closes by going back; that would undo this navigation, so leave by replacing.
      if (!routed) onClose();
      navigate(`/studio/areas/${register?.area.id}?feature=${buildingId}&mode=building&building-import=${imp.id}`, { replace: routed });
    },
    onError: (e) => setError((e as Error).message),
  });
  const step = !files.length ? 0 : 1;
  if (pdfs.length) {
    return <IntakeDropDialog files={pdfs} remainingFiles={files} routed={routed} onClose={onClose}
      onBack={() => setPdfs([])} />;
  }
  return (
    <Dialog
      title={`Add files · ${register?.property.name ?? 'building'}`}
      onClose={onClose}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button variant="primary" disabled={!found.length || start.isPending || !register} onClick={() => start.mutate()}>Start import</Button>
        </>
      )}
    >
      <div className="ul-stack" style={{ gap: 20 }}>
        <Stepper step={step} />
        <label className={styles.drop} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void add(event.dataTransfer.files); }}>
          <Icon icon={FileArrowUp} size={32} />
          <span className="ul-heading">Drop plans, level schedules, unit inventories or deeds</span>
          <input type="file" multiple className="ul-visually-hidden" onChange={(event) => void add(event.target.files)} />
        </label>
        {found.length ? (
          <div className="ul-panel">
            <DataTable caption="Files for this building" rows={found} rowKey={(f) => f.name} columns={[
              { header: 'File', cell: (f) => <span className="ul-id">{f.name}</span> },
              { header: 'Detected', cell: (f) => f.detected },
              { header: 'Reads', cell: (f) => f.contents },
              { header: 'Size', numeric: true, cell: (f) => `${Math.max(1, Math.round(f.bytes / 1024))} KB` },
              { header: 'Mapping', cell: (f) => <Badge tone={f.role === 'other' ? 'neutral' : 'info'} icon={null}>{f.role === 'other' ? 'Kept as evidence' : 'Proposed'}</Badge> },
            ]} />
          </div>
        ) : null}
        {error ? <Banner tone="danger">{error}</Banner> : null}
      </div>
    </Dialog>
  );
}

/**
 * D3. A drop's files stay listed with their route words until each is kept in the batch or removed. `onRemaining`
 * hears which files of the drop are still to route after a removal. S7.13a: a drop that makes a batch opens it at
 * once, its tables included; Back to files returns here, and Continue opens it again.
 */
function NewFiles({ onClose, routed, openCaseId, initialFiles, onRemaining }: {
  onClose: () => void; routed: boolean; openCaseId?: string; initialFiles?: File[];
  onRemaining?: (files: File[]) => void;
}) {
  const client = useQueryClient();
  const [files, setFiles] = useState<Picked[]>([]);
  const [step, setStep] = useState(0);
  const [showIntake, setShowIntake] = useState(false);
  const initialized = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const gis = files.find((f) => f.state === 'ready');
  const demoUpload = Boolean(gis);

  const add = async (list: FileList | File[] | null) => {
    if (!list?.length) return;
    const picked = [...list].map<Picked>((file) => ({ file,
      state: dropState(file.name, demoImportEnabled) }));
    setFiles((current) => [...current, ...picked]);
    setStep(1);
    let batched = picked.some((p) => p.state === 'intake');
    for (const item of picked.filter((p) => p.state === 'inspecting')) {
      // The opt-in NYC profile keeps its transport; a file it does not take joins the batch.
      const inspection = await inspectDemoFile(item.file).catch(() => null);
      setFiles((current) => current.map((file) => file.file !== item.file ? file
        : inspection ? { ...file, state: 'ready', inspection } : { ...file, state: 'intake' }));
      batched ||= !inspection;
    }
    if (batched) setShowIntake(true);
  };

  useEffect(() => {
    if (initialized.current || !initialFiles?.length) return;
    initialized.current = true;
    void add(initialFiles);
  }, [initialFiles]);

  const importFile = useMutation({
    mutationFn: () => startDemoImport(files.map(item => item.file)),
    onSuccess: async (pkg) => { await client.invalidateQueries(); navigate(`/studio/areas/${pkg.areaId}?package=${pkg.id}`); },
  });

  // S7.13a: outside the NYC profile, Continue takes the drop to the batch; only the profile waits for its check.
  const blocked = demoUpload && files.some(f => f.state !== 'ready')
    ? 'wait for every file to pass the NYC profile check' : null;

  const rows = useMemo(() => files, [files]);
  const intakeFiles = batchOrder(files.filter((file) => file.state === 'intake').map((file) => file.file));
  const remove = (picked: Picked) => {
    setFiles((current) => current.filter((x) => x !== picked));
    onRemaining?.(files.filter((x) => x !== picked).map((x) => x.file));
  };
  if (showIntake && intakeFiles.length) {
    return <IntakeDropDialog files={intakeFiles} openCaseId={openCaseId} routed={routed} onClose={onClose}
      remainingFiles={files.filter((file) => file.state !== 'intake').map((file) => file.file)}
      onBack={() => setShowIntake(false)} />;
  }
  return (
    <Dialog
      title="Add files"
      onClose={onClose}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          {!demoUpload || step < 2
            ? <Button variant="primary" disabled={demoUpload ? Boolean(blocked) : !intakeFiles.length}
              onClick={() => (demoUpload ? setStep(2) : setShowIntake(true))}>Continue</Button>
            : <Button variant="primary" disabled={Boolean(blocked) || importFile.isPending} onClick={() => importFile.mutate()}>Start import</Button>}
        </>
      )}
    >
      <div className="ul-stack" style={{ gap: 20 }}>
        <Stepper step={step} />
        {step === 0 || !files.length ? (
          <label
            className={styles.drop}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => { event.preventDefault(); void add(event.dataTransfer.files); }}
          >
            <Icon icon={FileArrowUp} size={32} />
            <span className="ul-heading">Drop files here, or choose files</span>
            <input ref={input} type="file" multiple className="ul-visually-hidden" onChange={(event) => void add(event.target.files)} />
          </label>
        ) : null}

        {files.length ? (
          <div className="ul-panel">
            <DataTable
              caption="Files in this batch"
              rows={rows}
              rowKey={(f) => `${f.file.name}-${f.file.size}-${f.file.lastModified}`}
              columns={[
                { header: 'File', cell: (f) => f.file.name },
                { header: 'Detected', cell: detected },
                { header: 'CRS', cell: (f) => (f.inspection ? (f.inspection.sourceCrs ?? <Badge tone="warning" icon={Warning}>CRS unverified</Badge>) : '—') },
                { header: 'Contents', numeric: true, cell: (f) => f.inspection?.demoContents || (
                  f.inspection?.featureCount === null || f.inspection?.featureCount === undefined ? '—'
                    : `${formatCount(f.inspection.featureCount)} features`) },
                { header: 'Mapping', cell: (f) => f.state === 'ready'
                  ? <Badge tone="info" icon={null}>Proposed</Badge> : '—' },
                ...(step < 2 ? [{ header: '', cell: (f: Picked) => <Button variant="ghost" iconOnly icon={Trash}
                  aria-label={`Remove ${f.file.name}`} onClick={() => remove(f)} /> }] : []),
              ]}
            />
          </div>
        ) : null}

        {gis?.inspection?.quarantine ? <Banner tone="warning">{gis.inspection.quarantine.message}</Banner> : null}
        {importFile.error ? <Banner tone="danger">{importFile.error.message}</Banner> : null}
        {blocked && files.length ? <p className="ul-help">Blocked: {blocked}.</p> : null}
      </div>
    </Dialog>
  );
}

const MAPPING: Record<ImportBatch['files'][number]['mapping'], { label: string; tone: 'success' | 'info' | 'neutral' }> = {
  reused: { label: 'Reused mapping', tone: 'success' }, proposed: { label: 'Proposed', tone: 'info' }, manual: { label: 'Manual', tone: 'neutral' },
};

/** A saved batch reopened: what was found in each file, CRS to confirm and mapping questions, then Start import. */
function SavedBatch({ batchId, onClose }: { batchId: string; onClose: () => void }) {
  const navigate = useNavigate();
  const batch = useImportBatch(batchId);
  const actions = useBuildingActions(batchId).data ?? [];
  const record = useRecordAction();
  const clear = useClearAction();
  const answer = (subject: string) => actions.find((a) => a.kind === 'record' && a.subjectId === subject)?.value ?? null;
  const [choosing, setChoosing] = useState<string | null>(null);
  const [fieldFor, setFieldFor] = useState<string | null>(null);

  if (batch.isPending) return <Dialog title="Add files" onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}><div className="ul-stack">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} />)}</div></Dialog>;
  if (!batch.data) return <Dialog title="Add files" onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}><Banner tone="danger">This batch could not be opened.</Banner></Dialog>;
  const b = batch.data;
  const crsOf = (f: ImportBatch['files'][number]) => f.crs ?? answer(`crs:${f.name}`);
  const unverified = b.files.filter((f) => f.crsApplies && !crsOf(f));
  const open = b.questions.filter((q) => !answer(`question:${q.id}`));
  const blocked = unverified.length ? `choose the coordinate system of ${unverified.map((f) => f.name).join(', ')}` : open.length ? `answer ${open.length} mapping question${open.length > 1 ? 's' : ''}` : null;
  const set = (subjectId: string, value: string, title: string) => record.mutate({ buildingId: batchId, kind: 'record', subjectId, value, title });
  const start = () => {
    set(batchId, 'imported', `${b.name}: import started`);
    navigate(b.buildingId && b.reviewLevelId ? `/studio/review/${b.buildingId}?level=${b.reviewLevelId}` : `/studio/areas/${b.areaId}`);
  };

  return (
    <Dialog
      title="Add files"
      onClose={onClose}
      aside={<span className="ul-caption">{b.name} · saved {formatDateTime(b.savedAt)}</span>}
      footer={(
        <>
          {blocked ? <span className={`ul-help ${styles.footNote}`}>Blocked: {blocked}.</span> : <span className={styles.footNote} />}
          <Button variant="ghost" onClick={onClose}>Save and continue later</Button>
          <Button variant="primary" disabled={Boolean(blocked)} onClick={start}>Start import</Button>
        </>
      )}
    >
      <div className="ul-stack" style={{ gap: 20 }}>
        <Stepper step={1} />
        <div className="ul-panel">
          <DataTable caption="Files in this batch" rows={b.files} rowKey={(f) => f.name} columns={[
            { header: 'File', cell: (f) => <span className="ul-id">{f.name}</span> },
            { header: 'Detected', cell: (f) => f.detected },
            { header: 'CRS', cell: (f) => {
              const crs = crsOf(f);
              if (crs) return <span className="ul-mono">{crs}</span>;
              if (!f.crsApplies) return <span className="ul-muted">—</span>;
              return choosing === f.name ? (
                <select className="ul-input" autoFocus aria-label={`Coordinate system of ${f.name}`} defaultValue=""
                  onChange={(e) => { if (e.target.value) set(`crs:${f.name}`, e.target.value, `${f.name}: CRS set to ${e.target.value}`); setChoosing(null); }} onBlur={() => setChoosing(null)}>
                  <option value="" disabled>Choose</option>
                  {(f.crsOptions ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : <span className="ul-row"><Badge tone="warning" icon={Warning}>CRS unverified</Badge><Button variant="soft" onClick={() => setChoosing(f.name)}>Choose</Button></span>;
            } },
            { header: 'Contents', numeric: true, cell: (f) => f.contents },
            { header: 'Mapping', cell: (f) => <Badge tone={MAPPING[f.mapping].tone} icon={null}>{MAPPING[f.mapping].label}</Badge> },
          ]} />
        </div>
        {b.questions.map((q) => {
          const value = answer(`question:${q.id}`);
          return (
            <div key={q.id} className={`${styles.question} ${value ? styles.questionDone : ''}`} role="group" aria-label={`Mapping question for ${q.field}`}>
              <span className={styles.questionText}><span className="ul-id">{q.field}</span> {q.text}</span>
              {value ? (
                <span className="ul-row">
                  <StatusBadge status="Reviewed" />
                  <span>{value === 'convert' ? 'Converted to m²' : value === 'keep' ? 'Kept as is' : `Mapped to ${value.replace(/^field:/, '')}`}</span>
                  <Button variant="ghost" onClick={() => clear.mutate({ buildingId: batchId, kind: 'record', subjectId: `question:${q.id}` })}>Change</Button>
                </span>
              ) : fieldFor === q.id ? (
                <select className="ul-input" autoFocus aria-label="Field" defaultValue="" onBlur={() => setFieldFor(null)}
                  onChange={(e) => { if (e.target.value) set(`question:${q.id}`, `field:${e.target.value}`, `${q.file}: ${q.field} mapped to ${e.target.value}`); setFieldFor(null); }}>
                  <option value="" disabled>Choose field</option>
                  {q.otherFields.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              ) : (
                <span className="ul-row">
                  {q.answers.map((a, i) => <Button key={a.value} variant={i === 0 ? 'soft' : 'ghost'} onClick={() => set(`question:${q.id}`, a.value, `${q.file}: ${q.field} ${a.value === 'convert' ? 'converted to m²' : 'kept as is'}`)}>{a.label}</Button>)}
                  <Button variant="ghost" icon={CaretDown} onClick={() => setFieldFor(q.id)}>Choose field</Button>
                </span>
              )}
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}

function Stepper({ step }: { step: number }) {
  return (
    <ol className={styles.stepper} aria-label="Steps">
      {STEPS.map((label, index) => (
        <li key={label} aria-current={index === step ? 'step' : undefined} className={index < step ? styles.done : index === step ? styles.on : undefined}>
          <span className={styles.dot}>{index < step ? <Icon icon={CheckCircle} size={16} /> : index + 1}</span>{label}
        </li>
      ))}
    </ol>
  );
}

const formatLabel = (format: string) => ({ geojson: 'GeoJSON', arcgis: 'ArcGIS JSON', gpkg: 'GeoPackage', shapefile_zip: 'Shapefile (zip)', laz: 'LiDAR (LAZ)', geotiff: 'GeoTIFF', mixed: 'Mixed layers' }[format] ?? format);
