import { createContext, useContext, type ReactNode } from 'react';
import { NO_READING_STATEMENTS } from './registerState';
import styles from './ReadingNote.module.css';

/** What the server states about a building's retained document readings, for the source lines rendered beneath. */
export const ReadingStatementsContext = createContext(NO_READING_STATEMENTS);

/** Beside one source: what the server states about the reading retained with it. Nothing when it states nothing. */
export function ReadingNote({ sourceId }: { sourceId: string }) {
  const statement = useContext(ReadingStatementsContext).get(sourceId);
  return statement ? <span className="ul-caption">{statement}</span> : null;
}

/**
 * A citation with the note of its source beneath it. When the server states nothing about that source the
 * citation is returned as it is, so a page whose sources are not stated renders exactly as before.
 */
export function Cited({ sourceId, children }: { sourceId: string | null | undefined; children: ReactNode }) {
  const stated = useContext(ReadingStatementsContext).has(sourceId ?? '');
  if (!sourceId || !stated) return children;
  return <span className={styles.cited}>{children}<ReadingNote sourceId={sourceId} /></span>;
}
