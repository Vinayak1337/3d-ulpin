const { useEffect: useE, useRef: useR, useState: useSt } = React;
const K = window.Ulpin;
const card = { background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-12)', boxShadow: 'var(--shadow-card)' };
const CODE = 'P3-7Q4M2R8T6V0W3X5Y9ZAB-R4', LOC = 'MH2507A1B3C4D5 / S01 / F07 / R003';
const HINDI_FONT = { fontFamily: '"Noto Sans Devanagari", var(--font-sans)' };

function whenScene(cb) { if (window.ULSceneClass) cb(); else window.addEventListener('ulscene-ready', cb, { once: true }); }
function Scene3D({ state, onSnap, style, cam }) {
  const ref = useR(null);
  useE(() => {
    let inst;
    whenScene(() => {
      inst = new window.ULSceneClass(); inst.init(ref.current, {}); inst.set(state); if (cam) inst.setCamera(cam[0], cam[1]);
      if (onSnap) setTimeout(() => { inst.tween && (inst.tween.start = -1e9); onSnap(inst.snapshot()); }, 1400);
    });
  }, []);
  return <div ref={ref} style={{ position: 'relative', overflow: 'hidden', background: 'var(--map-ground)', ...style }}></div>;
}
const S704 = { mode: 'floor', sel: 'unit', floor: 'F7', unit: 'Flat 704', view: '3D', render: 'Model' };

function Board({ x, y, w, h, label, children, id }) {
  return (
    <div style={{ position: 'absolute', left: x, top: y }} data-screen-label={label}>
      <div className="studio-label" style={{ position: 'absolute', top: -30, left: 0, color: 'var(--ink-muted)', whiteSpace: 'nowrap', fontSize: 14 }}>{label}</div>
      <div id={id} style={{ width: w, height: h, overflow: 'hidden', borderRadius: w < 500 ? 28 : 12, background: 'var(--bg)', boxShadow: '0 20px 60px #16272d26', position: 'relative', display: 'flex', flexDirection: 'column' }}>{children}</div>
    </div>
  );
}

