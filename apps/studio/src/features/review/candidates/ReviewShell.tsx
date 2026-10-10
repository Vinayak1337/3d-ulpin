import { useCallback, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Cursor } from '@phosphor-icons/react';
import { EmptyState, Panel, Tabs, Toast } from '@ulpin/ui';
import { CandidateCardView } from './CandidateCardView';
import { CandidateQueue } from './CandidateQueue';
import { HistoryPanel } from './HistoryPanel';
import { decisionHistory, type CandidateCard } from './model';
import styles from './CandidateReview.module.css';

type InspectorTab = 'candidate' | 'history';

export interface ReviewShellProps {
  heading: string;
  scope: string;
  backTo: { to: string; label: string };
  cards: CandidateCard[];
  withoutGeometry: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  canvas: ReactNode;
  /** The decision controls for the selected candidate; `notify` raises the confirmation toast. */
  decisions: (card: CandidateCard, notify: (message: string) => void) => ReactNode;
}

function SelectedCard({ card, props, notify }: {
  card: CandidateCard | null; props: ReviewShellProps; notify: (message: string) => void;
}) {
  if (card) return <CandidateCardView card={card}>{props.decisions(card, notify)}</CandidateCardView>;
  return (
    <EmptyState icon={Cursor} title="Select a candidate">
      Choose one in the queue or on the canvas to see its record.
    </EmptyState>
  );
}

/** Queue, canvas and one inspector. The queue and canvas select the same candidate; the URL holds it. */
export function ReviewShell(props: ReviewShellProps) {
  const [tab, setTab] = useState<InspectorTab>('candidate');
  const [notice, setNotice] = useState<string | null>(null);
  const selected = props.cards.find((card) => card.id === props.selectedId) ?? null;
  const dismiss = useCallback(() => setNotice(null), []);
  const decided = decisionHistory(props.cards).length;
  const showCandidate = (id: string) => {
    props.onSelect(id);
    setTab('candidate');
  };
  const tabs = [
    { value: 'candidate' as const, label: 'Candidate' },
    { value: 'history' as const, label: 'History', count: decided },
  ];
  const inspector = tab === 'history'
    ? <HistoryPanel cards={props.cards} onSelect={showCandidate} />
    : <SelectedCard card={selected} props={props} notify={setNotice} />;
  return (
    <div className={styles.page}>
      <div className={styles.top}>
        <h1 className={styles.title}>{props.heading}</h1>
        <span className={styles.scope}>{props.scope}</span>
        <span className={styles.grow} />
        <Link className="ul-btn ul-btn--ghost" to={props.backTo.to}>{props.backTo.label}</Link>
      </div>
      <div className={styles.body}>
        <CandidateQueue cards={props.cards} selectedId={props.selectedId} onSelect={showCandidate}
          withoutGeometry={props.withoutGeometry} />
        {props.canvas}
        <Panel className={styles.inspector} flush={(
          <>
            <Tabs label="Inspector" value={tab} onChange={setTab} tabs={tabs} />
            {inspector}
          </>
        )} />
      </div>
      {notice ? <Toast onDone={dismiss}>{notice}</Toast> : null}
    </div>
  );
}
