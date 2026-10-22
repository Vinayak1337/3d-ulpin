/**
 * TC1. A table cell's coordinates read without changing them: a decimal keeps the text it was written with, so the
 * GeoJSON number is the cell's number. Only WKT Point, LineString, Polygon and their Multi kinds are read, in two
 * dimensions; anything else is not read and nothing is guessed from it.
 */
export type Position = [string, string];
type Coordinates = Position | Coordinates[];
export type TableGeometry = { type: 'Point'; coordinates: Position }
  | { type: 'LineString' | 'MultiPoint'; coordinates: Position[] }
  | { type: 'Polygon' | 'MultiLineString'; coordinates: Position[][] }
  | { type: 'MultiPolygon'; coordinates: Position[][][] };

const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const JSON_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/** The cell's number as GeoJSON text, or null when the cell is not one finite decimal number. */
export function coordinateText(cell: string): string | null {
  const text = cell.trim();
  if (!DECIMAL.test(text) || !Number.isFinite(Number(text))) return null;
  return JSON_NUMBER.test(text) ? text : JSON.stringify(Number(text));
}

function coordinatesJson(value: Coordinates): string {
  return typeof value[0] === 'string' ? `[${value.join(',')}]`
    : `[${(value as Coordinates[]).map(coordinatesJson).join(',')}]`;
}

/** The geometry as GeoJSON text, its numbers exactly as read. */
export function geometryJson(geometry: TableGeometry): string {
  return `{"type":"${geometry.type}","coordinates":${coordinatesJson(geometry.coordinates)}}`;
}

const TOKEN = /\s*(?:([A-Za-z]+)|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)|([(),]))/y;

function tokens(text: string): string[] | null {
  const found: string[] = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < text.length) {
    const at = TOKEN.lastIndex;
    const match = TOKEN.exec(text);
    if (!match) return /^\s*$/.test(text.slice(at)) ? found : null;
    found.push(match[1]?.toUpperCase() ?? match[2] ?? match[3]);
  }
  return found;
}

class NotWkt extends Error {}

/** One pass over the tokens; every reader takes exactly what its grammar names or stops the parse. */
class Reader {
  private at = 0;
  constructor(private readonly items: string[]) {}

  peek() { return this.items[this.at]; }
  take(expected?: string) {
    const item = this.items[this.at++];
    if (item === undefined || expected !== undefined && item !== expected) throw new NotWkt();
    return item;
  }
  done() { return this.at === this.items.length; }

  position(): Position {
    const x = coordinateText(this.take()), y = coordinateText(this.take());
    if (x === null || y === null) throw new NotWkt();
    return [x, y];
  }

  /** `( item, item, ... )` with at least `least` items. */
  list<T>(item: () => T, least = 1): T[] {
    this.take('(');
    const items = [item()];
    while (this.peek() === ',') {
      this.take(',');
      items.push(item());
    }
    this.take(')');
    if (items.length < least) throw new NotWkt();
    return items;
  }

  line = () => this.list(() => this.position(), 2);
  ring = () => this.list(() => this.position(), 4);
  polygon = () => this.list(this.ring);
  /** `( x y )`: exactly one position. */
  single = (): Position => {
    this.take('(');
    const position = this.position();
    this.take(')');
    return position;
  };
  // A multipoint's points are written with or without their own brackets.
  point = () => this.peek() === '(' ? this.single() : this.position();
}

const KINDS = ['POINT', 'LINESTRING', 'POLYGON', 'MULTIPOINT', 'MULTILINESTRING', 'MULTIPOLYGON'];

function body(reader: Reader, type: string): TableGeometry {
  if (type === 'POINT') return { type: 'Point', coordinates: reader.single() };
  if (type === 'LINESTRING') return { type: 'LineString', coordinates: reader.line() };
  if (type === 'POLYGON') return { type: 'Polygon', coordinates: reader.polygon() };
  if (type === 'MULTIPOINT') return { type: 'MultiPoint', coordinates: reader.list(reader.point) };
  if (type === 'MULTILINESTRING') return { type: 'MultiLineString', coordinates: reader.list(reader.line) };
  if (type === 'MULTIPOLYGON') return { type: 'MultiPolygon', coordinates: reader.list(reader.polygon) };
  throw new NotWkt();
}

/** The cell's geometry; 'empty' for a blank cell or an EMPTY geometry; null for text that is not read as WKT. */
export function parseWkt(cell: string): TableGeometry | 'empty' | null {
  const items = tokens(cell);
  if (!items) return null;
  if (!items.length) return 'empty';
  const reader = new Reader(items);
  try {
    const type = reader.take();
    if (!KINDS.includes(type)) return null;
    if (reader.peek() === 'EMPTY') {
      reader.take();
      return reader.done() ? 'empty' : null;
    }
    const geometry = body(reader, type);
    return reader.done() ? geometry : null;
  } catch (error) {
    if (error instanceof NotWkt) return null;
    throw error;
  }
}
