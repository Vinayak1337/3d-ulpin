import { useIsFetching, useQuery, useQueryClient, type Query } from '@tanstack/react-query';
import { api, unwrap } from '@ulpin/api-client';
import { queryKeys } from '../../api/queries';
import { NO_READING_STATEMENTS, readingStatements, type ReadingStatements } from './registerState';

const PROFILE = 'consolidated';

/**
 * The read that carries what the server states about the document readings retained beside a recorded building's
 * sources. The server publishes `documentResult` on the consolidated register read only, so a recorded building
 * costs one more GET. A building without a record is not asked (that read answers 404 for it).
 */
export function useReadingStatementsRead(buildingId: string | null | undefined, recorded: boolean) {
  return useQuery({
    queryKey: [...queryKeys.register(buildingId ?? ''), PROFILE],
    enabled: Boolean(buildingId) && recorded,
    queryFn: ({ signal }) => readStatements(buildingId!, signal),
    staleTime: 60_000,
  });
}

/** The statements of that read by source id; none while it is pending and when it fails. */
export function useReadingStatements(buildingId: string | null | undefined, recorded: boolean): ReadingStatements {
  return useReadingStatementsRead(buildingId, recorded).data ?? NO_READING_STATEMENTS;
}

/** Every such read this session holds, whichever building it is for. */
const STATEMENT_READS = {
  predicate: ({ queryKey }: Query) => (
    queryKey[0] === 'buildings' && queryKey[2] === 'register' && queryKey[3] === PROFILE
  ),
};

/**
 * What the server states about one source in the reads this session already holds, for a place that knows a
 * source but not its building (the evidence viewer): a source id belongs to one building. It asks nothing itself;
 * the place the source was opened from has asked.
 */
export function useSourceReadingStatement(sourceId: string): string | null {
  const client = useQueryClient();
  // Render again when such a read starts or settles.
  useIsFetching(STATEMENT_READS);
  for (const [, statements] of client.getQueriesData<ReadingStatements>(STATEMENT_READS)) {
    const statement = statements?.get(sourceId);
    if (statement) return statement;
  }
  return null;
}

async function readStatements(buildingId: string, signal: AbortSignal): Promise<ReadingStatements> {
  const report = unwrap(await api.GET('/api/v1/buildings/{buildingId}/register', {
    params: { path: { buildingId }, query: { profile: PROFILE, format: 'json' } },
    signal,
  }));
  // The route also serves files; only its consolidated JSON report carries the statements.
  if (typeof report !== 'object' || report === null || !('omissions' in report)) return NO_READING_STATEMENTS;
  return readingStatements(report.sources);
}
