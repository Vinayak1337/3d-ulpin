import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { CheckCircle, FilePlus, WarningCircle } from '@phosphor-icons/react';
import { SceneView } from '@ulpin/scene/react';
import type { SceneState } from '@ulpin/scene';
import type { BuildingLedger, LevelReview } from '@ulpin/api-client/draft';
import { Badge, Button, DataTable, EmptyState, EvidenceChip, Icon, Panel, Skeleton, StatusBadge, formatDateTime, type StatusWord } from '@ulpin/ui';
import { useAreaContext, useBuildingLedger, useBuildingRegister, useLevelReview, usePageImage, useDocumentPages, type BuildingRegister } from '../../api/queries';
import type { BuildingAction } from '../../local/workflow';
import { buildingModel, type BuildingModel, type LevelModel } from '../../model/building';
import { EvidenceProvider, useOpenEvidence } from '../evidence/EvidenceContext';
import { parseLocator } from '../evidence/refs';
import { levelSummary } from '../map/inspector/BuildingInspector';
import { findingVolume, useBuildingScene } from '../map/useBuildingScene';
import { useBuildingActions, useClearAction, useRecordAction } from '../workflow/useWorkflow';
import { CheckGroups } from './CheckGroups';
import { useMapView } from '../map/useMapView';
import styles from './Workspace.module.css';

type Stage = 'review' | 'check';
const STAGES: { value: Stage | 'add'; label: string }[] = [
  { value: 'add', label: 'Add files' }, { value: 'review', label: 'Review details' }, { value: 'check', label: 'Check and record' },
];

/** S9/S10 Workspace: review what was extracted from the sources, then check and record the building. */
export function WorkspacePage() {
  const { buildingId } = useParams();
  const register = useBuildingRegister(buildingId);
  if (register.isPending) return <div className={styles.loading}><Skeleton width="40%" /><Skeleton /><Skeleton /></div>;
  if (register.error || !register.data) {
    return (
      <div className={styles.loading}>
        <EmptyState icon={WarningCircle} title="This workspace could not be opened" action={<Link to="/studio/work">Back to Batches</Link>}>
          {register.error?.message ?? 'The building was not found.'}
        </EmptyState>
      </div>
    );
  }
  return <EvidenceProvider><Workspace register={register.data} /></EvidenceProvider>;
}

function Workspace({ register }: { register: BuildingRegister }) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const stage: Stage = params.get('stage') === 'check' ? 'check' : 'review';
  const model = useMemo(() => buildingModel(register), [register]);
  const ledger = useBuildingLedger(register.property.id).data;
  const actions = useBuildingActions(register.property.id).data ?? [];
  const levelId = params.get('level') ?? model.levels.find((l) => /^F\d/.test(l.label))?.id ?? null;
  const level = model.levels.find((l) => l.id === levelId) ?? null;
  const go = (next: Stage | 'add') => {
    if (next === 'add') { navigate(`/studio/add-files?feature=${register.property.id}`); return; }
    setParams((p) => { const n = new URLSearchParams(p); if (next === 'check') n.set('stage', 'check'); else n.delete('stage'); return n; });
  };
  const context = stage === 'review' ? `${register.property.name}${level ? ` · ${level.label}` : ''}` : `${register.property.name} · draft r${(ledger?.revision ?? register.property.revision) + 1}`;

  return (
    <div className={styles.frame}>
      <div className={styles.top}>
        <nav aria-label="Workspace stage" className={styles.stages}>
          {STAGES.map((s) => (
            <button key={s.value} type="button" aria-current={s.value === stage ? 'step' : undefined} onClick={() => go(s.value)}>{s.label}</button>
          ))}
        </nav>
        <span className="ul-muted">{context}</span>
        <span className={styles.grow} />
        <Link className="ul-btn ul-btn--ghost" to={`/studio/properties/${register.property.id}/register`}>Open register</Link>
      </div>
      {stage === 'review'
        ? <ReviewStage register={register} model={model} level={level} actions={actions} onLevel={(id) => setParams((p) => { const n = new URLSearchParams(p); n.set('level', id); return n; })} onContinue={() => go('check')} />
        : <CheckStage register={register} model={model} ledger={ledger} actions={actions} />}
    </div>
  );
}

