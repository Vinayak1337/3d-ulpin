const { useState, useEffect, useRef } = React;
const U = window.Ulpin;
const { Icon, StudioHeader, Button, Badge, Inspector, EvidenceChip, ReadinessMeter, UlpinCode, LevelRail, Legend, MapToolbar, DigColumn, FindingCard, ImportStream, PropertyCard, SegmentedControl, Toggle, EVIDENCE_AND_RECORD_KEYS } = U;

const CODE = 'P3-7Q4M2R8T6V0W3X5Y9ZAB-R4';
const LOC = 'MH2507A1B3C4D5 / S01 / F07 / R003';
const LEVELS = [
  { id: 'Roof', elevation: '239.8' }, { id: 'F8', elevation: '236.8' }, { id: 'F7', elevation: '233.8' }, { id: 'F6', elevation: '230.8' },
  { id: 'F5', elevation: '227.8' }, { id: 'F4', elevation: '224.8' }, { id: 'F3', elevation: '221.8' }, { id: 'F2', elevation: '218.8' },
  { id: 'F1', elevation: '215.8' }, { id: 'G', elevation: '212.8', title: 'Ground, stilt parking' },
  { id: 'B1', elevation: '209.1', belowGround: true }, { id: 'B2', elevation: '205.8', estimated: true, belowGround: true }
];
const ELEV = Object.fromEntries(LEVELS.map(l => [l.id, l.elevation]));
const FINDINGS = [
  { id: 'ov', sev: 'blocking', title: 'Flat 101 / Flat 201: 6.4 m³ overlap', calc: ['Flat 101 top 218.90 m · Flat 201 bottom 218.70 m', '0.20 m × 32.0 m² = 6.4 m³'], ev: [{ kind: 'table', source: 'levels-r1.csv', locator: 'row 3', href: '#' }, { state: 'estimated', source: 'Flat 201 lower', locator: 'unverified' }], actions: [{ label: 'Request evidence', icon: 'file-arrow-up' }, { label: 'Apply level evidence' }] },
  { id: 'void', sev: 'blocking', title: 'F8: 3.2 m³ unexplained void', calc: ['Partition completeness · F8', '3.2 m³ not assigned to any space'], actions: [{ label: 'Request evidence', icon: 'file-arrow-up' }] },
  { id: 'carpet', sev: 'needs-review', title: 'Flat 704: carpet area +3.9 %', calc: ['72.00 − 69.30 = 2.70 m²', '2.70 ÷ 69.30 = 3.9 % · threshold 2 %'], ev: [{ source: 'Plan F7', locator: 'p.3 · r2', href: '#' }, { source: 'Sale deed', locator: 'cl.2', href: '#' }], actions: [{ label: 'Review area' }] },
  { id: 'share', sev: 'needs-review', title: 'Shares total 99.50 %', calc: ['55 of 55 units declared', '100.00 − 99.50 = 0.50 % unexplained'], ev: [{ source: 'Deed of declaration', href: '#' }], actions: [{ label: 'Request evidence', icon: 'file-arrow-up' }] },
  { id: 'park', sev: 'needs-review', title: 'Flat 704 parking: needs evidence', calc: ['Covered stilt, allotted by association', 'No source linked'], ev: [{ state: 'missing', locator: 'Needs evidence' }], actions: [{ label: 'Request evidence', icon: 'file-arrow-up' }] }
];
const IMPORT_ROWS = p => [
  { file: 'parcels.gpkg', state: 'saved', detail: '214 parcels · EPSG:32643' },
  { file: 'unit_inventory.xlsx', state: 'attention', detail: 'carpet_sqft read as ft², converted to m²', action: { label: 'Review 1 mapping' } },
  { file: 'levels.csv', state: 'attention', detail: '2 lower limits missing' },
  p >= 100 ? { file: 'plan_F7.pdf', state: 'saved', detail: 'Rooms and dimensions read' } : { file: 'plan_F7.pdf', state: 'running', detail: 'Reading rooms and dimensions', progress: p }
];

const float = { background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-12)', boxShadow: 'var(--shadow-floating)' };

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "state": "Default"
}/*EDITMODE-END*/;
const STATES = ['Default', 'Empty', 'Loading', 'Stale', 'Error', 'Snapshot', 'No 3D', 'Replayed', 'Restricted', 'Mapping unavailable'];

