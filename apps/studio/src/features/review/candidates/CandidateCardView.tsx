import type { ReactNode } from 'react';
import { useParams } from 'react-router';
import { FileText } from '@phosphor-icons/react';
import { DescriptionList, Icon, formatDateTime, type Fact } from '@ulpin/ui';
import { useBuildingCanonical, useSpatialMlBatch, useSpatialMlItem } from '../../../api/queries';
import { useOpenEvidence } from '../../evidence/EvidenceContext';
import { Cited, ReadingStatementsContext } from '../../register/ReadingNote';
import { useReadingStatements } from '../../register/useReadingStatements';
import { evidenceRef } from '../recorded/model';
import { CandidateChip } from './CandidateQueue';
import { modelCardSummary } from './modelCard';
import {
  citationOpenLabel, type CandidateCard, type CandidateCitation, type PlanEstimateView, type StatedSizeView,
} from './model';
import styles from './CandidateReview.module.css';

const DETERMINISTIC = 'Deterministic extraction; no model';
const ESTIMATE_BASIS = "From the candidate polygon in the plan's own metres, at the plan's candidate scale; "
  + "not a measurement.";

function Mono({ children }: { children: ReactNode }) {
  return <span className={styles.mono}>{children}</span>;
}

function Unknown() {
  return <em className="ul-unknown">Unknown</em>;
}

function recordedFacts(card: CandidateCard): Fact[] {
  const facts: Fact[] = [
    { label: 'Model', value: card.modelId ? <Mono>{card.modelId}</Mono> : DETERMINISTIC },
    { label: 'Method', value: <Mono>{card.method}</Mono> },
    { label: 'Confidence', value: card.confidence },
  ];
  if (card.kind === 'room') {
    facts.push({ label: 'Level', value: card.level });
    facts.push({ label: 'Floor title in the drawing', value: card.levelLiteral ?? <Unknown /> });
  }
  facts.push({ label: 'Frame', value: <Mono>{card.frame}</Mono> });
  return facts;
}

/** What the inference receipt and its batch say about a roofprint's model and image, read from the API. */
function ModelSection({ itemId }: { itemId: string }) {
  const item = useSpatialMlItem(itemId).data;
  const batch = useSpatialMlBatch(item?.batchId).data;
  if (!item) return null;
  const summary = modelCardSummary(item.result?.receipt);
  const components = item.result?.components.length ?? 0;
  const facts: Fact[] = [{ label: 'Image result', value: `${item.state}, ${components} components` }];
  if (batch) {
    facts.push({ label: 'Batch', value: <Mono>{batch.id.slice(0, 8)} · {batch.items.length} images</Mono> });
  }
  if (summary.development) facts.push({ label: 'Development split', value: summary.development });
  if (summary.claim) facts.push({ label: 'Claim', value: summary.claim });
  if (summary.licence) facts.push({ label: 'Licence', value: summary.licence });
  return (
    <section className={styles.section} aria-label="Model">
      <h3 className={styles.sectionTitle}>Model card summary</h3>
      <DescriptionList items={facts} />
    </section>
  );
}

function estimateFacts(estimate: PlanEstimateView): Fact[] {
  if (estimate.state === 'unknown') {
    return [{ label: 'Bounding extent', value: <Unknown /> }, { label: 'Area', value: <Unknown /> }];
  }
  return [
    { label: 'Bounding extent', value: `${estimate.extent} (estimated)` },
    { label: 'Area', value: `${estimate.area} (estimated)` },
  ];
}

/** The size the read states for a room; nothing when the read states none. */
function PlanEstimate({ estimate }: { estimate: PlanEstimateView | null }) {
  if (!estimate) return null;
  return (
    <section className={styles.section} aria-label="Estimated size">
      <h3 className={styles.sectionTitle}>Estimated size</h3>
      <DescriptionList items={estimateFacts(estimate)} />
      {estimate.state === 'estimated' ? <p className="ul-help">{ESTIMATE_BASIS}</p> : null}
    </section>
  );
}

