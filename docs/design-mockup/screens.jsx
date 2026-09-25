const { useState: useS } = React;
const UL = window.Ulpin;
const floatBox = { background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-12)', boxShadow: 'var(--shadow-floating)' };
const CODE_P3 = 'P3-7Q4M2R8T6V0W3X5Y9ZAB-R4', LOC_704 = 'MH2507A1B3C4D5 / S01 / F07 / R003';
const REVS = [
  { kind: 'recorded', title: 'r3 Recorded', byline: 'R. Iyer · 24 Sep 2026, 14:10', hash: '7f3a…c2e1', previousHash: '91be…04d7' },
  { kind: 'evidence', title: 'r2 Evidence applied', byline: 'R. Iyer · 24 Sep 2026, 13:52', hash: '91be…04d7', previousHash: '2c80…9a13' },
  { kind: 'draft', title: 'r1 Draft from 5 sources', byline: 'Import agent · 24 Sep 2026, 11:05' }
];

function Dialog({ width, title, onClose, children, foot, aside }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'grid', placeItems: 'center', background: 'color-mix(in srgb, var(--ink) 38%, transparent)', animation: 'ul-fade 200ms ease-out' }}>
      <div role="dialog" aria-label={title} onClick={e => e.stopPropagation()} style={{ width, maxWidth: 'calc(100vw - 48px)', maxHeight: 'calc(100dvh - 48px)', display: 'grid', gridTemplateRows: 'auto minmax(0,1fr) auto', background: 'var(--surface)', borderRadius: 'var(--radius-16)', boxShadow: 'var(--shadow-overlay)', overflow: 'hidden', animation: 'ul-pop 240ms cubic-bezier(.23,1,.32,1)' }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px', borderBottom: '1px solid var(--divider)' }}>
          <h2 className="studio-heading" style={{ margin: 0, flex: 1 }}>{title}</h2>{aside}
        </header>
        <div style={{ overflow: 'auto', padding: 20 }}>{children}</div>
        {foot && <footer style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 20px', background: 'var(--surface-subtle)', borderTop: '1px solid var(--divider)' }}>{foot}</footer>}
      </div>
    </div>
  );
}

function Readiness({ n, unknown = 0 }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span style={{ display: 'inline-grid', gridTemplateColumns: 'repeat(6, 8px)', gap: 2 }}>
        {Array.from({ length: 6 }, (_, i) => <span key={i} style={{ height: 8, borderRadius: 2, background: i < n ? 'var(--primary)' : i < n + unknown ? 'repeating-linear-gradient(45deg, var(--readiness-unknown) 0 2px, transparent 2px 4px)' : 'var(--divider)' }}></span>)}
      </span>
      <span className="data-num studio-body-sm ul-muted">{n} of 6</span>
    </span>
  );
}

const BATCHES = [
  { what: 'Lake View bundle', sub: '5 files', stage: 'Add files', next: 'Review 1 mapping', to: 'addfiles', r: [3, 1], t: '14:10' },
  { what: 'Lake View Residence · F1–F2', stage: 'Check and record', next: 'Resolve 6.4 m³ overlap', to: 'check', r: [4, 1], t: '14:02' },
  { what: 'Lake View Residence · F7', stage: 'Review details', next: 'Review 6 room candidates', to: 'review', r: [3, 1], t: '13:58' },
  { what: 'Lake View Residence · F7 units', stage: 'Recorded', next: 'Assign codes for 12 units', to: 'map', r: [6, 0], t: '13:40' },
  { what: 'Lake View Residence · F8', stage: 'Check and record', next: 'Resolve 3.2 m³ void', to: 'check', r: [4, 1], t: '13:31' },
  { what: 'Lake View Residence · shares', stage: 'Check and record', next: 'Explain 0.50 % in shares', to: 'register', r: [5, 0], t: '13:12' },
  { what: 'Flat 704', stage: 'Review details', next: 'Review carpet area +3.9 %', to: 'map', r: [5, 0], t: '12:55' },
  { what: 'Lake View Residence · basements', stage: 'Review details', next: 'Confirm B2 levels', to: 'review', r: [4, 2], t: '12:40' }
];
const STAGE_TONE = { 'Add files': 'neutral', 'Review details': 'info', 'Check and record': 'warning', 'Recorded': 'success' };