function PhoneBar({ title, right }) {
  return <div style={{ height: 56, flex: '0 0 56px', display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', background: 'var(--surface)', borderBottom: '1px solid var(--divider)' }}><K.Wordmark surface={title} size={16} /><span style={{ flex: 1 }}></span>{right}</div>;
}
const Initials = ({ t }) => <span style={{ width: 32, height: 32, borderRadius: 16, display: 'grid', placeItems: 'center', background: 'var(--primary-soft)', color: 'var(--primary)', font: '600 12px var(--font-sans)' }}>{t}</span>;

const PHONE_BATCHES = [
  ['Lake View bundle', 'Add files', 'neutral', 'Review 1 mapping'], ['Lake View Residence · F1–F2', 'Check and record', 'warning', 'Resolve 6.4 m³ overlap'],
  ['Lake View Residence · F7', 'Review details', 'info', 'Review 6 room candidates'], ['Lake View Residence · F7 units', 'Recorded', 'success', 'Assign codes for 12 units'],
  ['Lake View Residence · F8', 'Check and record', 'warning', 'Resolve 3.2 m³ void'], ['Flat 704', 'Review details', 'info', 'Review carpet area +3.9 %']
];
function S1Phone() {
  return <>
    <PhoneBar title="Studio" right={<Initials t="RI" />} />
    <div style={{ flex: 1, overflow: 'auto', padding: 16, display: 'grid', gap: 14, alignContent: 'start' }}>
      <h1 className="studio-title" style={{ margin: 0 }}>Batches</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 8 }}>
        {[['2', 'imports running'], ['5', 'findings'], ['12', 'units ready']].map(([n, l]) => <div key={l} style={{ ...card, padding: '10px 12px', display: 'grid' }}><span className="data-num" style={{ font: '600 22px/26px var(--font-display)' }}>{n}</span><span className="studio-label ul-muted">{l}</span></div>)}
      </div>
      <div style={{ ...card, overflow: 'hidden' }}>
        {PHONE_BATCHES.map(([w, st, tone, nx], i) => (
          <div key={i} style={{ display: 'grid', gap: 6, padding: '12px 14px', borderTop: i ? '1px solid var(--divider)' : 'none', minHeight: 44 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span className="studio-body" style={{ fontWeight: 600, flex: 1 }}>{w}</span><K.Badge tone={tone} icon={null}>{st}</K.Badge></div>
            <span className="studio-body-sm" style={{ color: 'var(--primary)', fontWeight: 600 }}>{nx} →</span>
          </div>
        ))}
      </div>
      <span className="ul-help">Editing is available on desktop.</span>
    </div>
  </>;
}

function S5Phone() {
  const lv = ['Roof', 'F8', 'F7', 'F6', 'F5', 'F4', 'F3', 'F2', 'F1', 'G', 'B1', 'B2'];
  return <>
    <PhoneBar title="Studio" right={<K.Badge status="Test fixture">Design mockup</K.Badge>} />
    <div style={{ flex: 1, position: 'relative' }}>
      <Scene3D state={S704} cam={[[44, 64, 70], [0, 16, 0]]} style={{ position: 'absolute', inset: 0 }} />
      <div style={{ position: 'absolute', top: 12, left: 12, right: 12, display: 'flex', gap: 6, overflow: 'hidden' }}>
        <span className="data-num studio-label" style={{ flex: '0 0 auto', whiteSpace: 'nowrap', alignSelf: 'center', height: 36, display: 'grid', placeItems: 'center', padding: '0 10px', borderRadius: 'var(--radius-pill)', background: 'var(--surface)', color: 'var(--ink-soft)', boxShadow: 'var(--shadow-floating)' }}>m · SD-1</span>
        {lv.map(l => <span key={l} style={{ flex: '0 0 auto', minWidth: 44, height: 36, display: 'grid', placeItems: 'center', borderRadius: 'var(--radius-pill)', font: '600 13px var(--font-sans)', background: l === 'F7' ? 'var(--primary)' : 'var(--surface)', color: l === 'F7' ? 'var(--on-primary)' : 'var(--ink)', boxShadow: 'var(--shadow-floating)' }}>{l}</span>)}
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, background: 'var(--surface)', borderRadius: '20px 20px 0 0', boxShadow: 'var(--shadow-overlay)', padding: '10px 18px 22px', display: 'grid', gap: 12 }}>
        <span style={{ justifySelf: 'center', width: 36, height: 4, borderRadius: 2, background: 'var(--border-strong)' }}></span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span className="studio-heading" style={{ flex: 1 }}>Flat 704</span><K.Badge status="Needs review" /></div>
        <K.UlpinCode code={CODE} location={LOC} labelled={false} />
        <K.DescriptionList items={[
          { label: 'Level', value: 'F7 · 233.8 to 236.8 m · SD-1' },
          { label: 'Carpet area', value: '69.30 m² · 72.00 declared' },
          { label: 'Share', value: '1.84 %' }]} />
        <span className="ul-help">View only on phone. Review on desktop.</span>
      </div>
    </div>
  </>;
}

