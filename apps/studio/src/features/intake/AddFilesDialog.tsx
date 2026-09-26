import { useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { CheckCircle, FileArrowUp, Trash, Warning } from '@phosphor-icons/react';
import { ApiError, api, type Schemas } from '@ulpin/api-client';
import { Badge, Banner, Button, DataTable, Dialog, Icon, StatusBadge, formatCount } from '@ulpin/ui';
import styles from './AddFilesDialog.module.css';

type Inspection = Schemas['POST_import_packages_inspect_Response_200_application_json'];
type Kind = 'building' | 'parcel' | 'road' | 'public_land' | 'utility';

interface Picked {
  file: File;
  state: 'inspecting' | 'ready' | 'not-gis' | 'failed';
  inspection?: Inspection;
  error?: string;
}

interface Mapping {
  kind: Kind;
  idField: string;
  nameField: string;
  heightField: string;
  heightUnit: '' | 'm' | 'ft';
  heightMeaning: string;
}

const GIS = /\.(geojson|json|gpkg|zip)$/i;
const STEPS = ['Drop files', 'Check what we found', 'Confirm'] as const;

/**
 * S2 Add files. Each GIS file is profiled by the real inspect endpoint (hash, format, CRS, fields); the
 * officer confirms the mapping; Start import sends the original to the real import endpoint. Other files
 * are listed and kept for a case upload; nothing is dropped silently.
 */
export function AddFilesDialog({ onClose }: { onClose: () => void }) {
  const [files, setFiles] = useState<Picked[]>([]);
  const [step, setStep] = useState(0);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [question, setQuestion] = useState<'open' | 'yes' | 'no'>('open');
  const input = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const gis = files.find((f) => f.state === 'ready');
  const fields = gis?.inspection?.fields ?? [];
  const heightCandidate = fields.find((f) => /height|hgt|elev/i.test(f.name) && !/ground/i.test(f.name));

  const add = async (list: FileList | null) => {
    if (!list?.length) return;
    const picked = [...list].map<Picked>((file) => ({ file, state: GIS.test(file.name) ? 'inspecting' : 'not-gis' }));
    setFiles((current) => [...current, ...picked]);
    setStep(1);
    for (const item of picked.filter((p) => p.state === 'inspecting')) {
      const body = new FormData();
      body.set('file', item.file);
      const result = await api.POST('/api/v1/import-packages/inspect', { body: body as never, bodySerializer: (b) => b as unknown as FormData });
      setFiles((current) => current.map((f) => (f.file !== item.file ? f
        : result.data ? { ...f, state: 'ready', inspection: result.data } : { ...f, state: 'failed', error: new ApiError(result.response.status, '', result.error).message })));
      if (result.data) {
        setMapping((m) => m ?? {
          kind: 'building', idField: result.data.suggestedIdField ?? '', nameField: result.data.suggestedNameField ?? '',
          heightField: '', heightUnit: '', heightMeaning: '',
        });
      }
    }
  };

  const importFile = useMutation({
    mutationFn: async () => {
      if (!gis?.inspection || !mapping) throw new Error('Choose a GIS file first.');
      const body = new FormData();
      body.set('file', gis.file);
      body.set('format', gis.inspection.format);
      if (gis.inspection.layer) body.set('layer', gis.inspection.layer);
      body.set('namespace', gis.inspection.suggestedNamespace);
      body.set('name', gis.inspection.suggestedTitle);
      body.set('mapping', JSON.stringify({
        kind: mapping.kind, idField: mapping.idField,
        ...(mapping.nameField ? { nameField: mapping.nameField } : {}),
        ...(mapping.heightField ? { heightField: mapping.heightField, heightUnit: mapping.heightUnit, heightMeaning: mapping.heightMeaning } : {}),
      }));
      const result = await api.POST('/api/v1/import-packages', { body: body as never, bodySerializer: (b) => b as unknown as FormData });
      if (!result.data) throw new ApiError(result.response.status, '', result.error);
      return result.data as { id: string; areaId: string };
    },
    onSuccess: (pkg) => navigate(`/studio/areas/${pkg.areaId}?package=${pkg.id}`),
  });

  const blocked = !gis ? 'add a GIS file (GeoJSON, GeoPackage or a zipped shapefile)'
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
      aside={<Stepper step={step} />}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          {step < 2
            ? <Button variant="primary" disabled={Boolean(blocked)} onClick={() => setStep(2)} title={blocked ?? undefined}>Continue</Button>
            : <Button variant="primary" disabled={Boolean(blocked) || importFile.isPending} onClick={() => importFile.mutate()}>Start import</Button>}
        </>
      )}
    >
      <div className="ul-stack" style={{ gap: 16 }}>
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
                { header: 'Contents', numeric: true, cell: (f) => (f.inspection?.featureCount === null || f.inspection?.featureCount === undefined ? '—' : `${formatCount(f.inspection.featureCount)} features`) },
                { header: 'Mapping', cell: (f) => (f.state === 'ready' ? <Badge tone="info" icon={null}>Proposed</Badge> : f.state === 'not-gis' ? <Badge icon={null}>Kept as evidence</Badge> : '—') },
                { header: '', cell: (f) => <Button variant="ghost" iconOnly icon={Trash} aria-label={`Remove ${f.file.name}`} onClick={() => setFiles((c) => c.filter((x) => x !== f))} /> },
              ]}
            />
          </div>
        ) : null}

        {gis?.inspection && mapping && step >= 1 ? (
          <>
            {heightCandidate && question === 'open' && !mapping.heightField ? (
              <div className={styles.question} role="group" aria-label="Mapping question">
                <span className={styles.questionText}><span className="ul-id">{heightCandidate.name}</span> may hold a height. Use it as the building height?</span>
                <Button variant="soft" onClick={() => { setMapping({ ...mapping, heightField: heightCandidate.name }); setQuestion('yes'); }}>Yes</Button>
                <Button variant="ghost" onClick={() => setQuestion('no')}>No</Button>
              </div>
            ) : question !== 'open' ? (
              <div className={styles.answered}><StatusBadge status="Reviewed" />{question === 'yes' ? `Height from ${mapping.heightField}` : 'No height field'}</div>
            ) : null}

            <fieldset className={styles.mapping} disabled={step === 2}>
              <legend className="ul-heading">Mapping for {gis.file.name}</legend>
              <Field label="Features are">
                <select className="ul-input" value={mapping.kind} onChange={(e) => setMapping({ ...mapping, kind: e.target.value as Kind })}>
                  <option value="building">Buildings</option><option value="parcel">Parcels</option><option value="road">Roads</option>
                  <option value="public_land">Public land</option><option value="utility">Utilities</option>
                </select>
              </Field>
              <Field label="Identifier field" help={gis.inspection.featureIdEligible ? 'Feature IDs in the file are usable too.' : 'Only complete, unique fields are listed.'}>
                <select className="ul-input" value={mapping.idField} onChange={(e) => setMapping({ ...mapping, idField: e.target.value })}>
                  <option value="">Choose a field</option>
                  {fields.filter((f) => f.idEligible).map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
                </select>
              </Field>
              <Field label="Name field (optional)">
                <select className="ul-input" value={mapping.nameField} onChange={(e) => setMapping({ ...mapping, nameField: e.target.value })}>
                  <option value="">None</option>
                  {fields.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
                </select>
              </Field>
              <Field label="Height field (optional)">
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
                      <option value="m">Metres</option><option value="ft">Feet (converted to metres, 0.3048 m/ft)</option>
                    </select>
                  </Field>
                  <Field label="What the height measures" help="As the source states it, for example “roof height above the building’s ground”.">
                    <input className="ul-input" value={mapping.heightMeaning} maxLength={500} onChange={(e) => setMapping({ ...mapping, heightMeaning: e.target.value })} />
                  </Field>
                </>
              ) : null}
            </fieldset>
          </>
        ) : null}

        {step === 2 && gis?.inspection ? (
          <Banner tone="info">
            Start import retains <span className="ul-id">{gis.file.name}</span> unchanged (SHA-256 <span className="ul-mono">{gis.inspection.sourceSha256.slice(0, 12)}…</span>) and creates an import to review. Nothing is recorded until you review and record it.
          </Banner>
        ) : null}
        {importFile.error ? <Banner tone="danger">{importFile.error.message}</Banner> : null}
        {blocked && files.length ? <p className="ul-help">Blocked: {blocked}.</p> : null}
        <p className="ul-help">Oblique imagery, LiDAR and plan reading <Badge icon={null}>Planned</Badge></p>
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

const formatLabel = (format: string) => ({ geojson: 'GeoJSON', arcgis: 'ArcGIS JSON', gpkg: 'GeoPackage', shapefile_zip: 'Shapefile (zip)' }[format] ?? format);