function Skel({ h = 14, w = '100%', r = 6 }) { return <span style={{ display: 'block', height: h, width: w, borderRadius: r, background: 'linear-gradient(90deg, var(--surface-subtle) 0%, var(--divider) 50%, var(--surface-subtle) 100%)', backgroundSize: '200% 100%', animation: 'ul-shim 1.4s ease-in-out infinite' }}></span>; }
function InspectorSkeleton() {
  return <div style={{ ...float, boxShadow: 'var(--shadow-card)', padding: 16, display: 'grid', gap: 14 }}><Skel h={22} w="60%" /><Skel w="80%" /><Skel h={1} />{[0, 1, 2, 3].map(i => <div key={i} style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 12 }}><Skel w="80%" /><Skel w={i % 2 ? '50%' : '70%'} /></div>)}<Skel h={40} r={8} /></div>;
}
function Banner({ tone, children, action, onAction }) {
  return <div role="status" className="studio-body-sm" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 8px 8px 14px', borderRadius: 'var(--radius-12)', background: `var(--${tone}-soft)`, color: 'var(--ink)', border: `1px solid color-mix(in srgb, var(--${tone}) 35%, transparent)`, boxShadow: 'var(--shadow-floating)', animation: 'ul-up 240ms cubic-bezier(.23,1,.32,1)' }}>
    <Icon name={tone === 'danger' ? 'warning-octagon' : 'warning'} size="sm" style={{ color: `var(--${tone})` }} /><span style={{ flex: 1 }}>{children}</span>{action && <Button variant="soft" onClick={onAction}>{action}</Button>}
  </div>;
}
window.StudioBits = { Skel, Banner };

