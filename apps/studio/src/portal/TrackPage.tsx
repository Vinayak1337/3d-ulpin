import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Check, X } from '@phosphor-icons/react';
import type { PublicRequestStatus, RequestState } from '@ulpin/api-client/draft';
import { Button, Icon, UlpinCode, formatDateTime } from '@ulpin/ui';
import { trackRequest } from './queries';
import styles from './Portal.module.css';

const STEPS: { state: RequestState; title: string; detail: string }[] = [
  { state: 'submitted', title: 'Received', detail: 'Your request reached the land records office.' },
  { state: 'in_review', title: 'In review', detail: 'An officer is checking your request and documents.' },
  { state: 'accepted', title: 'Decided', detail: 'The office has decided on your request.' },
];

/** P6: track a request by its reference and the mobile number it was filed with. */
export function TrackPage() {
  const [params] = useSearchParams();
  const [ref, setRef] = useState(params.get('ref') ?? '');
  const [mobile, setMobile] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<PublicRequestStatus | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try { setStatus(await trackRequest(ref.trim(), mobile)); } catch (e) { setStatus(null); setError(e instanceof Error ? e.message : 'Could not find this request.'); } finally { setBusy(false); }
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.verifyBox}>
        <h1 className="portal-h1">Track a request</h1>
        <p className="portal-body ul-muted">Enter the reference number you received and the mobile number you gave.</p>
        <form className={styles.verifyForm} onSubmit={(e) => void submit(e)}>
          <label className="ul-field"><span className="portal-label">Reference number</span>
            <input className={`ul-input ${styles.bigInput} ul-mono`} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="RQ-…" autoComplete="off" spellCheck={false} /></label>
          <label className="ul-field"><span className="portal-label">Mobile number</span>
            <input className={`ul-input ${styles.bigInput}`} value={mobile} onChange={(e) => setMobile(e.target.value.replace(/[^\d ]/g, ''))} inputMode="numeric" autoComplete="tel-national" maxLength={12} /></label>
          <Button type="submit" variant="primary" className={styles.bigButton} disabled={busy || !ref.trim() || !mobile.trim()}>{busy ? 'Checking…' : 'Check status'}</Button>
          {error ? <p className={styles.formError} role="alert">{error}</p> : null}
        </form>
      </div>
      {status ? <Status status={status} onRefresh={() => void trackRequest(status.ref, mobile).then(setStatus)} /> : null}
    </div>
  );
}

function Status({ status: s, onRefresh }: { status: PublicRequestStatus; onRefresh: () => void }) {
  const reached = (state: RequestState) => s.history.find((h) => h.state === state || (state === 'accepted' && h.state === 'rejected'));
  const rejected = s.state === 'rejected';
  return (
    <section className={styles.done} aria-label={`Request ${s.ref}`}>
      <span className="portal-label ul-muted">{s.ref} · {s.kind === 'register' ? 'Building register' : 'Record correction'}</span>
      <span className="portal-h3">{s.kind === 'register' ? `Register of ${s.buildingName}` : `Correction${s.recordName ? ` to ${s.recordName}` : ''}, ${s.buildingName}`}</span>
      <UlpinCode code={s.buildingCode} copyable={false} />
      <ol className={styles.steps}>
        {STEPS.map((step) => {
          const h = reached(step.state);
          const isDecision = step.state === 'accepted';
          const title = isDecision && h ? (rejected ? 'Not accepted' : 'Accepted') : step.title;
          const detail = isDecision && h ? (rejected ? 'The office could not take this request up.' : s.kind === 'register' ? 'The office will record this building\'s floors and flats.' : 'The office will correct the record.') : step.detail;
          return (
            <li key={step.state} data-state={h ? (isDecision && rejected ? 'rejected' : 'done') : 'todo'}>
              <span className={styles.stepDot}>{h ? <Icon icon={isDecision && rejected ? X : Check} size={16} /> : null}</span>
              <span className={styles.stepText}>
                <b>{title}</b>
                <span className="ul-muted">{h ? formatDateTime(h.at) : detail}</span>
                {h && isDecision ? <span>{detail}</span> : null}
                {h?.note ? <span>Note from the office: {h.note}</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
      <div className={styles.doneActions}>
        <Link to={`/portal/buildings/${s.buildingId}`} className="ul-btn">View {s.buildingName}</Link>
        <Button variant="ghost" onClick={onRefresh}>Refresh</Button>
      </div>
    </section>
  );
}
