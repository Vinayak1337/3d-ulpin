const FSK = window.BoardsKit, FSU = window.Ulpin;
const fsFloat = { background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-12)', boxShadow: 'var(--shadow-card)' };

function StudioShell({ active = 'Register', children, dim }) {
  return <>
    <FSU.StudioHeader active={active} area="Lake View area" status="Live" initials="RI" userName="R. Iyer" />
    <div style={{ flex: 1, minHeight: 0, position: 'relative', display: 'grid' }}>{children}</div>
  </>;
}

function S15() {
  return <StudioShell>
    <div style={{ overflow: 'auto' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 24px', background: 'var(--surface)', borderBottom: '1px solid var(--divider)' }}>
        <div style={{ display: 'grid', flex: 1, gap: 6 }}>
          <span className="studio-body-sm ul-muted">Lake View Residence / F7</span>
          <div className="ul-row"><h1 className="studio-title" style={{ margin: 0 }}>Flat 704</h1><FSU.Badge status="Assigned" /><FSU.Badge status="Needs review">Carpet area +3.9 %</FSU.Badge><FSU.Badge status="Test fixture">Design mockup</FSU.Badge></div>
        </div>
        <FSU.Button variant="ghost" icon="map-trifold">Open in 3D</FSU.Button><FSU.Button variant="primary" icon="qr-code">Property Card</FSU.Button>
      </header>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr) 360px', gap: 16, padding: 16, alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 16 }}>
          <FSU.Panel title="Identity"><FSU.UlpinCode code={FSK.CODE} location={FSK.LOC} legend copyable /></FSU.Panel>
          <FSU.Panel title="Facts"><FSU.DescriptionList items={[
            { label: 'Level', value: 'F7 · 233.8 to 236.8 m · SD-1' }, { label: 'Rights', value: 'Exclusive unit' }, { label: 'Undivided share', value: '1.84 %' },
            { label: 'Parking', value: <span className="ul-row">Covered stilt<FSU.EvidenceChip state="missing" locator="Needs evidence" href="#" /></span> },
            { label: 'Tenure', value: 'Apartment declaration' }]} /></FSU.Panel>
        </div>
        <div style={{ display: 'grid', gap: 16 }}>
          <FSU.CarpetAreaCheck unit="Flat 704" grossInternal={74.38} deductions={[{ label: 'Less service shaft', area: 0.88 }, { label: 'Less exclusive balcony', area: 4.2 }]} declared={72} declaredEvidence={{ source: 'Sale deed', locator: 'cl.2', href: '#' }} tolerancePct={2} style={{ maxWidth: 'none' }} />
          <FSU.StrataSection parcel="MH2507A1B3C4D5" selected={1} roof="239.8 roof" ground="212.4 ground" levels={[{}, { label: 'F7 · Flat 704', elevation: '233.8' }, {}, {}, {}, {}, {}, {}, {}]} basements={[{ label: 'B1 · parking', elevation: '209.1' }, { label: 'B2 · parking (levels estimated)', elevation: '205.8', estimated: true }]} style={{ maxWidth: 'none' }} />
        </div>
        <div style={{ display: 'grid', gap: 16 }}>
          <FSU.Panel title="Evidence"><div style={{ display: 'grid', gap: 8 }}>{[['document', 'Plan F7', 'p.3 · r2'], ['document', 'Sale deed', 'cl.2'], ['document', 'Declaration', 'schedule'], ['table', 'levels.csv', 'F7']].map(([k, s, l]) => <div key={s}><FSU.EvidenceChip kind={k} source={s} locator={l} href="#" /></div>)}</div></FSU.Panel>
          <FSU.RevisionTimeline chain="consistent" revisions={FSK.REV} style={{ maxWidth: 'none' }} />
        </div>
      </div>
    </div>
  </StudioShell>;
}

function S16() {
  const Row = ({ l, a, b, ch }) => <div style={{ display: 'grid', gridTemplateColumns: '200px minmax(0,1fr) minmax(0,1fr)', gap: 16, padding: '12px 16px', borderTop: '1px solid var(--divider)', background: ch ? 'var(--warning-soft)' : 'transparent', alignItems: 'center' }}><span className="studio-body-sm ul-muted">{l}</span><span className="studio-body">{a}</span><span className="studio-body" style={{ fontWeight: ch ? 600 : 400 }}>{b}</span></div>;
  return <StudioShell>
    <div style={{ overflow: 'auto', padding: 24, display: 'grid', gap: 16, alignContent: 'start', maxWidth: 1200, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
      <div className="ul-row"><h1 className="studio-title" style={{ margin: 0, flex: 1 }}>Compare revisions · Lake View Residence</h1><FSU.Badge tone="success" icon="shield-check">Chain consistent</FSU.Badge></div>
      <div style={{ ...fsFloat, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '200px minmax(0,1fr) minmax(0,1fr)', gap: 16, padding: '12px 16px', background: 'var(--surface-subtle)' }}><span></span><span className="studio-heading">r2 Evidence applied</span><span className="studio-heading">r3 Recorded</span></div>
        <Row l="By" a="R. Iyer · 24 Sep 2026, 13:52" b="R. Iyer · 24 Sep 2026, 14:10" ch />
        <Row l="Hash" a={<span className="id-code">91be…04d7</span>} b={<span className="id-code">7f3a…c2e1</span>} ch />
        <Row l="Previous hash" a={<span className="id-code">2c80…9a13</span>} b={<span className="id-code">91be…04d7</span>} ch />
        <Row l="State" a={<FSU.Badge status="Needs review" />} b={<FSU.Badge status="Recorded" />} ch />
        <Row l="Units" a="55" b="55" />
        <Row l="Levels" a="11 · B2 estimated" b="11 · B2 estimated" />
        <Row l="Shares total" a="99.50 %" b="99.50 %" />
      </div>
      <span className="ul-help">Only changed rows are highlighted. Geometry differences open in 3D side by side.</span>
    </div>
  </StudioShell>;
}

function S17() {
  return <StudioShell active="Map">
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 360px', gap: 16, padding: 16, minHeight: 0 }}>
      <div style={{ position: 'relative', borderRadius: 'var(--radius-12)', overflow: 'hidden' }}>
        <FSK.Scene3D state={{ mode: 'building', sel: 'bldg', view: '3D', render: 'Model' }} style={{ position: 'absolute', inset: 0 }} />
        <div style={{ position: 'absolute', left: '34%', right: '34%', top: '8%', height: '26%', border: '2px dashed var(--primary)', borderRadius: 4, background: 'repeating-linear-gradient(135deg, color-mix(in srgb, var(--primary) 10%, transparent) 0 8px, transparent 8px 16px)' }}></div>
        <span className="studio-label" style={{ position: 'absolute', left: '34%', top: 'calc(8% - 28px)', padding: '3px 10px', borderRadius: 'var(--radius-pill)', background: 'var(--surface)', boxShadow: 'var(--shadow-floating)' }}>Envelope · illustrative</span>
      </div>
      <FSU.Panel title="Air-rights envelope" aside={<FSU.Badge status="Provisional" />} footer={<FSU.Button disabled>Create envelope</FSU.Button>}>
        <div style={{ display: 'grid', gap: 12 }}>
          <FSU.DescriptionList items={[{ label: 'Built', value: 'G + 8 · roof 239.8 m · SD-1' }, { label: 'Remaining floor area', value: <em>Unknown</em> }, { label: 'Rule', value: <span className="ul-row"><FSU.EvidenceChip state="missing" locator="FSI rule needed" href="#" /></span> }]} />
          <span className="ul-help">Remaining permissible floor area, not a right. Needs the development-control rule before any number is shown.</span>
        </div>
      </FSU.Panel>
    </div>
  </StudioShell>;
}

function S18() {
  const G = ({ t, items }) => <div style={{ display: 'grid', gap: 2 }}><span className="studio-label ul-muted" style={{ padding: '8px 12px 4px' }}>{t}</span>{items.map(([a, b, on], i) => <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 12px', borderRadius: 'var(--radius-8)', background: on ? 'var(--primary-soft)' : 'transparent' }}><span className="studio-body" style={{ flex: 1, fontWeight: on ? 600 : 400 }}>{a}</span><span className="studio-body-sm ul-muted">{b}</span></div>)}</div>;
  return <StudioShell active="Map">
    <div style={{ position: 'absolute', inset: 0, background: 'var(--map-ground)' }}></div>
    <div style={{ position: 'absolute', inset: 0, background: 'color-mix(in srgb, var(--ink) 38%, transparent)', display: 'grid', justifyItems: 'center', alignContent: 'start', paddingTop: 96 }}>
      <div role="dialog" aria-label="Command palette" style={{ width: 640, background: 'var(--surface)', borderRadius: 'var(--radius-16)', boxShadow: 'var(--shadow-overlay)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: '1px solid var(--divider)' }}><FSU.Icon name="magnifying-glass" /><span className="studio-heading" style={{ flex: 1 }}>704</span><span className="studio-body-sm ul-muted">Esc</span></div>
        <div style={{ padding: 8, display: 'grid', gap: 4 }}>
          <G t="Codes" items={[[<span className="id-code">P3-7Q4M…-R4</span>, 'Flat 704 · F7', true]]} />
          <G t="Spaces" items={[['Flat 704', 'Lake View Residence · F7']]} />
          <G t="Findings" items={[['Flat 704: carpet area +3.9 %', 'Needs review'], ['Flat 704 parking: needs evidence', 'Needs review']]} />
          <G t="Actions" items={[['Make Property Card', 'Flat 704'], ['Open register', 'Lake View Residence']]} />
        </div>
      </div>
    </div>
  </StudioShell>;
}

function S19() {
  return <StudioShell>
    <div style={{ position: 'absolute', inset: 0, background: 'var(--bg)' }}></div>
    <div style={{ position: 'absolute', inset: 0, background: 'color-mix(in srgb, var(--ink) 38%, transparent)', display: 'grid', placeItems: 'center' }}>
      <div role="dialog" aria-label="Merge spaces" style={{ width: 760, display: 'grid', background: 'var(--surface)', borderRadius: 'var(--radius-16)', boxShadow: 'var(--shadow-overlay)', overflow: 'hidden' }}>
        <header style={{ padding: '14px 20px', borderBottom: '1px solid var(--divider)' }}><h2 className="studio-heading" style={{ margin: 0 }}>Merge Flat 704 and Flat 705</h2></header>
        <div style={{ padding: 20, display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 40px minmax(0,1fr)', gap: 12, alignItems: 'center' }}>
          <div style={{ display: 'grid', gap: 12 }}>
            <span className="studio-label ul-muted">Retired on confirm</span>
            <div style={{ padding: 14, borderRadius: 'var(--radius-12)', background: 'var(--surface-subtle)', display: 'grid', gap: 6 }}><span className="studio-body" style={{ fontWeight: 600 }}>Flat 704</span><FSU.UlpinCode code={FSK.CODE} location={FSK.LOC} labelled={false} /></div>
            <div style={{ padding: 14, borderRadius: 'var(--radius-12)', background: 'var(--surface-subtle)', display: 'grid', gap: 6 }}><span className="studio-body" style={{ fontWeight: 600 }}>Flat 705</span><FSU.UlpinCode state="draft" location="MH2507A1B3C4D5 / S01 / F07 / R004" labelled={false} /></div>
          </div>
          <span style={{ textAlign: 'center', fontSize: 22, color: 'var(--ink-muted)' }}>→</span>
          <div style={{ display: 'grid', gap: 12 }}>
            <span className="studio-label ul-muted">Successor</span>
            <div style={{ padding: 14, borderRadius: 'var(--radius-12)', border: '1.5px dashed var(--primary)', display: 'grid', gap: 6 }}><span className="studio-body" style={{ fontWeight: 600 }}>New space · F7</span><FSU.UlpinCode state="draft" labelled={false} /><span className="ul-help">A random code is generated on confirm.</span></div>
            <FSU.DescriptionList items={[{ label: 'Share', value: <span>1.84 % + <em>Unknown</em></span> }, { label: 'Lineage', value: '2 predecessors' }]} />
          </div>
        </div>
        <footer style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 20px', background: 'var(--surface-subtle)', borderTop: '1px solid var(--divider)' }}>
          <span className="ul-help" style={{ flex: 1 }}>Blocked: merger deed and new share declaration needed</span>
          <FSU.Button variant="ghost">Cancel</FSU.Button><FSU.Button variant="primary" disabled>Retire and assign successor</FSU.Button>
        </footer>
      </div>
    </div>
  </StudioShell>;
}

function FpBoards() {
  const { Board } = FSK; const D = [1440, 900], M = [390, 844];
  const { P2, P5, P6, P7 } = window.FpPortal, { A2, A3, A4, A5, A6, A7 } = window.FpAdmin;
  const Sect = ({ x, y, t }) => <div className="studio-title" style={{ position: 'absolute', left: x, top: y, whiteSpace: 'nowrap', color: 'var(--ink)' }}>{t}</div>;
  const portal = [['P2 Results', P2], ['P5 Request a correction', P5], ['P6 My requests', P6], ['P7 Sign in', P7]];
  const admin = [['A2 Imports', A2], ['A3 Coverage', A3], ['A4 AI quality', A4], ['A5 Audit', A5], ['A6 Users', A6], ['A7 Settings', A7]];
  const studio = [['S15 Unit page', S15], ['S16 Revision compare', S16], ['S17 Air-rights envelope', S17], ['S18 Command palette', S18], ['S19 Split, merge or boundary adjustment', S19]];
  return <>
    <Sect x={80} y={5130} t="Portal · full product" />
    {portal.map(([l, C], i) => <React.Fragment key={l}><Board x={80} y={5220 + i * 1020} w={D[0]} h={D[1]} label={l + ' · 1440'}><C /></Board><Board x={1600} y={5220 + i * 1020} w={M[0]} h={M[1]} label={l.split(' ')[0] + ' · 390'}><C phone /></Board></React.Fragment>)}
    <Sect x={2200} y={-10} t="Admin · full product" />
    {admin.map(([l, C], i) => <Board key={l} x={2200} y={80 + i * 1020} w={D[0]} h={D[1]} label={l + ' · 1440'}><C /></Board>)}
    <Sect x={3800} y={-10} t="Studio · full product" />
    {studio.map(([l, C], i) => <Board key={l} x={3800} y={80 + i * 1020} w={D[0]} h={D[1]} label={l + ' · 1440'}><C /></Board>)}
  </>;
}
ReactDOM.createRoot(document.getElementById('fp-root')).render(<FpBoards />);
