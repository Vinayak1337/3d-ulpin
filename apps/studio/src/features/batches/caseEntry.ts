import type { GetResponse } from '@ulpin/api-client';
import { refusalOf } from '../review/candidates/commands';

type SourceCase = GetResponse<'/api/v1/cases/{caseId}'>;
type CaseRow = Pick<GetResponse<'/api/v1/work-queue'>['items'][number], 'tableSourceIds'>;
type CaseSource = Pick<SourceCase['sources'][number], 'id' | 'name' | 'profile' | 'createdAt'>;

/** The profile the server retains a table under, and the only one its table profile read answers for. */
const TABLE_PROFILE = 'tabular-manual-v1';

export interface CaseTable {
  sourceId: string;
  name: string;
  retainedAt: string | null;
  /** The table page of this source. */
  href: string;
}

/**
 * The retained tables of a case as its read lists them, newest first. `Continue import` opens the table page when
 * there is exactly one, a list of them when there are several, and one sentence with Add files when there is none.
 */
export function caseTables(caseId: string, sources: readonly CaseSource[], row?: CaseRow): CaseTable[] {
  if (row?.tableSourceIds !== undefined) {
    return row.tableSourceIds.map((sourceId) => {
      const source = sources.find((candidate) => candidate.id === sourceId);
      return {
        sourceId, name: source?.name ?? sourceId, retainedAt: source?.createdAt ?? null,
        href: `/studio/work/cases/${caseId}/tables/${sourceId}`,
      };
    });
  }
  return sources
    .filter((source) => source.profile === TABLE_PROFILE)
    .map((source) => ({
      sourceId: source.id, name: source.name, retainedAt: source.createdAt,
      href: `/studio/work/cases/${caseId}/tables/${source.id}`,
    }))
    .sort((left, right) => right.retainedAt.localeCompare(left.retainedAt));
}

const TABLES_ONLY = 'Only a retained table has an import page in the Studio.';

function heldWithoutTable(sourceCount: number): string {
  if (sourceCount === 0) return 'no retained source';
  if (sourceCount === 1) return '1 retained source and no table';
  return `${sourceCount} retained sources and no table`;
}

/** What a case without a table holds, from the count of sources its read lists, and why no page opens for it. */
export function noTableSentence(sourceCount: number): string {
  return `This case holds ${heldWithoutTable(sourceCount)}. ${TABLES_ONLY}`;
}

const NO_CASE = 'The server holds no case at this address.';
const UNREAD_CASE = 'The server did not read this case out';

/** A case read that failed, by the server's code: never its message. */
export function unreadCase(error: unknown): string {
  const { code } = refusalOf(error);
  if (code === 'NOT_FOUND') return NO_CASE;
  return code ? `${UNREAD_CASE} · ${code}` : `${UNREAD_CASE}.`;
}
