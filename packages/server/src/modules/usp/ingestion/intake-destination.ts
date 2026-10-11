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
