import { useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { CheckCircle, FileArrowUp, Trash } from '@phosphor-icons/react';
import type { PublicRequestStatus, RequestKind } from '@ulpin/api-client/draft';
import { Button, EmptyState, Icon, Skeleton, UlpinCode } from '@ulpin/ui';
import { Crumbs } from './PortalFrame';
import { fileRequest, usePublicBuilding } from './queries';
import styles from './Portal.module.css';

const RELATIONS = ['Owner', 'Joint owner', 'Tenant', 'Resident association', 'Builder or developer', 'Legal heir', 'Other'];

/**
 * P5: request a building's register, or a correction to one of its released records. The applicant's
 * name and mobile go to the land records office only; they are never shown on the portal.
 */
export function RequestPage() {
  const [params] = useSearchParams();
  const buildingId = params.get('building');
  const recordId = params.get('record');
  const building = usePublicBuilding(buildingId);
  const b = building.data;
  const hasFloors = Boolean(b?.storeys.length);
  const [kind, setKind] = useState<RequestKind>(params.get('kind') === 'correction' || recordId ? 'correction' : 'register');
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [relation, setRelation] = useState(RELATIONS[0]!);
  const [message, setMessage] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [agreed, setAgreed] = useState(false);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<PublicRequestStatus | null>(null);
  const input = useRef<HTMLInputElement>(null);

  if (!buildingId) {
    return (
      <div className={styles.wrap}>
        <EmptyState icon={FileArrowUp} title="Find the building first" action={<Link to="/portal/map">Open the map</Link>}>
          Requests are filed from a building's page. Search for it by name, 3D ULPIN or parcel ULPIN, or pick it on the map.
        </EmptyState>
      </div>
    );
  }
  if (building.isPending) return <div className={styles.wrap}><Skeleton width="50%" height={36} /><Skeleton height={240} /></div>;
  if (!b) return <div className={styles.wrap}><EmptyState icon={FileArrowUp} title="This building is not on record" action={<Link to="/portal">Search again</Link>}>It may have been removed.</EmptyState></div>;
  const record = recordId ? b.records.find((r) => r.id === recordId) ?? null : null;
  const effectiveKind: RequestKind = hasFloors ? kind : 'register';

  const add = (list: FileList | null) => {
    if (!list) return;
    // Copy now: the input's FileList empties when its value is reset.
    const picked = [...list];
    setFiles((current) => [...current, ...picked.filter((f) => !current.some((c) => c.name === f.name && c.size === f.size))].slice(0, 10));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!agreed) { setError('Confirm that the details are correct.'); return; }
    const form = new FormData();
    form.set('kind', effectiveKind);
    form.set('buildingId', b.id);
    if (record) form.set('recordId', record.id);
    form.set('name', name);
    form.set('mobile', mobile);
    form.set('relation', relation);
    form.set('message', message);
    for (const f of files) form.append('file', f);
    setBusy(true);
    try {
      setDone(await fileRequest(form));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The request could not be sent. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className={styles.wrap}>
        <div className={styles.done} role="status">
          <span className="ul-row" style={{ color: 'var(--ui-success)' }}><Icon icon={CheckCircle} size={32} /><span className="portal-h3">Request received</span></span>
          <p className="portal-body">Your reference number is</p>
          <span className={styles.refBig}>{done.ref}</span>
          <p className="portal-body ul-muted">Keep it with the mobile number you gave. The land records office reviews requests in the order they arrive; you can check progress any time.</p>
          <div className={styles.doneActions}>
            <Link to={`/portal/track?ref=${encodeURIComponent(done.ref)}`} className="ul-btn ul-btn--primary">Track this request</Link>
            <Link to={`/portal/buildings/${b.id}`} className="ul-btn">Back to {b.name}</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.recordHead}>
        <Crumbs items={[{ label: 'Home', to: '/portal' }, { label: b.name, to: `/portal/buildings/${b.id}` }, { label: 'Request' }]} />
        <h1 className="portal-h1">{effectiveKind === 'register' ? `Request the register of ${b.name}` : `Request a correction${record ? ` to ${record.name}` : ''}`}</h1>
        <UlpinCode code={b.code} location={b.location} copyable={false} />
      </div>
      <form className={styles.form} onSubmit={(e) => void submit(e)} noValidate>
        <fieldset className={styles.kindPick} style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="portal-label" style={{ marginBottom: 8 }}>What do you need?</legend>
          <label>
            <input type="radio" name="kind" value="register" checked={effectiveKind === 'register'} onChange={() => setKind('register')} disabled={hasFloors} />
            <span className="portal-h3">Register this building</span>
            <span className="portal-body-sm ul-muted">{hasFloors ? 'Its floors are already recorded.' : 'Record its floors and flats from your documents.'}</span>
          </label>
          <label>
            <input type="radio" name="kind" value="correction" checked={effectiveKind === 'correction'} onChange={() => setKind('correction')} disabled={!hasFloors} />
            <span className="portal-h3">Correct a record</span>
            <span className="portal-body-sm ul-muted">{hasFloors ? 'A level, area or share looks wrong.' : 'Available once its floors are recorded.'}</span>
          </label>
        </fieldset>

        <div className={styles.twoCol}>
          <label className="ul-field"><span className="portal-label">Your name</span>
            <input className={`ul-input ${styles.bigInput}`} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required maxLength={120} /></label>
          <label className="ul-field"><span className="portal-label">Mobile number</span>
            <input className={`ul-input ${styles.bigInput}`} value={mobile} onChange={(e) => setMobile(e.target.value.replace(/[^\d ]/g, ''))} inputMode="numeric" autoComplete="tel-national" placeholder="10 digits" required maxLength={12} /></label>
        </div>
        <label className="ul-field"><span className="portal-label">You are the</span>
          <select className={`ul-input ${styles.bigInput}`} value={relation} onChange={(e) => setRelation(e.target.value)}>
            {RELATIONS.map((r) => <option key={r}>{r}</option>)}
          </select>
        </label>
        <label className="ul-field"><span className="portal-label">{effectiveKind === 'register' ? 'Tell us about the building' : 'What is wrong, and what should it be?'}</span>
          <textarea className="ul-input" value={message} onChange={(e) => setMessage(e.target.value)} required maxLength={2000}
            placeholder={effectiveKind === 'register' ? 'For example: how many floors and flats it has, and whether an occupancy certificate was issued.' : 'For example: the carpet area in my sale deed differs from the one on this record.'} />
        </label>

        <div className="ul-stack">
          <span className="portal-label">Documents <span className="ul-muted">(optional)</span></span>
          <label className={styles.drop} data-over={over}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}>
            <Icon icon={FileArrowUp} size={32} />
            <span><b>Choose files</b> or drop them here</span>
            <span className="portal-body-sm">Sale deed, sanctioned plan, occupancy certificate. PDF or image, up to 10 files.</span>
            <input ref={input} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.csv,.xlsx" onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
          </label>
          {files.length ? (
            <ul className={styles.fileList}>
              {files.map((f) => (
                <li key={f.name + f.size}>
                  <span>{f.name} <span className="ul-muted">· {Math.max(1, Math.round(f.size / 1024))} KB</span></span>
                  <Button variant="ghost" iconOnly icon={Trash} aria-label={`Remove ${f.name}`} onClick={() => setFiles((c) => c.filter((x) => x !== f))} />
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <label className={styles.consent}>
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          <span>The details I give are correct. My name and mobile number go only to the land records office and are not shown on this portal.</span>
        </label>
        {error ? <p className={styles.formError} role="alert">{error}</p> : null}
        <div className={styles.doneActions}>
          <Button type="submit" variant="primary" className={styles.bigButton} disabled={busy}>{busy ? 'Sending…' : 'Send request'}</Button>
          <Link to={`/portal/buildings/${b.id}`} className={`ul-btn ul-btn--ghost ${styles.bigButton}`} style={{ display: 'inline-flex', alignItems: 'center' }}>Cancel</Link>
        </div>
      </form>
    </div>
  );
}
