import { createHash } from 'node:crypto';

/** Namespace for every ID the Studio's local derivations create (UUIDv5, stable and traceable). */
export const NAMESPACE = uuidV5('ulpin-studio-local-derivation', '6ba7b811-9dad-11d1-80b4-00c04fd430c8');

export function uuidV5(name, namespace = NAMESPACE) {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1').update(Buffer.concat([ns, Buffer.from(name, 'utf8')])).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const round = (v, d) => { const k = 10 ** d; return Math.round(v * k) / k; };

/** WKT POLYGON ((x y, ...), (hole ...)) → [[[x, y], ...], ...] */
export function parseWktPolygon(wkt) {
  const match = /^POLYGON\s*\(\((.*)\)\)$/s.exec(wkt.trim());
  if (!match) throw new Error(`Unsupported WKT: ${wkt.slice(0, 40)}`);
  return match[1].split(/\)\s*,\s*\(/).map((ring) => ring.split(',').map((pair) => pair.trim().split(/\s+/).map(Number)));
}

/** Minimal RFC 4180 CSV parser (quoted fields, doubled quotes). */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows;
  return body.filter((r) => r.length === header.length).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}
