import type { IntakeCard } from '@ulpin/contracts/usp';
import { sha256 } from '../../../infrastructure/storage';
const shapeTypes: Record<number, string> = {
  1: 'Point', 3: 'LineString', 5: 'Polygon', 8: 'MultiPoint', 11: 'PointZ', 13: 'LineStringZ',
  15: 'PolygonZ', 18: 'MultiPointZ', 21: 'PointM', 23: 'LineStringM', 25: 'PolygonM', 28: 'MultiPointM',
};

export function probeShapefile(card: IntakeCard, bytes: Uint8Array) {
  const head = Buffer.from(bytes);
  if (head.length < 100) return;
  card.depth = 'structure';
  card.formatVersion = String(head.readUInt32LE(28));
  const type = shapeTypes[head.readUInt32LE(32)];
  if (type) card.geometryTypes = [type];
  const bbox = [36, 44, 52, 60].map(offset => head.readDoubleLE(offset));
  if (bbox.every(Number.isFinite)) card.extent.native = bbox as [number, number, number, number];
  card.limits.push('Shapefile header only; companion counts/CRS are recorded only when grouped.');
}

export function probeDbf(card: IntakeCard, bytes: Uint8Array) {
  const head = Buffer.from(bytes);
  if (head.length < 32) return;
  card.depth = 'structure';
  card.counts.rows = head.readUInt32LE(4);
  const end = Math.min(head.readUInt16LE(8), head.length);
  const types: Record<string, IntakeCard['columns'][number]['inferredType']> = {
    C: 'text', N: 'number', F: 'number', L: 'boolean', D: 'date', I: 'number', B: 'number',
  };
  for (let offset = 32; offset + 32 <= end && head[offset] !== 13; offset += 32) {
    if (card.columns.length >= 256) break;
    const name = head.subarray(offset, offset + 11).toString('ascii').replace(/\0.*$/, '');
    if (!name) continue;
    card.columns.push({ name, inferredType: types[String.fromCharCode(head[offset + 11])] ?? 'unknown',
      sampledNonEmpty: 0 });
  }
  card.limits.push('DBF field descriptors only; encoding not established without .cpg; no record read.');
}

export function applyShapefileCompanions(card: IntakeCard, companions: Map<string, Uint8Array>) {
  const shx = companions.get('shx');
  if (shx && shx.length >= 100) {
    const header = Buffer.from(shx);
    const length = header.readUInt32BE(24) * 2;
    if (length >= 100 && (length - 100) % 8 === 0) card.counts.features = (length - 100) / 8;
  }
  const dbf = companions.get('dbf');
  if (dbf) {
    const projected = { ...card, columns: [] };
    probeDbf(projected, dbf);
    card.columns = projected.columns;
    card.counts.rows = projected.counts.rows;
    if (card.counts.features !== null && card.counts.rows !== card.counts.features) {
      card.limits.push('SHAPEFILE_COUNT_CONFLICT: .shx and .dbf counts disagree.');
    }
  }
  const prj = companions.get('prj');
  if (prj) {
    card.crs = { state: 'sidecar', code: null, sidecarSha256: sha256(prj) };
    card.limits.push('Sidecar hash covers the bounded .prj bytes; CRS code requires existing native CRS resolver.');
  }
  const cpg = companions.get('cpg');
  const encoding = cpg ? Buffer.from(cpg).toString('ascii').trim() : '';
  if (/^(?:UTF-8|UTF8|1252|65001|ISO-8859-1)$/i.test(encoding)) card.encoding = encoding;
}

export function applyRasterCompanions(card: IntakeCard, companions: Map<string, Uint8Array>) {
  const prj = companions.get('prj');
  if (prj) {
    card.crs.sidecarSha256 = sha256(prj);
    if (card.crs.state === 'absent') card.crs.state = 'sidecar';
    card.limits.push('Raster .prj hash retained; world-file transform and CRS agreement need the native reader.');
  }
}

export function probePdf(card: IntakeCard, head: Uint8Array, tail: Uint8Array) {
  const text = Buffer.from(head).toString('latin1');
  const end = Buffer.from(tail).toString('latin1');
  card.formatVersion = /^%PDF-(\d\.\d)/.exec(text)?.[1] ?? null;
  card.depth = 'structure';
  // A token can occur in document text; only a validated trailer can establish encryption.
  card.encrypted = null;
  if (/\/Encrypt\b/.test(text + end)) {
    card.limits.push('Encryption token in header/tail; encryption state awaits validated trailer resolution.');
  }
  card.limits.push('PDF header/tail only; encryption absence/page count need validated trailer/page-tree resolution.');
}