function Studio() {
  const [tw, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const ui = tw.state;
  const [theme, setTheme] = useState(() => localStorage.getItem('ul-theme') || 'light');
  const [page, setPageRaw] = useState(() => { const p = localStorage.getItem('ul-page'); return ['map', 'batches', 'register', 'workspace'].includes(p) ? p : 'map'; });
  const setPage = p => { setPageRaw(p); if (p !== 'verify') localStorage.setItem('ul-page', p); };
  const [wsStage, setWsStage] = useState('review');
  const [regFloor, setRegFloor] = useState(null);
  const [compare, setCompare] = useState(false);
  const [snap, setSnap] = useState(null);
  const [assignedOn, setAssignedOn] = useState(null);
  const [mode, setMode] = useState('area');
  const [sel, setSel] = useState('bldg');
  const [floor, setFloor] = useState('F7');
  const [unit, setUnit] = useState(null);
  const [view, setView] = useState('3D');
  const [render, setRender] = useState('Model');
  const [finding, setFinding] = useState('ov');
  const [imp, setImp] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [assigned, setAssigned] = useState(false);
  const [toast, setToast] = useState(null);
  const [panel, setPanel] = useState(null);
  const [layers, setLayers] = useState({ ai: false, ortho: false, aiState: {} });
  const ro = ui === 'Restricted';
  const [ready, setReady] = useState(!!window.ULScene);
  const host = useRef(null);
  const inited = useRef(false);

  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('ul-theme', theme); window.ULScene?.refreshTheme?.(); }, [theme]);
  useEffect(() => { if (!ready) { const f = () => setReady(true); window.addEventListener('ulscene-ready', f); return () => window.removeEventListener('ulscene-ready', f); } }, [ready]);
  const pickRef = useRef(); pickRef.current = p => {
    if (dialog) return;
    if (page === 'register') { if (!compare) setRegFloor(p.type === 'none' ? null : p.floor || null); return; }
    if (page !== 'map') return;
    if (p.type === 'none') { if (mode === 'floor' && unit) setUnit(null); else if (mode === 'area' || mode === 'building') { setSel(null); setMode('area'); } return; }
    if (p.type === 'unit') { if (mode === 'floor') { setUnit(p.unit); setSel('unit'); } return; }
    if (p.type === 'bldg') { if (sel === 'bldg' && mode === 'area') setMode('building'); else if (mode === 'building' && p.floor) { setFloor(p.floor); setMode('floor'); setUnit(null); } else { setSel('bldg'); if (mode !== 'underground') setMode(mode === 'area' ? 'area' : 'building'); } }
  };
  useEffect(() => {
    if (!ready || !host.current) return;
    if (!inited.current) { inited.current = true; window.ULScene.init(host.current, { onPick: p => pickRef.current(p) }); }
    else window.ULScene.mount(host.current);
  }, [ready, page, wsStage]);
  useEffect(() => {
    if (!inited.current) return;
    let s = { mode, sel, floor, unit, view, render };
    if (page === 'register') s = { mode: compare ? 'deviation' : regFloor ? 'floor' : 'building', sel: 'bldg', floor: regFloor || 'F7', unit: null, view: '3D', render: 'Model' };
    if (page === 'workspace') s = { mode: 'findings', sel: null, floor: 'F7', unit: null, view: '3D', render: 'Volumes' };
    window.ULScene.set(s); window.ULScene.setLoading(ui === 'Loading');
  }, [ui, page, mode, sel, floor, unit, view, render, ready, regFloor, compare, wsStage]);
  useEffect(() => {
    if (!ready || !inited.current) return;
    const onMap = page === 'map';
    window.ULScene.setLayers({ ai: onMap && layers.ai && (mode === 'area' || mode === 'building'), ortho: onMap && layers.ortho, aiState: layers.aiState });
  }, [layers, mode, page, ready]);
  useEffect(() => {
    if (imp == null) return;
    if (imp >= 100) { const t = setTimeout(() => { setImp(null); window.ULScene.setImport(null); }, 1400); return () => clearTimeout(t); }
    const t = setTimeout(() => setImp(v => v + 4), 160); window.ULScene.setImport(Math.round(10 + (imp / 100) * 11)); return () => clearTimeout(t);
  }, [imp]);
  useEffect(() => {
    const k = e => {
      if (e.key !== 'Escape') return;
      if (dialog) return setDialog(null);
      if (page !== 'map') return;
      if (mode === 'floor' && unit) return setUnit(null);
      if (mode === 'floor' || mode === 'findings' || mode === 'underground') { setMode('building'); setSel('bldg'); return; }
      if (mode === 'building') return setMode('area');
      setSel(null);
    };
    addEventListener('keydown', k); return () => removeEventListener('keydown', k);
  }, [mode, unit, dialog, page]);

  const go = (m, extra = {}) => { setMode(m); if ('unit' in extra) setUnit(extra.unit); if (extra.sel !== undefined) setSel(extra.sel); if (extra.floor) setFloor(extra.floor); };
  const tool = mode === 'underground' ? 'underground' : 'select';
  const onTool = t => { if (t === 'underground' || t === 'impact') go('underground', { sel: 'bldg' }); else if (t === 'select' && mode === 'underground') go('building', { sel: 'bldg' }); };
  const startImport = () => { go('area', { sel: null, unit: null }); setImp(0); };
  const openFrom = to => {
    if (to === 'addfiles') return setDialog('addfiles');
    if (to === 'check' || to === 'review') { setWsStage(to); return setPage('workspace'); }
    if (to === 'register') return setPage('register');
    setPage('map'); go('floor', { floor: 'F7', unit: null, sel: 'bldg' });
  };
  const openFinding = id => { setFinding(id); setPage('map'); go('findings'); };
  const openEvidence = e => { e?.preventDefault?.(); setSnap(window.ULScene.snapshot()); setDialog('evidence'); };
  const doAssign = () => { setAssignedOn(new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })); setAssigned(true); setDialog(null); setToast('assigned'); setTimeout(() => setToast(t => t === 'assigned' ? null : t), 6000); };

  const showRail = mode === 'building' || mode === 'floor';
  const is704 = mode === 'floor' && unit === 'Flat 704';

  let legend = null;
  if (mode === 'floor') legend = [{ title: 'Rights', items: [
    { label: 'Exclusive unit · 42', color: 'var(--rights-exclusive)' }, { label: 'Shared area · 9', color: 'var(--rights-shared)' },
    { label: 'Public or authority · 3', color: 'var(--rights-public)' }, { label: 'Unknown · 4', color: 'var(--readiness-unknown)', hatch: true }] }, EVIDENCE_AND_RECORD_KEYS[0]];
  if (mode === 'underground') legend = [{ title: 'Utilities', items: [
    { label: 'Water · 1', color: 'var(--utility-water)' }, { label: 'Metro corridor · Test fixture', color: 'var(--rights-public)' },
    { label: 'No survey', color: 'var(--readiness-unknown)', hatch: true }] }];
  if (mode === 'findings') legend = [{ title: 'Findings', items: [{ label: 'Blocking · 2', color: 'var(--mark-critical)', hatch: true }, { label: 'Needs review · 3', color: 'var(--mark-warning)' }] }];

  let inspector = null;
  if (imp != null) inspector = null;
  else if (mode === 'underground') inspector = (
    <DigColumn range="0 to 20 m" style={{ maxWidth: 'none' }} bands={[
      { depth: '0.9 to 1.2 m', color: 'var(--utility-water)', label: <><strong>Water main DN300</strong> · quality B · tolerance not stated</> },
      { depth: '1.2 to 3.0 m', unknown: true, label: <><strong>Unknown</strong> · no utility survey</> },
      { depth: '14.4 to 18.4 m', color: 'var(--rights-public)', label: <><strong>Metro corridor</strong> · Test fixture</> }
    ]} />
  );
  else if (mode === 'findings') { const f = FINDINGS.find(x => x.id === finding); inspector = <FindingCard severity={f.sev} method="Check v1.4 · r1" title={f.title} calculation={f.calc} evidence={f.ev} actions={f.actions} />; }
  else if (mode === 'floor' && unit) inspector = is704 ? (
    <Inspector title="Flat 704" status={assigned ? 'Assigned' : 'Needs review'} code={assigned ? CODE : undefined} location={LOC}
      facts={[
        { label: 'Level', value: <span className="data-num">F7 · 233.8 to 236.8 m · SD-1</span> },
        { label: 'Carpet area', value: <span className="ul-row"><span className="data-num">69.30 m²</span><EvidenceChip source="Plan F7" locator="p.3 · r2" href="#" onClick={openEvidence} /></span> },
        { label: 'Declared', value: <span className="ul-row"><span className="data-num">72.00 m²</span><EvidenceChip source="Sale deed" locator="cl.2" href="#" /><Badge tone="warning" icon={null}>+3.9 %</Badge></span> },
        { label: 'Share', value: <span className="ul-row"><span className="data-num">1.84 %</span><EvidenceChip source="Declaration" href="#" /></span> },
        { label: 'Parking', value: <span className="ul-row">Covered stilt<EvidenceChip state="missing" locator="Needs evidence" href="#" /></span> },
        ...(ro ? [{ label: 'Owner names', value: <span className="ul-row"><Badge icon="eye-slash">Restricted</Badge><span className="ul-muted">officer role</span></span> }] : [])
      ]}
      primaryAction={ro ? { label: 'Assign code', icon: 'shield-check', disabled: true } : assigned ? { label: 'Property Card', icon: 'qr-code', onClick: () => setDialog('card') } : { label: 'Assign code', icon: 'shield-check', onClick: () => setDialog('assign') }}
      secondaryAction={ro ? undefined : { label: 'Review area', onClick: () => { setFinding('carpet'); go('findings'); } }}>
      {ro && <span className="ul-help">Blocked: read-only role. Assigning codes needs the officer role.</span>}
    </Inspector>
  ) : (
    <Inspector title={unit} status="Draft" location={`MH2507A1B3C4D5 / S01 / ${floor}`}
      facts={[{ label: 'Level', value: <span className="data-num">{floor} · {ELEV[floor]} m · SD-1{floor === 'B2' ? ' est.' : ''}</span> }, { label: 'Carpet area', value: <em>Unknown</em> }]}
      primaryAction={{ label: 'Request evidence', icon: 'file-arrow-up' }} />
  );
  else if (sel === 'bldg' || mode === 'floor') inspector = (
    <Inspector title="Lake View Residence" status="Reviewed" location="Parcel ULPIN · MH2507A1B3C4D5"
      facts={[
        { label: 'Address', value: '12 Lake View Road' },
        { label: 'Levels', value: 'G + 8 · stilt · B1, B2' },
        { label: 'Units', value: <span className="data-num">55</span> },
        { label: 'Findings', value: <button onClick={() => go('findings')} style={{ all: 'unset', cursor: 'pointer' }}><Badge status="Blocking">2 blocking</Badge></button> }
      ]}
      primaryAction={mode === 'floor' ? { label: 'Select a unit', disabled: true } : { label: 'Explore floors', icon: 'stack', onClick: () => go('floor', { floor: 'F7', unit: null }) }}
      secondaryAction={{ label: 'Open register', onClick: () => setPage('register') }}>
      <ReadinessMeter bare task="Assign proposed 3D ULPIN" dimensions={[
        { name: 'Evidence', value: 1 }, { name: 'Geometry', value: 1 }, { name: 'Association', value: 1 },
        { name: 'Consistency', value: 0.5, label: '2 findings' }, { name: 'Review', value: 1 }, { name: 'Freshness', value: 'unknown' }]} />
    </Inspector>
  );

  const tray = imp != null ? (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 12, alignItems: 'start', height: '100%', overflow: 'auto' }}>
      <ImportStream title="Importing Lake View bundle" meta="186 spaces saved" rows={IMPORT_ROWS(Math.min(100, Math.round(62 + imp * 0.38)))} />
      <div className="ul-row"><Button variant="ghost">Pause</Button><Button variant="ghost" onClick={() => { setImp(null); window.ULScene.setImport(null); }}>Cancel</Button></div>
    </div>
  ) : mode === 'findings' ? (
    <div style={{ display: 'grid', gap: 2, overflow: 'auto', height: '100%', alignContent: 'start' }}>
      {FINDINGS.map(f => (
        <button key={f.id} onClick={() => setFinding(f.id)} style={{ all: 'unset', cursor: 'pointer', display: 'grid', gridTemplateColumns: '120px minmax(0,1fr)', alignItems: 'center', gap: 12, padding: '6px 10px', borderRadius: 'var(--radius-8)', background: finding === f.id ? 'var(--primary-soft)' : 'transparent', transition: 'background 120ms' }}>
          <Badge status={f.sev === 'blocking' ? 'Blocking' : 'Needs review'} />
          <span className="studio-body-sm" style={{ color: 'var(--ink)', fontWeight: finding === f.id ? 600 : 400 }}>{f.title}</span>
        </button>
      ))}
    </div>
  ) : null;

  const dialogs = <>
      {dialog === 'assign' && <AssignDialog onClose={() => setDialog(null)} onAssign={doAssign} />}
      {dialog === 'card' && <CardDialog onClose={() => setDialog(null)} onVerify={() => { setDialog(null); setPage('verify'); }} />}
      {dialog === 'addfiles' && <AddFilesDialog providerDown={ui === 'Mapping unavailable'} onClose={() => setDialog(null)} onStart={() => { setDialog(null); setPage('map'); startImport(); }} />}
      {dialog === 'evidence' && <EvidenceDialog snap={snap} onClose={() => setDialog(null)} />}
  </>;
  if (page === 'verify') return <>{<VerifyPage ui={ui} assignedOn={assignedOn || '—'} onBack={() => setPage('map')} />}{dialogs}</>;
  const NAV = { Batches: 'batches', Map: 'map', Register: 'register' };
  return (
    <div style={{ height: '100dvh', display: 'grid', gridTemplateRows: page === 'map' ? 'var(--header-studio) 36px minmax(0,1fr)' : 'var(--header-studio) minmax(0,1fr)', background: 'var(--bg)', color: 'var(--ink)', overflow: 'hidden' }}>
      <StudioHeader active={page === 'register' ? 'Register' : page === 'map' ? 'Map' : 'Batches'} onNavigate={n => NAV[n] && setPage(NAV[n])} area="Lake View area" status={ui === 'Snapshot' ? 'Snapshot 24 Sep, 14:10' : 'Live'} initials={ro ? 'EN' : 'RI'} userName={ro ? 'Engineer · read-only' : 'R. Iyer'}
        actions={<><HeaderMenus /><Button variant="ghost" aria-label="Switch theme" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? 'Light' : 'Dark'}</Button></>} />
      {page === 'batches' && <BatchesPage ui={ui} onOpen={openFrom} />}
      {page === 'workspace' && (wsStage === 'review' ? <WorkspaceReview onStage={s => s === 'Add files' ? setDialog('addfiles') : setWsStage(s === 'Review details' ? 'review' : 'check')} />
        : <WorkspaceCheck hostRef={host} onOpenFinding={openFinding} onStage={s => s === 'Add files' ? setDialog('addfiles') : setWsStage(s === 'Review details' ? 'review' : 'check')} />)}
      {page === 'register' && <RegisterPage ro={ro} ui={ui} hostRef={host} assigned={assigned} floor={regFloor} setFloor={setRegFloor} compare={compare} setCompare={setCompare} levels={LEVELS} onBack={() => setPage('map')} onCard={() => setDialog('card')} />}
      {page === 'map' && <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px 0 8px', borderBottom: '1px solid var(--divider)', background: 'var(--surface)', minWidth: 0, overflow: 'hidden' }} className="studio-body-sm">
        <PanelSwitch panel={panel} setPanel={setPanel} />
        <span style={{ width: 1, height: 20, background: 'var(--divider)' }}></span>
        <strong style={{ fontWeight: 600 }}>Lake View</strong>
        <span className="ul-muted">{imp != null ? 'Importing · 186 spaces saved' : 'r3'}</span>
        <Badge status="Test fixture">Design mockup</Badge>
        {ui === 'Replayed' && <Badge icon="clock-counter-clockwise">Replayed from rehearsal 22 Nov</Badge>}
        {ro && <Badge icon="eye-slash">Read-only role</Badge>}
        {mode !== 'area' && imp == null && <Crumbs mode={mode} floor={floor} unit={unit} go={go} />}
        <span style={{ flex: 1 }}></span>
        <Button variant="ghost" icon="file-arrow-up" onClick={() => setDialog('addfiles')} disabled={imp != null || ro}>Add files</Button>
      </div>
      <main style={{ display: 'grid', gridTemplateColumns: `${panel ? '308px ' : ''}minmax(0,1fr)${inspector ? ' var(--rail-right)' : ''}`, gap: 16, padding: 16, minHeight: 0 }}>
        {panel && <LeftPanel panel={panel} setPanel={setPanel} layers={layers} setLayers={setLayers} mode={mode} go={go} unit={unit} ui={ui} openFinding={openFinding} />}
        <section style={{ minWidth: 0, display: 'grid', gridTemplateRows: tray ? 'minmax(0,1fr) var(--tray-height)' : 'minmax(0,1fr)', gap: 16, minHeight: 0 }}>
          <div style={{ position: 'relative', borderRadius: 'var(--radius-12)', overflow: 'hidden', background: 'var(--map-ground)', minHeight: 0 }}>
            <div ref={host} style={{ position: 'absolute', inset: 0, visibility: ui === 'No 3D' ? 'hidden' : 'visible' }}></div>
            {ui === 'No 3D' && <div style={{ position: 'absolute', inset: 0, zIndex: 5, display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 220px', gap: 16, padding: '136px 16px 16px', background: 'var(--bg)' }}>
              <div style={{ ...float, overflow: 'hidden', display: 'grid', placeItems: 'center', padding: 12 }}><div style={{ width: '100%', maxWidth: 720, aspectRatio: '260/180' }}><PlanSheet highlight704={unit === 'Flat 704'} showCandidates={false} /></div></div>
              <div style={{ ...float, padding: 8, display: 'grid', alignContent: 'start', gap: 2, overflow: 'auto' }}>
                {['Flat 701', 'Flat 702', 'Flat 703', 'Flat 704', 'Flat 705', 'Flat 706', 'Stair S1', 'Lift L1', 'Corridor'].map(u => <button key={u} onClick={() => { go('floor', { floor: 'F7', unit: u, sel: 'unit' }); }} className="studio-body-sm" style={{ all: 'unset', cursor: 'pointer', padding: '8px 10px', borderRadius: 'var(--radius-8)', background: unit === u ? 'var(--primary-soft)' : 'transparent', fontWeight: unit === u ? 600 : 400 }}>{u}</button>)}
              </div>
            </div>}
            {(ui === 'Stale' || ui === 'Error' || ui === 'No 3D') && <div style={{ position: 'absolute', top: 76, left: 16, zIndex: 12, width: 'min(520px, calc(100% - 32px))' }}>
              {ui === 'Stale' && <Banner tone="warning" action="Rebuild"><span className="id-code">levels-r2.csv</span> is newer than this model. Rebuild to apply.</Banner>}
              {ui === 'Error' && <Banner tone="danger" action="Choose"><span className="id-code">parcels.shp</span> has no CRS. Choose the coordinate system to continue.</Banner>}
              {ui === 'No 3D' && <Banner tone="info">3D view unavailable on this device. Showing the plan.</Banner>}
            </div>}
            {ui === 'Empty' && <div style={{ position: 'absolute', inset: 0, zIndex: 11, display: 'grid', placeItems: 'center', background: 'color-mix(in srgb, var(--map-ground) 70%, transparent)' }}>
              <div style={{ ...float, boxShadow: 'var(--shadow-overlay)', padding: '20px 24px', display: 'grid', gap: 14, justifyItems: 'start', maxWidth: 380 }}>
                <span className="studio-body">No floors recorded for this building. Add a plan or level schedule.</span>
                <Button variant="primary" icon="file-arrow-up" onClick={() => setDialog('addfiles')}>Add files</Button>
              </div>
            </div>}
            <div style={{ position: 'absolute', top: 16, left: 16, zIndex: 10 }}>
              <MapToolbar key={(mode === 'findings' ? 'Volumes' : render) + view} tool={tool} onToolChange={onTool} view={view} onViewChange={setView} render={mode === 'findings' ? 'Volumes' : render} onRenderChange={setRender} onResetCamera={() => go(mode)} />
            </div>
            {showRail && <div style={{ position: 'absolute', top: 16, right: 16, bottom: 64, overflow: 'auto', zIndex: 10, animation: 'ul-in 240ms cubic-bezier(.23,1,.32,1)' }}>
              <LevelRail reference="m · SD-1" ground="212.4" levels={LEVELS} selected={mode === 'floor' ? floor : undefined} onSelect={id => go('floor', { floor: id, unit: null })} />
            </div>}
            {legend && <div style={{ position: 'absolute', bottom: 16, left: 16, zIndex: 10, animation: 'ul-in 240ms cubic-bezier(.23,1,.32,1)' }}><Legend sections={legend} /></div>}
            {mode === 'area' && imp == null && sel === null && <Hint>Select a building</Hint>}
            {mode === 'building' && <Hint>Select a floor</Hint>}
            {mode === 'floor' && !unit && <Hint>Select a unit</Hint>}
            <div className="data-num" style={{ position: 'absolute', bottom: 16, right: 16, zIndex: 10, display: 'flex', alignItems: 'center', gap: 12, padding: '6px 10px', ...float, fontSize: 12, color: 'var(--ink-soft)' }}>
              <span>EPSG:32643 · 212.40 m · SD-1</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 40, height: 4, borderLeft: '1px solid var(--ink-soft)', borderRight: '1px solid var(--ink-soft)', borderBottom: '1px solid var(--ink-soft)' }}></span>20 m</span>
              <span style={{ fontWeight: 700, color: 'var(--ink)' }}>N</span>
            </div>
          </div>
          {tray && <div style={{ ...float, padding: 12, minHeight: 0, overflow: 'hidden', animation: 'ul-up 260ms cubic-bezier(.23,1,.32,1)' }}>{tray}</div>}
        </section>
        {inspector && ui === 'Loading' && <aside><InspectorSkeleton /></aside>}
        {inspector && ui !== 'Loading' && <aside key={mode + unit + finding} style={{ minHeight: 0, overflow: 'auto', animation: 'ul-in 220ms cubic-bezier(.23,1,.32,1)' }}>{inspector}</aside>}
      </main>
      </>}
      {toast === 'assigned' && (
        <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', zIndex: 60, display: 'flex', alignItems: 'center', gap: 16, padding: '10px 10px 10px 16px', ...float, boxShadow: 'var(--shadow-overlay)', animation: 'ul-up 260ms cubic-bezier(.23,1,.32,1)' }}>
          <Badge status="Assigned" /><span className="id-code">P3-7Q4M…-R4</span>
          <Button variant="soft" icon="qr-code" onClick={() => { setToast(null); setDialog('card'); }}>Make Property Card</Button>
        </div>
      )}
      {dialogs}
      <TweaksPanel>
        <TweakSection label="Screen state" />
        <TweakSelect label="State" value={ui} options={STATES} onChange={v => setTweak('state', v)} />
      </TweaksPanel>
    </div>
  );
}

