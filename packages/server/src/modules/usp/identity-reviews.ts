import type { PoolClient } from 'pg';
import {
  ProjectIdentityReviewSchema, UspIdentityReviewListSchema, UspListIdentityReviewsSchema,
  type IdentityReviewList, type RequestContext,
} from '@ulpin/contracts/usp';
import { transaction } from '../../infrastructure/db';
import { notFound } from '../../infrastructure/errors';
import { fingerprint } from '../cases/domain';
import { assertLocalUsp } from './snapshots';

type Item = IdentityReviewList['items'][number];
type Row = {
  id: string; manifest_id: string; operation: string; command_hash: string; body: unknown;
  created_at: Date; consumed_at: Date | null; used_operation: string | null;
};

/** The site of a recorded registry record in an area that is not archived. Anything else is the 404 of the
 * neighbouring record reads. */
async function recordSiteTx(client: PoolClient, recordId: string): Promise<string> {
  const row = (await client.query(
    `SELECT r.site_id FROM registry_records r JOIN map_areas a ON a.site_id=r.site_id
     WHERE r.id=$1 AND r.revision>0 AND a.archived_at IS NULL`,
    [recordId],
  )).rows[0];
  if (!row) notFound();
  return row.site_id;
}

/**
 * One statement reads the page. A review is selected only when it is of the record's site, its stored command
 * names the record, and the manifest it is bound to was captured under the caller's access view and policy (the
 * manifest checks of readManifest). A review the caller may not read therefore takes no slot of the page and
 * cannot move `truncated`.
 *
 * Newest first is `created_at`, the start of the transaction that stored the review; one transaction stores one
 * review, so equal times are two commands and fall back to the id. The consuming operation is read from the
 * audit row that names the review, as one value, so a review can never fill two rows of the page.
 */
async function pageTx(client: PoolClient, ctx: RequestContext, siteId: string, recordId: string, limit: number) {
  return (await client.query(
    `SELECT r.id,r.manifest_id,r.operation,r.command_hash,r.body,r.created_at,r.consumed_at,
       (SELECT a.operation FROM usp_project_identity_audit a WHERE a.review_id=r.id
        ORDER BY a.created_at,a.id LIMIT 1) AS used_operation
     FROM usp_project_identity_reviews r JOIN usp_snapshots s ON s.id=r.manifest_id
     WHERE r.scope_id=$1 AND s.scope_id=$1 AND s.body->>'accessViewId'=$2 AND s.body->>'policyVersion'=$3
       AND r.body->'recordIds' @> $4::jsonb
     ORDER BY r.created_at DESC,r.id DESC LIMIT $5`,
    [siteId, ctx.accessViewId, ctx.policyVersion, JSON.stringify([recordId]), limit + 1],
  )).rows as Row[];
}

/**
 * The item of a row, or null when the row does not agree with itself: its body is not a review command, its
 * hash is not that command's, its command names another site, manifest or operation or holds no revision for
 * the record, or its consumed time and its audit row do not say the same thing. An assignment refuses such a
 * review, so it is counted and not listed.
 */
function listedItem(row: Row, siteId: string, recordId: string): Item | null {
  const parsed = ProjectIdentityReviewSchema.safeParse(row.body);
  if (!parsed.success || row.command_hash !== fingerprint(parsed.data)) return null;
  const review = parsed.data;
  const expectedRecordVersion = review.expectedVersions[recordId];
  const namesItsRow = review.scope.scopeId === siteId && review.scope.manifestId === row.manifest_id
    && review.operation === row.operation;
  const usedAsAudited = row.used_operation === (row.consumed_at ? review.operation : null);
  if (!namesItsRow || expectedRecordVersion === undefined || !usedAsAudited) return null;
  return {
    reviewId: row.id,
    operation: review.operation,
    reason: review.reason,
    createdAt: new Date(row.created_at).toISOString(),
    scope: review.scope,
    expectedManifestId: row.manifest_id,
    expectedRecordVersion,
    used: row.consumed_at ? { at: new Date(row.consumed_at).toISOString(), operation: review.operation } : null,
    commandSha256: row.command_hash,
  };
}

/**
 * The identity reviews that name one record and that this caller may read, newest first, each with the scope,
 * manifest id and record revision an assignment must name and with what consumed it, if anything has. It writes
 * nothing. The evidence a review cites, its location and its reviewer are not answered.
 *
 * Only stored rows are read. The cited documents of the bound snapshot are not checked here; the assignment
 * that is given a listed review applies its own checks, including that the caller is the reviewer.
 */
export async function listIdentityReviews(ctx: RequestContext, raw: unknown): Promise<IdentityReviewList> {
  assertLocalUsp(ctx);
  const { recordId, limit } = UspListIdentityReviewsSchema.parse(raw);
  return transaction(async client => {
    const siteId = await recordSiteTx(client, recordId);
    const rows = await pageTx(client, ctx, siteId, recordId, limit);
    const page = rows.slice(0, limit);
    const items = page.flatMap(row => listedItem(row, siteId, recordId) ?? []);
    return UspIdentityReviewListSchema.parse({
      recordId, siteId, items, truncated: rows.length > limit, unreadable: page.length - items.length,
    });
  });
}