// ------------------------------------------------------------------ Review details

function ReviewStage({ register, model, level, actions, onLevel, onContinue }: {
  register: BuildingRegister; model: BuildingModel; level: LevelModel | null; actions: BuildingAction[]; onLevel: (id: string) => void; onContinue: () => void;
}) {
  const review = useLevelReview(register.property.id, level?.id);
  const levels = <LevelRegister model={model} selected={level?.id ?? null} onSelect={onLevel} datum="m · SD-1" />;
  return (
    <div className={styles.review}>
      {review.isPending ? <Skeleton width="100%" height={420} />
        : review.data?.sheet ? <CandidateSheet review={review.data} actions={actions} buildingId={register.property.id} onContinue={onContinue} levels={levels} />
          : (
            <div className={styles.questionLayout}>
              <LevelQuestion register={register} level={level} review={review.data ?? null} actions={actions} />
              <div className={styles.side}>{levels}</div>
            </div>
          )}
    </div>
  );
}

const CONFIDENCE: Record<LevelReview['candidates'][number]['confidence'], { label: string; tone: string }> = {
  high: { label: 'High confidence', tone: 'ul-badge--success' },
  medium: { label: 'Medium confidence', tone: 'ul-badge--info' },
  low: { label: 'Low confidence', tone: 'ul-badge--warning' },
};