function PortalTop({ phone }) {
  if (!phone) return <K.PortalHeader title="3D ULPIN" department="Land records · Design mockup" languageSwitch="हिन्दी" signInLabel="Sign in" accessibilityBar />;
  return <div style={{ height: 60, flex: '0 0 60px', display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', background: 'var(--surface)', borderBottom: '1px solid var(--divider)' }}>
    <span aria-label="Department mark slot" style={{ width: 32, height: 32, borderRadius: 6, border: '1px dashed var(--border-strong)' }}></span>
    <K.Wordmark surface="Portal" size={16} /><span style={{ flex: 1 }}></span>
    <K.Button variant="ghost" style={HINDI_FONT}>हिन्दी</K.Button>
  </div>;
}
const Wrap = ({ children, phone }) => <div style={{ flex: 1, overflow: 'auto' }}><div style={{ maxWidth: 'var(--portal-content)', margin: '0 auto', padding: phone ? '20px 16px 32px' : '40px 32px 56px', display: 'grid', gap: phone ? 20 : 32 }}>{children}</div></div>;
const TaskLink = ({ t, s }) => <a href="#" onClick={e => e.preventDefault()} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', alignItems: 'center', gap: 12, minHeight: 56, padding: '10px 4px', borderTop: '1px solid var(--divider)', textDecoration: 'none', color: 'var(--ink)' }}><span style={{ display: 'grid' }}><span className="portal-h3" style={{ fontSize: 18 }}>{t}</span><span className="studio-body-sm ul-muted" style={HINDI_FONT}>{s}</span></span><span style={{ color: 'var(--primary)', fontSize: 20 }}>→</span></a>;

function P1({ phone }) {
  const search = (
    <div style={{ display: 'grid', gap: 14, ...(phone ? { position: 'sticky', top: 0, background: 'var(--bg)', paddingBottom: 12, zIndex: 2 } : {}) }}>
      <h1 className={phone ? 'portal-h1' : 'portal-display'} style={{ margin: 0 }}>Find a property record</h1>
      <p className="portal-body ul-muted" style={{ margin: 0, ...HINDI_FONT }}>संपत्ति रिकॉर्ड खोजें</p>
      <div style={{ display: 'grid', gridTemplateColumns: phone ? '1fr' : 'minmax(0,1fr) auto', gap: 12, alignItems: 'end' }}>
        <K.Field label="3D ULPIN, parcel ULPIN or address" placeholder="Flat 704 Lake View" />
        <K.Button variant="primary" size="lg" icon="magnifying-glass">Search</K.Button>
      </div>
    </div>
  );
  const tasks = <div style={{ display: 'grid' }}><TaskLink t="Verify a Property Card" s="प्रॉपर्टी कार्ड सत्यापित करें" /><TaskLink t="Request a correction" s="सुधार का अनुरोध करें" /><TaskLink t="Track my request" s="मेरा अनुरोध ट्रैक करें" /></div>;
  const note = <div style={{ padding: '16px 18px', borderRadius: 'var(--radius-12)', background: 'var(--surface-subtle)', display: 'grid', gap: 6 }}>
    <span className="portal-label" style={{ fontWeight: 600 }}>What this record shows</span>
    <span className="portal-body ul-muted">Released facts only. No owner names. A technical record, not a title document.</span>
  </div>;
  return <><PortalTop phone={phone} /><Wrap phone={phone}>
    {phone ? <>{search}{tasks}{note}</> : <div style={{ display: 'grid', gridTemplateColumns: '7fr 5fr', gap: 64, alignItems: 'start', paddingTop: 24 }}><div style={{ display: 'grid', gap: 32 }}>{search}{note}</div>{tasks}</div>}
  </Wrap></>;
}

function Facts() {
  return <K.DescriptionList items={[
    { label: 'Level', value: 'F7' }, { label: 'Elevations', value: '233.8 to 236.8 m · site datum SD-1' },
    { label: 'Carpet area', value: '69.30 m²' }, { label: 'Undivided share', value: '1.84 %' },
    { label: 'Shared spaces', value: 'Stair S1, Lift L1, Corridor' }, { label: 'Last updated', value: '24 Sep 2026 · r3' }]} />;
}
const NoteBar = () => <div className="portal-body" style={{ padding: '12px 16px', borderRadius: 'var(--radius-8)', background: 'var(--info-soft)', color: 'var(--ink)' }}>Released details only. Owner names and documents are not public.</div>;
const Crumb = () => <nav className="studio-body-sm ul-muted" style={{ display: 'flex', gap: 8 }}><a href="#">Home</a><span>/</span><a href="#">Results</a><span>/</span><span style={{ color: 'var(--ink)' }}>Flat 704</span></nav>;

function P3({ phone, snap, setSnap }) {
  const head = <div style={{ display: 'grid', gap: 12 }}><Crumb /><h1 className={phone ? 'portal-h2' : 'portal-h1'} style={{ margin: 0 }}>Flat 704, Lake View Residence</h1>
    <K.UlpinCode code={CODE} location={LOC} copyable />
    <span className="studio-body-sm ul-muted">Parcel ULPIN <span className="id-code">MH2507A1B3C4D5</span></span></div>;
  const facts = <div style={{ ...card, padding: 20, display: 'grid', gap: 18 }}><Facts /><K.Button variant="primary" size="lg" icon="download-simple">Download Property Card</K.Button></div>;
  if (phone) return <><PortalTop phone /><Wrap phone>{head}<NoteBar />{facts}
    <div style={{ ...card, overflow: 'hidden', position: 'relative', height: 240 }}>
      {snap ? <img src={snap} alt="Flat 704 on F7, static 3D view" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : <div style={{ height: '100%', background: 'var(--map-ground)' }}></div>}
      <div style={{ position: 'absolute', right: 12, bottom: 12 }}><K.Button size="lg" icon="cube">Open 3D</K.Button></div>
    </div></Wrap></>;
  return <><PortalTop /><Wrap>{head}<NoteBar />
    <div style={{ display: 'grid', gridTemplateColumns: '7fr 5fr', gap: 32, alignItems: 'start' }}>
      <div style={{ display: 'grid', gap: 16 }}>
        <div style={{ position: 'relative', height: 420, borderRadius: 'var(--radius-12)', overflow: 'hidden' }}><Scene3D state={S704} cam={[[34, 50, 50], [0, 20, 0]]} onSnap={setSnap} style={{ position: 'absolute', inset: 0 }} />
          <span className="studio-label" style={{ position: 'absolute', top: 12, left: 12, padding: '4px 10px', borderRadius: 'var(--radius-pill)', background: 'var(--surface)', boxShadow: 'var(--shadow-floating)' }}>View only</span></div>
        <K.StrataSection parcel="MH2507A1B3C4D5" selected={1} roof="239.8 roof" ground="212.4 ground" levels={[{}, { label: 'F7 · Flat 704', elevation: '233.8' }, {}, {}, {}, {}, {}, {}, {}]}
          basements={[{ label: 'B1 · parking', elevation: '209.1' }, { label: 'B2 · parking (levels estimated)', elevation: '205.8', estimated: true }]} utility="Water main (B)" corridor="Metro corridor · test fixture" corridorRange="194.0 to 198.0" style={{ maxWidth: 'none' }} />
      </div>
      {facts}
    </div></Wrap></>;
}

const REV = [
  { kind: 'recorded', title: 'r3 Recorded', byline: '24 Sep 2026, 14:10', hash: '7f3a…c2e1', previousHash: '91be…04d7' },
  { kind: 'evidence', title: 'r2 Evidence applied', byline: '24 Sep 2026, 13:52', hash: '91be…04d7', previousHash: '2c80…9a13' },
  { kind: 'draft', title: 'r1 Draft', byline: '24 Sep 2026, 11:05' }];
function P4({ phone }) {
  const result = <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '18px 20px', borderRadius: 'var(--radius-12)', background: 'var(--success-soft)', color: 'var(--success)' }}><K.Icon name="check-circle" /><span className="portal-h2" style={{ fontSize: phone ? 22 : 24 }}>Valid: revision r3</span></div>;
  const summary = <div style={{ ...card, padding: 20, display: 'grid', gap: 16 }}><span className="portal-h3">Flat 704, Lake View Residence</span><K.UlpinCode code={CODE} location={LOC} copyable />
    <K.DescriptionList items={[{ label: 'Level', value: 'F7 · 233.8 to 236.8 m · SD-1' }, { label: 'Carpet area', value: '69.30 m²' }, { label: 'Revision hash', value: '7f3a…c2e1', mono: true }]} /></div>;
  const foot = <div className="portal-body" style={{ padding: '16px 0', borderTop: '1px solid var(--divider)' }}>Something wrong? <a href="#">Request a correction</a> with your evidence.</div>;
  const tl = <K.RevisionTimeline chain="consistent" revisions={REV} style={{ maxWidth: 'none' }} />;
  return <><PortalTop phone={phone} /><Wrap phone={phone}>
    <h1 className={phone ? 'portal-h2' : 'portal-h1'} style={{ margin: 0 }}>Verify a Property Card</h1>
    {result}
    {phone ? <>{summary}{tl}</> : <div style={{ display: 'grid', gridTemplateColumns: '7fr 5fr', gap: 32, alignItems: 'start' }}>{summary}{tl}</div>}
    {foot}
  </Wrap></>;
}

