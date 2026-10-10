import { useState } from 'react';
import { CheckCircle, XCircle } from '@phosphor-icons/react';
import { Button } from '@ulpin/ui';
import { DecisionSheet } from './DecisionSheet';
import type { StagedDecision } from './decisions';
import type { CandidateCard } from './model';
import { ReasonDialog } from './ReasonDialog';
import { RegistryStep } from './RegistryStep';
import styles from './CandidateReview.module.css';

const DIALOG_HELP: Record<StagedDecision['outcome'], string> = {
  accepted: 'Accepting selects this roof projection as a source candidate. '
    + 'It does not record a building in the registry.',
  rejected: 'A rejected candidate stays in the record with your reason.',
};

interface Props {
  card: CandidateCard;
  staged: StagedDecision[];
  areaRevision: number | undefined;
  titleOf: (candidateId: string) => string;
  onStage: (decision: StagedDecision) => void;
  onUnstage: (candidateId: string) => void;
  onRecorded: (message: string) => void;
}

/** Decisions on one roofprint: stage accept or reject with a reason, then record the image's decisions together. */
export function RoofprintDecisions({ card, staged, areaRevision, titleOf, onStage, onUnstage, onRecorded }: Props) {
  const [dialog, setDialog] = useState<StagedDecision['outcome'] | null>(null);
  if (!card.canDecide) return card.state === 'reviewed' ? <RegistryStep card={card} /> : null;
  const mine = staged.find((decision) => decision.candidateId === card.id);
  const sameImage = staged.filter((decision) => decision.itemId === card.itemId);

  const confirm = (reason: string) => {
    if (dialog && card.itemId) onStage({ candidateId: card.id, itemId: card.itemId, outcome: dialog, reason });
    setDialog(null);
  };

  return (
    <>
      {!mine && card.itemId ? (
        <div className={styles.actions}>
          <Button variant="primary" icon={CheckCircle} onClick={() => setDialog('accepted')}>Accept</Button>
          <Button icon={XCircle} onClick={() => setDialog('rejected')}>Reject</Button>
        </div>
      ) : null}
      {mine ? (
        <p className="ul-help">Staged: {mine.outcome === 'accepted' ? 'accept' : 'reject'}. Reason: {mine.reason}</p>
      ) : null}
      {card.itemId && sameImage.length && areaRevision !== undefined ? (
        <DecisionSheet itemId={card.itemId} decisions={sameImage} areaRevision={areaRevision} titleOf={titleOf}
          onRemove={onUnstage} onRecorded={onRecorded} />
      ) : null}
      {dialog ? (
        <ReasonDialog title={`${dialog === 'accepted' ? 'Accept' : 'Reject'} ${card.title}`}
          confirmLabel={dialog === 'accepted' ? 'Stage acceptance' : 'Stage rejection'} onConfirm={confirm}
          onClose={() => setDialog(null)}>
          <p className="ul-help">{DIALOG_HELP[dialog]}</p>
        </ReasonDialog>
      ) : null}
    </>
  );
}
