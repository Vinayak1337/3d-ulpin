import { readSourceCase, type TableFromOriginalBody } from './retain';
import type { useFollowTable, Opened } from './useFollowTable';
export type Kept = { current: { caseId: string; sourceId: string; body: TableFromOriginalBody | null } | null };
type Follow = ReturnType<typeof useFollowTable>['follow'];

/**
 * TB2: a table dropped alone is kept first, through the uploads route at any size, and then read from that kept
 * original; the server reads it whole, or as a stream past the whole-file bound. The original is uploaded once per
 * case: a retry only asks the server to read it again, and a read that stopped is asked for with a new request key.
 */
export async function readKeptTable(caseId: string, selection: TableFromOriginalBody['selection'], kept: Kept,
  upload: (caseId: string) => Promise<string | null>, follow: Follow): Promise<Opened> {
  if (kept.current?.caseId !== caseId) {
    const sourceId = await upload(caseId);
    if (!sourceId) throw new Error('The upload was cancelled; nothing was imported.');
    kept.current = { caseId, sourceId, body: null };
  }
  const current = kept.current;
  if (JSON.stringify(current.body?.selection) !== JSON.stringify(selection)) current.body = null;
  const body = current.body ??= { requestKey: crypto.randomUUID(),
    expectedWorkspaceRevision: (await readSourceCase(caseId)).revision, selection };
  return follow(caseId, current.sourceId, body, () => { current.body = null; });
}
