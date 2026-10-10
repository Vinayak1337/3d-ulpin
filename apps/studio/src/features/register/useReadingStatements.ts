import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '@ulpin/api-client';
import { queryKeys } from '../../api/queries';
import { NO_READING_STATEMENTS, readingStatements, type ReadingStatements } from './registerState';

/**
 * What the server states about the document readings retained beside a recorded building's sources, by source id.
 * The server publishes `documentResult` on the consolidated register read only, so a recorded building costs one
 * more GET. A building without a record is not asked (that read answers 404 for it); while the read is pending
 * and when it fails, nothing is stated.
 */
export function useReadingStatements(buildingId: string | null | undefined, recorded: boolean): ReadingStatements {
  const query = useQuery({
    queryKey: [...queryKeys.register(buildingId ?? ''), 'consolidated'],
    enabled: Boolean(buildingId) && recorded,
    queryFn: ({ signal }) => readStatements(buildingId!, signal),
    staleTime: 60_000,
  });
  return query.data ?? NO_READING_STATEMENTS;
}

async function readStatements(buildingId: string, signal: AbortSignal): Promise<ReadingStatements> {
  const report = unwrap(await api.GET('/api/v1/buildings/{buildingId}/register', {
    params: { path: { buildingId }, query: { profile: 'consolidated', format: 'json' } },
    signal,
  }));
  // The route also serves files; only its consolidated JSON report carries the statements.
  if (typeof report !== 'object' || report === null || !('omissions' in report)) return NO_READING_STATEMENTS;
  return readingStatements(report.sources);
}