function Limitations({ items }: { items: string[] }) {
  return (
    <section className={styles.section} aria-label="Limitations">
      <h3 className={styles.sectionTitle}>Limitations</h3>
      {items.length ? (
        <ul className={styles.limits}>{items.map((text) => <li key={text}>{text}</li>)}</ul>
      ) : (
        <p className="ul-help"><Unknown />: the record states no limitations.</p>
      )}
    </section>
  );
}

/**
 * One citation as a control that opens the evidence viewer at the cited source, page and region. It is the
 * evidence chip drawn as its own button, because the chip's button is named by its text alone and this one
 * has to say what it opens.
 */
function CitationControl({ title, citation }: { title: string; citation: CandidateCitation }) {
  const open = useOpenEvidence();
  return (
    <button type="button" className="ul-evid" aria-label={citationOpenLabel(citation)}
      onClick={() => open(evidenceRef(title, citation))}>
      <Icon icon={FileText} size={16} />
      <b>{citation.source}</b>
      <span>{citation.locator}</span>
    </button>
  );
}

/** What the sheet prints beside the room, as read, with where it is printed. It is never set against the estimate. */
function StatedSize({ title, stated }: { title: string; stated: StatedSizeView | null }) {
  if (!stated) return null;
  return (
    <section className={styles.section} aria-label="Stated size">
      <p className={styles.stated}>Stated on the sheet: {stated.literal}</p>
      <div className="ul-row"><CitationControl title={title} citation={stated.citation} /></div>
    </section>
  );
}

/**
 * The card does not carry its building, so the reading statements are those of the page's building (none
 * on an area's review page). A citation is joined to them by its source id.
 */
function Citations({ card }: { card: CandidateCard }) {
  const { buildingId } = useParams();
  const reviewed = useBuildingCanonical(buildingId).data?.recordState === 'reviewed';
  const readings = useReadingStatements(buildingId, reviewed);
  return (
    <section className={styles.section} aria-label="Citations">
      <h3 className={styles.sectionTitle}>Citations</h3>
      {card.citations.length ? (
        <ReadingStatementsContext.Provider value={readings}>
          <div className="ul-row">
            {card.citations.map((citation) => (
              <Cited key={citation.key} sourceId={citation.sourceId}>
                <CitationControl title={card.title} citation={citation} />
              </Cited>
            ))}
          </div>
        </ReadingStatementsContext.Provider>
      ) : (
        <p className="ul-help"><Unknown />: the record cites no source.</p>
      )}
    </section>
  );
}

function DecisionRecord({ card }: { card: CandidateCard }) {
  if (!card.decision) return null;
  const { outcome, reason, actor, time } = card.decision;
  return (
    <section className={styles.decision} aria-label="Decision on record">
      <strong>{outcome === 'accepted' ? 'Accepted' : 'Rejected'} · {formatDateTime(time)}</strong>
      <span>{reason}</span>
      <span className="ul-muted">By {actor}</span>
    </section>
  );
}

/** One candidate with everything its record states. A candidate is never styled as a reviewed value. */
export function CandidateCardView({ card, children }: { card: CandidateCard; children?: ReactNode }) {
  return (
    <div className={styles.inspectorBody}>
      <header className={styles.cardHead}>
        <span className="ul-caption">{card.kindLabel} candidate</span>
        <h2 className={styles.cardTitle}>{card.title}</h2>
        <span className="ul-row"><CandidateChip chip={card.chip} /></span>
      </header>
      <DecisionRecord card={card} />
      {children}
      <DescriptionList items={recordedFacts(card)} />
      <StatedSize title={card.title} stated={card.statedSize} />
      <PlanEstimate estimate={card.planEstimate} />
      {card.itemId ? <ModelSection itemId={card.itemId} /> : null}
      <Limitations items={card.limitations} />
      <Citations card={card} />
    </div>
  );
}