function BatchesPage({ onOpen, ui }) {
  const { Skel } = window.StudioBits || {};
  const { Button, Badge, Field } = UL;
  const [q, setQ] = useS('');
  const rows = ui === 'Empty' ? [] : BATCHES.filter(b => !q || (b.what + b.next).toLowerCase().includes(q.toLowerCase()));
  return (
    <div style={{ overflow: 'auto', minHeight: 0 }}>
      <div style={{ maxWidth: 'var(--max-content)', margin: '0 auto', padding: '24px 24px 48px', display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 300px', gap: 24, alignItems: 'start' }}>
        <section style={{ display: 'grid', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <h1 className="studio-title" style={{ margin: 0, flex: 1 }}>Batches</h1>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, height: 40, padding: '0 12px', border: '1px solid var(--line-control)', borderRadius: 'var(--radius-8)', background: 'var(--surface)', width: 240 }}>
              <UL.Icon name="magnifying-glass" size="sm" /><input aria-label="Search batches" value={q} onChange={e => setQ(e.target.value)} placeholder="Search" style={{ all: 'unset', flex: 1, font: '400 14px var(--font-sans)', color: 'var(--ink)' }} />
            </label>
            {['Stage', 'Area', 'Assigned to me'].map(f => <Button key={f} variant="ghost" icon="caret-down">{f}</Button>)}
            <Button variant="primary" icon="file-arrow-up" onClick={() => onOpen('addfiles')}>Add files</Button>
          </div>
          <div style={{ ...floatBox, boxShadow: 'var(--shadow-card)', overflow: 'hidden' }}>
            {ui === 'Loading' && Array.from({ length: 8 }, (_, i) => <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) 150px minmax(0,1.2fr) 120px 56px', gap: 16, padding: '18px 16px', borderTop: i ? '1px solid var(--divider)' : 'none' }}><Skel w="70%" /><Skel w="60%" /><Skel w="80%" /><Skel w="70%" /><Skel /></div>)}
            {ui !== 'Loading' && rows.length === 0 && (ui === 'Empty'
              ? <div style={{ padding: '48px 24px', display: 'grid', gap: 14, justifyItems: 'center' }}><span className="studio-body">No batches yet. Add files to start.</span><Button variant="primary" icon="file-arrow-up" onClick={() => onOpen('addfiles')}>Add files</Button></div>
              : <div className="studio-body ul-muted" style={{ padding: 32, textAlign: 'center' }}>No batches match.</div>)}
            {ui !== 'Loading' && rows.map((b, i) => (
              <button key={i} onClick={() => onOpen(b.to)} style={{ all: 'unset', cursor: 'pointer', display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) 150px minmax(0,1.2fr) 120px 56px', alignItems: 'center', gap: 16, padding: '14px 16px', borderTop: i ? '1px solid var(--divider)' : 'none', transition: 'background 120ms' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-tint)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <span style={{ display: 'grid' }}><span className="studio-body" style={{ fontWeight: 600 }}>{b.what}</span><span className="studio-body-sm ul-muted">Lake View{b.sub ? ' · ' + b.sub : ''}</span></span>
                <span><Badge tone={STAGE_TONE[b.stage]} icon={null}>{b.stage}</Badge></span>
                <span className="studio-body-sm" style={{ color: 'var(--primary)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>{b.next} →</span>
                <Readiness n={b.r[0]} unknown={b.r[1]} />
                <span className="data-num studio-body-sm ul-muted" style={{ textAlign: 'right' }}>{b.t}</span>
              </button>
            ))}
          </div>
        </section>
        <aside style={{ display: 'grid', gap: 12, paddingTop: 56 }}>
          {(ui === 'Empty' ? [['0', 'imports running', 'addfiles']] : [['2', 'imports running', 'addfiles'], ['5', 'findings need review', 'check'], ['12', 'units ready', 'map']]).map(([n, l, to]) => (
            <button key={l} onClick={() => onOpen(to)} style={{ all: 'unset', cursor: 'pointer', ...floatBox, boxShadow: 'var(--shadow-card)', padding: '16px 18px', display: 'grid', gap: 2 }}>
              <span className="data-num" style={{ font: '600 28px/34px var(--font-display)', color: 'var(--ink)' }}>{n}</span>
              <span className="studio-body-sm ul-muted">{l}</span>
            </button>
          ))}
        </aside>
      </div>
    </div>
  );
}

function AddFilesDialog({ onClose, onStart, providerDown }) {
  const { Button, Badge, DataTable } = UL;
  const [conv, setConv] = useS(null);
  const [crs, setCrs] = useS(false);
  const Step = ({ n, label, on, done }) => <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: on ? 'var(--ink)' : 'var(--ink-muted)', fontWeight: on ? 600 : 400 }} className="studio-body-sm"><span style={{ width: 22, height: 22, borderRadius: 11, display: 'grid', placeItems: 'center', fontSize: 12, background: on ? 'var(--primary)' : done ? 'var(--primary-soft)' : 'var(--surface-subtle)', color: on ? 'var(--on-primary)' : done ? 'var(--primary)' : 'var(--ink-muted)' }}>{done ? '✓' : n}</span>{label}</span>;
  const MAP = { Proposed: 'info', 'Reused mapping': 'success', Manual: 'neutral' };
  const rows = [
    { f: 'parcels.gpkg', p: 'GeoPackage', crs: 'EPSG:32643', n: '214 parcels', m: 'Reused mapping' },
    { f: 'unit_inventory.xlsx', p: 'Excel inventory', crs: '—', n: '55 rows', m: 'Proposed' },
    { f: 'levels.csv', p: 'CSV levels', crs: '—', n: '11 levels', m: 'Manual' },
    { f: 'plan_F7.pdf', p: 'PDF plan', crs: crs ? 'EPSG:32643' : null, n: '—', m: 'Proposed' }
  ].map(r => providerDown && r.m === 'Proposed' ? { ...r, m: 'Manual' } : r);
  return (
    <Dialog width="var(--dialog-lg)" title="Add files" onClose={onClose}
      foot={<><Button variant="ghost" onClick={onClose}>Save and continue later</Button><Button variant="primary" onClick={onStart}>Start import</Button></>}>
      <div style={{ display: 'grid', gap: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}><Step n="1" label="Drop files" done /><span style={{ flex: '0 0 32px', height: 1, background: 'var(--divider)' }}></span><Step n="2" label="Check what we found" on /><span style={{ flex: '0 0 32px', height: 1, background: 'var(--divider)' }}></span><Step n="3" label="Confirm" /></div>
        <DataTable columns={[
          { header: 'File', cell: r => <span className="id-code">{r.f}</span> },
          { header: 'Detected', cell: r => r.p },
          { header: 'CRS', cell: r => r.crs ?? <span className="ul-row"><Badge tone="warning" icon="warning">CRS unverified</Badge><Button variant="soft" onClick={() => setCrs(true)}>Choose</Button></span> },
          { header: 'Contents', cell: r => r.n, numeric: true },
          { header: 'Mapping', cell: r => <Badge tone={MAP[r.m]} icon={null}>{r.m}</Badge> }
        ]} rows={rows} />
        {providerDown ? <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 16px', borderRadius: 'var(--radius-12)', background: 'var(--warning-soft)' }}>
          <UL.Icon name="warning" size="sm" style={{ color: 'var(--warning)' }} /><span className="studio-body" style={{ flex: 1 }}>Automatic mapping unavailable. Map manually or save for later.</span><Button variant="soft">Map manually</Button>
        </div> : <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 16px', borderRadius: 'var(--radius-12)', background: conv ? 'var(--surface-subtle)' : 'var(--info-soft)', transition: 'background 200ms' }}>
          <span className="studio-body" style={{ flex: 1 }}><span className="id-code">carpet_sqft</span> looks like carpet area in ft². Convert to m²?</span>
          {conv ? <Badge status="Reviewed">{conv === 'yes' ? 'Converted to m²' : 'Kept as is'}</Badge> : <div className="ul-row"><Button variant="soft" onClick={() => setConv('yes')}>Yes</Button><Button variant="ghost" onClick={() => setConv('no')}>No</Button><Button variant="ghost" icon="caret-down">Choose field</Button></div>}
        </div>}
        <div className="ul-row studio-body-sm ul-muted"><span>Oblique imagery and LiDAR profiles</span><Badge icon={null}>Planned</Badge></div>
      </div>
    </Dialog>
  );
}

const PX = x => (x + 12) * 10 + 10, PY = z => (8 - z) * 10 + 10;
const PLAN_UNITS = [[-12, -4, 1.2, 8, '701'], [-4, 4, 1.2, 8, '702'], [4, 12, 1.2, 8, '703'], [-12, -4, -8, -1.2, '704'], [-4, 4, -8, -1.2, '705'], [4, 12, -8, -1.2, '706'], [-12, -9, -1.2, 1.2, 'S1'], [-9, -7, -1.2, 1.2, 'L1'], [-7, 12, -1.2, 1.2, 'Corridor']];
const ROOMS = [
  { id: 'Living room', r: [10, 102, 45, 38], dim: '4.5 × 3.8 m' }, { id: 'Bedroom 1', r: [55, 102, 35, 38], dim: '3.5 × 3.8 m' },
  { id: 'Kitchen', r: [10, 140, 28, 30], dim: '2.8 × 3.0 m' }, { id: 'Bath', r: [38, 140, 20, 30], dim: '2.0 × 3.0 m' },
  { id: 'Bedroom 2', r: [58, 140, 32, 30], dim: '3.2 × 3.0 m' }, { id: 'Wall W-12', r: [54, 102, 2, 68], wall: true }
];

function PlanSheet({ active = -1, done = [], highlight704, showCandidates = true }) {
  return (
    <svg viewBox="0 0 260 180" style={{ width: '100%', height: '100%', display: 'block' }} role="img" aria-label="Scanned plan F7, page 3">
      <defs><pattern id="pgrid" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M10 0H0V10" fill="none" stroke="var(--divider)" strokeWidth="0.3" /></pattern></defs>
      <rect width="260" height="180" fill="var(--surface)" /><rect width="260" height="180" fill="url(#pgrid)" />
      {PLAN_UNITS.map(([x0, x1, z0, z1, id]) => (
        <g key={id}><rect x={PX(x0)} y={PY(z1)} width={(x1 - x0) * 10} height={(z1 - z0) * 10} fill="none" stroke="var(--ink-muted)" strokeWidth="1.2" />
          {id !== '704' && <text x={PX((x0 + x1) / 2)} y={PY((z0 + z1) / 2) + 2} textAnchor="middle" fontSize="5.5" fill="var(--ink-muted)" fontFamily="var(--font-sans)">{id}</text>}</g>
      ))}
      {highlight704 && <rect x={PX(-12)} y={PY(-1.2)} width="80" height="68" fill="color-mix(in srgb, var(--primary) 12%, transparent)" stroke="var(--primary)" strokeWidth="1.6" />}
      {showCandidates && ROOMS.map((rm, i) => {
        const [x, y, w, h] = rm.r, on = i === active, ok = done.includes(i);
        return <g key={rm.id}>
          <rect x={x + 1} y={y + 1} width={w - 2} height={h - 2} rx="1" fill={on ? 'color-mix(in srgb, var(--primary) 16%, transparent)' : 'none'} stroke="var(--primary)" strokeWidth={on ? 1.4 : 0.8} strokeDasharray={ok || on ? 'none' : '3 2'} opacity={ok ? 0.55 : 1} />
          {!rm.wall && <text x={x + w / 2} y={y + h / 2} textAnchor="middle" fontSize="5" fill="var(--ink)" fontFamily="var(--font-sans)" fontWeight={on ? 600 : 400}>{rm.id}</text>}
          {!rm.wall && on && <text x={x + w / 2} y={y + h / 2 + 7} textAnchor="middle" fontSize="4.2" fill="var(--primary)" fontFamily="var(--font-mono)">{rm.dim}</text>}
        </g>;
      })}
      {highlight704 && <g><rect x="22" y="93" width="56" height="8" rx="1.5" fill="var(--warning-soft)" stroke="var(--warning)" strokeWidth="0.5" /><text x="50" y="98.8" textAnchor="middle" fontSize="4.6" fontFamily="var(--font-mono)" fill="var(--ink)">CARPET 69.30 m²</text></g>}
      <text x="10" y="176" fontSize="4.5" fill="var(--ink-muted)" fontFamily="var(--font-mono)">plan_F7.pdf · p.3 · r2</text>
    </svg>
  );
}

function StageBar({ stage, onStage }) {
  const st = ['Add files', 'Review details', 'Check and record'];
  return (
    <nav aria-label="Workspace stage" style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 'var(--radius-pill)', background: 'var(--surface-subtle)', width: 'fit-content' }}>
      {st.map(s => <button key={s} onClick={() => onStage(s)} aria-current={s === stage ? 'step' : undefined} className="studio-body-sm" style={{ all: 'unset', cursor: 'pointer', padding: '6px 14px', borderRadius: 'var(--radius-pill)', background: s === stage ? 'var(--surface)' : 'transparent', boxShadow: s === stage ? 'var(--shadow-card)' : 'none', color: s === stage ? 'var(--ink)' : 'var(--ink-muted)', fontWeight: s === stage ? 600 : 400, transition: 'background 150ms' }}>{s}</button>)}
    </nav>
  );
}

const LEVEL_REG = [
  ['F8', '236.8', '239.8', 'levels.csv', 'Reviewed'], ['F7', '233.8', '236.8', 'levels.csv', 'Reviewed'], ['F1–F6', '215.8', '233.8', 'levels.csv', 'Reviewed'],
  ['G · stilt parking', '212.8', '215.8', 'plan_G.pdf', 'Reviewed'], ['B1', '209.1', '212.4', 'levels.csv', 'Needs evidence'], ['B2', '205.8 est.', '209.1', 'Estimated', 'Provisional']
];

function WorkspaceReview({ onStage }) {
  const { Button, Badge, EvidenceChip, DataTable, Panel } = UL;
  const [idx, setIdx] = useS(0);
  const [done, setDone] = useS([]);
  const rm = ROOMS[idx];
  const next = () => { setDone(d => [...d, idx]); setIdx(i => Math.min(ROOMS.length - 1, i + 1)); };
  const left = ROOMS.length - done.length;
  return (
    <div style={{ display: 'grid', gridTemplateRows: 'auto minmax(0,1fr)', gap: 16, padding: 16, minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}><StageBar stage="Review details" onStage={onStage} /><span className="studio-body-sm ul-muted">Lake View Residence · F7</span></div>
      <div style={{ display: 'grid', gridTemplateColumns: '84px minmax(0,1fr) var(--rail-right-wide)', gap: 16, minHeight: 0 }}>
        <div style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
          {['p.3', 'p.2', 'p.1'].map((p, i) => <div key={p} style={{ aspectRatio: '0.72', borderRadius: 'var(--radius-8)', border: i === 0 ? '2px solid var(--primary)' : '1px solid var(--border-strong)', background: 'repeating-linear-gradient(135deg, var(--surface) 0 6px, var(--surface-subtle) 6px 12px)', display: 'grid', placeItems: 'end center', padding: 4 }}><span className="id-code" style={{ fontSize: 10 }}>{p}</span></div>)}
          <div style={{ height: 1, background: 'var(--divider)', margin: '4px 0' }}></div>
          {[['ruler', 'Measure'], ['crosshair', 'Calibrate'], ['intersect', 'Compare']].map(([ic, l]) => <Button key={l} variant="ghost" iconOnly icon={ic} aria-label={l} title={l} />)}
        </div>
        <div style={{ ...floatBox, overflow: 'hidden', display: 'grid', placeItems: 'center', padding: 16, background: 'var(--surface)' }}>
          <div style={{ width: '100%', maxWidth: 820, aspectRatio: '260/180' }}><PlanSheet active={left ? idx : -1} done={done} /></div>
        </div>
        <div style={{ display: 'grid', gap: 16, alignContent: 'start', overflow: 'auto', minHeight: 0 }}>
          {left > 0 ? (
            <Panel key={idx} title={`${done.length + 1} of ${ROOMS.length} to review`} aside={<Badge tone="info" icon={null}>AI candidate</Badge>}
              footer={<><Button variant="primary" icon="check-circle" onClick={next}>Accept</Button><Button>Adjust</Button><Button variant="ghost" onClick={next}>Reject</Button></>}>
              <div style={{ display: 'grid', gap: 10, animation: 'ul-in 200ms cubic-bezier(.23,1,.32,1)' }}>
                <span className="studio-heading">{rm.id}</span>
                <span className="ul-row"><Badge tone="success" icon={null}>High confidence</Badge><EvidenceChip source="plan_F7.pdf" locator="p.3 · r2" href="#" /></span>
                {rm.dim && <span className="data-num studio-body-sm ul-muted">{rm.dim} · from OCR</span>}
              </div>
            </Panel>
          ) : (
            <Panel title="All candidates reviewed" aside={<Badge status="Reviewed" />} footer={<Button variant="primary" onClick={() => onStage('Check and record')}>Continue to checks</Button>}>
              <span className="studio-body-sm ul-muted">6 of 6 decided. Unit prisms are built from these polygons and the level register.</span>
            </Panel>
          )}
          <Panel title="Level register" aside={<span className="ul-caption">m · SD-1</span>} flush={
            <DataTable columns={[
              { header: 'Level', cell: r => r[0] }, { header: 'Lower', cell: r => r[1], numeric: true }, { header: 'Upper', cell: r => r[2], numeric: true },
              { header: 'State', cell: r => <Badge status={r[4]} /> }
            ]} rows={LEVEL_REG} />
          } />
        </div>
      </div>
    </div>
  );
}

function CheckRow({ name, detail, status, action, onAction }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 12, alignItems: 'center', padding: '10px 0', borderTop: '1px solid var(--divider)' }}>
      <span style={{ display: 'grid' }}><span className="studio-body" style={{ fontWeight: 500 }}>{name}</span>{detail && <span className="studio-body-sm ul-muted">{detail}</span>}</span>
      {action ? <UL.Button variant="soft" onClick={onAction}>{action}</UL.Button> : <UL.Badge status={status} />}
    </div>
  );
}

function WorkspaceCheck({ onStage, hostRef, onOpenFinding }) {
  const { Button, Badge, Panel } = UL;
  const G = ({ title, badge, children }) => <div style={{ display: 'grid' }}><div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 0 6px' }}><span className="studio-label ul-muted" style={{ flex: 1 }}>{title}</span>{badge}</div>{children}</div>;
  return (
    <div style={{ display: 'grid', gridTemplateRows: 'auto minmax(0,1fr)', gap: 16, padding: 16, minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}><StageBar stage="Check and record" onStage={onStage} /><span className="studio-body-sm ul-muted">Lake View Residence · draft r4</span></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) var(--rail-right-wide)', gap: 16, minHeight: 0 }}>
        <div style={{ position: 'relative', borderRadius: 'var(--radius-12)', overflow: 'hidden', background: 'var(--map-ground)' }}>
          <div ref={hostRef} style={{ position: 'absolute', inset: 0 }}></div>
          <div style={{ position: 'absolute', top: 16, left: 16 }}><UL.SegmentedControl aria-label="Render" value="Volumes" options={[{ value: 'Model', label: 'Model' }, { value: 'Volumes', label: 'Volumes' }]} /></div>
        </div>
        <div style={{ display: 'grid', gap: 16, alignContent: 'start', overflow: 'auto', minHeight: 0 }}>
          <Panel title="Checks" aside={<span className="ul-caption">Check v1.4</span>} bodyPadding="0 16px 8px">
            <G title="Blocking" badge={<Badge tone="danger" icon={null}>2</Badge>}>
              <CheckRow name="Exclusive overlap" detail="Flat 101 / Flat 201 · 6.4 m³" action="Open in 3D" onAction={() => onOpenFinding('ov')} />
              <CheckRow name="Partition completeness" detail="1 unexplained 3.2 m³ void on F8" action="Open" onAction={() => onOpenFinding('void')} />
            </G>
            <G title="Needs review" badge={<Badge tone="warning" icon={null}>2</Badge>}>
              <CheckRow name="Carpet area" detail="Flat 704 · 3.9 % over declared" status="Needs review" />
              <CheckRow name="Shares" detail="Total 99.50 % · expected 100 %" status="Needs review" />
            </G>
            <G title="Not assessed" badge={<Badge icon={null}>1</Badge>}><div style={{ background: 'repeating-linear-gradient(135deg, var(--surface-subtle) 0 6px, transparent 6px 12px)', borderRadius: 'var(--radius-8)', padding: '0 8px' }}><CheckRow name="Exclusive overlap · F3" detail="Not assessed: open shell on Flat 305" status="Not assessed" /></div></G>
            <G title="Passed" badge={<Badge tone="success" icon={null}>2</Badge>}>
              <CheckRow name="Stack consistency" status="Passed" />
              <CheckRow name="Anchoring" status="Passed" />
            </G>
          </Panel>
          <Panel title="Changes since r3" footer={<div style={{ display: 'grid', gap: 6, justifyItems: 'end', width: '100%' }}><Button variant="primary" disabled>Record reviewed details</Button><span className="ul-help">Blocked: 2 blocking findings open</span></div>}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 12 }}>
              {[['55', 'units'], ['11', 'levels'], ['4', 'shared spaces']].map(([n, l]) => <div key={l} style={{ display: 'grid' }}><span className="data-num" style={{ font: '600 22px/28px var(--font-display)' }}>{n}</span><span className="studio-body-sm ul-muted">{l}</span></div>)}
            </div>
            <div className="studio-body-sm ul-muted" style={{ marginTop: 10 }}>B2, B1, G as stilt parking, F1 to F8</div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function EvidenceDialog({ onClose, snap }) {
  const { Button, Badge, EvidenceChip } = UL;
  return (
    <Dialog width="var(--dialog-lg)" title="Sanctioned plan · p.3" onClose={onClose}
      aside={<div className="ul-row"><Badge icon={null}>r2</Badge><span className="data-num studio-body-sm ul-muted">24 Sep 2026 · 91be…04d7</span><Button variant="ghost" icon="file-text">Open original</Button></div>}
      foot={<><span className="ul-row" style={{ marginRight: 'auto' }}><span className="studio-body-sm ul-muted">Supports</span><EvidenceChip source="Carpet area" locator="69.30 m²" /><EvidenceChip source="Level" locator="F7" /></span><Button variant="ghost" onClick={onClose}>Close</Button><Button>Link to another space</Button></>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.25fr) minmax(0,1fr)', gap: 16 }}>
        <div style={{ borderRadius: 'var(--radius-12)', border: '1px solid var(--border-strong)', overflow: 'hidden', aspectRatio: '260/180' }}><PlanSheet highlight704 showCandidates={false} /></div>
        <div style={{ borderRadius: 'var(--radius-12)', overflow: 'hidden', background: 'var(--map-ground)', position: 'relative', minHeight: 220 }}>
          {snap && <img src={snap} alt="Flat 704 in 3D, F7" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />}
          <span className="studio-label" style={{ position: 'absolute', left: 12, bottom: 12, padding: '4px 10px', borderRadius: 'var(--radius-pill)', background: 'var(--primary)', color: 'var(--on-primary)' }}>Flat 704 · F7</span>
        </div>
      </div>
    </Dialog>
  );
}

function RegisterPage({ ro, ui, hostRef, assigned, floor, setFloor, compare, setCompare, onBack, onCard, levels }) {
  const { Button, Badge, Tabs, DataTable, ShareLedger, RevisionTimeline, EvidenceChip, LevelRail, DescriptionList, Panel } = UL;
  const [tab, setTab] = useS('Units');
  const { Skel, Banner } = window.StudioBits || {};
  const [exp, setExp] = useS(false);
  const units = ['701', '702', '703', '704', '705', '706'].map(n => ({ lvl: 'F7', unit: 'Flat ' + n, code: n === '704' && assigned ? 'P3-7Q4M…-R4' : null, carpet: n === '704' ? '69.30' : null, share: n === '704' ? '1.84' : null, rights: 'Exclusive', st: n === '704' ? (assigned ? 'Assigned' : 'Needs review') : 'Draft' }));
  return (
    <div style={{ display: 'grid', gridTemplateRows: 'auto minmax(0,1fr)', minHeight: 0 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 24px', borderBottom: '1px solid var(--divider)', background: 'var(--surface)', flexWrap: 'wrap' }}>
        <div style={{ display: 'grid', flex: 1, minWidth: 0 }}>
          <div className="ul-row"><h1 className="studio-title" style={{ margin: 0 }}>Lake View Residence</h1><Badge status="Reviewed" /><Badge status="Test fixture">Design mockup</Badge></div>
          <span className="studio-body-sm ul-muted">12 Lake View Road · Parcel ULPIN <span className="id-code">MH2507A1B3C4D5</span> · Apartment declaration</span>
        </div>
        <Button variant="ghost" icon="map-trifold" onClick={onBack}>Back to map</Button>
        <Button variant={compare ? 'soft' : 'default'} icon="intersect" onClick={() => setCompare(!compare)}>{compare ? 'Close compare' : 'Deviation check'}</Button>
        <div style={{ position: 'relative' }}>
          <Button icon="download-simple" onClick={() => setExp(!exp)}>Export</Button>
          {exp && <div role="menu" style={{ position: 'absolute', right: 0, top: 46, zIndex: 40, width: 280, ...floatBox, boxShadow: 'var(--shadow-overlay)', padding: 6, animation: 'ul-pop 160ms cubic-bezier(.23,1,.32,1)', transformOrigin: 'top right' }}>
            {[['CityJSON 2.0 + sidecar'], ['LADM mapping report'], ['CityGML 3.0', 'Planned'], ['GeoPackage · Gati Shakti layer', 'Planned']].map(([l, p]) => (
              <button key={l} role="menuitem" disabled={!!p} onClick={() => setExp(false)} className="studio-body-sm" style={{ all: 'unset', display: 'flex', alignItems: 'center', gap: 8, width: 'calc(100% - 20px)', padding: '9px 10px', borderRadius: 'var(--radius-8)', cursor: p ? 'default' : 'pointer', color: p ? 'var(--ink-muted)' : 'var(--ink)' }}
                onMouseEnter={e => !p && (e.currentTarget.style.background = 'var(--surface-subtle)')} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <span style={{ flex: 1 }}>{l}</span>{p && <Badge icon={null}>{p}</Badge>}
              </button>))}
          </div>}
        </div>
        <div style={{ display: 'grid', justifyItems: 'end', gap: 2 }}><Button variant="primary" icon="qr-code" onClick={onCard} disabled={!assigned || ro}>Property Card</Button>{(!assigned || ro) && <span className="ul-help">{ro ? 'Blocked: read-only role' : 'Blocked: assign a proposed code first'}</span>}</div>
      </header>
      {(ui === 'Stale' || ui === 'Error') && <div style={{ padding: '12px 16px 0' }}>{ui === 'Stale' ? <Banner tone="warning" action="Rebuild"><span className="id-code">levels-r2.csv</span> is newer than this model. Rebuild to apply.</Banner> : <Banner tone="danger" action="Choose"><span className="id-code">parcels.shp</span> has no CRS. Choose the coordinate system to continue.</Banner>}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,55fr) minmax(0,45fr)', gap: 16, padding: 16, minHeight: 0 }}>
        <div style={{ display: 'grid', gridTemplateRows: 'minmax(0,1fr) auto', gap: 8, minHeight: 0 }}>
          <div style={{ position: 'relative', borderRadius: 'var(--radius-12)', overflow: 'hidden', background: 'var(--map-ground)' }}>
            <div ref={hostRef} style={{ position: 'absolute', inset: 0 }}></div>
            {compare ? <>
              <span className="studio-label" style={{ position: 'absolute', top: 16, left: 16, padding: '5px 12px', borderRadius: 'var(--radius-pill)', ...floatBox }}>Sanctioned · G + 8</span>
              <span className="studio-label" style={{ position: 'absolute', top: 16, left: 'calc(50% + 16px)', padding: '5px 12px', borderRadius: 'var(--radius-pill)', ...floatBox }}>Observed · drone survey</span>
              <span style={{ position: 'absolute', top: 14, right: 16 }}><Badge status="Test fixture">Seeded test case</Badge></span>
              <span style={{ position: 'absolute', top: 0, bottom: 0, left: '50%', width: 1, background: 'var(--border-strong)' }}></span>
            </> : <div style={{ position: 'absolute', top: 16, right: 16, bottom: 16, overflow: 'auto' }}><LevelRail reference="m · SD-1" ground="212.4" levels={levels} selected={floor || undefined} onSelect={setFloor} /></div>}
          </div>
          {compare && <span className="ul-caption" style={{ textAlign: 'center' }}>Observed from drone survey; not a legal determination.</span>}
        </div>
        <div style={{ minHeight: 0, overflow: 'auto', display: 'grid', alignContent: 'start', gap: 16 }}>
          {compare ? (
            <Panel title="Sanctioned against observed" aside={<Badge status="Needs review" />} footer={<Button variant="primary">Create finding</Button>}>
              <div style={{ display: 'grid', gap: 16 }}>
                <DataTable columns={[{ header: '', cell: r => r[0] }, { header: 'Sanctioned', cell: r => r[1], numeric: true }, { header: 'Observed', cell: r => r[2], numeric: true }]}
                  rows={[['Storeys', '9', <strong style={{ color: 'var(--danger)' }}>10</strong>], ['Height', '27.0 m', <strong style={{ color: 'var(--danger)' }}>30.0 m</strong>], ['Rooftop structure', '—', '118 m²'], ['Setback', <Badge status="Not comparable" />, <span className="ul-muted">roofprint only</span>]]} />
                <div className="ul-help">Stair cabin and water tank excluded by rule.</div>
                <div className="ul-row"><EvidenceChip source="Sanctioned plan" locator="r2" href="#" /><EvidenceChip kind="feature" source="Drone survey" locator="12 Sep 2026 · checkpoint RMSE" href="#" /><EvidenceChip source="Extraction model" locator="held-out IoU" href="#" /></div>
              </div>
            </Panel>
          ) : <>
            <Tabs tabs={['Units', 'Shares', 'Documents', 'Checks', 'History']} value={tab} onChange={setTab} />
            <div key={tab} style={{ animation: 'ul-fade 160ms ease-out' }}>
              {tab === 'Units' && ui === 'Loading' && <div style={{ ...floatBox, padding: 16, display: 'grid', gap: 14 }}>{Array.from({ length: 7 }, (_, i) => <Skel key={i} w={i ? '100%' : '40%'} />)}</div>}
              {tab === 'Units' && ui === 'Empty' && <div style={{ ...floatBox, boxShadow: 'var(--shadow-card)', padding: '32px 24px', display: 'grid', gap: 14, justifyItems: 'start' }}><span className="studio-body">No floors recorded for this building. Add a plan or level schedule.</span><Button variant="primary" icon="file-arrow-up">Add files</Button></div>}
              {tab === 'Units' && ui !== 'Loading' && ui !== 'Empty' && <div style={{ ...floatBox, boxShadow: 'var(--shadow-card)', overflow: 'hidden' }}><DataTable columns={[
                { header: 'Level', cell: r => r.lvl }, { header: 'Unit', cell: r => <strong style={{ fontWeight: 600 }}>{r.unit}</strong> },
                { header: 'Code', cell: r => r.code ? <span className="id-code">{r.code}</span> : <span className="ul-muted">After review</span> },
                { header: 'Carpet m²', cell: r => r.carpet ?? <em className="ul-muted">Unknown</em>, numeric: true },
                { header: 'Share %', cell: r => r.share ?? <em className="ul-muted">Unknown</em>, numeric: true },
                { header: 'Status', cell: r => <Badge status={r.st} /> }]} rows={units} more="49 more units" /></div>}
              {tab === 'Shares' && <ShareLedger building="Lake View Residence" basis="area" totalUnits={55} total={99.5} moreUnits={54} rows={[{ unit: 'Flat 704', code: assigned ? 'P3-7Q4M…-R4' : '—', carpet: 69.3, share: 1.84 }]} evidence={{ source: 'Deed of declaration', href: '#' }} style={{ maxWidth: 'none' }} />}
              {tab === 'Documents' && <Panel title="Sources" aside={<span className="ul-caption">5</span>}><div style={{ display: 'grid', gap: 10 }}>{[['feature', 'parcels.gpkg', '214 features'], ['table', 'unit_inventory.xlsx', '55 rows'], ['table', 'levels.csv', '11 rows'], ['document', 'Sanctioned plan', 'p.3 · r2'], ['document', 'Sale deed', 'cl.2']].map(([k, s, l]) => <div key={s}><EvidenceChip kind={k} source={s} locator={l} href="#" /></div>)}</div></Panel>}
              {tab === 'Checks' && <Panel title="Checks" bodyPadding="0 16px 8px"><CheckRow name="Exclusive overlap" detail="Flat 101 / Flat 201 · 6.4 m³" status="Blocking" /><CheckRow name="Partition completeness" detail="3.2 m³ void on F8" status="Blocking" /><CheckRow name="Carpet area" detail="Flat 704 · 3.9 %" status="Needs review" /><CheckRow name="Shares" detail="99.50 %" status="Needs review" /><CheckRow name="Stack consistency" status="Passed" /><CheckRow name="Anchoring" status="Passed" /></Panel>}
              {tab === 'History' && <RevisionTimeline chain="consistent" revisions={REVS} style={{ maxWidth: 'none' }} />}
            </div>
          </>}
        </div>
      </div>
    </div>
  );
}

function VerifyPage({ onBack, assignedOn, ui }) {
  const { Button, Badge, UlpinCode, DescriptionList, RevisionTimeline, Wordmark } = UL;
  const { Skel } = window.StudioBits || {};
  const [v, setV] = useS('valid');
  const res = { valid: ['success', 'check-circle', 'Valid: revision r3'], superseded: ['warning', 'warning', 'Superseded by r4'], retired: ['danger', 'warning-octagon', 'Retired: merged into P3-9F2K…-RS'] }[v];
  const head = <header style={{ display: 'flex', alignItems: 'center', gap: 12, height: 56, padding: '0 20px', background: 'var(--surface)', borderBottom: '1px solid var(--divider)' }}><Wordmark surface="Verify" /><span style={{ flex: 1 }}></span><Button variant="ghost" onClick={onBack}>Back to Studio</Button></header>;
  const note = <div className="studio-body-sm" style={{ padding: '8px 12px', borderRadius: 'var(--radius-8)', background: 'var(--surface-subtle)', color: 'var(--ink-soft)' }}>Local demonstration link. Public verification is planned.</div>;
  const alt = ui === 'Loading' ? <div style={{ ...floatBox, boxShadow: 'var(--shadow-card)', padding: 18, display: 'grid', gap: 14 }}>{Skel && <><Skel h={28} w="55%" /><Skel w="80%" /><Skel /><Skel w="70%" /><Skel w="40%" /></>}</div>
    : ui === 'Empty' ? <div style={{ ...floatBox, boxShadow: 'var(--shadow-card)', padding: '24px 20px', display: 'grid', gap: 12, justifyItems: 'start' }}><span className="portal-h3">No card found for this link</span><span className="studio-body-sm ul-muted">This device has no Property Card with this code and revision. Make the card in the Studio first.</span><Button onClick={onBack}>Back to Studio</Button></div>
    : ui === 'Error' ? <div role="alert" style={{ display: 'grid', gap: 12, justifyItems: 'start', padding: '16px 18px', borderRadius: 'var(--radius-12)', background: 'var(--danger-soft)' }}><span className="ul-row" style={{ color: 'var(--danger)' }}><UL.Icon name="warning-octagon" /><span className="portal-h3">Could not check this card</span></span><span className="studio-body-sm" style={{ color: 'var(--ink)' }}>The local resolver is not running on this device. Start the Studio and try again.</span><Button variant="soft">Try again</Button></div> : null;
  if (alt) return <div style={{ overflow: 'auto', minHeight: '100dvh', background: 'var(--bg)' }}>{head}<main style={{ maxWidth: 560, margin: '0 auto', padding: '20px 16px 48px', display: 'grid', gap: 16 }}>{note}{alt}</main></div>;
  return (
    <div style={{ overflow: 'auto', minHeight: '100dvh', background: 'var(--bg)' }}>
      {head}
      <main style={{ maxWidth: 560, margin: '0 auto', padding: '20px 16px 48px', display: 'grid', gap: 16 }}>
        {note}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 18px', borderRadius: 'var(--radius-12)', background: `var(--${res[0]}-soft)`, color: `var(--${res[0]})`, animation: 'ul-pop 240ms cubic-bezier(.23,1,.32,1)' }} key={v}>
          <UL.Icon name={res[1]} /><span className="portal-h3" style={{ flex: 1 }}>{res[2]}</span>{v !== 'valid' && <a href="#" onClick={e => { e.preventDefault(); setV('valid'); }} className="studio-body-sm">Open current</a>}
        </div>
        <div style={{ ...floatBox, boxShadow: 'var(--shadow-card)', padding: 18, display: 'grid', gap: 16 }}>
          <span className="studio-heading">Flat 704, Lake View Residence</span>
          <UlpinCode code={CODE_P3} location={LOC_704} copyable />
          <DescriptionList items={[
            { label: 'Level', value: 'F7 · 233.8 to 236.8 m · site datum SD-1' },
            { label: 'Carpet area', value: '69.30 m²' },
            { label: 'Assigned', value: assignedOn },
            { label: 'Revision hash', value: '7f3a…c2e1', mono: true }]} />
        </div>
        <RevisionTimeline chain="consistent" revisions={REVS} style={{ maxWidth: 'none' }} />
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 8 }}>
          <UL.SegmentedControl aria-label="Preview result" value={v} onChange={setV} options={[{ value: 'valid', label: 'Valid' }, { value: 'superseded', label: 'Superseded' }, { value: 'retired', label: 'Retired' }]} />
        </div>
      </main>
    </div>
  );
}

Object.assign(window, { PlanSheet, Dialog, BatchesPage, AddFilesDialog, WorkspaceReview, WorkspaceCheck, EvidenceDialog, RegisterPage, VerifyPage });
