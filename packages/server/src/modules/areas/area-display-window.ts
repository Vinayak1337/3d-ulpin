import type { PoolClient } from 'pg';
import type {
  AreaDisplaySummary, AreaDisplayWindow, AreaGeometry, AreaHeight, AreaWindowFeature, MapArea,
} from '@ulpin/contracts';
import { transaction } from '../../infrastructure/db';
import { AppError } from '../../infrastructure/errors';
import { AREA_DISPLAY_LIMIT, getArea } from './areas';

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
const SUMMARY_SQL = `SELECT s.n feature_count,ST_XMin(s.box) min_x,ST_YMin(s.box) min_y,ST_XMax(s.box) max_x,
  ST_YMax(s.box) max_y FROM (SELECT count(*)::integer n,ST_Extent(${LOCAL}) box FROM physical_features f
  WHERE ${MEMBERS}) s`;
// The window is moved into EPSG:4326 once, so the GiST index on geographic_geometry serves the filter.
const WINDOW_SQL = `WITH win AS (SELECT ST_Transform(ST_MakeEnvelope(
    $5::double precision+$3::double precision,$6::double precision+$4::double precision,
    $7::double precision+$3::double precision,$8::double precision+$4::double precision,$2::integer),4326) g)
  SELECT f.id,f.identifier,f.body->>'kind' kind,f.body->'height' height,
    CASE WHEN f.area_id=$1 THEN f.body->'geometry' ELSE ST_AsGeoJSON(${LOCAL},9,0)::jsonb END geometry
  FROM physical_features f,win WHERE ${MEMBERS} AND ST_Intersects(f.geographic_geometry,win.g)
    AND ($9::text IS NULL OR f.identifier>$9::text)
  ORDER BY f.identifier LIMIT $10`;

type WindowRow = {
  id: string; identifier: string; kind: AreaWindowFeature['kind']; height: AreaHeight | null;
  geometry: AreaGeometry | null;
};

/** One bounded read-only transaction per display read, as the area's other bounded reads. */
async function boundedRead<T>(
  areaId: string, read: (client: PoolClient, frame: unknown[], area: MapArea) => Promise<T>,
) {
  return transaction(async client => {
    await client.query("SET LOCAL statement_timeout='15s'");
    const area = await getArea(areaId, client);
    if (!area.reference) {
      throw new AppError(409, 'AREA_REFERENCE',
        'This area has no reference system, so its features have no place on the map to read by window.');
    }
    const frame = [area.id, Number(area.reference.analysisCrs.split(':')[1]), ...area.reference.origin];
    return read(client, frame, area);
  }, undefined, 'repeatable_read_only');
}

/** How many features the area holds to draw and where they lie, so a map can place itself before reading them. */
export async function areaDisplaySummary(areaId: string): Promise<AreaDisplaySummary> {
  return boundedRead(areaId, async (client, frame, area) => {
    const row = (await client.query(SUMMARY_SQL, frame)).rows[0];
    const extent = row.min_x === null ? null : [row.min_x, row.min_y, row.max_x, row.max_y] as [
      number, number, number, number,
    ];
    return {
      areaId: area.id, areaRevision: area.revision, featureCount: row.feature_count, extent,
      displayLimit: AREA_DISPLAY_LIMIT,
    };
  });
}

/** One keyset page, by identifier, of the features meeting a window in the area's local metres. */
export async function areaDisplayWindow(areaId: string, window: DisplayWindow): Promise<AreaDisplayWindow> {
  return boundedRead(areaId, async (client, frame, area) => {
    const { minX, minY, maxX, maxY, after, limit } = window;
    const rows = (await client.query<WindowRow>(WINDOW_SQL,
      [...frame, minX, minY, maxX, maxY, after ?? null, limit + 1])).rows;
    const page = rows.slice(0, limit);
    return {
      areaId: area.id, areaRevision: area.revision, features: page.map(windowFeature),
      next: rows.length > limit ? page[page.length - 1].identifier : null,
    };
  });
}

function windowFeature(row: WindowRow): AreaWindowFeature {
  const stated = row.height && row.height.state !== 'unknown' && typeof row.height.value === 'number';
  return {
    id: row.id, identifier: row.identifier, kind: row.kind, polygons: outline(row.geometry),
    heightM: stated ? row.height!.value : null, heightState: row.height?.state ?? 'unknown',
  };
}

/** Polygon outlines as plan rings; lines, points and missing geometry have no outline to draw. */
function outline(geometry: AreaGeometry | null): AreaWindowFeature['polygons'] {
  const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates]
    : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
  return polygons.map(polygon => polygon.map(ring => ring.map(([x, y]) => [x, y] as [number, number])));
}
