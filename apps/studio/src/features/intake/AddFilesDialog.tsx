import { useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { CaretDown, CheckCircle, FileArrowUp, Trash, Warning } from '@phosphor-icons/react';
import type { FileDetection, ImportBatch } from '@ulpin/api-client/draft';
import { api, ApiError, type Schemas } from '@ulpin/api-client';
import { Badge, Banner, Button, DataTable, Dialog, Icon, Skeleton, StatusBadge, formatCount, formatDateTime } from '@ulpin/ui';
import { demoImportEnabled, inspectDemoFile, startDemoImport } from '../../api/demo-import';
import { detectBuildingFiles, startBuildingImport, useBuildingRegister, useImportBatch } from '../../api/queries';
import { useBuildingActions, useClearAction, useRecordAction } from '../workflow/useWorkflow';
import styles from './AddFilesDialog.module.css';

type Inspection = Schemas['POST_import_packages_inspect_Response_200_application_json'] & { demoContents?: string };
type Kind = 'building' | 'parcel' | 'road' | 'public_land' | 'utility';

interface Picked {
  file: File;
  state: 'inspecting' | 'ready' | 'not-gis' | 'failed';
  inspection?: Inspection;
  error?: string;
  /** Answered by the NYC upload profile (demo import) rather than the area import. */
  via?: 'demo' | 'local';
}

interface Mapping {
  kind: Kind;
  idField: string;
  nameField: string;
  heightField: string;
  heightUnit: '' | 'm' | 'ft';
  heightMeaning: string;
}

/** The unit the officer has confirmed; an unconfirmed unit stays unknown and blocks the import. */
const heightUnitText = (unit: Mapping['heightUnit']) => ({ m: ' in metres', ft: ' in feet', '': ', unit not chosen' })[unit];

const GIS = /\.(geojson|json|gpkg|zip)$/i;
const STEPS = ['Drop files', 'Check what we found', 'Confirm'] as const;

/**
 * S2 Add files. Each GIS file is profiled by the real inspect endpoint (hash, format, CRS, fields); the
 * officer confirms the mapping; Start import sends the original to the real import endpoint. Other files
 * are listed and kept for a case upload; nothing is dropped silently.
 */
export function AddFilesDialog({ onClose, batchId, buildingId, routed = false }: { onClose: () => void; batchId?: string | null; buildingId?: string | null; routed?: boolean }) {
  if (batchId) return <SavedBatch batchId={batchId} onClose={onClose} />;
  if (buildingId) return <BuildingFiles buildingId={buildingId} onClose={onClose} routed={routed} />;
  return <NewFiles onClose={onClose} />;
}

/**
 * Add files to one building: plans, level schedules, unit inventories and deeds. Each file is recognised,
 * then Start import records the building's levels and units, which appear on the map as they are read.
 */
function BuildingFiles({ buildingId, onClose, routed }: { buildingId: string; onClose: () => void; routed: boolean }) {
  const register = useBuildingRegister(buildingId).data;
  const navigate = useNavigate();
  const client = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const [found, setFound] = useState<FileDetection[]>([]);
  const [error, setError] = useState<string | null>(null);
  const add = async (list: FileList | null) => {
    if (!list?.length) return;
    const next = [...files, ...list];
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
          <span className="ul-help">PDF, CSV and Excel. Floors and units are read from them and appear on the map.</span>
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

function NewFiles({ onClose }: { onClose: () => void }) {
  const client = useQueryClient();
  const [files, setFiles] = useState<Picked[]>([]);
  const [step, setStep] = useState(0);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [editing, setEditing] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const gis = files.find((f) => f.state === 'ready');
  const demoUpload = files.length > 0 && files.some((f) => f.via === 'demo');
  const fields = gis?.inspection?.fields ?? [];
  const kindField = fields.find((f) => /^(kind|type|class|category)$/i.test(f.name))?.name ?? null;

  const add = async (list: FileList | null) => {
    if (!list?.length) return;
    const picked = [...list].map<Picked>((file) => ({ file, state: (GIS.test(file.name) || demoImportEnabled && /\.(laz|tif|tiff)$/i.test(file.name)) ? 'inspecting' : 'not-gis' }));
    setFiles((current) => [...current, ...picked]);
    setStep(1);
    for (const item of picked.filter((p) => p.state === 'inspecting')) {
      const body = new FormData();
      body.set('file', item.file);
      // The NYC upload profile answers its own files; any other file goes to the area import.
      const demo = demoImportEnabled
        ? await inspectDemoFile(item.file).then(data => ({ data, error: undefined, response: new Response() })).catch(error => ({ data: undefined, error: { message: error.message }, response: new Response(null, { status: 400 }) }))
        : null;
      const via: 'demo' | 'local' = demo?.data ? 'demo' : 'local';
      const result = demo?.data ? demo : GIS.test(item.file.name)
        ? await api.POST('/api/v1/import-packages/inspect', { body: body as never, bodySerializer: (b) => b as unknown as FormData })
        : demo!;
      setFiles((current) => current.map((f) => (f.file !== item.file ? f
        : result.data ? { ...f, state: 'ready', inspection: result.data, via } : { ...f, state: 'failed', error: new ApiError(result.response.status, '', result.error).message })));
      if (result.data) {
        const height = result.data.fields.find((f) => /height|hgt/i.test(f.name) && !/ground/i.test(f.name));
        setMapping((m) => m ?? {
          kind: 'building', idField: result.data.suggestedIdField ?? '', nameField: result.data.suggestedNameField ?? '',
          // Proposed from the field name; the officer confirms or changes it before import.
          heightField: height?.name ?? '',
          heightUnit: !height ? '' : /(_m|metre|meter)s?$/i.test(height.name) ? 'm' : /(_ft|feet|foot)$/i.test(height.name) ? 'ft' : '',
          heightMeaning: !height ? '' : /roof/i.test(height.name) ? 'Roof height above ground' : 'Building height above ground',
        });
        if (via === 'local') setSummary(await kindSummary(item.file));
      }
    }
  };

  const importFile = useMutation({
    mutationFn: async () => {
      if (demoUpload) return startDemoImport(files.map(item => item.file));
      if (!gis?.inspection || !mapping) throw new Error('Choose a GIS file first.');
      const body = new FormData();
      body.set('file', gis.file);
      body.set('format', gis.inspection.format);
      if (gis.inspection.layer) body.set('layer', gis.inspection.layer);
      body.set('namespace', gis.inspection.suggestedNamespace);
      body.set('name', gis.inspection.suggestedTitle);
      body.set('mapping', JSON.stringify({
        kind: mapping.kind, ...(kindField ? { kindField } : {}), idField: mapping.idField,
        ...(mapping.nameField ? { nameField: mapping.nameField } : {}),
        ...(mapping.heightField ? { heightField: mapping.heightField, heightUnit: mapping.heightUnit, heightMeaning: mapping.heightMeaning } : {}),
      }));
      const result = await api.POST('/api/v1/import-packages', { body: body as never, bodySerializer: (b) => b as unknown as FormData });
      if (!result.data) throw new ApiError(result.response.status, '', result.error);
      return result.data as { id: string; areaId: string };
    },
    onSuccess: async (pkg) => { await client.invalidateQueries(); navigate(`/studio/areas/${pkg.areaId}?package=${pkg.id}`); },
  });

  const blocked = demoUpload ? (!files.length ? 'add the NYC layer files or their ZIP' : files.some(f => f.state !== 'ready') ? 'wait for every file to pass the NYC profile check' : null) : !gis ? 'add a GIS file (GeoJSON, GeoPackage or a zipped shapefile)'
    : gis.inspection?.quarantine?.accepted === 0 ? 'no source geometries were accepted'
    : !gis.inspection?.sourceCrs ? 'the file states no coordinate reference system'
      : !mapping?.idField ? 'choose the field that identifies each feature'
        : mapping.heightField && !mapping.heightUnit ? 'choose the height unit the source uses'
        : mapping.heightField && !mapping.heightMeaning.trim() ? 'say what the height field measures'
          : null;

  const rows = useMemo(() => files, [files]);
  return (
    <Dialog
      title="Add files"
      onClose={onClose}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          {step < 2
            ? <Button variant="primary" disabled={Boolean(blocked)} onClick={() => setStep(2)} title={blocked ?? undefined}>Continue</Button>
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
            <span className="ul-help">GIS layers are read now. Plans, tables and documents are kept as evidence for a case upload.</span>
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
                { header: 'File', cell: (f) => <span className="ul-id">{f.file.name}</span> },
                { header: 'Detected', cell: (f) => (f.state === 'ready' ? formatLabel(f.inspection!.format) : f.state === 'inspecting' ? 'Reading…' : f.state === 'not-gis' ? 'Document or table' : <span className="ul-error"><Icon icon={Warning} size={16} />{f.error}</span>) },
                { header: 'CRS', cell: (f) => (f.inspection ? (f.inspection.sourceCrs ?? <Badge tone="warning" icon={Warning}>CRS unverified</Badge>) : '—') },
                { header: 'Contents', numeric: true, cell: (f) => f.via === 'demo' && f.inspection?.demoContents ? f.inspection.demoContents : (f.inspection?.featureCount === null || f.inspection?.featureCount === undefined ? '—' : `${formatCount(f.inspection.featureCount)} features`) },
                { header: 'Mapping', cell: (f) => (f.state === 'ready' ? <Badge tone="info" icon={null}>Proposed</Badge> : f.state === 'not-gis' ? <Badge icon={null}>Kept as evidence</Badge> : '—') },
                ...(step < 2 ? [{ header: '', cell: (f: Picked) => <Button variant="ghost" iconOnly icon={Trash} aria-label={`Remove ${f.file.name}`} onClick={() => setFiles((c) => c.filter((x) => x !== f))} /> }] : []),
              ]}
            />
          </div>
        ) : null}

        {!demoUpload && gis?.inspection && mapping && step >= 1 ? (
          <section className={styles.readAs} aria-label="How the file is read">
            <header className={styles.readAsHead}>
              <span className="ul-heading">{step === 2 ? 'It will be read like this' : 'We propose to read it like this'}</span>
              {step === 1 ? <button type="button" className={styles.link} onClick={() => setEditing((e) => !e)}>{editing ? 'Done' : 'Change'}</button> : null}
            </header>
            {!editing || step === 2 ? (
              <dl className={styles.readList}>
                <div><dt>Each feature is</dt><dd>{kindField ? <>read from <span className="ul-id">{kindField}</span>{summary ? <span className="ul-muted"> · {summary}</span> : null}</> : KIND_LABEL[mapping.kind]}</dd></div>
                <div><dt>Identified by</dt><dd>{mapping.idField ? <span className="ul-id">{mapping.idField}</span> : <span className="ul-error">choose a field</span>}</dd></div>
                <div><dt>Named by</dt><dd>{mapping.nameField ? <span className="ul-id">{mapping.nameField}</span> : <span className="ul-muted">no name</span>}</dd></div>
                <div><dt>Height</dt><dd>{mapping.heightField ? <><span className="ul-id">{mapping.heightField}</span>{heightUnitText(mapping.heightUnit)} · {mapping.heightMeaning.toLowerCase()}</> : <span className="ul-muted">unknown (no height field)</span>}</dd></div>
              </dl>
            ) : (
              <div className={styles.mapping}>
                {!kindField ? (
                  <Field label="Features are">
                    <select className="ul-input" value={mapping.kind} onChange={(e) => setMapping({ ...mapping, kind: e.target.value as Kind })}>
                      <option value="building">Buildings</option><option value="parcel">Parcels</option><option value="road">Roads</option>
                      <option value="public_land">Public land</option><option value="utility">Utilities</option>
                    </select>
                  </Field>
                ) : null}
                <Field label="Identifier field">
                  <select className="ul-input" value={mapping.idField} onChange={(e) => setMapping({ ...mapping, idField: e.target.value })}>
                    <option value="">Choose a field</option>
                    {fields.filter((f) => f.idEligible).map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
                  </select>
                </Field>
                <Field label="Name field">
                  <select className="ul-input" value={mapping.nameField} onChange={(e) => setMapping({ ...mapping, nameField: e.target.value })}>
                    <option value="">None</option>
                    {fields.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
                  </select>
                </Field>
                <Field label="Height field">
                  <select className="ul-input" value={mapping.heightField} onChange={(e) => setMapping({ ...mapping, heightField: e.target.value })}>
                    <option value="">None: heights stay unknown</option>
                    {fields.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
                  </select>
                </Field>
                {mapping.heightField ? (
                  <>
                    <Field label="Height unit">
                      <select className="ul-input" value={mapping.heightUnit} onChange={(e) => setMapping({ ...mapping, heightUnit: e.target.value as 'm' | 'ft' })}>
                        <option value="">Choose the source unit</option>
                        <option value="m">Metres</option><option value="ft">Feet (converted to metres)</option>
                      </select>
                    </Field>
                    <Field label="What the height measures">
                      <input className="ul-input" value={mapping.heightMeaning} maxLength={500} onChange={(e) => setMapping({ ...mapping, heightMeaning: e.target.value })} />
                    </Field>
                  </>
                ) : null}
              </div>
            )}
          </section>
        ) : null}

        {!demoUpload && step === 2 && gis?.inspection ? (
          <Banner tone="info">
            Start import retains <span className="ul-id">{gis.file.name}</span> unchanged (SHA-256 <span className="ul-mono">{gis.inspection.sourceSha256.slice(0, 12)}…</span>) and creates an import to review. Nothing is recorded until you review and record it.
          </Banner>
        ) : null}
        {gis?.inspection?.quarantine ? <Banner tone="warning">{gis.inspection.quarantine.message}</Banner> : null}
        {importFile.error ? <Banner tone="danger">{importFile.error.message}</Banner> : null}
        {blocked && files.length ? <p className="ul-help">Blocked: {blocked}.</p> : null}
      </div>
    </Dialog>
  );
}

const KIND_LABEL: Record<Kind, string> = { building: 'a building', parcel: 'a parcel', road: 'a road', public_land: 'public land', utility: 'a utility' };

/** "22 buildings · 22 parcels · …" from a GeoJSON file's kind field, read in the browser. */
async function kindSummary(file: File): Promise<string | null> {
  if (!/\.(geo)?json$/i.test(file.name)) return null;
  try {
    const doc = JSON.parse(await file.text()) as { features?: { properties?: Record<string, unknown> }[] };
    const counts = new Map<string, number>();
    for (const f of doc.features ?? []) {
      const k = String(f.properties?.kind ?? f.properties?.type ?? '');
      if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const word: Record<string, [string, string]> = { building: ['building', 'buildings'], parcel: ['parcel', 'parcels'], road: ['road', 'roads'], public_land: ['open land', 'open land'], utility: ['utility', 'utilities'] };
    return [...counts].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${(word[k] ?? [k, k])[n === 1 ? 0 : 1]}`).join(' · ') || null;
  } catch { return null; }
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

function Field({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <label className="ul-field">
      <span className="ul-label">{label}</span>
      {children}
      {help ? <span className="ul-help">{help}</span> : null}
    </label>
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