function Crumbs({ mode, floor, unit, go }) {
  const items = [{ label: 'Lake View Residence', on: () => go('building', { sel: 'bldg', unit: null }) }];
  if (mode === 'floor') items.push({ label: floor, on: () => go('floor', { unit: null }) });
  if (mode === 'floor' && unit) items.push({ label: unit });
  if (mode === 'underground') items.push({ label: 'Underground' });
  if (mode === 'findings') items.push({ label: 'Findings' });
  return (
    <nav aria-label="Selection" style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 12, borderLeft: '1px solid var(--divider)' }}>
      {items.map((it, i) => <React.Fragment key={i}>
        {i > 0 && <span className="ul-muted">/</span>}
        {it.on && i < items.length - 1 ? <a href="#" onClick={e => { e.preventDefault(); it.on(); }} style={{ color: 'var(--ink-soft)', textDecoration: 'none' }}>{it.label}</a> : <span style={{ fontWeight: 600 }}>{it.label}</span>}
      </React.Fragment>)}
    </nav>
  );
}

function Hint({ children }) {
  return <div className="studio-label" style={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 10, padding: '6px 12px', borderRadius: 'var(--radius-pill)', background: 'var(--surface)', color: 'var(--ink-soft)', boxShadow: 'var(--shadow-floating)', pointerEvents: 'none', animation: 'ul-up 260ms cubic-bezier(.23,1,.32,1)' }}>{children}</div>;
}

