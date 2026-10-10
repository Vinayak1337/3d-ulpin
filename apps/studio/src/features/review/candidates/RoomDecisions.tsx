import { useState } from 'react';
import { Button } from '@ulpin/ui';
import { refusalOf } from './commands';
import { attachLevelBody, type LevelChoices } from './decisions';
import { LevelPicker } from './LevelPicker';
import type { CandidateCard } from './model';
import { ReasonDialog } from './ReasonDialog';
import { useAttachRoom } from './useCandidateMutations';
import styles from './CandidateReview.module.css';

const NO_REJECT_COMMAND = 'The API has no command to reject a room candidate yet.';

/**
 * A room can only be attached to an existing reviewed level (the API's `attach_level` action). Rejecting a room
 * has no command, so its button stays off and says why instead of pretending.
 */
export function RoomDecisions({ buildingId, canonicalRevision, card, choices, onRecorded }: {
  buildingId: string;
  canonicalRevision: string;
  card: CandidateCard;
  choices: LevelChoices;
  onRecorded: (message: string) => void;
}) {
  const [levelId, setLevelId] = useState('');
  const [asking, setAsking] = useState(false);
  const attach = useAttachRoom(buildingId);
  if (card.state !== 'candidate') return null;
  const failure = attach.error ? refusalOf(attach.error) : null;

  const confirm = (reason: string) => {
    const body = attachLevelBody({
      requestKey: crypto.randomUUID(), canonicalRevision, candidateId: card.id, levelId, reason,
    });
    attach.mutate(body, {
      onSuccess: () => { setAsking(false); onRecorded(`Attached ${card.title} to the chosen level.`); },
    });
  };

  return (
    <section className={styles.section} aria-label="Decision">
      <h3 className={styles.sectionTitle}>Attach to a level</h3>
      <LevelPicker choices={choices} value={levelId} onChange={setLevelId} />
      <div className={styles.actions}>
        <Button variant="primary" disabled={!levelId} onClick={() => setAsking(true)}>Accept on this level</Button>
        <Button disabled title={NO_REJECT_COMMAND}>Reject</Button>
      </div>
      <p className="ul-help">{NO_REJECT_COMMAND}</p>
      {asking ? (
        <ReasonDialog title={`Accept ${card.title} on a level`} confirmLabel="Accept" busy={attach.isPending}
          failure={failure ? `${failure.message}${failure.code ? ` (${failure.code})` : ''}` : null}
          onConfirm={confirm} onClose={() => setAsking(false)}>
          <p className="ul-help">This attaches the candidate to the level. It does not place the room on the map.</p>
        </ReasonDialog>
      ) : null}
    </section>
  );
}
