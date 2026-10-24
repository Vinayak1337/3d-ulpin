import type { RegistryRecord } from '@ulpin/contracts';
import { normalizeProjectCode } from '@ulpin/contracts/usp';
import { query } from '../../infrastructure/db';
import { AppError } from '../../infrastructure/errors';

export type SourceProjectCode = { code: string; actor: string };
const sourceSpaces = (records: RegistryRecord[]) => records.filter(record => record.kind === 'space'
  && 'sourceOnly' in record && record.revision > 0);
const stale = () => new AppError(409, 'CANONICAL_CURRENT_ONLY', 'A recorded source child changed during projection.');

/** Only the assigned P3 authority is read, including its check symbol; no identifier is synthesized here. */
export async function readSourceProjectCodes(records: RegistryRecord[], siteId: string) {
  const spaces = sourceSpaces(records);
  const codes = new Map<string, SourceProjectCode>();
  if (!spaces.length) return codes;
  const rows = (await query(`SELECT c.record_id,c.code,c.status,r.revision,s.version,v.reviewer_subject
    FROM usp_project_codes c JOIN registry_records r ON r.id=c.record_id
    JOIN usp_project_identity_state s ON s.record_id=c.record_id
    JOIN usp_project_identity_reviews v ON v.id=s.review_id
    WHERE c.record_id=ANY($1::uuid[]) AND c.scope_id=$2 AND r.site_id=$2 AND r.kind='space'`,
  [spaces.map(record => record.id), siteId])).rows;
  for (const row of rows) {
    if (row.status !== 'assigned') continue;
    const record = spaces.find(record => record.id === row.record_id)!;
    if (Number(row.revision) !== record.revision || Number(row.version) !== record.revision) throw stale();
    if (normalizeProjectCode(row.code) !== row.code) {
      throw new AppError(503, 'CANONICAL_PROJECT_CODE', 'The exact assigned P3 code failed its check.');
    }
    codes.set(record.id, { code: row.code, actor: row.reviewer_subject });
  }
  return codes;
}

/** A P3 write bumps its space, not the building feature; recheck children as well as the existing root guard. */
export async function assertSourceChildRevisions(records: RegistryRecord[], siteId: string) {
  const children = records.filter(record => 'sourceOnly' in record);
  if (!children.length) return;
  const rows = (await query('SELECT id,revision FROM registry_records WHERE id=ANY($1::uuid[]) AND site_id=$2',
    [children.map(record => record.id), siteId])).rows;
  if (rows.length !== children.length || rows.some(row => Number(row.revision)
    !== children.find(record => record.id === row.id)?.revision)) throw stale();
}
