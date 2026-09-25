const SP = window.Ulpin;
const spFloat = { background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-12)', boxShadow: 'var(--shadow-floating)' };
const AI_CANDS = [['Candidate 1', 'High confidence', 'success'], ['Candidate 2', 'High confidence', 'success'], ['Candidate 3', 'Medium confidence', 'info'], ['Candidate 4', 'Low confidence', 'warning']];
const F7_SPACES = [['Flat 701', 'Exclusive'], ['Flat 702', 'Exclusive'], ['Flat 703', 'Exclusive'], ['Flat 704', 'Exclusive'], ['Flat 705', 'Exclusive'], ['Flat 706', 'Exclusive'], ['Stair S1', 'Shared'], ['Lift L1', 'Shared'], ['Corridor', 'Shared']];
const PANELS = [['Layers', 'stack'], ['Spaces', 'buildings'], ['Sources', 'file-text'], ['Checks', 'list-checks']];

function PanelSwitch({ panel, setPanel }) {
  return <div style={{ display: 'flex', gap: 2 }}>{PANELS.map(([p, ic]) => <SP.Button key={p} variant={panel === p ? 'soft' : 'ghost'} icon={ic} aria-pressed={panel === p} onClick={() => setPanel(panel === p ? null : p)}>{p}</SP.Button>)}</div>;
}

function Sec({ title, aside, children }) {
  return <div style={{ display: 'grid', gap: 8, padding: '12px 0', borderTop: '1px solid var(--divider)' }}><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span className="studio-label ul-muted" style={{ flex: 1 }}>{title}</span>{aside}</div>{children}</div>;
}
const Replayed = () => <SP.Badge icon="clock-counter-clockwise">Replayed from rehearsal 22 Nov</SP.Badge>;