function CandidateSheet({ review, actions, buildingId, onContinue, levels }: { review: LevelReview; actions: BuildingAction[]; buildingId: string; onContinue: () => void; levels: ReactNode }) {
  const sheet = review.sheet!;
  const doc = useDocumentPages(sheet.sourceId).data;
  const [pageNo, setPageNo] = useState(sheet.page);
  const page = doc?.pages.find((p) => p.page === pageNo) ?? null;
  const image = usePageImage(page?.url);
  const openEvidence = useOpenEvidence();
  const record = useRecordAction();
  const clear = useClearAction();
  const decisions = new Map(actions.filter((a) => a.kind === 'candidate').map((a) => [a.subjectId, a]));
  const undecided = review.candidates.filter((c) => !decisions.has(c.id));
  const [chosen, setChosen] = useState<string | null>(null);
  const [adjusting, setAdjusting] = useState<string | null>(null);
  const active = review.candidates.find((c) => c.id === chosen) ?? undecided[0] ?? null;
  const decision = active ? decisions.get(active.id) : undefined;
  const cal = sheet.page === pageNo ? page?.calibration : null;
  const toPage = (ring: number[][]) => ring.map(([x, y]) => `${cal!.origin[0] + x! * cal!.scale},${cal!.origin[1] - y! * cal!.scale}`).join(' ');

  // The page region around all candidates, at the page's aspect ratio.
  const view = useMemo(() => {
    if (!cal) return '0 0 842 595';
    const pts = review.candidates.flatMap((c) => c.geometry.coordinates[0]!).map(([x, y]) => [cal.origin[0] + x! * cal.scale, cal.origin[1] - y! * cal.scale]);
    const xs = pts.map((p) => p[0]!), ys = pts.map((p) => p[1]!);
    let w = (Math.max(...xs) - Math.min(...xs)) * 2.2, h = (Math.max(...ys) - Math.min(...ys)) * 2.2;
    if (w / h > 842 / 595) h = (w * 595) / 842; else w = (h * 842) / 595;
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    return `${cx - w / 2} ${cy - h / 2} ${w} ${h}`;
  }, [cal, review.candidates]);

  const decide = (value: string, label?: string) => {
    if (!active) return;
    record.mutate({ buildingId, kind: 'candidate', subjectId: active.id, value, title: `${review.level} · ${label ?? active.label}: candidate ${value}` });
    setChosen(null);
    setAdjusting(null);
  };
  const locator = parseLocator({ locator: `p.${sheet.page} · ${sheet.revision}` });

  return (
    <div className={styles.sheetLayout}>
      <div className={styles.pages} role="tablist" aria-label="Pages">
        {(doc?.pages ?? []).slice().sort((a, b) => b.page - a.page).map((p) => (
          <button key={p.page} type="button" role="tab" aria-selected={p.page === pageNo} className={styles.thumb} onClick={() => setPageNo(p.page)} title={p.label}>
            <span className="ul-mono">p.{p.page}</span>
          </button>
        ))}
      </div>
      <div className={styles.sheet}>
        {image.data ? (
          <svg viewBox={cal ? view : '0 0 842 595'} className={styles.sheetSvg} role="img" aria-label={`${sheet.source}, page ${pageNo}, with ${review.candidates.length} room candidates`}>
            <image href={image.data} width="842" height="595" />
            {cal ? review.candidates.map((c) => {
              const d = decisions.get(c.id);
              const on = c.id === active?.id;
              return (
                <polygon key={c.id} points={toPage(c.geometry.coordinates[0]!)} onClick={() => setChosen(c.id)}
                  className={`${styles.candidate} ${on ? styles.candidateOn : ''} ${d ? styles[`candidate_${d.value.split(':')[0]}`] ?? '' : ''}`}>
                  <title>{c.label}</title>
                </polygon>
              );
            }) : null}
          </svg>
        ) : <Skeleton width="100%" height={420} />}
      </div>
      <div className={styles.side}>
        {active && !decision ? (
          <Panel key={active.id} title={`${review.candidates.length - undecided.length + 1} of ${review.candidates.length} to review`} aside={<Badge tone="info" icon={null}>Extracted</Badge>}
            footer={adjusting === active.id ? (
              <form className={styles.adjust} onSubmit={(e) => { e.preventDefault(); const v = new FormData(e.currentTarget).get('label'); decide(`adjusted:${String(v)}`, String(v)); }}>
                <input name="label" className="ul-input" defaultValue={active.label} aria-label="Room name" autoFocus />
                <Button type="submit" variant="primary">Save</Button>
                <Button variant="ghost" onClick={() => setAdjusting(null)}>Cancel</Button>
              </form>
            ) : (
              <>
                <Button variant="primary" icon={CheckCircle} onClick={() => decide('accepted')}>Accept</Button>
                <Button onClick={() => setAdjusting(active.id)}>Adjust</Button>
                <Button variant="ghost" onClick={() => decide('rejected')}>Reject</Button>
              </>
            )}>
            <div className={styles.candidateBody}>
              <span className="ul-heading">{active.label}</span>
              <span className="ul-row">
                <span className={`ul-badge ${CONFIDENCE[active.confidence].tone}`}>{CONFIDENCE[active.confidence].label}</span>
                <EvidenceChip kind="document" source={sheet.source} locator={active.locator}
                  onOpen={() => openEvidence({ sourceId: sheet.sourceId, label: sheet.source, locator, subject: { id: active.id, name: active.label, outline: active.geometry.coordinates[0] } })} />
              </span>
              <span className="ul-num ul-muted">{active.dimensions} · {active.areaM2.toFixed(2)} m² · {review.method}</span>
            </div>
          </Panel>
        ) : active && decision ? (
          <Panel title={active.label} aside={<DecisionBadge value={decision.value} />}
            footer={<Button variant="ghost" onClick={() => clear.mutate({ buildingId, kind: 'candidate', subjectId: active.id })}>Change decision</Button>}>
            <span className="ul-help">Decided {formatDateTime(decision.at)} by {decision.by}.</span>
          </Panel>
        ) : null}
        {!undecided.length ? (
          <Panel title="All candidates reviewed" aside={<StatusBadge status="Reviewed" />} footer={<Button variant="primary" onClick={onContinue}>Continue to checks</Button>}>
            <span className="ul-help">{review.candidates.length} of {review.candidates.length} decided. Unit prisms are built from these polygons and the level register.</span>
          </Panel>
        ) : null}
        {levels}
      </div>
    </div>
  );
}

