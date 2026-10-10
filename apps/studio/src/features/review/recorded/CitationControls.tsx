import { EvidenceChip } from '@ulpin/ui';
import { useOpenEvidence } from '../../evidence/EvidenceContext';
import { ReadingNote } from '../../register/ReadingNote';
import { evidenceRef, type RecordedCitation } from './model';
import styles from './Recorded.module.css';

/**
 * Each citation of a recorded label as a control that opens the evidence viewer at its page and region, with what
 * the server states about the document reading retained beside the cited source, when it states anything.
 */
export function CitationControls({ label, citations }: { label: string; citations: RecordedCitation[] }) {
  const open = useOpenEvidence();
  if (!citations.length) return <span>No citation recorded</span>;
  return (
    <span className={styles.citations}>
      {citations.map((citation) => (
        <span key={citation.key} className={styles.citation}>
          <EvidenceChip source={citation.source} locator={citation.locator}
            onOpen={() => open(evidenceRef(label, citation))} />
          <ReadingNote sourceId={citation.sourceId} />
        </span>
      ))}
    </span>
  );
}
