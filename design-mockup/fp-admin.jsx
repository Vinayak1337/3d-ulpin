const FAK = window.BoardsKit, FAU = window.Ulpin;
const faLink = (t, n) => <a href="#" onClick={e => e.preventDefault()} className="data-num">{n ?? t}</a>;

function AdminShell({ active, title, aside, children }) {
  return <>
    <FAU.StudioHeader surface="Admin" nav={['Overview', 'Imports', 'Coverage', 'AI quality', 'Users', 'Audit', 'Settings']} active={active} status="Snapshot 24 Sep, 14:10" initials="AD" userName="A. Deshmukh" />
    <div style={{ flex: 1, overflow: 'auto' }}><div style={{ maxWidth: 'var(--max-content)', margin: '0 auto', padding: 24, display: 'grid', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><h1 className="studio-title" style={{ margin: 0, flex: 1 }}>{title}</h1>{aside}<FAU.Badge status="Test fixture">Design mockup</FAU.Badge></div>
      {children}
    </div></div>
  </>;
}
const FaTable = ({ title, aside, cols, rows, more }) => <FAU.Panel title={title} aside={aside} flush={<FAU.DataTable columns={cols.map((c, i) => ({ header: c[0], numeric: !!c[1], cell: r => r[i] }))} rows={rows} more={more} />} />;

function A2() {
  return <AdminShell active="Imports" title="Imports" aside={<FAU.Button variant="primary" icon="file-arrow-up">Add files</FAU.Button>}>
    <FaTable title="Running" aside={<span className="ul-caption">2</span>} cols={[['Import'], ['Started by'], ['Saved', 1], ['Needs attention'], ['State']]}
      rows={[
        ['Lake View bundle · 5 files', 'R. Iyer', faLink('', '186 spaces'), <span className="ul-row"><FAU.Badge status="Needs review">1 mapping</FAU.Badge><FAU.Badge status="Needs evidence">2 lower limits</FAU.Badge></span>, <span className="data-num">plan_F7.pdf 62 %</span>],
        [<span className="id-code">levels-r2.csv</span>, 'R. Iyer', <em className="ul-muted">Unknown</em>, <span className="ul-muted">—</span>, <span>Checking</span>]]} />
    <FaTable title="Files in Lake View bundle" cols={[['File'], ['Profile'], ['CRS'], ['Mapping'], ['Result']]}
      rows={[
        [<span className="id-code">parcels.gpkg</span>, 'GeoPackage', 'EPSG:32643', <FAU.Badge tone="success" icon={null}>Reused mapping</FAU.Badge>, faLink('', '214 parcels')],
        [<span className="id-code">unit_inventory.xlsx</span>, 'Excel inventory', '—', <FAU.Badge tone="info" icon={null}>Proposed</FAU.Badge>, faLink('', '55 rows')],
        [<span className="id-code">levels.csv</span>, 'CSV levels', '—', <FAU.Badge icon={null}>Manual</FAU.Badge>, faLink('', '11 levels')],
        [<span className="id-code">plan_F7.pdf</span>, 'PDF plan', <FAU.Badge tone="warning" icon="warning">CRS unverified</FAU.Badge>, <FAU.Badge tone="info" icon={null}>Proposed</FAU.Badge>, <span className="data-num">62 %</span>]]} />
    <span className="ul-help">Originals are kept unchanged. A failed file never removes saved results.</span>
  </AdminShell>;
}

function A3() {
  return <AdminShell active="Coverage" title="Coverage">
    <FaTable title="By block" cols={[['Block'], ['Parcels', 1], ['Buildings', 1], ['Spaces', 1], ['Ready %', 1], ['Unknown %', 1]]} rows={[['Lake View', faLink('', '214'), faLink('', '22'), faLink('', '186'), faLink('', '6.5'), faLink('', '2.2')]]} more="Other blocks not imported" />
    <FaTable title="Lake View · by building" cols={[['Building'], ['Levels', 1], ['Units', 1], ['Ready for codes', 1], ['Open findings', 1], ['State']]}
      rows={[['Lake View Residence', '11', faLink('', '55'), faLink('', '12'), faLink('', '5'), <FAU.Badge status="Reviewed" />], ['21 other buildings', <em className="ul-muted">Unknown</em>, <em className="ul-muted">Unknown</em>, '0', '0', <FAU.Badge status="Unknown">Massing only</FAU.Badge>]]} />
    <span className="ul-help">Ready means ready for the named task, not a single score. Unknown is counted, never hidden.</span>
  </AdminShell>;
}

function A4() {
  const na = <FAU.Badge status="Not assessed" />;
  return <AdminShell active="AI quality" title="AI quality" aside={<span className="ul-caption">held-out tests only</span>}>
    <FaTable title="Models" cols={[['Model'], ['Measure'], ['Result'], ['Sample', 1]]}
      rows={[['Building extraction', 'IoU on held-out tiles', na, '—'], ['Floor segmentation', 'Boundary error on held-out plans', na, '—'], ['Intake mapping', 'Mapping accuracy', na, '—']]} more="Numbers appear once a held-out test runs." />
    <FaTable title="Schema learner" aside={<FAU.Badge icon={null}>Planned</FAU.Badge>} cols={[['Method'], ['Held-out layouts', 1], ['Correct', 1]]}
      rows={[['Learner', '—', '—'], ['Recipe reuse', '—', '—'], ['Model mapping', '—', '—']]} />
    <div className="ul-row studio-body-sm"><FAU.Badge icon="clock-counter-clockwise">Replayed from rehearsal 22 Nov</FAU.Badge><span className="ul-muted">Replayed answers are excluded from these results.</span></div>
  </AdminShell>;
}

function A5() {
  return <AdminShell active="Audit" title="Audit">
    <div className="studio-body-sm" style={{ display: 'flex', alignItems: 'center', gap: 10 }}><FAU.Badge tone="success" icon="shield-check">Chain consistent</FAU.Badge><span>Revision chain consistent for {faLink('', '186 of 186')} records, last check 14:10</span></div>
    <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 16, alignItems: 'start' }}>
      <FaTable title="Events · Lake View Residence" cols={[['When'], ['Who'], ['What'], ['Revision']]}
        rows={[['24 Sep 14:10', 'R. Iyer', 'Recorded reviewed details', 'r3'], ['24 Sep 13:52', 'R. Iyer', 'Applied level evidence', 'r2'], ['24 Sep 11:05', 'Import agent', 'Drafted from 5 sources', 'r1']]} />
      <FAU.RevisionTimeline chain="consistent" revisions={FAK.REV} style={{ maxWidth: 'none' }} />
    </div>
    <span className="ul-help">Revisions are hashed and chained; they are not signed.</span>
  </AdminShell>;
}