function DecisionBadge({ value }: { value: string }) {
  if (value === 'accepted') return <span className="ul-badge ul-badge--success">Accepted</span>;
  if (value === 'rejected') return <span className="ul-badge">Rejected</span>;
  return <span className="ul-badge ul-badge--info">Adjusted</span>;
}

function LevelQuestion({ register, level, review, actions }: { register: BuildingRegister; level: LevelModel | null; review: LevelReview | null; actions: BuildingAction[] }) {
  const record = useRecordAction();
  const clear = useClearAction();
  const done = level ? actions.find((a) => a.kind === 'record' && a.subjectId === level.id) : undefined;
  if (!level) return <EmptyState icon={WarningCircle} title="No level selected">Choose a level in the level register.</EmptyState>;
  return (
    <div className={styles.question}>
      <Panel title={`${level.label} · ${level.lower?.toFixed(1) ?? '?'} to ${level.upper?.toFixed(1) ?? '?'} m`} aside={done ? <StatusBadge status="Reviewed" /> : level.estimated ? <StatusBadge status="Estimated" /> : <StatusBadge status="Reviewed" />}
        footer={done ? (
          <><span className="ul-help">{done.title} · {formatDateTime(done.at)}</span><Button variant="ghost" onClick={() => clear.mutate({ buildingId: register.property.id, kind: 'record', subjectId: level.id })}>Undo</Button></>
        ) : review?.question ? (
          <>
            <Link className="ul-btn ul-btn--primary" to={`/studio/add-files?feature=${register.property.id}`}><Icon icon={FilePlus} />Add level evidence</Link>
            <Button onClick={() => record.mutate({ buildingId: register.property.id, kind: 'record', subjectId: level.id, value: 'provisional', title: `${level.label} kept provisional: estimate stays flagged` })}>Keep as provisional</Button>
          </>
        ) : null}>
        <p className={styles.questionText}>{review?.question ?? (level.estimated ? 'The limits of this level are estimated.' : 'Nothing on this level is waiting for review.')}</p>
        <p className="ul-help">An estimated level stays hatched in 3D and cannot support a proposed code until a source confirms it.</p>
      </Panel>
    </div>
  );
}

function levelState(level: LevelModel): StatusWord {
  if (level.estimated) return 'Estimated';
  const bindings = (level.record.geometry as { bindings?: Record<string, unknown> } | undefined)?.bindings ?? {};
  return Object.keys(bindings).length ? 'Reviewed' : 'Needs evidence';
}

function LevelRegister({ model, selected, onSelect, datum }: { model: BuildingModel; selected: string | null; onSelect: (id: string) => void; datum: string }) {
  return (
    <aside>
      <Panel title="Level register" aside={<span className="ul-caption">{datum}</span>} flush={(
        <DataTable caption="Levels" rows={model.levels} rowKey={(l) => l.id} selectedKey={selected} onRowClick={(l) => onSelect(l.id)} columns={[
          { header: 'Level', cell: (l) => l.label + (l.record.use?.includes('stilt') ? ' · stilt' : '') },
          { header: 'Lower', numeric: true, cell: (l) => (l.lower === null ? <em className="ul-unknown">Unknown</em> : `${l.lower.toFixed(1)}${l.estimated ? ' est.' : ''}`) },
          { header: 'Upper', numeric: true, cell: (l) => (l.upper === null ? <em className="ul-unknown">Unknown</em> : l.upper.toFixed(1)) },
          { header: 'State', cell: (l) => <StatusBadge status={levelState(l)} /> },
        ]} />
      )} />
    </aside>
  );
}