function LeftPanel({ panel, setPanel, layers, setLayers, mode, go, unit, ui, openFinding }) {
  const { Button, Badge, Toggle, EvidenceChip } = SP;
  const colourBy = mode === 'floor' ? 'Rights' : mode === 'underground' ? 'Utilities' : 'None';
  const setAi = (i, v) => setLayers(l => ({ ...l, aiState: { ...l.aiState, [i]: v } }));
  const decided = Object.keys(layers.aiState).length;
  let body = null;
  if (panel === 'Layers') body = <>
    <Sec title="Base"><span className="studio-body-sm ul-muted">Parcels · buildings · roads and water</span></Sec>
    <Sec title="Imagery">
      <div className="ul-layer"><span className="ul-grow studio-body-sm">Orthophoto</span><Toggle aria-label="Orthophoto" checked={layers.ortho} onChange={v => setLayers(l => ({ ...l, ortho: !!v, ai: v ? l.ai : false }))} /></div>
      <div className="ul-layer"><span className="ul-grow studio-body-sm">AI candidates <span className="ul-muted">· building extraction</span></span><Toggle aria-label="AI candidates" checked={layers.ai} onChange={v => { setLayers(l => ({ ...l, ai: !!v, ortho: v ? true : l.ortho })); if (v && mode !== 'area' && mode !== 'building') go('area', { sel: 'bldg', unit: null }); }} /></div>
    </Sec>
    <Sec title="Colour by" aside={<span className="ul-caption">one at a time</span>}>
      <div role="radiogroup" aria-label="Colour by" style={{ display: 'grid', gap: 2 }}>
        {[['None', () => go(mode === 'area' ? 'area' : 'building', { sel: 'bldg', unit: null })], ['Rights', () => go('floor', { floor: 'F7', unit: null, sel: 'bldg' })], ['Utilities', () => go('underground', { sel: 'bldg' })]].map(([l, f]) => (
          <button key={l} role="radio" aria-checked={colourBy === l} onClick={f} className="studio-body-sm" style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, padding: '7px 8px', borderRadius: 'var(--radius-8)', background: colourBy === l ? 'var(--primary-soft)' : 'transparent', fontWeight: colourBy === l ? 600 : 400 }}>
            <span style={{ width: 14, height: 14, borderRadius: 7, border: '1.5px solid ' + (colourBy === l ? 'var(--primary)' : 'var(--line-control)'), boxShadow: colourBy === l ? 'inset 0 0 0 3px var(--surface), inset 0 0 0 8px var(--primary)' : 'none' }}></span>{l}
          </button>))}
      </div>
    </Sec>
    {layers.ai && <Sec title="AI candidates" aside={<span className="data-num ul-caption">{decided} of 4 decided</span>}>
      {ui === 'Replayed' && <Replayed />}
      <span className="ul-help">Dashed outlines over the orthophoto. Suggestions only; accept or reject each.</span>
      {AI_CANDS.map(([n, c, t], i) => { const s = layers.aiState[i]; return (
        <div key={n} style={{ display: 'grid', gap: 6, padding: '8px 10px', borderRadius: 'var(--radius-8)', background: 'var(--surface-subtle)', opacity: s === 'rejected' ? 0.6 : 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span className="studio-body-sm" style={{ fontWeight: 600, flex: 1 }}>{n}</span><Badge tone={t} icon={null}>{c}</Badge></div>
          {s ? <div className="ul-row"><Badge status={s === 'accepted' ? 'Reviewed' : 'Cancelled'}>{s === 'accepted' ? 'Accepted' : 'Rejected'}</Badge><Button variant="ghost" onClick={() => setLayers(l => { const a = { ...l.aiState }; delete a[i]; return { ...l, aiState: a }; })}>Undo</Button></div>
            : <div className="ul-row"><Button variant="soft" onClick={() => setAi(i, 'accepted')}>Accept</Button><Button variant="ghost" onClick={() => setAi(i, 'rejected')}>Reject</Button></div>}
        </div>); })}
      <EvidenceChip kind="feature" source="Extraction model" locator="held-out IoU" href="#" />
    </Sec>}
  </>;
  if (panel === 'Spaces') body = <>
    <Sec title="F7 · 9 spaces" aside={<span className="ul-caption">55 units in building</span>}>
      <div style={{ display: 'grid', gap: 2 }}>{F7_SPACES.map(([u, r]) => (
        <button key={u} onClick={() => go('floor', { floor: 'F7', unit: u, sel: 'unit' })} className="studio-body-sm" style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 'var(--radius-8)', background: unit === u ? 'var(--primary-soft)' : 'transparent', fontWeight: unit === u ? 600 : 400 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: r === 'Shared' ? 'var(--rights-shared)' : 'var(--rights-exclusive)' }}></span><span style={{ flex: 1 }}>{u}</span><span className="ul-muted">{r}</span>
        </button>))}</div>
    </Sec>
    <Sec title="Other floors"><span className="studio-body-sm ul-muted">Pick a level on the rail to list its spaces.</span></Sec>
  </>;
  if (panel === 'Sources') body = <>
    <Sec title="Evidence" aside={<span className="ul-caption">5</span>}>
      {[['feature', 'parcels.gpkg', '214 features'], ['table', 'unit_inventory.xlsx', '55 rows'], ['table', 'levels.csv', '11 rows'], ['document', 'Sanctioned plan', 'p.3 · r2'], ['document', 'Sale deed', 'cl.2']].map(([k, s, l]) => <div key={s}><EvidenceChip kind={k} source={s} locator={l} href="#" /></div>)}
    </Sec>
    <Sec title="Model answers">
      <div style={{ display: 'grid', gap: 6 }}><span className="studio-body-sm">Room candidates · plan_F7.pdf</span>{ui === 'Replayed' ? <Replayed /> : <span className="ul-help">From the live model, 24 Sep 2026</span>}</div>
      <div style={{ display: 'grid', gap: 6 }}><span className="studio-body-sm">Mapping · unit_inventory.xlsx</span>{ui === 'Replayed' ? <Replayed /> : <Badge tone="info" icon={null}>Proposed</Badge>}</div>
    </Sec>
  </>;
  if (panel === 'Checks') body = <Sec title="Lake View Residence · r3" aside={<span className="ul-caption">Check v1.4</span>}>
    {[['Exclusive overlap', 'Flat 101 / Flat 201 · 6.4 m³', 'Blocking', 'ov'], ['Partition completeness', '3.2 m³ void on F8', 'Blocking', 'void'], ['Carpet area', 'Flat 704 · 3.9 %', 'Needs review', 'carpet'], ['Shares', '99.50 %', 'Needs review', 'share'], ['Exclusive overlap · F3', 'Not assessed: open shell on Flat 305', 'Not assessed'], ['Stack consistency', null, 'Passed'], ['Anchoring', null, 'Passed']].map(([n, d, s, f]) => (
      <button key={n} disabled={!f} onClick={() => f && openFinding(f)} style={{ all: 'unset', cursor: f ? 'pointer' : 'default', display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 8, alignItems: 'center', padding: '8px 10px', borderRadius: 'var(--radius-8)', background: s === 'Not assessed' ? 'repeating-linear-gradient(135deg, var(--surface-subtle) 0 6px, transparent 6px 12px)' : 'transparent' }}>
        <span style={{ display: 'grid' }}><span className="studio-body-sm" style={{ fontWeight: 500 }}>{n}</span>{d && <span className="studio-body-sm ul-muted">{d}</span>}</span><Badge status={s} />
      </button>))}
  </Sec>;
  return (
    <aside aria-label={panel} style={{ ...spFloat, boxShadow: 'var(--shadow-card)', minHeight: 0, display: 'grid', gridTemplateRows: 'auto minmax(0,1fr)', animation: 'ul-fade 180ms ease-out' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 10px 10px 16px' }}><h2 className="studio-heading" style={{ margin: 0, flex: 1 }}>{panel}</h2><Button variant="ghost" onClick={() => setPanel(null)}>Close</Button></header>
      <div style={{ overflow: 'auto', padding: '0 16px 12px' }}>{body}</div>
    </aside>
  );
}

const PLANNED = [['Unit page', 'Full page for one space'], ['Revision compare', 'Two revisions side by side'], ['Air-rights envelope', 'Remaining permissible floor area'], ['Command palette', 'Search codes, addresses, findings'], ['Split, merge or boundary adjustment', 'Retire codes, assign successors'], ['Admin console', 'Coverage, backlog, AI quality, audit']];
function Menu({ label, icon, width = 300, children }) {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => { if (!open) return; const f = () => setOpen(false); setTimeout(() => addEventListener('click', f), 0); return () => removeEventListener('click', f); }, [open]);
  return <div style={{ position: 'relative' }}>
    <SP.Button variant="ghost" icon={icon} aria-expanded={open} onClick={() => setOpen(o => !o)}>{label}</SP.Button>
    {open && <div role="menu" onClick={e => e.stopPropagation()} style={{ position: 'absolute', right: 0, top: 44, zIndex: 70, width, ...spFloat, boxShadow: 'var(--shadow-overlay)', padding: 6, animation: 'ul-pop 160ms cubic-bezier(.23,1,.32,1)', transformOrigin: 'top right' }}>{children}</div>}
  </div>;
}
const MItem = ({ label, sub, badge, checked, disabled, style }) => <div role="menuitem" aria-disabled={disabled || undefined} className="studio-body-sm" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 'var(--radius-8)', color: disabled ? 'var(--ink-muted)' : 'var(--ink)', ...style }}>
  <span style={{ display: 'grid', flex: 1 }}><span style={{ fontWeight: checked ? 600 : 400 }}>{label}</span>{sub && <span className="ul-muted" style={{ fontSize: 12 }}>{sub}</span>}</span>{checked && <SP.Icon name="check-circle" size="sm" style={{ color: 'var(--primary)' }} />}{badge && <SP.Badge icon={null}>{badge}</SP.Badge>}
</div>;

function HeaderMenus() {
  return <>
    <Menu label="EN" icon="translate" width={260}>
      <MItem label="English" checked />
      <MItem label="हिन्दी" sub="Studio text is Hindi-ready" badge="Planned" disabled style={{ fontFamily: '"Noto Sans Devanagari", var(--font-sans)' }} />
    </Menu>
    <Menu label="More" icon="caret-down">
      <div className="studio-label ul-muted" style={{ padding: '6px 10px' }}>Coming in the full product</div>
      {PLANNED.map(([l, s]) => <MItem key={l} label={l} sub={s} badge="Planned" disabled />)}
    </Menu>
  </>;
}

Object.assign(window, { LeftPanel, PanelSwitch, HeaderMenus });
