import { Banner, Button, StatusBadge } from '@ulpin/ui';
import { useImportPackages, useSpatialMlItem } from '../../../api/queries';
import { refusalOf } from './commands';
import type { CandidateCard } from './model';
import { useReviewDraft } from './useCandidateMutations';
import styles from './CandidateReview.module.css';

const BLOCKED_HELP: Record<string, string> = {
  USP_GEOMETRY_PAYLOAD_UNQUALIFIED: 'The geometry of this draft has not been qualified, and recording needs '
    + 'that first. The qualification command is not published in the API yet.',
};

/** The draft package that holds this candidate: the one whose feature came from this component. */
function useDraftFor(card: CandidateCard) {
  const item = useSpatialMlItem(card.itemId).data;
  const packages = useImportPackages((item?.footprintDrafts ?? []).map((draft) => draft.packageId));
  const loaded = packages.flatMap((query) => query.data ?? []);
  return loaded.find((pkg) => pkg.features.some((f) => f.sourceKey === card.id)) ?? null;
}

function Blocked({ error }: { error: unknown }) {
  const refusal = refusalOf(error);
  const help = refusal.code ? BLOCKED_HELP[refusal.code] : undefined;
  return (
    <>
      <Banner tone="warning">Blocked: {refusal.message}{refusal.code ? ` (${refusal.code})` : ''}</Banner>
      {help ? <p className="ul-help">{help}</p> : null}
    </>
  );
}

/** An accepted roofprint is a source selection and a draft. Recording it in the registry is a separate step. */
export function RegistryStep({ card }: { card: CandidateCard }) {
  const draft = useDraftFor(card);
  const review = useReviewDraft(draft?.id ?? '');
  if (!draft) return null;
  return (
    <section className={styles.section} aria-label="Registry">
      <h3 className={styles.sectionTitle}>Registry</h3>
      <span className="ul-row">
        <StatusBadge status="Draft" />
        <span className="ul-help">Draft package {draft.id.slice(0, 8)}, revision {draft.revision}</span>
      </span>
      <p className="ul-help">Accepted as a source selection only. It is not recorded in the registry.</p>
      {review.error ? <Blocked error={review.error} /> : null}
      {review.isSuccess ? <Banner tone="info">Registry review prepared. Recording is the next step.</Banner> : null}
      <div className={styles.actions}>
        <Button disabled={review.isPending} onClick={() => review.mutate(draft.revision)}>
          Review for the registry
        </Button>
      </div>
    </section>
  );
}