function AssignDialog({ onClose, onAssign }) {
  return (
    <Dialog width="var(--dialog-md)" title="Assign proposed 3D ULPIN · Flat 704" onClose={onClose}
      foot={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon="shield-check" onClick={onAssign}>Assign code</Button></>}>
      <div style={{ display: 'grid', gap: 20 }}>
        <div style={{ padding: 16, borderRadius: 'var(--radius-12)', background: 'var(--surface-subtle)' }}>
          <UlpinCode state="draft" location={LOC} legend />
          <div className="ul-help" style={{ marginTop: 8 }}>A random code is generated on confirm</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 20 }}>
          <ReadinessMeter bare task="Assign proposed 3D ULPIN" dimensions={['Evidence', 'Geometry', 'Association', 'Consistency', 'Review', 'Freshness'].map(n => ({ name: n, value: 1 }))} />
          <div style={{ display: 'grid', gap: 12, alignContent: 'start' }} className="studio-body-sm">
            <div className="ul-row"><span className="ul-muted">Parcel ULPIN</span><span className="id-code">MH2507A1B3C4D5</span><Badge status="Reviewed" /></div>
            <div className="ul-row"><span className="ul-muted">Lineage</span><span>New space · no predecessors</span></div>
            <div className="ul-help">The state's ULPIN is unchanged.</div>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

