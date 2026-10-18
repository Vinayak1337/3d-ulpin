import type { PoolClient } from 'pg';
import type {
  AreaDisplaySummary, AreaDisplayWindow, AreaGeometry, AreaHeight, AreaWindowFeature, MapArea,
} from '@ulpin/contracts';
import { transaction } from '../../infrastructure/db';
import { AppError } from '../../infrastructure/errors';
import {
  areaProposals, type ProposalFeature, type ProposalPackage, type RuleCondition,
} from './area-display-proposals';
import { AREA_DISPLAY_LIMIT, areaDisplayPackages, getArea } from './areas';

export type DisplayWindow = {
  minX: number; minY: number; maxX: number; maxY: number; after?: string; limit: number;
};

/** The same membership as an area's other reads: its own recorded features and its explicit group members. */
const MEMBERS = `f.revision>0 AND (f.area_id=$1 OR EXISTS (
  SELECT 1 FROM block_group_memberships m JOIN block_groups g ON g.id=m.group_id
  WHERE m.feature_id=f.id AND g.area_id=$1
))`;
/** A geographic geometry in the area's local metres: its analysis CRS translated by its origin. */
const LOCAL = `ST_Translate(ST_Transform(f.geographic_geometry,$2::integer),
  -($3::double precision),-($4::double precision))`;
/** The area's unrecorded proposals, chosen by areaProposals and passed as parallel package and feature identifiers
 * from parameter $n, as their packages hold them. A draft row's outline is its package's, so it is taken from the
 * row; a correction of a recorded feature, or a draft written before rows held outlines, is read from its package. */
const proposed = (n: number) => `proposed AS (SELECT f.id,f.identifier,e.feature body,
    coalesce(CASE WHEN f.revision=0 THEN f.geographic_geometry END,
      ST_SetSRID(ST_GeomFromGeoJSON(e.feature->'geographicGeometry'),4326)) geographic_geometry
  FROM import_packages p CROSS JOIN LATERAL jsonb_array_elements(p.body->'features') e(feature)
  JOIN unnest($${n}::uuid[],$${n + 1}::uuid[]) c(package_id,feature_id)
    ON c.package_id=p.id AND c.feature_id=(e.feature->>'id')::uuid
  JOIN physical_features f ON f.id=c.feature_id WHERE p.id=ANY($${n}::uuid[]))`;
/** The window from parameters $5 to $8 in the area's local metres, moved into EPSG:4326 once. */
const ENVELOPE = `ST_Transform(ST_MakeEnvelope(
    $5::double precision+$3::double precision,$6::double precision+$4::double precision,
    $7::double precision+$3::double precision,$8::double precision+$4::double precision,$2::integer),4326)`;
/** The package features a window read gives the proposal rule: the drafts whose outline meets the window, found by
 * the GiST index on geographic_geometry, and every feature whose row holds no draft outline. */
const DRAWABLE = `(e->>'id')::uuid IN (SELECT id FROM physical_features WHERE revision=0
    AND ST_Intersects(geographic_geometry,${ENVELOPE}))
  OR (e->>'id')::uuid IN (SELECT id FROM physical_features WHERE area_id=$1
    AND (revision>0 OR geographic_geometry IS NULL))`;
const SUMMARY_SQL = `WITH ${proposed(5)}, drawn AS (
    SELECT f.geographic_geometry FROM physical_features f WHERE ${MEMBERS} AND f.id<>ALL($6::uuid[])
    UNION ALL SELECT geographic_geometry FROM proposed)
  SELECT s.n feature_count,ST_XMin(s.box) min_x,ST_YMin(s.box) min_y,ST_XMax(s.box) max_x,
  ST_YMax(s.box) max_y FROM (SELECT count(*)::integer n,ST_Extent(${LOCAL}) box FROM drawn f) s`;
// The window is moved into EPSG:4326 once, so the GiST index on geographic_geometry serves the recorded filter.
const WINDOW_SQL = `WITH win AS (SELECT ${ENVELOPE} g),
  ${proposed(11)}
  SELECT * FROM (SELECT f.id,f.identifier,f.body->>'kind' kind,f.body->'height' height,
      CASE WHEN f.area_id=$1 THEN f.body->'geometry' ELSE ST_AsGeoJSON(${LOCAL},9,0)::jsonb END geometry,
      'recorded' display_state
    FROM physical_features f,win WHERE ${MEMBERS} AND f.id<>ALL($12::uuid[])
      AND ST_Intersects(f.geographic_geometry,win.g) AND ($9::text IS NULL OR f.identifier>$9::text)
    UNION ALL SELECT p.id,p.identifier,p.body->>'kind',p.body->'height',p.body->'geometry','unrecorded_proposal'
    FROM proposed p,win WHERE ST_Intersects(p.geographic_geometry,win.g)
      AND ($9::text IS NULL OR p.identifier>$9::text)) d
  ORDER BY d.identifier LIMIT $10`;

