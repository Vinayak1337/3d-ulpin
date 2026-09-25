const FK = window.BoardsKit, FU = window.Ulpin;
const fpHi = FK.HINDI_FONT;
const FpHi = ({ children }) => <span className="studio-body-sm ul-muted" style={fpHi}>{children}</span>;
const FpCrumb = ({ items }) => <nav className="studio-body-sm ul-muted" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{items.map((t, i) => <React.Fragment key={t}>{i > 0 && <span>/</span>}{i < items.length - 1 ? <a href="#" onClick={e => e.preventDefault()}>{t}</a> : <span style={{ color: 'var(--ink)' }}>{t}</span>}</React.Fragment>)}</nav>;
const FpNote = ({ children, tone = 'info' }) => <div className="portal-body" style={{ padding: '12px 16px', borderRadius: 'var(--radius-8)', background: `var(--${tone}-soft)`, color: 'var(--ink)' }}>{children}</div>;
const FpH1 = ({ phone, children, hi }) => <div style={{ display: 'grid', gap: 4 }}><h1 className={phone ? 'portal-h2' : 'portal-h1'} style={{ margin: 0 }}>{children}</h1>{hi && <FpHi>{hi}</FpHi>}</div>;

function P2({ phone }) {
  const search = <div style={{ display: 'grid', gridTemplateColumns: phone ? '1fr' : 'minmax(0,1fr) auto', gap: 12, alignItems: 'end' }}><FU.Field label="3D ULPIN, parcel ULPIN or address" defaultValue="Flat 704 Lake View" /><FU.Button variant="primary" size="lg" icon="magnifying-glass">Search</FU.Button></div>;
  const result = (
    <a href="#" onClick={e => e.preventDefault()} style={{ ...FK.card, padding: 20, display: 'grid', gap: 12, textDecoration: 'none', color: 'var(--ink)', minHeight: 44 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><span className="portal-h3" style={{ flex: 1 }}>Flat 704, Lake View Residence</span><FU.Badge status="Recorded" /></div>
      <FU.UlpinCode code={FK.CODE} location={FK.LOC} labelled={false} />
      <span className="portal-body ul-muted">12 Lake View Road · F7 · carpet area 69.30 m²</span>
      <span className="portal-body" style={{ color: 'var(--primary)', fontWeight: 600 }}>Open record →</span>
    </a>);
  const list = <div style={{ display: 'grid', gap: 16 }}><span className="portal-label ul-muted">1 released record</span>{result}<FpNote>Other units in Lake View Residence are not released yet.</FpNote></div>;
  return <><FK.PortalTop phone={phone} /><FK.Wrap phone={phone}>
    <FpCrumb items={['Home', 'Results']} />
    <FpH1 phone={phone} hi="खोज परिणाम">Results</FpH1>
    {search}
    {phone ? list : <div style={{ display: 'grid', gridTemplateColumns: '6fr 5fr', gap: 32, alignItems: 'start' }}>{list}
      <div style={{ position: 'relative', height: 400, borderRadius: 'var(--radius-12)', overflow: 'hidden' }}><FK.Scene3D state={{ mode: 'area', sel: 'bldg', view: '3D', render: 'Model' }} style={{ position: 'absolute', inset: 0 }} />
        <span className="studio-label" style={{ position: 'absolute', top: 12, left: 12, padding: '4px 10px', borderRadius: 'var(--radius-pill)', background: 'var(--surface)', boxShadow: 'var(--shadow-floating)' }}>View only</span></div>
    </div>}
  </FK.Wrap></>;
}

function FpStepper({ steps, at, phone }) {
  if (phone) return <div style={{ display: 'grid', gap: 8 }}><span className="portal-label ul-muted">Step {at + 1} of {steps.length}</span><span style={{ display: 'grid', gridTemplateColumns: `repeat(${steps.length}, 1fr)`, gap: 4 }}>{steps.map((s, i) => <span key={s} style={{ height: 4, borderRadius: 2, background: i <= at ? 'var(--primary)' : 'var(--divider)' }}></span>)}</span></div>;
  return <ol style={{ display: 'flex', gap: 12, alignItems: 'center', listStyle: 'none', margin: 0, padding: 0 }}>{steps.map((s, i) => <React.Fragment key={s}>{i > 0 && <span style={{ flex: '0 0 40px', height: 1, background: 'var(--divider)' }}></span>}
    <li aria-current={i === at ? 'step' : undefined} className="portal-body" style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: i === at ? 600 : 400, color: i > at ? 'var(--ink-muted)' : 'var(--ink)' }}>
      <span style={{ width: 28, height: 28, borderRadius: 14, display: 'grid', placeItems: 'center', font: '600 14px var(--font-sans)', background: i === at ? 'var(--primary)' : i < at ? 'var(--primary-soft)' : 'var(--surface-subtle)', color: i === at ? 'var(--on-primary)' : i < at ? 'var(--primary)' : 'var(--ink-muted)' }}>{i < at ? '✓' : i + 1}</span>{s}</li></React.Fragment>)}</ol>;
}
function FpRadio({ options, value }) {
  return <div role="radiogroup" style={{ display: 'grid', gap: 8 }}>{options.map(o => <label key={o} className="portal-body" style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 48, padding: '0 14px', borderRadius: 'var(--radius-8)', border: '1px solid ' + (o === value ? 'var(--primary)' : 'var(--line-control)'), background: o === value ? 'var(--primary-soft)' : 'var(--surface)' }}>
    <span style={{ width: 18, height: 18, borderRadius: 9, border: '2px solid ' + (o === value ? 'var(--primary)' : 'var(--line-control)'), boxShadow: o === value ? 'inset 0 0 0 3px var(--surface), inset 0 0 0 9px var(--primary)' : 'none' }}></span>{o}</label>)}</div>;
}
function P5({ phone }) {
  const rec = <div style={{ ...FK.card, padding: 16, display: 'grid', gap: 8 }}><span className="portal-label ul-muted">Record</span><span className="portal-h3" style={{ fontSize: 18 }}>Flat 704, Lake View Residence</span><FU.UlpinCode code={FK.CODE} location={FK.LOC} labelled={false} /><span className="portal-body ul-muted">Carpet area on record: 69.30 m²</span></div>;
  const form = <div style={{ display: 'grid', gap: 20 }}>
    <div style={{ display: 'grid', gap: 10 }}><span className="portal-h3" style={{ fontSize: 18 }}>What is wrong?</span><FpRadio value="Carpet area" options={['Carpet area', 'Level or height', 'Undivided share', 'Something else']} /></div>
    <FU.Field label="What should it be?" defaultValue="72.00 m², as in the sale deed" help="Say where the right value comes from." />
    <div style={{ display: 'grid', gap: 8 }}><span className="portal-label" style={{ fontWeight: 600 }}>Evidence</span>
      <div style={{ display: 'grid', gap: 6, justifyItems: 'start', padding: 16, borderRadius: 'var(--radius-8)', border: '1.5px dashed var(--line-control)', background: 'var(--surface)' }}><span className="portal-body">Add a PDF or photo of your document</span><FU.Button icon="file-arrow-up">Choose file</FU.Button><span className="studio-body-sm ul-muted">Your document is seen only by the officer reviewing it.</span></div></div>
    <div style={{ display: 'flex', gap: 12, justifyContent: phone ? 'stretch' : 'flex-start', flexDirection: phone ? 'column-reverse' : 'row' }}><FU.Button size="lg" variant="ghost">Back</FU.Button><FU.Button size="lg" variant="primary">Continue</FU.Button></div>
  </div>;
  return <><FK.PortalTop phone={phone} /><FK.Wrap phone={phone}>
    <FpCrumb items={['Home', 'Flat 704', 'Request a correction']} />
    <FpH1 phone={phone} hi="सुधार का अनुरोध करें">Request a correction</FpH1>
    <FpStepper phone={phone} at={1} steps={['Record', 'Details and evidence', 'Review and send']} />
    {phone ? <>{rec}{form}</> : <div style={{ display: 'grid', gridTemplateColumns: '7fr 4fr', gap: 40, alignItems: 'start' }}>{form}<div style={{ display: 'grid', gap: 16 }}>{rec}<FpNote>Your name is not shown on public pages.</FpNote></div></div>}
  </FK.Wrap></>;
}