// ------------------------------------------------------------------ Check and record

function CheckStage({ register, model, ledger, actions }: { register: BuildingRegister; model: BuildingModel; ledger: BuildingLedger | null | undefined; actions: BuildingAction[] }) {
  const [{ look: mapLook, layers: mapLayers }] = useMapView();
  const context = useAreaContext(register.area.id).data;
  const features = context?.features ?? NONE;
  const feature = features.find((f) => f.id === register.property.id) ?? null;
  const { base, footprints, detail, groundM } = useBuildingScene(features, feature, model, ledger, 'none');
  const findings = register.findings;
  const [findingId, setFindingId] = useState<string | null>(findings.find((f) => f.category === 'blocking')?.id ?? findings[0]?.id ?? null);
  const finding = findings.find((f) => f.id === findingId) ?? null;
  const record = useRecordAction();
  const recorded = actions.find((a) => a.kind === 'record' && a.subjectId === register.property.id);
  const state = useMemo<SceneState>(() => ({
    mode: finding ? 'findings' : 'building', buildingId: register.property.id, levelId: null, spaceId: null, tool: 'select',
    finding: finding ? findingVolume(finding, groundM) : null,
  }), [finding, groundM, register.property.id]);
  const blocking = ledger?.checks.filter((c) => c.state === 'blocking').length ?? findings.filter((f) => f.category === 'blocking').length;
  const units = model.spaces.filter((s) => s.use === 'apartment').length;
  const shared = new Set(model.spaces.filter((s) => s.use !== 'apartment').map((s) => s.name)).size;

  return (
    <div className={styles.check}>
      <div className={styles.canvasWrap}>
        {context ? <SceneView look={mapLook} layers={mapLayers} className={styles.canvas} base={base} buildings={footprints} detail={detail} state={state} label={`3D view of ${register.property.name} with the open finding`} /> : null}
        {finding ? <span className={`ul-float ${styles.findingPill}`}>{finding.message}</span> : null}
      </div>
      <div className={styles.side}>
        <Panel title="Checks" aside={<span className="ul-caption">{ledger?.checkMethod ?? findings[0]?.method ?? ''}</span>}>
          {ledger ? (
            <CheckGroups checks={ledger.checks} action={(c) => (c.findingId && c.state === 'blocking' ? (c.findingId === findingId ? 'Shown in 3D' : 'Open in 3D') : null)}
              onOpen={(c) => setFindingId(c.findingId)} />
          ) : <p className="ul-help">Not assessed: no checks have run on this building's records.</p>}
        </Panel>
        <Panel title={`Changes since r${ledger?.revision ?? register.property.revision}`}
          footer={(
            <div className={styles.recordFoot}>
              {recorded ? <><StatusBadge status="Recorded" /><span className="ul-help">{formatDateTime(recorded.at)} · {recorded.by}</span></> : (
                <>
                  <Button variant="primary" disabled={blocking > 0 || record.isPending}
                    onClick={() => record.mutate({ buildingId: register.property.id, kind: 'record', subjectId: register.property.id, value: 'recorded', title: `r${(ledger?.revision ?? register.property.revision) + 1} Recorded` })}>
                    Record reviewed details
                  </Button>
                  {blocking > 0 ? <span className="ul-help">Blocked: {blocking} blocking finding{blocking > 1 ? 's' : ''} open</span> : null}
                </>
              )}
            </div>
          )}>
          <div className={styles.counts}>
            {[[units, 'units'], [model.levels.length, 'levels'], [shared, 'shared spaces']].map(([n, l]) => (
              <span key={l}><b className="ul-num">{n}</b><span className="ul-muted">{l}</span></span>
            ))}
          </div>
          <p className="ul-help">{levelSummary(model)}</p>
        </Panel>
      </div>
    </div>
  );
}

const NONE: never[] = [];
