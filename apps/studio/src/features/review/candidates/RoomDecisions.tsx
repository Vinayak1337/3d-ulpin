import { useState } from 'react';
import { Button } from '@ulpin/ui';
import { refusalOf } from './commands';
import { attachLevelBody, rejectRoomBody, type LevelChoices } from './decisions';
import { LevelPicker } from './LevelPicker';
import type { CandidateCard } from './model';
import { ReasonDialog } from './ReasonDialog';
import { useAttachRoom, useRejectRoom } from './useCandidateMutations';
import styles from './CandidateReview.module.css';

interface Props {
  buildingId: string;
  canonicalRevision: string;
  card: CandidateCard;
  choices: LevelChoices;
  onRecorded: (message: string) => void;
}

type RoomAction = 'attach' | 'reject';

function useRoomDecision(props: Props, levelId: string) {
  const [action, setAction] = useState<RoomAction | null>(null);
  const attach = useAttachRoom(props.buildingId);
  const reject = useRejectRoom(props.buildingId);
  const mutation = action === 'reject' ? reject : attach;
  const failure = mutation.error ? refusalOf(mutation.error) : null;
  const close = () => setAction(null);
  const ask = (next: RoomAction) => {
    attach.reset();
    reject.reset();
    setAction(next);
  };
  const confirm = (reason: string) => {
    if (!props.card.canDecide || !action) return;
    const input = {
      requestKey: crypto.randomUUID(), canonicalRevision: props.canonicalRevision,
      candidateId: props.card.id, reason,
    };
    const onSuccess = () => {
      close();
      const message = action === 'reject'
        ? `Recorded the rejection of ${props.card.title}; the candidate stays in the record.`
        : `Attached ${props.card.title} to the chosen level.`;
      props.onRecorded(message);
    };
    if (action === 'reject') reject.mutate(rejectRoomBody(input), { onSuccess });
    else attach.mutate(attachLevelBody({ ...input, levelId }), { onSuccess });
  };
  return { action, ask, close, confirm, busy: mutation.isPending, failure };
}

/** An undecided room can be rejected or accepted onto an existing reviewed level, with a retained reason. */
export function RoomDecisions(props: Props) {
  const { card, choices } = props;
  const [levelId, setLevelId] = useState('');
  const decision = useRoomDecision(props, levelId);
  if (!card.canDecide) return null;
  const rejecting = decision.action === 'reject';
  const title = rejecting ? `Reject ${card.title}` : `Accept ${card.title} on a level`;
  const failure = decision.failure;
  return (
    <section className={styles.section} aria-label="Decision">
      <h3 className={styles.sectionTitle}>Attach to a level</h3>
      <LevelPicker choices={choices} value={levelId} onChange={setLevelId} />
      <div className={styles.actions}>
        <Button variant="primary" disabled={!levelId} onClick={() => decision.ask('attach')}>
          Accept on this level
        </Button>
        <Button onClick={() => decision.ask('reject')}>Reject</Button>
      </div>
      {decision.action ? (
        <ReasonDialog title={title} confirmLabel={rejecting ? 'Record rejection' : 'Accept'} busy={decision.busy}
          failure={failure ? `${failure.message}${failure.code ? ` (${failure.code})` : ''}` : null}
          onConfirm={decision.confirm} onClose={decision.close}>
          <p className="ul-help">
            {rejecting
              ? 'A rejected candidate stays in the record with your reason.'
              : 'This attaches the candidate to the level. It does not place the room on the map.'}
          </p>
        </ReasonDialog>
      ) : null}
    </section>
  );
}