function A6() {
  const Y = <FAU.Icon name="check-circle" size="sm" style={{ color: 'var(--success)' }} label="Allowed" />, N = <span className="ul-muted">—</span>;
  return <AdminShell active="Users" title="Users" aside={<FAU.Button variant="primary">Invite user</FAU.Button>}>
    <FaTable title="People" cols={[['Name'], ['Role'], ['Area'], ['Last active']]} rows={[['R. Iyer', 'Officer', 'Lake View', '14:10'], ['A. Deshmukh', 'Supervisor', 'All', '14:12']]} />
    <FaTable title="What each role can do" cols={[['Action'], ['Officer'], ['Supervisor'], ['Engineer · read-only']]}
      rows={[['See owner names', Y, Y, <FAU.Badge icon="eye-slash">Restricted</FAU.Badge>], ['Record reviewed details', Y, Y, N], ['Assign proposed 3D ULPIN', Y, Y, N], ['Export screening report', Y, Y, Y], ['Change settings', N, Y, N]]} />
  </AdminShell>;
}

function A7() {
  const Row = ({ l, v, h }) => <div style={{ display: 'grid', gridTemplateColumns: '260px minmax(0,1fr)', gap: 16, padding: '12px 0', borderTop: '1px solid var(--divider)', alignItems: 'center' }}><span style={{ display: 'grid' }}><span className="studio-body" style={{ fontWeight: 500 }}>{l}</span>{h && <span className="studio-body-sm ul-muted">{h}</span>}</span><span className="studio-body">{v}</span></div>;
  return <AdminShell active="Settings" title="Settings">
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 16, alignItems: 'start' }}>
      <FAU.Panel title="Checks" bodyPadding="0 16px 4px"><Row l="Carpet-area review threshold" v={<span className="data-num">2 %</span>} h="Above this becomes Needs review" /><Row l="Check order" v="Blocking, severity, size" /><Row l="Check version" v="v1.4" /></FAU.Panel>
      <FAU.Panel title="Records" bodyPadding="0 16px 4px"><Row l="Vertical reference" v="Site datum SD-1" h="Local benchmark on the gate pillar" /><Row l="Code" v="3D ULPIN (proposed)" h="The state's Parcel ULPIN is unchanged" /><Row l="Property Card QR" v="Local demonstration link" /><Row l="Public verification" v={<FAU.Badge icon={null}>Planned</FAU.Badge>} /></FAU.Panel>
      <FAU.Panel title="Portal" bodyPadding="0 16px 4px"><Row l="Languages" v="English, हिन्दी" /><Row l="Public fields" v="Released facts only; no owner names" /></FAU.Panel>
      <FAU.Panel title="Model answers" bodyPadding="0 16px 4px"><Row l="Offline rehearsal" v="Replay 22 Nov" h="Replayed answers carry a badge" /><Row l="If the provider is down" v="Map manually" /></FAU.Panel>
    </div>
  </AdminShell>;
}

Object.assign(window, { FpAdmin: { A2, A3, A4, A5, A6, A7 } });