export function probeLas(card: IntakeCard, bytes: Uint8Array) {
  const head = Buffer.from(bytes);
  if (head.length < 227 || head[24] !== 1 || head[25] > 4) return;
  const headerSize = head.readUInt16LE(94);
  if (headerSize < 227 || head.readUInt32LE(96) < headerSize) return;
  card.depth = 'structure';
  card.formatVersion = `${head[24]}.${head[25]}`;
  card.point = { format: head[104] & 63, scale: [131, 139, 147].map(offset => head.readDoubleLE(offset)) as
    [number, number, number] };
  card.counts.points = head.readUInt32LE(107);
  if (head[25] >= 4 && head.length >= 255) {
    const extended = head.readBigUInt64LE(247);
    card.counts.points = extended <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(extended) : null;
  }
  card.extent.native = [head.readDoubleLE(187), head.readDoubleLE(203),
    head.readDoubleLE(179), head.readDoubleLE(195)];
  if (!card.extent.native.every(Number.isFinite)) card.extent.native = null;
  card.limits.push('Public LAS header only; VLR CRS and compressed chunk tables require the existing point reader.');
}

function tiffScalar(head: Buffer, offset: number, little: boolean): number | null {
  const short = (at: number) => little ? head.readUInt16LE(at) : head.readUInt16BE(at);
  const long = (at: number) => little ? head.readUInt32LE(at) : head.readUInt32BE(at);
  if (long(offset + 4) !== 1) return null;
  if (short(offset + 2) === 3) return short(offset + 8);
  if (short(offset + 2) === 4) return long(offset + 8);
  return null;
}

function tiffGeoKeys(card: IntakeCard, head: Buffer, at: number, little: boolean) {
  const short = (offset: number) => little ? head.readUInt16LE(offset) : head.readUInt16BE(offset);
  const long = (offset: number) => little ? head.readUInt32LE(offset) : head.readUInt32BE(offset);
  const count = long(at + 4);
  const offset = long(at + 8);
  if (short(at + 2) !== 3 || count < 4 || offset + count * 2 > head.length) return;
  const keys = short(offset + 6);
  if (4 + keys * 4 > count) return;
  const geographic = new Set<number>();
  const projected = new Set<number>();
  for (let index = 0; index < keys; index++) {
    const key = offset + 8 + index * 8;
    if (![2048, 3072].includes(short(key)) || short(key + 2) !== 0 || short(key + 4) !== 1) continue;
    const code = short(key + 6);
    if (code > 0 && code !== 32767) (short(key) === 3072 ? projected : geographic).add(code);
  }
  // A projected CRS can also name its underlying geographic CRS; those two codes do not conflict.
  const codes = projected.size ? projected : geographic;
  if (codes.size === 1) card.crs = { state: 'stated', code: `EPSG:${[...codes][0]}`, sidecarSha256: null };
  if (codes.size > 1) card.crs.state = 'conflicting';
}

export function probeTiff(card: IntakeCard, bytes: Uint8Array) {
  const head = Buffer.from(bytes);
  if (head.length < 8) return;
  const little = head[0] === 73;
  const short = (at: number) => little ? head.readUInt16LE(at) : head.readUInt16BE(at);
  const offset = little ? head.readUInt32LE(4) : head.readUInt32BE(4);
  if (offset + 2 > head.length || offset < 8) {
    card.limits.push('First TIFF IFD outside the head; indexed raster reader needed.');
    return;
  }
  const entries = short(offset);
  if (offset + 2 + entries * 12 > head.length) {
    card.limits.push('First TIFF IFD cut by the head bound.');
    return;
  }
  card.depth = 'structure';
  card.raster = { width: null, height: null, tiled: false };
  for (let index = 0; index < entries; index++) {
    const at = offset + 2 + index * 12;
    const tag = short(at);
    const value = tiffScalar(head, at, little);
    if (tag === 256) card.raster.width = value;
    if (tag === 257) card.raster.height = value;
    if (tag === 277) card.counts.bands = value;
    if (tag === 322 || tag === 324) card.raster.tiled = true;
    if (tag === 34735) {
      card.format = 'geotiff';
      tiffGeoKeys(card, head, at, little);
    }
  }
  card.limits.push('First TIFF IFD only; CRS code, transform, COG qualification/overviews need native raster reader.');
}