function CardDialog({ onClose, onVerify }) {
  const [scope, setScope] = useState('unit');
  const [aud, setAud] = useState('public');
  const [names, setNames] = useState(false);
  return (
    <Dialog width="var(--dialog-lg)" title="Property Card · Flat 704" onClose={onClose}
      foot={<><Button variant="ghost" onClick={onClose}>Close</Button><Button icon="qr-code" onClick={onVerify}>Open local link</Button><Button variant="primary" icon="download-simple">Export PDF</Button></>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 260px', gap: 24 }}>
        <PropertyCard title="Flat 704, Lake View Residence" code={CODE} location={LOC} revision="r3" hash="7f3a…c2e1" chain="Chain consistent" qrLabel="QR code: local demonstration link"
          facts={[
            { label: 'Parcel ULPIN', value: 'MH2507A1B3C4D5', mono: true },
            { label: 'Level', value: 'F7 · 233.80 to 236.80 m · site datum SD-1' },
            { label: 'Carpet area', value: '69.30 m² (from plan components) · 72.00 m² declared' },
            { label: 'Undivided share', value: '1.84 % of parcel' },
            ...(aud !== 'public' && names ? [{ label: 'Party names', value: <em>Restricted (officer role)</em> }] : [])
          ]} />
        <div style={{ display: 'grid', gap: 20, alignContent: 'start' }}>
          <div style={{ display: 'grid', gap: 6 }}><span className="studio-label ul-muted">Scope</span>
            <SegmentedControl aria-label="Scope" value={scope} onChange={setScope} options={[{ value: 'unit', label: 'Unit' }, { value: 'floor', label: 'Floor' }, { value: 'bldg', label: 'Building' }]} /></div>
          <div style={{ display: 'grid', gap: 6 }}><span className="studio-label ul-muted">Audience</span>
            <SegmentedControl aria-label="Audience" value={aud} onChange={setAud} options={[{ value: 'public', label: 'Public' }, { value: 'owner', label: 'Owner' }, { value: 'officer', label: 'Officer' }]} /></div>
          <div className="ul-layer" style={{ opacity: aud === 'public' ? 0.5 : 1 }}><span className="ul-grow studio-body-sm">Party names</span><Toggle aria-label="Party names" checked={aud !== 'public' && names} onChange={v => aud !== 'public' && setNames(!!v)} /></div>
          <div style={{ display: 'grid', gap: 6 }}><span className="studio-label ul-muted">QR opens</span><span className="studio-body-sm">Local demonstration link</span></div>
        </div>
      </div>
    </Dialog>
  );
}

ReactDOM.createRoot(document.getElementById('ds-root')).render(<Studio />);
