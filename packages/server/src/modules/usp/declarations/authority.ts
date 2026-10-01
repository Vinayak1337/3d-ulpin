import type { PoolClient } from 'pg';
import { z } from 'zod';
import type { DeclarationInput, DeclarationEvidence, RequestContext, SnapshotScope, TargetPin } from '@ulpin/contracts/usp';
import { AppError, conflict } from '../../../infrastructure/errors';
import { canonical, fingerprint } from '../../cases/domain';
import { documentAuthorityTx } from '../ingestion/document-authority';

export function declarationEvidence(input: DeclarationInput): readonly DeclarationEvidence[] {
  return [input.instrument, input.population.evidence, input.denominator.evidence, ...input.entries.map(e => e.evidence)];
}
/** Case-first, then the existing recording mutex, then any source/registry row locks. */
export async function lockDeclarationSiteTx(client: PoolClient, siteId: string) {
  z.uuid().parse(siteId);
  // Include retained copied-source lineage before taking the recording mutex;
  // document authority may protect those parent cases later in this transaction.
  const cases = await client.query(`WITH RECURSIVE evidence_sources AS (
    SELECT s.id,s.case_id,s.inspection FROM sources s JOIN cases c ON c.id=s.case_id WHERE c.site_id=$1
    UNION SELECT p.id,p.case_id,p.inspection FROM sources p JOIN evidence_sources s
      ON p.id::text=s.inspection #>> '{copiedFrom,sourceRevisionId}'
  ) SELECT id FROM cases WHERE site_id=$1 OR id IN(SELECT case_id FROM evidence_sources)
    ORDER BY id LIMIT 2001 FOR SHARE`, [siteId]);
  if (cases.rows.length > 2000) throw new AppError(413, 'DECLARATION_CASE_LIMIT', 'Select a smaller source scope.');
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('physical-area-recording',0))");
  await client.query('SELECT id FROM registry_sites WHERE id=$1 FOR SHARE', [siteId]);
}
/** Only new operations need a write fence. Authorized receipt replay is read-only. */
export async function lockDeclarationFenceTx(client: PoolClient, siteId: string) {
  // REPEATABLE READ starts before a waiting advisory lock. A modified fence
  // causes PostgreSQL to reject that old view (40001), including insert-only
  // declaration/applicability changes that do not change registry rows.
  await client.query('INSERT INTO usp_declaration_scope_fences(site_id) VALUES($1) ON CONFLICT DO NOTHING', [siteId]);
  await client.query('SELECT fence FROM usp_declaration_scope_fences WHERE site_id=$1 FOR UPDATE', [siteId]);
}
export async function assertDeclarationEvidenceTx(client: PoolClient, ctx: RequestContext, scope: SnapshotScope,
  evidence: readonly DeclarationEvidence[], protect: boolean, mode: 'exact' | 'replay' = 'exact') {
  const verified = new Set<string>();
  for (const e of evidence) {
    if (e.pointer.sourceRevision.ref.namespace !== 'source_revision') conflict('Expected an exact instrument source.');
    if (e.pointer.partRevision || e.pointer.assetRevision)
      throw new AppError(422, 'DECLARATION_PART_PROFILE', 'Use an exact original source receipt and explicit locator; extracted part/asset authority is outside this profile.');
    const id = e.pointer.sourceRevision.ref.id;
    z.uuid().parse(id);
    const receiptKey = `${id}@${e.pointer.sourceRevision.revision}:${e.sha256}:${e.bytes}`;
    if (verified.has(receiptKey)) continue;
    const captured = (await client.query(`SELECT body,body_sha256 FROM usp_snapshot_bodies
      WHERE manifest_id=$1 AND namespace='source_revision' AND object_id=$2 AND revision=$3`,
      [scope.manifestId, id, e.pointer.sourceRevision.revision])).rows[0];
    if (!captured || fingerprint(captured.body) !== captured.body_sha256) conflict('The exact source is absent from the snapshot.');
    const row = (await client.query(`SELECT * FROM sources WHERE id=$1${protect ? ' FOR SHARE' : ''}`, [id])).rows[0];
    const source = captured.body;
    if (source.id !== id || source.revision !== e.pointer.sourceRevision.revision
      || source.sha256 !== e.sha256 || Number(source.bytes) !== e.bytes) conflict('The retained source receipt is unavailable.');
    if (!row || row.case_id !== source.case_id)
      throw new AppError(403, 'DECLARATION_SOURCE_DENIED', 'The retained source context is unavailable.');
    if (mode === 'exact' && (row.revision !== e.pointer.sourceRevision.revision || row.sha256 !== e.sha256
      || Number(row.bytes) !== e.bytes || row.object_key !== source.object_key)) conflict('The source revision or byte receipt changed.');
    const site = (await client.query('SELECT site_id,archived FROM cases WHERE id=$1', [row.case_id])).rows[0];
    if (!site || site.site_id !== scope.scopeId || site.archived !== false || typeof row.object_key !== 'string' || !row.object_key)
      throw new AppError(403, 'DECLARATION_SOURCE_DENIED', 'The source is unavailable in this site.');
    // The legacy document helper may return false for an unmarked lineage.
    // Do not let that bypass active-case boundaries for contributing parents.
    const roots = mode === 'replay' ? [source, row] : [row];
    for (const root of roots) {
      const seen = new Set<string>([id]);
      let parentId = root.inspection?.copiedFrom?.sourceRevisionId;
      while (parentId) {
        if (typeof parentId !== 'string' || seen.has(parentId) || seen.size >= 8)
          throw new AppError(403, 'DECLARATION_SOURCE_DENIED', 'The source lineage is unavailable.');
        seen.add(parentId);
        const parent = (await client.query(`SELECT * FROM sources WHERE id=$1${protect ? ' FOR SHARE' : ''}`, [parentId])).rows[0];
        const parentCase = parent && (await client.query('SELECT site_id,archived FROM cases WHERE id=$1', [parent.case_id])).rows[0];
        if (!parent || !parentCase || parentCase.site_id !== scope.scopeId || parentCase.archived !== false)
          throw new AppError(403, 'DECLARATION_SOURCE_DENIED', 'The source lineage is unavailable in this site.');
        if (mode === 'replay') await documentAuthorityTx(client, parent, 'original', new Set(), protect);
        parentId = parent.inspection?.copiedFrom?.sourceRevisionId;
      }
    }
    // Marked documents enforce canonical input/job/lineage authority; legacy
    // sources still require the explicit existence/site/hash checks above.
    // Replay discloses an immutable receipt, not a new source-derived result.
    // Check current original access/binding without requiring old extraction,
    // source revision, case revision or reader pins to remain current.
    await documentAuthorityTx(client, mode === 'replay' ? row : source,
      mode === 'replay' ? 'original' : 'snapshot', new Set(), protect);
    if (ctx.principal.mode !== 'local_demo') throw new AppError(403, 'DECLARATION_SOURCE_DENIED', 'The source is unavailable.');
    verified.add(receiptKey);
  }
}
export async function assertPopulationTx(client: PoolClient, siteId: string, targets: readonly TargetPin[], protect: boolean) {
  const ids = [...new Set(targets.map(p => p.ref.id))].sort();
  for (const id of ids) z.uuid().parse(id);
  const records = (await client.query(`SELECT r.id,r.revision,r.kind,c.status AS project_status
    FROM registry_records r LEFT JOIN usp_project_codes c ON c.record_id=r.id
    WHERE r.site_id=$1 AND r.id=ANY($2::uuid[]) ORDER BY r.id${protect ? ' FOR SHARE OF r' : ''}`, [siteId, ids])).rows;
  for (const pin of targets) {
    const record = records.find(r => r.id === pin.ref.id);
    if (pin.ref.namespace !== 'registry_record' || !record || record.revision !== pin.revision
      || ['retired', 'cancelled_error'].includes(record.project_status)) conflict('A declaration member changed or is unavailable.');
  }
}
export const equalPin = (a: TargetPin, b: TargetPin) => canonical(a) === canonical(b);