function P6({ phone }) {
  const steps = [['Sent', '25 Sep 2026', 'done'], ['Received by the land records office', 'Added to an officer’s list', 'done'], ['Under review', 'An officer checks your evidence', 'now'], ['Answer', 'You see it here and by SMS', 'todo']];
  const tracker = <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid' }}>{steps.map(([t, s, st], i) => (
    <li key={t} style={{ display: 'grid', gridTemplateColumns: '28px minmax(0,1fr)', gap: 14 }}>
      <span style={{ display: 'grid', justifyItems: 'center', gridTemplateRows: '28px 1fr' }}><span style={{ width: 28, height: 28, borderRadius: 14, display: 'grid', placeItems: 'center', font: '600 13px var(--font-sans)', background: st === 'done' ? 'var(--primary)' : st === 'now' ? 'var(--primary-soft)' : 'var(--surface-subtle)', color: st === 'done' ? 'var(--on-primary)' : st === 'now' ? 'var(--primary)' : 'var(--ink-muted)', border: st === 'now' ? '2px solid var(--primary)' : 'none' }}>{st === 'done' ? '✓' : i + 1}</span>{i < steps.length - 1 && <span style={{ width: 2, background: st === 'done' ? 'var(--primary)' : 'var(--divider)', minHeight: 28 }}></span>}</span>
      <span style={{ display: 'grid', paddingBottom: 20 }}><span className="portal-body" style={{ fontWeight: 600, color: st === 'todo' ? 'var(--ink-muted)' : 'var(--ink)' }}>{t}</span><span className="studio-body-sm ul-muted">{s}</span></span>
    </li>))}</ol>;
  const req = <div style={{ ...FK.card, padding: 20, display: 'grid', gap: 16 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}><span className="portal-h3" style={{ flex: 1, fontSize: 18 }}>Carpet area · Flat 704, Lake View Residence</span><FU.Badge status="Needs review">Under review</FU.Badge></div>
    {tracker}
    <FpNote>An answer updates the technical record. It does not decide ownership.</FpNote>
  </div>;
  return <><FK.PortalTop phone={phone} /><FK.Wrap phone={phone}>
    <FpCrumb items={['Home', 'My requests']} />
    <FpH1 phone={phone} hi="मेरे अनुरोध">My requests</FpH1>
    {phone ? req : <div style={{ display: 'grid', gridTemplateColumns: '7fr 4fr', gap: 40, alignItems: 'start' }}>{req}<div style={{ display: 'grid', gap: 12 }}><span className="portal-label" style={{ fontWeight: 600 }}>Need to add something?</span><span className="portal-body ul-muted">You can add evidence until the answer is ready.</span><FU.Button icon="file-arrow-up">Add evidence</FU.Button></div></div>}
  </FK.Wrap></>;
}

function P7({ phone }) {
  const box = <div style={{ ...FK.card, padding: phone ? 20 : 32, display: 'grid', gap: 20, maxWidth: 480, width: '100%' }}>
    <FpH1 phone={phone} hi="साइन इन करें">Sign in</FpH1>
    <FU.Field label="Mobile number" placeholder="10-digit mobile number" help="We send a one-time code by SMS." />
    <FU.Button size="lg" variant="primary">Send code</FU.Button>
    <div style={{ height: 1, background: 'var(--divider)' }}></div>
    <span className="portal-body ul-muted">Only needed to request or track a correction. Searching and verifying a card need no sign-in.</span>
  </div>;
  return <><FK.PortalTop phone={phone} /><FK.Wrap phone={phone}>{phone ? box : <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 64, alignItems: 'start', paddingTop: 24 }}>{box}<div style={{ display: 'grid', gap: 12, paddingTop: 12 }}><span className="portal-h3">Why we ask</span><span className="portal-body ul-muted">Your number links your requests to you. It is never shown on public pages or on a Property Card.</span></div></div>}</FK.Wrap></>;
}

Object.assign(window, { FpPortal: { P2, P5, P6, P7 } });