function LineChart() {
  const pts = Array.from({ length: 30 }, (_, i) => i === 29 ? 186 : 0);
  const W = 520, H = 180, pad = 32, max = 200;
  const xy = pts.map((v, i) => [pad + (i / 29) * (W - pad - 12), H - 24 - (v / max) * (H - 48)]);
  return <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }} role="img" aria-label="Spaces recorded per day: 186 on 24 Sep, none on the other 29 days">
    {[0, 100, 200].map(t => { const y = H - 24 - (t / max) * (H - 48); return <g key={t}><line x1={pad} x2={W - 12} y1={y} y2={y} stroke="var(--divider)" /><text x={pad - 6} y={y + 4} textAnchor="end" fontSize="10" fill="var(--ink-muted)" fontFamily="var(--font-mono)">{t}</text></g>; })}
    <polyline points={xy.map(p => p.join(',')).join(' ')} fill="none" stroke="var(--seq-550)" strokeWidth="1.8" />
    <circle cx={xy[29][0]} cy={xy[29][1]} r="3.5" fill="var(--seq-550)" />
    <text x={xy[29][0] - 6} y={xy[29][1] - 8} textAnchor="end" fontSize="11" fill="var(--ink)" fontFamily="var(--font-sans)">186 · 24 Sep</text>
    <text x={pad} y={H - 6} fontSize="10" fill="var(--ink-muted)" fontFamily="var(--font-sans)">26 Aug</text><text x={W - 12} y={H - 6} textAnchor="end" fontSize="10" fill="var(--ink-muted)" fontFamily="var(--font-sans)">24 Sep</text>
  </svg>;
}
function BarChart() {
  const d = [['Overlap', 1], ['Partition', 1], ['Stack', 0], ['Carpet area', 1], ['Shares', 1]];
  return <div style={{ display: 'grid', gap: 10 }}>{d.map(([l, n]) => <a key={l} href="#" onClick={e => e.preventDefault()} style={{ display: 'grid', gridTemplateColumns: '96px minmax(0,1fr) 24px', alignItems: 'center', gap: 10, textDecoration: 'none', color: 'var(--ink)' }}>
    <span className="studio-body-sm">{l}</span><span style={{ height: 14, borderRadius: 3, background: 'var(--surface-subtle)', overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: `${n * 50}%`, background: 'var(--seq-550)' }}></span></span><span className="data-num studio-body-sm">{n}</span></a>)}
    <div style={{ display: 'grid', gridTemplateColumns: '96px minmax(0,1fr) 24px', gap: 10 }}><span></span><span className="data-num studio-label ul-muted" style={{ display: 'flex', justifyContent: 'space-between' }}><span>0</span><span>1</span><span>2</span></span></div>
  </div>;
}
function A1() {
  const tile = (n, l, sub) => <a href="#" onClick={e => e.preventDefault()} style={{ ...card, padding: '18px 20px', display: 'grid', gap: 4, textDecoration: 'none', color: 'var(--ink)' }}><span className="studio-body-sm ul-muted">{l}</span><span className="data-num" style={{ font: '600 32px/38px var(--font-display)' }}>{n}</span>{sub && <span className="studio-body-sm" style={{ color: 'var(--danger)' }}>{sub}</span>}</a>;
  const P = ({ title, aside, children }) => <K.Panel title={title} aside={aside}>{children}</K.Panel>;
  return <>
    <K.StudioHeader surface="Admin" nav={['Overview', 'Imports', 'Coverage', 'AI quality', 'Users', 'Audit', 'Settings']} active="Overview" status="Snapshot 24 Sep, 14:10" initials="AD" userName="A. Deshmukh" />
    <div style={{ flex: 1, overflow: 'auto' }}><div style={{ maxWidth: 'var(--max-content)', margin: '0 auto', padding: 24, display: 'grid', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><h1 className="studio-title" style={{ margin: 0, flex: 1 }}>Overview</h1><K.Badge status="Test fixture">Design mockup</K.Badge></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 16 }}>{tile('5', 'Open findings', '2 blocking')}{tile('38', 'Spaces awaiting review')}{tile('2', 'Imports running')}{tile('41', 'Proposed codes assigned this week')}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 16 }}>
        <P title="Spaces recorded per day" aside={<span className="ul-caption">last 30 days</span>}><LineChart /></P>
        <P title="Findings by check type" aside={<span className="ul-caption">open</span>}><BarChart /></P>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 16 }}>
        <K.Panel title="Coverage by block" flush={<K.DataTable columns={[{ header: 'Block', cell: r => r[0] }, { header: 'Parcels', cell: r => r[1], numeric: true }, { header: 'Buildings', cell: r => r[2], numeric: true }, { header: 'Spaces', cell: r => r[3], numeric: true }, { header: 'Ready %', cell: r => r[4], numeric: true }, { header: 'Unknown %', cell: r => r[5], numeric: true }]}
          rows={[['Lake View', '214', '22', '186', '6.5', '2.2']]} more="Other blocks not imported" />} />
        <K.Panel title="AI quality" aside={<span className="ul-caption">held-out tests</span>} flush={<K.DataTable columns={[{ header: 'Model', cell: r => r[0] }, { header: 'Result', cell: r => <K.Badge status="Not assessed" /> }, { header: 'n', cell: r => '—', numeric: true }]}
          rows={[['Building extraction IoU'], ['Floor segmentation boundary error'], ['Mapping accuracy']]} more="Numbers appear once a held-out test runs." />} />
      </div>
      <div className="studio-body-sm" style={{ display: 'flex', alignItems: 'center', gap: 10 }}><K.Badge tone="success" icon="shield-check">Chain consistent</K.Badge><span>Revision chain consistent for 186 of 186 records, last check 14:10</span></div>
    </div></div>
  </>;
}