type WindowRow = {
  id: string; identifier: string; kind: AreaWindowFeature['kind']; height: AreaHeight | null;
  geometry: AreaGeometry | null; display_state: AreaWindowFeature['displayState'];
};

const READ_TIMEOUT_MS = 15000;

/** One bounded read-only transaction per display read, as the area's other bounded reads, given the area's
 * proposals as the context read chooses them; with a window, only those the window can draw. A signal that
 * fires (the client closed the request) cancels the running statement and frees the pooled connection. */
async function boundedRead<T>(
  areaId: string, read: (client: PoolClient, frame: unknown[], area: MapArea, proposals: unknown[]) => Promise<T>,
  box?: number[], signal?: AbortSignal,
) {
  const deadline = signal && { deadlineAt: Date.now() + READ_TIMEOUT_MS, signal };
  return transaction(async client => {
    await client.query("SET LOCAL statement_timeout='15s'");
    const area = await getArea(areaId, client);
    if (!area.reference) {
      throw new AppError(409, 'AREA_REFERENCE',
        'This area has no reference system, so its features have no place on the map to read by window.');
    }
    const frame = [area.id, Number(area.reference.analysisCrs.split(':')[1]), ...area.reference.origin];
    const kept = box && { sql: DRAWABLE, values: [...frame.slice(1), ...box] };
    return read(client, frame, area, await chosenProposals(client, area, kept));
  }, deadline, 'repeatable_read_only');
}

/** The proposals the context read would draw, as parallel package and feature identifiers. */
async function chosenProposals(client: PoolClient, area: MapArea, kept?: RuleCondition) {
  const packages: ProposalPackage<ProposalFeature>[] = await areaDisplayPackages(client, area.id, true, kept);
  const chosen = (await areaProposals(client, area, packages))
    .flatMap(({ packageId, features }) => features.map(feature => [packageId, feature.id]));
  return [chosen.map(([packageId]) => packageId), chosen.map(([, featureId]) => featureId)];
}

/** How many features the area holds to draw and where they lie, so a map can place itself before reading them. */
export async function areaDisplaySummary(areaId: string, signal?: AbortSignal): Promise<AreaDisplaySummary> {
  return boundedRead(areaId, async (client, frame, area, proposals) => {
    const row = (await client.query(SUMMARY_SQL, [...frame, ...proposals])).rows[0];
    const extent = row.min_x === null ? null : [row.min_x, row.min_y, row.max_x, row.max_y] as [
      number, number, number, number,
    ];
    return {
      areaId: area.id, areaRevision: area.revision, featureCount: row.feature_count, extent,
      displayLimit: AREA_DISPLAY_LIMIT,
    };
  }, undefined, signal);
}

/** One keyset page, by identifier, of the features meeting a window in the area's local metres. */
export async function areaDisplayWindow(
  areaId: string, window: DisplayWindow, signal?: AbortSignal,
): Promise<AreaDisplayWindow> {
  return boundedRead(areaId, async (client, frame, area, proposals) => {
    const { minX, minY, maxX, maxY, after, limit } = window;
    const rows = (await client.query<WindowRow>(WINDOW_SQL,
      [...frame, minX, minY, maxX, maxY, after ?? null, limit + 1, ...proposals])).rows;
    const page = rows.slice(0, limit);
    return {
      areaId: area.id, areaRevision: area.revision, features: page.map(windowFeature),
      next: rows.length > limit ? page[page.length - 1].identifier : null,
    };
  }, [window.minX, window.minY, window.maxX, window.maxY], signal);
}

function windowFeature(row: WindowRow): AreaWindowFeature {
  const stated = row.height && row.height.state !== 'unknown' && typeof row.height.value === 'number';
  return {
    id: row.id, identifier: row.identifier, kind: row.kind, polygons: outline(row.geometry),
    heightM: stated ? row.height!.value : null, heightState: row.height?.state ?? 'unknown',
    displayState: row.display_state,
  };
}

/** Polygon outlines as plan rings; lines, points and missing geometry have no outline to draw. */
function outline(geometry: AreaGeometry | null): AreaWindowFeature['polygons'] {
  const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates]
    : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
  return polygons.map(polygon => polygon.map(ring => ring.map(([x, y]) => [x, y] as [number, number])));
}
