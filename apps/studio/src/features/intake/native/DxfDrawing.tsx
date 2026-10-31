type Field = { state: string; tags: { code: number; value: number }[] };
type Fields = Record<string, Field | undefined>;
type Vertex = { fields?: Fields; position?: Field; bulge?: Field };
type Entity = { type: string; status: string; fields: Fields; vertices?: Vertex[]; space?: { kind: string } };
export type DxfInspection = { units: { state: string; code: number | null; name: string | null };
  entities: Entity[] };

const value = (field: Field | undefined, code: number) => field?.tags?.find(tag => tag.code === code)?.value;
const xy = (field: Field | undefined, x = 10, y = 20) => [value(field, x), value(field, y)];
const bulged = (field: Field | undefined) => field?.state === 'supplied' && value(field, 42) !== 0;

/** Stored straight edges only. No curve flattening, block expansion, unit conversion or placement. */
function edges(entity: Entity): { points: number[][]; closed: boolean; reason?: string } {
  const fields = entity.fields;
  const flags = value(fields.flags, 70) ?? 0;
  const vertices = entity.vertices ?? [];
  const closed = entity.type !== 'LINE' && Boolean(flags & 1);
  const refuse = (reason?: string) => ({ points: [], closed, reason });
  if (!['LINE', 'LWPOLYLINE', 'POLYLINE'].includes(entity.type)) return refuse();
  if (entity.status !== 'supported' || entity.space?.kind === 'block_definition') return refuse();
  const wcs = entity.type === 'LINE' || (entity.type === 'POLYLINE' && Boolean(flags & 8));
  const extrusion = fields.extrusion;
  if (!wcs && extrusion && extrusion.state !== 'absent'
    && ![210, 220, 230].every((code, at) => value(extrusion, code) === [0, 0, 1][at])) return refuse('OCS');
  if (entity.type === 'POLYLINE' && flags & (2 | 4 | 16 | 64)) return refuse();
  if (vertices.some(vertex => bulged(vertex.fields?.bulge ?? vertex.bulge))) return refuse('bulged');
  const points = entity.type === 'LINE' ? [xy(fields.start), xy(fields.end, 11, 21)]
    : vertices.map(vertex => xy(vertex.fields?.position ?? vertex.position));
  if (points.length < 2 || points.some(point => !point.every(Number.isFinite))) return refuse();
  return { points: points as number[][], closed };
}

/** One path per whole entity, bounded by segments rather than by SVG element count. */
export function dxfDrawing(inspection: DxfInspection) {
  const paths: string[] = [];
  const notDrawn: Record<string, number> = {};
  let segments = 0;
  let omittedSegments = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const entity of inspection.entities) {
    const { points, closed, reason } = edges(entity);
    const size = points.length ? points.length - 1 + Number(closed) : 0;
    if (!size || segments + size > 50_000) {
      const category = size ? `${entity.type} (segment limit)` : `${entity.type}${reason ? ` (${reason})` : ''}`;
      notDrawn[category] = (notDrawn[category] ?? 0) + 1;
      omittedSegments += size;
      continue;
    }
    segments += size;
    for (const [x, y] of points) {
      minX = Math.min(minX, x!);
      maxX = Math.max(maxX, x!);
      minY = Math.min(minY, y!);
      maxY = Math.max(maxY, y!);
    }
    paths.push(points.map(([x, y], at) => `${at ? 'L' : 'M'}${x} ${y}`).join(' ') + (closed ? ' Z' : ''));
  }
  const margin = paths.length ? Math.max(maxX - minX, maxY - minY, 1) / 40 : 1;
  const frame = paths.length ? [minX - margin, -maxY - margin, maxX - minX + 2 * margin,
    maxY - minY + 2 * margin] : [0, 0, 1, 1];
  return { paths, segments, notDrawn, omittedSegments, frame: frame.join(' ') };
}

export function DxfDrawing({ inspection }: { inspection: DxfInspection }) {
  const drawing = dxfDrawing(inspection);
  const units = inspection.units;
  const counts = Object.entries(drawing.notDrawn).map(([type, count]) => `${type}: ${count}`).join(', ') || '0';
  return <div className="ul-stack">
    <svg role="img" aria-label={`DXF drawing in its own frame, ${drawing.paths.length} entities`}
      viewBox={drawing.frame} preserveAspectRatio="xMidYMid meet"
      style={{ width: '100%', height: '20rem', background: 'var(--ui-surface)', color: 'var(--ui-ink)' }}>
      <g transform="scale(1 -1)" fill="none" stroke="currentColor">
        {drawing.paths.map((path, at) => <path key={at} d={path} vectorEffect="non-scaling-stroke" />)}
      </g>
    </svg>
    <p>{units.state === 'absent' ? 'Units not stated' : `$INSUNITS: ${units.code ?? 'not stated'}`
      + (units.name ? ` · ${units.name}` : '')}</p>
    <p>Not drawn · {counts}{drawing.omittedSegments ? `; ${drawing.omittedSegments} segments over the limit` : ''}</p>
    <p>The drawing is not placed on the map.</p>
  </div>;
}
