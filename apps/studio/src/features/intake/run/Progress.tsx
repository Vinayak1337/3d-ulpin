import { useEffect, useState } from 'react';
import { Button, Panel, formatDateTime } from '@ulpin/ui';
import { Link } from 'react-router';
import { cardPdfPath, cardVerificationPath } from '../../identity/registryCard';
import { ArtefactLinks } from './ArtefactLinks';
import { failureWords, retryConfirmation } from './api';
import { Findings } from './Packages';
import { readinessLabels, stageWords, type Confirmation, type Target } from './model';
import styles from './Run.module.css';

export function Progress({ caseId, confirmation, refresh, onOpen, mapPath }: {
  caseId: string; confirmation: Confirmation; refresh: () => void; onOpen: (target: Target) => void;
  mapPath?: string | null;
}) {
  const done = confirmation.progress.length > 0
    && confirmation.progress.every(target => ['carded', 'stopped'].includes(target.readiness));
  return <Panel title={done ? 'Done' : `Confirmed ${formatDateTime(confirmation.createdAt)}`} className={styles.stack}>
    {done ? <DoneActions confirmation={confirmation} mapPath={mapPath} /> : null}
    <p>{confirmation.counts.recorded} recorded · {confirmation.counts.carded} carded ·
      {' '}{confirmation.counts.stopped} stopped</p>
    <p className={styles.reason}>{confirmation.acknowledgement}</p>
    <Findings counts={confirmation.findingCounts} />
    <Retry caseId={caseId} confirmation={confirmation} refresh={refresh} />
    {done ? <details>
      <summary>Building progress</summary>
      <ProgressList targets={confirmation.progress} onOpen={onOpen} />
    </details> : <ProgressList targets={confirmation.progress} onOpen={onOpen} />}
  </Panel>;
}

function DoneActions({ confirmation, mapPath }: { confirmation: Confirmation; mapPath?: string | null }) {
  const card = confirmation.progress.find(target => target.readiness === 'carded' && target.artefacts.card)
    ?.artefacts.card;
  return <div className={styles.controls}>
    {card ? <>
      <a className="ul-btn" href={cardPdfPath(card.id, card.revision)} target="_blank" rel="noreferrer">
        Open the card
      </a>
      <Link className="ul-btn" to={cardVerificationPath(card.id, card.revision)}>Verify</Link>
    </> : null}
    {mapPath ? <Link className="ul-btn" to={mapPath}>See on the map</Link> : null}
  </div>;
}

function ProgressList({ targets, onOpen }: { targets: readonly Target[]; onOpen: (target: Target) => void }) {
  return <ul className={styles.list}>
    {targets.map(target => <li key={target.targetId} className={styles.target}>
      <details onToggle={event => { if (event.currentTarget.open) onOpen(target); }}>
        <summary>{target.locator} · {stageWords[target.stage]}</summary>
        {target.reason && target.readiness !== 'stopped'
          ? <p className={styles.reason}>{target.reason}</p> : null}
      </details>
      <p>{readinessLabels[target.readiness]}</p>
      {target.readiness === 'stopped' && target.reason ? <p className={styles.reason}>{target.reason}</p> : null}
      <ArtefactLinks target={target} onOpen={() => onOpen(target)} />
    </li>)}
  </ul>;
}

function Retry({ caseId, confirmation, refresh }: {
  caseId: string; confirmation: Confirmation; refresh: () => void;
}) {
  const expires = Date.parse(confirmation.expiresAt);
  const [expired, setExpired] = useState(Date.now() >= expires);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => setExpired(true), Math.max(0, expires - Date.now()));
    return () => window.clearTimeout(timer);
  }, [expires]);
  const retry = async () => {
    if (busy || Date.now() >= expires) return;
    setBusy(true);
    setError('');
    try {
      await retryConfirmation(caseId, confirmation.confirmationId);
      refresh();
    } catch (failure) {
      setError(failureWords(failure));
    } finally {
      setBusy(false);
    }
  };
  return <div className={styles.stack}>
    <p>{expired ? 'This confirmation expired' : 'This confirmation expires'}
      {' '}{formatDateTime(confirmation.expiresAt)}.</p>
    {!expired && confirmation.counts.stopped > 0 ? <Button disabled={busy} onClick={() => void retry()}>
      Try the stopped ones again
    </Button> : null}
    {error ? <p role="alert">{error}</p> : null}
  </div>;
}
