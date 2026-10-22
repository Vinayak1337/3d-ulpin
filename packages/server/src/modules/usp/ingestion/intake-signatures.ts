import type { IntakeCard } from '@ulpin/contracts/usp';
import { decodeDelimitedText } from './delimited-text';

type Kind = { format: string; family: IntakeCard['family'] };
const kind = (format: string, family: Kind['family']): Kind => ({ format, family });

export function decodeIntakeHead(bytes: Uint8Array): { text: string; encoding: string | null } {
  try {
    // A head is not the whole-file encoding receipt; a cut multibyte character is allowed here.
    return decodeDelimitedText(bytes, true);
  } catch {
    return { text: '', encoding: null };
  }
}

function binaryKind(head: Buffer): Kind | undefined {
  const starts = (hex: string) => head.subarray(0, hex.length / 2).equals(Buffer.from(hex, 'hex'));
  const ascii = head.subarray(0, 32).toString('ascii');
  if (ascii.startsWith('%PDF-')) return kind('pdf', 'document');
  if (starts('89504e470d0a1a0a')) return kind('png', 'image');
  if (starts('ffd8ff')) return kind('jpeg', 'image');
  if (ascii.startsWith('LASF')) {
    const compressed = head.length > 104 && Boolean(head[104] & 128);
    return kind(compressed ? 'laz' : 'las', 'point_cloud');
  }
  if (ascii.startsWith('SQLite format 3\0')) {
    if (head.length >= 72 && [0x47504b47, 0x47503130].includes(head.readUInt32BE(68))) {
      return kind('geopackage', 'vector');
    }
    return kind('sqlite', 'table');
  }
  if (ascii.startsWith('PAR1')) return kind('parquet', 'table');
  if (starts('504b0304') || starts('504b0506') || starts('504b0708')) return kind('zip', 'archive');
  if (starts('49492a00') || starts('4d4d002a')) return kind('tiff', 'raster');
  if (starts('49492b00') || starts('4d4d002b')) return kind('bigtiff', 'raster');
  if (head.length >= 100 && head.readUInt32BE(0) === 9994 && head.readUInt32LE(28) === 1000) {
    return kind('shapefile', 'vector');
  }
  if (ascii.startsWith('glTF')) return kind('glb', 'model3d');
  if (/^AC10\d{2}/.test(ascii)) return kind('dwg', 'unknown');
  if (ascii.startsWith('ASTM-E57')) return kind('e57', 'point_cloud');
  if (starts('377abcaf271c')) return kind('7z', 'archive');
  if (starts('526172211a0700') || starts('526172211a070100')) return kind('rar', 'archive');
  if (starts('6667620366676201')) return kind('flatgeobuf', 'vector');
  if (ascii.startsWith('AutoCAD Binary DXF\r\n')) return kind('dxf', 'model3d');
  if (dbfHeader(head)) return kind('dbf', 'table');
  return undefined;
}

function dbfHeader(head: Buffer): boolean {
  if (head.length < 32 || ![3, 4, 5, 48, 49, 50, 67, 99, 131, 139, 203, 245].includes(head[0])) return false;
  return head[2] >= 1 && head[2] <= 12 && head[3] >= 1 && head[3] <= 31
    && head.readUInt16LE(8) >= 33 && head.readUInt16LE(10) > 0;
}

function rootJsonType(text: string): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"' && depth === 1) {
      const type = /^"type"\s*:\s*"(FeatureCollection|Feature|CityJSON|CityJSONFeature)"/.exec(text.slice(index));
      if (type) return type[1];
      if (/^"asset"\s*:\s*\{[^}]*"version"\s*:\s*"\d+\.\d+"/.test(text.slice(index))) return 'glTF';
    }
    if (char === '"') inString = true;
    if (char === '{' || char === '[') depth++;
    if (char === '}' || char === ']') depth--;
  }
  return null;
}

