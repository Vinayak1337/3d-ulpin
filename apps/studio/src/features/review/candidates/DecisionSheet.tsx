import { useMemo } from 'react';
import { Banner, Button } from '@ulpin/ui';
import { useImportPackage, useSpatialMlItem } from '../../../api/queries';
import { refusalOf } from './commands';
import { footprintDecisionPlan, type DecisionPlan, type StagedDecision } from './decisions';
import { useRecordRoofprints } from './useCandidateMutations';
import styles from './CandidateReview.module.css';

/** The decisions staged on one image, recorded together in one command. */
export function DecisionSheet({ itemId, decisions, areaRevision, titleOf, onRemove, onRecorded }: {
  itemId: string;
  decisions: StagedDecision[];
  areaRevision: number;
  titleOf: (candidateId: string) => string;
  onRemove: (candidateId: string) => void;
  onRecorded: (message: string) => void;
}) {
  const item = useSpatialMlItem(itemId).data;
  const revision = useImportPackage(item?.packageId).data?.revision;
  const record = useRecordRoofprints(itemId);
  const signature = JSON.stringify(decisions);
  // A new key per set of decisions: the API refuses a key reused for different controls.
  const requestKey = useMemo(() => crypto.randomUUID(), [signature]);
  const plan: DecisionPlan = revision === undefined
    ? { ok: false, reason: 'Reading the package revision.' }
    : footprintDecisionPlan({ requestKey, packageRevision: revision, areaRevision, decisions });
  const failure = record.error ? refusalOf(record.error) : null;

  const submit = () => {
    if (!plan.ok) return;
    record.mutate(plan.body, {
      onSuccess: (result) => onRecorded(`Recorded ${decisions.length} decision${decisions.length === 1 ? '' : 's'}. `
        + `Draft package ${result.package.id.slice(0, 8)} holds the accepted roofprint; it is not in the registry.`),
    });
  };

  return (
    <section className={styles.section} aria-label="Decisions staged on this image">
      <h3 className={styles.sectionTitle}>Staged on this image · {decisions.length}</h3>
      <ul className={styles.staged}>
        {decisions.map((decision) => (
          <li key={decision.candidateId} className={styles.stagedRow}>
            <span>{decision.outcome === 'accepted' ? 'Accept' : 'Reject'} {titleOf(decision.candidateId)}</span>
            <Button variant="ghost" onClick={() => onRemove(decision.candidateId)}>Remove</Button>
          </li>
        ))}
      </ul>
      {!plan.ok ? <p className="ul-help">{plan.reason}</p> : null}
      {failure ? <Banner tone="warning">{failure.message}{failure.code ? ` (${failure.code})` : ''}</Banner> : null}
      <div className={styles.actions}>
        <Button variant="primary" disabled={!plan.ok || record.isPending} onClick={submit}>
          Record {decisions.length} decision{decisions.length === 1 ? '' : 's'}
        </Button>
      </div>
    </section>
  );
}
