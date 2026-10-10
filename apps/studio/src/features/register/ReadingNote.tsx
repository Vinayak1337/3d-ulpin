import { createContext, useContext } from 'react';
import { NO_READING_STATEMENTS } from './registerState';

/** What the server states about a building's retained document readings, for the source lines rendered beneath. */
export const ReadingStatementsContext = createContext(NO_READING_STATEMENTS);

/** Beside one source: what the server states about the reading retained with it. Nothing when it states nothing. */
export function ReadingNote({ sourceId }: { sourceId: string }) {
  const statement = useContext(ReadingStatementsContext).get(sourceId);
  return statement ? <span className="ul-caption">{statement}</span> : null;
}