function jsonKind(text: string): Kind | undefined {
  if (/^\s*\x1e\s*\{/.test(text)) {
    const type = rootJsonType(text.replace(/^\s*\x1e/, ''));
    return kind('geojson-seq', type === 'Feature' || type === 'FeatureCollection' ? 'vector' : 'table');
  }
  const type = rootJsonType(text);
  if (type === 'glTF') return kind('gltf', 'model3d');
  if (type === 'CityJSON' || type === 'CityJSONFeature') return kind('cityjson', 'model3d');
  if (type) {
    if (/^\s*\{[^\n]*\}\s*\n\s*\{/.test(text)) return kind('ndjson', 'vector');
    return kind('geojson', 'vector');
  }
  if (/^\s*\{[^\n]*\}\s*\n\s*\{/.test(text)) return kind('ndjson', 'table');
  return undefined;
}

// Skip declarations only: no entity expansion, external resolution or document-body inspection.
function doctypeEnd(text: string, start: number): number {
  let quote = '';
  let subsetDepth = 0;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (quote) {
      if (char === quote) quote = '';
      continue;
    }
    if (text.startsWith('<!--', index)) {
      const end = text.indexOf('-->', index + 4);
      if (end < 0) return -1;
      index = end + 2;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '[') subsetDepth++;
    else if (char === ']') subsetDepth--;
    else if (char === '>' && subsetDepth === 0) return index + 1;
  }
  return -1;
}

function xmlRootStart(text: string): number {
  let index = 0;
  while (index < text.length) {
    if (/\s/.test(text[index])) {
      index++;
      continue;
    }
    if (text.startsWith('<?', index)) {
      const end = text.indexOf('?>', index + 2);
      if (end < 0) return -1;
      index = end + 2;
    } else if (text.startsWith('<!--', index)) {
      const end = text.indexOf('-->', index + 4);
      if (end < 0) return -1;
      index = end + 3;
    } else if (text.startsWith('<!DOCTYPE', index)) {
      index = doctypeEnd(text, index + 9);
      if (index < 0) return -1;
    } else return index;
  }
  return -1;
}

function xmlKind(text: string): Kind | undefined {
  const start = xmlRootStart(text);
  if (start < 0) return undefined;
  const root = /^<([\w:.-]+)(?=[\s/>])((?:"[^"]*"|'[^']*'|[^"'<>])*)>/.exec(text.slice(start));
  if (!root) return undefined;
  const local = root[1].split(':').pop()?.toLowerCase();
  if (local === 'html') return undefined;
  if (local === 'kml') return kind('kml', 'vector');
  if (local === 'citymodel' && /citygml/i.test(root[2])) return kind('citygml', 'model3d');
  if (/opengis.net\/gml/.test(root[2])) return kind('gml', 'vector');
  return undefined;
}

function asciiDxf(text: string): boolean {
  const lines = text.trimStart().split(/\r?\n/);
  let index = 0;
  while (lines[index]?.trim() === '999' && index + 1 < lines.length) index += 2;
  return lines[index]?.trim() === '0' && lines[index + 1]?.trim() === 'SECTION'
    && lines[index + 2]?.trim() === '2'
    && /^(?:HEADER|ENTITIES|CLASSES|TABLES|BLOCKS|OBJECTS)$/.test(lines[index + 3]?.trim() ?? '');
}

function asciiObj(text: string): boolean {
  const number = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
  let vertex = false;
  let companion = false;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (/^(?:f|vn|vt)[ \t]+/.test(trimmed)) companion = true;
    if (/^v[ \t]+/.test(trimmed)) {
      const values = trimmed.split(/[ \t]+/).slice(1);
      if ([3, 4, 6].includes(values.length) && values.every(value => number.test(value))) vertex = true;
    }
    if (vertex && companion) return true;
  }
  return false;
}

export function detectIntakeKind(bytes: Uint8Array): Kind {
  const binary = binaryKind(Buffer.from(bytes));
  if (binary) return binary;
  const { text } = decodeIntakeHead(bytes);
  if (!text || text.includes('\0')) return kind('unknown', 'unknown');
  const structured = jsonKind(text) ?? xmlKind(text);
  if (structured) return structured;
  if (/^\s*ISO-10303-21\s*;/i.test(text) && /FILE_SCHEMA\s*\(\s*\(\s*['"]IFC/i.test(text)) {
    return kind('ifc', 'model3d');
  }
  if (/^ply\r?\nformat (ascii|binary_little_endian|binary_big_endian) 1\.0/.test(text)) {
    return kind('ply', 'point_cloud');
  }
  if (asciiDxf(text)) return kind('dxf', 'model3d');
  if (asciiObj(text)) return kind('obj', 'model3d');
  const lines = text.trimStart().split(/\r?\n/, 3);
  if (lines.length >= 2 && lines[0].includes('\t') && lines[1].includes('\t')) return kind('tsv', 'table');
  if (lines.length >= 2 && [',', ';', '|'].some(value => lines[0].includes(value) && lines[1].includes(value))) {
    return kind('csv', 'table');
  }
  return kind('unknown', 'unknown');
}

const extensions: Record<string, string[]> = {
  geojson: ['geojson', 'json'], 'geojson-seq': ['geojsons', 'geojsonl', 'jsonseq'], ndjson: ['ndjson', 'jsonl'],
  shapefile: ['shp', 'shx'], dbf: ['dbf'], geopackage: ['gpkg'], sqlite: ['sqlite', 'db'],
  parquet: ['parquet', 'geoparquet'], geoparquet: ['parquet', 'geoparquet'],
  tiff: ['tif', 'tiff'], bigtiff: ['tif', 'tiff'],
  xlsx: ['xlsx'], docx: ['docx'], ods: ['ods'], kmz: ['kmz'], geotiff: ['tif', 'tiff'],
  'shapefile-index': ['shx'], csv: ['csv'], tsv: ['tsv'], png: ['png'], jpeg: ['jpg', 'jpeg'],
  las: ['las'], laz: ['laz'],
  pdf: ['pdf'], ifc: ['ifc'], citygml: ['gml', 'xml'], gml: ['gml', 'xml'], kml: ['kml', 'xml'],
  glb: ['glb'], gltf: ['gltf', 'json'], obj: ['obj'], zip: ['zip'],
  dwg: ['dwg'], e57: ['e57'], ply: ['ply'], '7z': ['7z'], rar: ['rar'], flatgeobuf: ['fgb'], dxf: ['dxf'],
};

export function intakeNameDisagrees(format: string, name: string): boolean {
  const extension = name.split('.').pop()?.toLowerCase();
  return Boolean(extension && extensions[format] && !extensions[format].includes(extension));
}
