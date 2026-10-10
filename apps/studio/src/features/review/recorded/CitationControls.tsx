import { EvidenceChip } from '@ulpin/ui';
import { useOpenEvidence } from '../../evidence/EvidenceContext';
import { evidenceRef, type RecordedCitation } from './model';
import styles from './Recorded.module.css';

/** Each citation of a recorded label as a control that opens the evidence viewer at its page and region. */
export function CitationControls({ label, citations }: { label: string; citations: RecordedCitation[] }) {
  const open = useOpenEvidence();
  if (!citations.length) return <span>No citation recorded</span>;
  return (
    <span className={styles.citations}>
      {citations.map((citation) => (
        <EvidenceChip key={citation.key} source={citation.source} locator={citation.locator}
          onOpen={() => open(evidenceRef(label, citation))} />
      ))}
    </span>
  );
}
