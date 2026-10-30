import type { PoolClient } from 'pg';
import type { MapArea } from '@ulpin/contracts';
import type { MappingDestination } from '@ulpin/contracts/usp';
import { AppError } from '../../../infrastructure/errors';
import { query } from '../../../infrastructure/db';
import { fingerprint } from '../../cases/domain';
import { getArea } from '../../areas/areas';

/** The intake's proposal, not a new destination policy. */
export function intakeDestination(gis: { suggestedTitle: string; suggestedNamespace: string },
  area: MapArea | null): MappingDestination {
  const named = { name: gis.suggestedTitle, namespace: gis.suggestedNamespace };
  if (!area) return { kind: 'new_area', ...named };
  return { kind: 'existing_area', areaId: area.id, expectedAreaRevision: area.revision,
    referenceFingerprint: fingerprint(area.reference || null), ...named };
}

type AreaLookup = (sql: string, values: string[]) => Promise<{ id: string } | undefined>;
type HolderLookup = (sql: string, values: string[]) => Promise<{ own: boolean }[]>;

/** The areas that hold a file namespace by seed or by feature link, and whether each is this case's live area: its
 * site's, or one a source of this case records as its own (S9.5a). */
const HOLDERS = `SELECT COALESCE(a.archived_at IS NULL AND (a.site_id=c.site_id OR a.id::text IN (
    SELECT s.inspection->'intakeOwnArea'->>'areaId' FROM sources s WHERE s.case_id=c.id)),false) own
  FROM map_areas a JOIN cases c ON c.id=$3
  WHERE a.seed_key=$1 OR a.id IN (SELECT area_id FROM source_feature_links WHERE namespace=$2)`;

/** G20. The same bytes in a new case make that case's own area: a file namespace held only by another case's
 * area, or by a retired one, is scoped to this case, so no seed or feature link reaches that area. A namespace
 * this case's live area holds stays, and the duplicate refusal stays within the case. */
export async function caseScopedDestination<T extends { namespace: string; name: string } | null>(
  caseId: string, value: T, lookup: HolderLookup = async (sql, values) =>
    (await query<{ own: boolean }>(sql, values)).rows): Promise<T> {
  if (!value?.namespace.startsWith('file:') || value.namespace.includes(':case:')) return value;
  const holders = await lookup(HOLDERS, [`${value.namespace}:${value.name}`, value.namespace, caseId]);
  if (!holders.length || holders.some(holder => holder.own)) return value;
  return { ...value, namespace: `${value.namespace}:case:${caseId}` };
}

type NameLookup = (sql: string, values: string[]) => Promise<{ name: string } | undefined>;

/** The case's retired area that holds an import of these bytes: the area this file made in this batch. */
const RETIRED_FILE_AREA = `SELECT a.name FROM cases c JOIN map_areas a ON a.site_id=c.site_id
  WHERE c.id=$1 AND a.archived_at IS NOT NULL
    AND EXISTS (SELECT 1 FROM import_packages p WHERE p.area_id=a.id AND p.body->>'sourceHash'=$2)`;

/** G20B. A drop of a file whose area in this batch is retired rests in these words and changes nothing; a new
 * batch gives the file its own area (G20). Null while the file has no retired area in this batch. */
export async function retiredFileAreaWords(caseId: string, sha256: string, lookup: NameLookup =
  async (sql, values) => (await query<{ name: string }>(sql, values)).rows[0]): Promise<string | null> {
  const area = await lookup(RETIRED_FILE_AREA, [caseId, sha256]);
  return area ? `The area this file made in this batch (${area.name}) is retired; nothing new is prepared from it `
    + 'here. Start a new batch to read this file again.' : null;
}

/** The recipe path's same-bytes duplicate is refused in those words instead of resting on the old source. */
export async function refuseRetiredFileAreaTx(client: PoolClient, caseId: string, sha256: string): Promise<void> {
  const words = await retiredFileAreaWords(caseId, sha256,
    async (sql, values) => (await client.query<{ name: string }>(sql, values)).rows[0]);
  if (words) throw new AppError(409, 'AREA_RETIRED', words);
}

export async function intakeCaseArea(caseId: string, lookup: AreaLookup = async (sql, values) =>
  (await query<{ id: string }>(sql, values)).rows[0]): Promise<MapArea | null> {
  const row = await lookup('SELECT a.id FROM cases c JOIN map_areas a ON a.site_id=c.site_id WHERE c.id=$1', [caseId]);
  return row ? getArea(row.id) : null;
}

/** Authoring without a destination uses the same stored suggestion and case-area lookup as intake. */
export async function authoredIntakeDestination(caseId: string, suggestion: unknown): Promise<MappingDestination> {
  const gis = suggestion as { suggestedTitle?: unknown; suggestedNamespace?: unknown } | null;
  if (!gis || typeof gis.suggestedTitle !== 'string' || !gis.suggestedTitle.trim()
    || typeof gis.suggestedNamespace !== 'string' || !gis.suggestedNamespace.trim())
    throw new AppError(422, 'MAPPING_DESTINATION_UNAVAILABLE',
      'This source has no stored GIS destination suggestion. Choose a destination explicitly.');
  return intakeDestination({ suggestedTitle: gis.suggestedTitle, suggestedNamespace: gis.suggestedNamespace },
    await intakeCaseArea(caseId));
}