function Boards() {
  const [snap, setSnap] = useSt(null);
  const D = [1440, 900], M = [390, 844];
  return <>
    <Board x={80} y={80} w={M[0]} h={M[1]} label="S1 Batches · 390"><S1Phone /></Board>
    <Board x={520} y={80} w={M[0]} h={M[1]} label="S5 Building and floors · 390"><S5Phone /></Board>
    <Board x={960} y={80} w={M[0]} h={M[1]} label="P4L Verify card · local link · 390"><div style={{ flex: 1, overflow: 'auto' }}><window.VerifyPage assignedOn="25 Sep 2026" onBack={() => {}} /></div></Board>
    <Board x={80} y={1080} w={D[0]} h={D[1]} label="P1 Portal home and search · 1440"><P1 /></Board>
    <Board x={1600} y={1080} w={M[0]} h={M[1]} label="P1 · 390"><P1 phone /></Board>
    <Board x={80} y={2100} w={D[0]} h={D[1]} label="P3 Public property record · 1440"><P3 setSnap={setSnap} /></Board>
    <Board x={1600} y={2100} w={M[0]} h={M[1]} label="P3 · 390"><P3 phone snap={snap} /></Board>
    <Board x={80} y={3120} w={D[0]} h={D[1]} label="P4 Verify Property Card · public · 1440"><P4 /></Board>
    <Board x={1600} y={3120} w={M[0]} h={M[1]} label="P4 · 390"><P4 phone /></Board>
    <Board x={80} y={4140} w={D[0]} h={D[1]} label="A1 Admin overview · 1440"><A1 /></Board>
  </>;
}
window.BoardsKit = { Board, PhoneBar, PortalTop, Wrap, card, Scene3D, S704, HINDI_FONT, Initials, REV, CODE, LOC };
ReactDOM.createRoot(document.getElementById('ds-root')).render(<Boards />);
