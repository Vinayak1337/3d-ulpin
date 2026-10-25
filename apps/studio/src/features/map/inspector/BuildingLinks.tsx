import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle, Question, Warning } from '@phosphor-icons/react';
import { api, ApiError, unwrap } from '@ulpin/api-client';
import { Badge } from '@ulpin/ui';
import type { IntakeItem } from '../../intake/batch-model';
import { useIntakeManifest } from '../../intake/batch-queries';
import { evidenceKey } from '../../intake/evidence/api';
import { buildingWords, outcomeWords, type Candidate, type EvidencePage,
  type Outcome } from '../../intake/evidence/model';
import { readTargetByFeature } from '../../intake/run/api';
import type { Target } from '../../intake/run/model';
import { buildingTargetKey } from './BuildingCard';
import { batchPath } from './cardState';
import { linkKeyWords, linkOutcomeWords, linkPlaceWords, linkReview, linkReviewWords } from './evidence';
import styles from './Inspector.module.css';

/** Under the batch's evidence key: every refresh the batch takes reads this building's links again. */
export const featureLinksKey = (caseId: string, featureId: string) => [...evidenceKey(caseId), 'feature', featureId];

/** The first page of the candidates whose anchors name this map feature; the page's counts stay case-wide. */
export async function readFeatureLinks(caseId: string, featureId: string): Promise<EvidencePage> {
  return unwrap(await api.GET('/api/v1/ingestion/cases/{caseId}/intake/evidence', {
    params: { path: { caseId }, query: { featureId } },
  })) as EvidencePage;
}

const NONE = 'No links.';
/** Amber, not red: a conflict or several buildings needs the officer's review; it is not a blocking finding. */
const TONE: Record<Outcome, { tone: 'success' | 'warning' | 'neutral'; icon: typeof CheckCircle }> = {
  matched: { tone: 'success', icon: CheckCircle }, several: { tone: 'warning', icon: Warning },
  conflicting: { tone: 'warning', icon: Warning }, no_match: { tone: 'neutral', icon: Question },
};

function Unread({ error }: { error: unknown }) {
  return <p className={styles.note} role="alert">Links could not be read.
    {' '}{error instanceof ApiError ? error.message : 'The server gave no answer.'}</p>;
}

/**
 * Read only: the register rows and document pages a declared key links to this building, read from the case of the
 * intake target that names it. A building no target names has no links. A failed read is said in this section only.
 */
export function BuildingLinks({ featureId, packageId }: { featureId: string; packageId?: string }) {
  const read = useQuery({ queryKey: buildingTargetKey(featureId, packageId), retry: false,
    queryFn: () => readTargetByFeature(featureId, packageId) });
  return <section className={styles.linksSection} aria-label="Links to register rows and pages">
    <h3 className={styles.sectionTitle}>Links to register rows and pages</h3>
    {read.error ? <Unread error={read.error} />
      : read.isPending ? <p className={styles.note} role="status">Reading links…</p>
        : read.data ? <TargetLinks target={read.data} featureId={featureId} />
          : <p className={styles.note}>{NONE}</p>}
  </section>;
}

function TargetLinks({ target, featureId }: { target: Target; featureId: string }) {
  const read = useQuery({ queryKey: featureLinksKey(target.caseId, featureId), retry: false,
    queryFn: () => readFeatureLinks(target.caseId, featureId) });
  const manifest = useIntakeManifest(target.caseId);
  if (read.error) return <Unread error={read.error} />;
  if (read.isPending) return <p className={styles.note} role="status">Reading links…</p>;
  const page = read.data;
  if (!page.candidates.length) return <p className={styles.note}>{NONE}</p>;
  const fileName = (itemId: string) => manifest.data
    ? manifest.data.items.find((item: IntakeItem) => item.itemId === itemId)?.name ?? 'A file no longer listed'
    : manifest.error ? 'File name could not be read' : 'Reading…';
  return <>
    <ul className={styles.links}>
      {page.candidates.map((candidate) => <LinkRow key={candidate.candidateId} candidate={candidate}
        file={fileName(candidate.evidence.itemId)} page={page} target={target} />)}
    </ul>
    {page.nextCursor ? <Link to={batchPath(target.caseId)}>More links in the batch</Link> : null}
  </>;
}

function LinkRow({ candidate, file, page, target }: {
  candidate: Candidate; file: string; page: EvidencePage; target: Target;
}) {
  const look = TONE[candidate.outcome];
  const others = candidate.anchors.filter((anchor) => anchor.targetId !== target.targetId);
  const evidence = candidate.evidence;
  return <li className={styles.link}>
    <span className={styles.linkHead}>
      <b>{file}</b>
      <Badge tone={look.tone} icon={look.icon}>{linkOutcomeWords[candidate.outcome]}</Badge>
    </span>
    <span>{linkPlaceWords(evidence)}</span>
    <span>Key <span className="ul-mono">{linkKeyWords(candidate)}</span>
      {candidate.outcome !== 'matched'
        ? <span className="ul-muted"> · {outcomeWords[candidate.outcome]}</span> : null}</span>
    {evidence.kind === 'document_part' ? <span className="ul-muted">“{evidence.quote}”</span> : null}
    {others.length ? <span className="ul-muted">
      Also names {buildingWords({ ...candidate, anchors: others }, [])}
    </span> : null}
    <span className={styles.linkReview}>{linkReviewWords(linkReview(candidate, page.confirmations, target))}</span>
  </li>;
}
