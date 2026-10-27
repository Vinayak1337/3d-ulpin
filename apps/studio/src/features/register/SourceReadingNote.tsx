import styles from './ReadingNote.module.css';
import { useSourceReadingStatement } from './useReadingStatements';

/**
 * The reading note for a place that is not rendered under the page's statements and knows only the source it
 * shows (the evidence viewer). Nothing when no read of this session states anything about that source.
 */
export function SourceReadingNote({ sourceId }: { sourceId: string }) {
  const statement = useSourceReadingStatement(sourceId);
  return statement ? <span className={`ul-caption ${styles.inHeader}`}>{statement}</span> : null;
}
