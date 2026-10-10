import type { PoolClient } from 'pg';
import {
  UspBuildingSnapshotListSchema, UspListBuildingSnapshotsSchema, UspSnapshotManifestSchema,
  type BuildingSnapshotList, type RequestContext, type SnapshotManifest,
} from '@ulpin/contracts/usp';
import { transaction } from '../../infrastructure/db';
import { notFound } from '../../infrastructure/errors';
import { assertLocalUsp } from './snapshots';

type Item = BuildingSnapshotList['items'][number];
type Row = { id: string; digest: string; body: unknown; created_at: Date };

/** The site of a building under the rule of the building ledger: a building feature, recorded or proposed, in
 * an area that is not archived. Anything else is the neighbouring reads' 404. */
async function buildingSiteTx(client: PoolClient, buildingId: string): Promise<string> {
  const row = (await client.query(
    `SELECT a.site_id FROM physical_features f JOIN map_areas a ON a.id=f.area_id
     WHERE f.id=$1 AND f.revision>=0 AND f.body->>'kind'='building' AND a.archived_at IS NULL`,
    [buildingId],
  )).rows[0];
  if (!row) notFound('Building not found.');
  return row.site_id;
}

/**
 * One statement reads the page. A snapshot is selected only when it is of the building's site, was captured
 * under the caller's access view and policy (the manifest checks of readManifest) and lists the building as a
 * member. A snapshot the caller may not read, or one that does not hold the building, therefore takes no slot
 * of the page and cannot move `truncated`.
 *
 * Newest first is the capture time the manifest states, because `created_at` is the start of the transaction
 * and one command can store two snapshots in it. The time is compared as text in byte order, which is
 * chronological for the UTC form the capture writes and, unlike a cast, cannot fail on a damaged value. A body
 * without it is ordered last. Equal capture times fall back to `created_at` and then the id.
 */
async function pageTx(client: PoolClient, ctx: RequestContext, siteId: string, buildingId: string, limit: number) {
  const member = JSON.stringify([{ pin: { ref: { namespace: 'area_feature', id: buildingId } } }]);
  return (await client.query(
    `SELECT id,digest,body,created_at FROM usp_snapshots
     WHERE scope_id=$1 AND body->>'accessViewId'=$2 AND body->>'policyVersion'=$3
       AND body->'members' @> $4::jsonb
     ORDER BY (body->>'capturedAt') COLLATE "C" DESC NULLS LAST,created_at DESC,id DESC LIMIT $5`,
    [siteId, ctx.accessViewId, ctx.policyVersion, member, limit + 1],
  )).rows as Row[];
}

/** The stored manifest of a row, or null when the body fails the published schema or its scope does not name
 * the row that holds it. Such a scope could not be passed on, so the row is counted and not listed. */
function storedManifest(row: Row, siteId: string): SnapshotManifest | null {
  const parsed = UspSnapshotManifestSchema.safeParse(row.body);
  if (!parsed.success) return null;
  const { scope } = parsed.data;
  const namesItsRow = scope.manifestId === row.id && scope.snapshotDigest === row.digest && scope.scopeId === siteId;
  return namesItsRow ? parsed.data : null;
}

/** Counts come from the stored members only. A document result that was not current is the freshness written
 * at capture, never a fresh check. */
function listedItem(row: Row, manifest: SnapshotManifest): Item {
  const notCurrent = manifest.members.filter(member => member.documentResult?.current === false);
  return {
    scope: manifest.scope,
    createdAt: new Date(row.created_at).toISOString(),
    capturedAt: manifest.capturedAt,
    members: { total: manifest.members.length, documentResultNotCurrent: notCurrent.length },
  };
}

/**
 * The recorded snapshots that hold one building and that this caller may read, newest capture first, each with
 * the scope its manifest stores, so a client can pass that scope unchanged to the other USP reads. It writes
 * nothing and makes no statement about recency beyond the order.
 *
 * Only stored manifests are read. The cited documents of a snapshot are not checked here, so one document that
 * moved on or became unavailable cannot fail the list; a read that is given a listed scope still applies its own
 * document checks.
 */
export async function listBuildingSnapshots(ctx: RequestContext, raw: unknown): Promise<BuildingSnapshotList> {
  assertLocalUsp(ctx);
  const { buildingId, limit } = UspListBuildingSnapshotsSchema.parse(raw);
  return transaction(async client => {
    const siteId = await buildingSiteTx(client, buildingId);
    const rows = await pageTx(client, ctx, siteId, buildingId, limit);
    const page = rows.slice(0, limit);
    const items = page.flatMap(row => {
      const manifest = storedManifest(row, siteId);
      return manifest ? [listedItem(row, manifest)] : [];
    });
    return UspBuildingSnapshotListSchema.parse({
      buildingId, siteId, items, truncated: rows.length > limit, unreadable: page.length - items.length,
    });
  });
}
