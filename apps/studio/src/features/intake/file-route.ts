export type FileRoute = 'intake' | 'direct' | 'table' | 'unsupported';

/** A successful opt-in development profile is handled before this production routing decision. */
export function fileRoute(name: string): FileRoute {
  if (/\.(geojson|json)$/i.test(name)) return 'intake';
  if (/\.(gpkg|zip)$/i.test(name)) return 'direct';
  if (/\.(csv|xlsx)$/i.test(name)) return 'table';
  return 'unsupported';
}

/** Member names from a ZIP's central directory, read from its tail only; null when it cannot be read here. */
export async function zipMemberNames(file: Blob): Promise<string[] | null> {
  const tail = new DataView(await file.slice(Math.max(0, file.size - 65_557)).arrayBuffer());
  let end = -1;
  for (let at = tail.byteLength - 22; at >= 0; at--) {
    if (tail.getUint32(at, true) === 0x06054b50) { end = at; break; }
  }
  if (end < 0) return null;
  const count = tail.getUint16(end + 10, true);
  const bytes = tail.getUint32(end + 12, true);
  const offset = tail.getUint32(end + 16, true);
  if (bytes > 1024 * 1024 || offset + bytes > file.size) return null;
  const directory = new DataView(await file.slice(offset, offset + bytes).arrayBuffer());
  const names: string[] = [];
  const decoder = new TextDecoder();
  for (let at = 0, index = 0; index < count; index++) {
    if (at + 46 > directory.byteLength || directory.getUint32(at, true) !== 0x02014b50) return null;
    const length = directory.getUint16(at + 28, true);
    const skip = length + directory.getUint16(at + 30, true) + directory.getUint16(at + 32, true);
    if (at + 46 + skip > directory.byteLength) return null;
    names.push(decoder.decode(new Uint8Array(directory.buffer, directory.byteOffset + at + 46, length)));
    at += 46 + skip;
  }
  return names;
}

/**
 * ZF2: only a ZIP holding a shapefile keeps the bounded direct import. Every other ZIP, one this browser cannot read
 * included, joins the batch: each GeoJSON layer becomes its own item, and the server's probe words what it refuses.
 */
export async function zipRoute(file: Blob): Promise<'intake' | 'direct'> {
  const names = await zipMemberNames(file).catch(() => null);
  return names?.some(name => /\.shp$/i.test(name)) ? 'direct' : 'intake';
}

/** The route of one picked file; only a ZIP's route needs its directory. */
export async function pickedRoute(file: File): Promise<FileRoute> {
  return /\.zip$/i.test(file.name) ? zipRoute(file) : fileRoute(file.name);
}
