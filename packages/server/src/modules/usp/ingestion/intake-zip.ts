import { createInflateRaw, constants, crc32, inflateRawSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { Readable, pipeline } from 'node:stream';
import { INTAKE_PROBE_LIMITS as limits, type IntakeCard, type IntakeMember } from '@ulpin/contracts/usp';
import { applyShapefileCompanions, applyRasterCompanions } from './intake-headers';
import { workbookSheets } from './intake-workbook';

export type IntakeRangeReader = (start: number, end: number) => Promise<Uint8Array>;
type Entry = { name: string; size: number; compressed: number; method: number; flags: number; offset: number;
  crc: number };
type MemberProbe = (bytes: Uint8Array, size: number, name: string) => Promise<IntakeCard>;

export function zipMemberRefusal(entry: Pick<Entry, 'name' | 'size' | 'compressed'>, depth = 0): string | null {
  if (/^(?:[\/\\]|[A-Za-z]:)/.test(entry.name) || entry.name.split(/[\/\\]/).includes('..')) {
    return 'ZIP_UNSAFE_PATH';
  }
  if (/[\u0000-\u001f]/.test(entry.name) || entry.name.length > 1024) return 'ZIP_UNSAFE_PATH';
  if (depth > limits.nestingDepth) return 'ZIP_NESTING_LIMIT';
  if (entry.size > limits.expandedBytes) return 'ZIP_EXPANDED_LIMIT';
  if (entry.size > Math.max(1, entry.compressed) * limits.compressionRatio) return 'ZIP_RATIO_LIMIT';
  return null;
}

function endRecord(tail: Buffer): number {
  for (let at = tail.length - 22; at >= 0; at--) {
    if (tail.readUInt32LE(at) === 0x06054b50 && at + 22 + tail.readUInt16LE(at + 20) === tail.length) return at;
  }
  return -1;
}

function directoryEntries(directory: Buffer, count: number): Entry[] {
  const entries: Entry[] = [];
  let at = 0;
  for (let index = 0; index < count; index++) {
    if (at + 46 > directory.length || directory.readUInt32LE(at) !== 0x02014b50) {
      throw new Error('ZIP_DIRECTORY_INVALID');
    }
    const names = directory.readUInt16LE(at + 28);
    const extra = directory.readUInt16LE(at + 30);
    const comment = directory.readUInt16LE(at + 32);
    if (at + 46 + names + extra + comment > directory.length) throw new Error('ZIP_DIRECTORY_INVALID');
    const flags = directory.readUInt16LE(at + 8);
    const nameBytes = directory.subarray(at + 46, at + 46 + names);
    if (!(flags & 2048) && nameBytes.some(byte => byte >= 128)) throw new Error('ZIP_NAME_ENCODING_UNSUPPORTED');
    const name = new TextDecoder('utf-8', { fatal: true }).decode(nameBytes);
    entries.push({ name, flags, method: directory.readUInt16LE(at + 10), crc: directory.readUInt32LE(at + 16),
      compressed: directory.readUInt32LE(at + 20), size: directory.readUInt32LE(at + 24),
      offset: directory.readUInt32LE(at + 42) });
    at += 46 + names + extra + comment;
  }
  if (at !== directory.length) throw new Error('ZIP_DIRECTORY_INVALID');
  return entries;
}

/** Inflation is stopped at the member-head ceiling; neither member body nor expanded archive is buffered. */
async function inflateHead(compressed: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const inflater = createInflateRaw({ finishFlush: constants.Z_SYNC_FLUSH });
    const chunks: Buffer[] = [];
    let count = 0;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      inflater.destroy();
      resolve(Buffer.concat(chunks, count));
    };
    inflater.on('data', (chunk: Buffer) => {
      const keep = chunk.subarray(0, limits.memberHeadBytes - count);
      chunks.push(keep);
      count += keep.length;
      if (count >= limits.memberHeadBytes) finish();
    });
    inflater.once('error', error => { if (!finished) reject(error); });
    inflater.once('end', finish);
    inflater.end(compressed);
  });
}

/** The member's compressed bytes start after its local header, which must agree with the directory entry. */
async function memberDataOffset(read: IntakeRangeReader, entry: Entry, directoryOffset: number): Promise<number> {
  if (entry.offset + 30 > directoryOffset) throw new Error('ZIP_MEMBER_RANGE');
  const header = Buffer.from(await read(entry.offset, entry.offset + 30));
  if (header.readUInt32LE(0) !== 0x04034b50 || header.readUInt16LE(8) !== entry.method
    || header.readUInt16LE(6) !== entry.flags) throw new Error('ZIP_LOCAL_HEADER_INVALID');
  const offset = entry.offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
  if (offset + entry.compressed > directoryOffset) throw new Error('ZIP_MEMBER_RANGE');
  return offset;
}

async function memberHead(read: IntakeRangeReader, entry: Entry, directoryOffset: number): Promise<Uint8Array> {
  const offset = await memberDataOffset(read, entry, directoryOffset);
  // The local 30-byte header is charged to the same 64 KiB member read allowance.
  const compressed = await read(offset, offset + Math.min(entry.compressed, limits.memberHeadBytes - 30));
  if (entry.method === 0) return compressed.subarray(0, limits.memberHeadBytes);
  if (entry.method !== 8) throw new Error('ZIP_COMPRESSION_UNSUPPORTED');
  return inflateHead(compressed);
}

function shallowCard(card: IntakeCard): NonNullable<IntakeMember['card']> {
  const { members: _members, ...fields } = card;
  return fields;
}

async function inspectEntry(read: IntakeRangeReader, entry: Entry, offset: number, probe: MemberProbe) {
  const member: IntakeMember = { name: entry.name, sizeBytes: entry.size, compressedBytes: entry.compressed,
    format: 'unknown', family: 'unknown', refusalCode: zipMemberRefusal(entry), companions: [], card: null };
  if (entry.flags & 1) member.refusalCode = 'ZIP_ENCRYPTED_MEMBER';
  if (member.refusalCode) return { member, bytes: null };
  const started = performance.now();
  let bytesRead = 0;
  try {
    const measured: IntakeRangeReader = async (start, end) => {
      const result = await read(start, end);
      bytesRead += result.length;
      return result;
    };
    const bytes = await memberHead(measured, entry, offset);
    const card = await probe(bytes, entry.size, entry.name);
    card.probeBytesRead = bytesRead;
    card.probeMs = Math.round((performance.now() - started) * 1000) / 1000;
    member.format = card.format;
    member.family = card.family;
    member.card = shallowCard(card);
    return { member, bytes };
  } catch (error) {
    if (error instanceof Error && error.message === 'INTAKE_PROBE_BUDGET') throw error;
    member.refusalCode = 'ZIP_MEMBER_HEADER_FAILED';
    return { member, bytes: null };
  }
}

type InspectedEntry = Awaited<ReturnType<typeof inspectEntry>>;

function mergeCompanionHeaders(item: InspectedEntry, companions: InspectedEntry[]) {
  if (!item.member.card) return;
  const bytes = new Map<string, Uint8Array>();
  const merged = { ...item.member.card, members: [] };
  for (const other of companions) {
    const extension = other.member.name.split('.').pop()!.toLowerCase();
    if (!other.bytes || other.member.refusalCode) continue;
    if (extension === 'prj' && other.bytes.length !== other.member.sizeBytes) {
      if (merged.crs.state === 'absent') merged.crs.state = 'sidecar';
      merged.limits.push('PRJ member cut by the header bound; complete text hash and CRS remain unknown.');
      continue;
    }
    bytes.set(extension, other.bytes);
  }
  if (merged.format === 'shapefile') applyShapefileCompanions(merged, bytes);
  else if (merged.family === 'raster' || merged.family === 'image') applyRasterCompanions(merged, bytes);
  item.member.card = shallowCard(merged);
}

function groupSidecars(inspected: InspectedEntry[], card: IntakeCard) {
  const sidecar = /\.(?:shx|dbf|prj|cpg|tfw|jgw|pgw|wld|aux\.xml)$/i;
  const primary = /\.(?:shp|tif|tiff|png|jpg|jpeg)$/i;
  const grouped = new Set<string>();
  for (const item of inspected.filter(item => primary.test(item.member.name))) {
    const base = item.member.name.replace(primary, '');
    const companions = inspected.filter(other => other.member.name.replace(sidecar, '') === base
      && sidecar.test(other.member.name));
    item.member.companions = companions.map(other => other.member.name);
    for (const other of companions) {
      grouped.add(other.member.name);
      if (other.member.refusalCode) {
        card.limits.push(`${other.member.refusalCode}: companion ${other.member.name} kept but not probed.`);
      }
    }
    mergeCompanionHeaders(item, companions);
  }
  const orphan = inspected.filter(item => sidecar.test(item.member.name) && !grouped.has(item.member.name));
  if (orphan.length) {
    card.limits.push('Loose sidecars remain in the archive directory; no independent sidecar item planned.');
  }
  card.members = inspected.filter(item => !sidecar.test(item.member.name)).map(item => item.member);
}

function officeKind(card: IntakeCard, inspected: Awaited<ReturnType<typeof inspectEntry>>[]) {
  const names = inspected.map(item => item.member.name);
  if (names.includes('xl/workbook.xml')) {
    card.format = 'xlsx';
    card.family = 'table';
    const workbook = inspected.find(item => item.member.name === 'xl/workbook.xml');
    if (workbook?.bytes) workbookSheets(card, workbook.bytes, workbook.member.sizeBytes);
    else card.limits.push('Workbook XML was refused or unavailable; sheet names remain unknown.');
    card.limits.push('Workbook sheet names only; no cell or shared-string member opened.');
  } else if (names.includes('word/document.xml') && names.includes('[Content_Types].xml')) {
    card.format = 'docx';
    card.family = 'document';
    card.limits.push('OOXML member layout only; no document text opened.');
  } else if (names.includes('mimetype')) {
    const mime = inspected.find(item => item.member.name === 'mimetype')?.bytes;
    if (mime && Buffer.from(mime).toString() === 'application/vnd.oasis.opendocument.spreadsheet') {
      card.format = 'ods';
      card.family = 'table';
    }
  } else if (inspected.some(item => item.member.format === 'kml')) {
    card.format = 'kmz';
    card.family = 'vector';
  }
}

function directoryProfile(end: Buffer, size: number, depth: number) {
  const at = endRecord(end);
  if (at < 0) return { count: 0, bytes: 0, offset: 0, refusal: 'ZIP_END_NOT_FOUND' };
  const count = end.readUInt16LE(at + 10);
  const bytes = end.readUInt32LE(at + 12);
  const offset = end.readUInt32LE(at + 16);
  const guards: [boolean, string][] = [
    [depth > limits.nestingDepth, 'ZIP_NESTING_LIMIT'],
    [count > limits.members, 'ZIP_MEMBER_LIMIT'],
    [bytes > limits.directoryBytes, 'ZIP_DIRECTORY_LIMIT'],
    [Boolean(end.readUInt16LE(at + 4) || end.readUInt16LE(at + 6)), 'ZIP_MULTIDISK_UNSUPPORTED'],
    [offset + bytes > size - end.length + at, 'ZIP_DIRECTORY_INVALID'],
  ];
  return { count, bytes, offset, refusal: guards.find(([hit]) => hit)?.[1] ?? null };
}

async function readDirectory(card: IntakeCard, read: IntakeRangeReader, size: number, tail: Uint8Array, depth: number) {
  const profile = directoryProfile(Buffer.from(tail), size, depth);
  if (profile.refusal) {
    card.limits.push(`${profile.refusal}: archive kept; bounded directory probe refused, native reader needed.`);
    return null;
  }
  const directory = Buffer.from(await read(profile.offset, profile.offset + profile.bytes));
  let entries: Entry[];
  try { entries = directoryEntries(directory, profile.count); }
  catch {
    card.limits.push('ZIP_DIRECTORY_INVALID_OR_ENCODING: directory kept; CP437/non-UTF8 names need native reader.');
    return null;
  }
  if (new Set(entries.map(entry => entry.name)).size !== entries.length) {
    card.limits.push('ZIP_DUPLICATE_PATH: archive directory refused.');
    return null;
  }
  if (entries.reduce((sum, entry) => sum + entry.size, 0) > limits.expandedBytes) {
    card.limits.push('ZIP_EXPANDED_LIMIT: archive member probe refused.');
    return null;
  }
  card.depth = 'structure';
  card.counts.members = profile.count;
  return { entries, offset: profile.offset };
}

async function inspectZipMembers(read: IntakeRangeReader, entries: Entry[], offset: number,
  probe: MemberProbe, depth: number) {
  const office = entries.some(entry => entry.name === 'xl/workbook.xml' || entry.name === 'word/document.xml')
    || entries.some(entry => entry.name === 'mimetype') && entries.some(entry => entry.name === 'content.xml');
  const inspected: InspectedEntry[] = [];
  for (const entry of entries.filter(entry => !entry.name.endsWith('/'))) {
    // Office signatures/sheet lists come from the directory plus workbook/mimetype, never cells/document text.
    if (office && !['xl/workbook.xml', 'mimetype'].includes(entry.name)) {
      const directoryCard = await probe(new Uint8Array(), entry.size, entry.name);
      directoryCard.limits = ['Office member listed from central directory only; no content opened.'];
      const refusal = entry.flags & 1 ? 'ZIP_ENCRYPTED_MEMBER' : zipMemberRefusal(entry, depth);
      inspected.push({ member: { name: entry.name, sizeBytes: entry.size, compressedBytes: entry.compressed,
        format: 'unknown', family: 'unknown', refusalCode: refusal, companions: [],
        card: shallowCard(directoryCard) }, bytes: null });
    } else inspected.push(await inspectEntry(read, entry, offset, probe));
  }
  return inspected;
}

export async function probeZip(card: IntakeCard, read: IntakeRangeReader, size: number, tail: Uint8Array,
  probe: MemberProbe, depth = 0) {
  const directory = await readDirectory(card, read, size, tail, depth);
  if (!directory) return;
  const inspected = await inspectZipMembers(read, directory.entries, directory.offset, probe, depth);
  officeKind(card, inspected);
  groupSidecars(inspected, card);
}

const RANGE_BYTES = 1024 * 1024;

/** One member found by its exact path in a retained ZIP's directory, past the probe's directory guards. */
export async function locateZipMember(read: IntakeRangeReader, size: number, path: string) {
  const tail = await read(Math.max(0, size - limits.tailBytes), size);
  const profile = directoryProfile(Buffer.from(tail), size, 0);
  if (profile.refusal) throw new Error(profile.refusal);
  const directory = Buffer.from(await read(profile.offset, profile.offset + profile.bytes));
  const entries = directoryEntries(directory, profile.count);
  const ordinal = entries.findIndex(entry => entry.name === path);
  const entry = entries[ordinal];
  if (!entry || entries.filter(other => other.name === path).length !== 1) throw new Error('ZIP_MEMBER_NOT_FOUND');
  const refusal = entry.flags & 1 ? 'ZIP_ENCRYPTED_MEMBER' : zipMemberRefusal(entry);
  if (refusal) throw new Error(refusal);
  return { entry, ordinal, directoryOffset: profile.offset };
}

export type ZipMemberLocation = Awaited<ReturnType<typeof locateZipMember>>;

/**
 * Reads one whole member back out of a retained ZIP, for keeping it as its own original. The directory guards of the
 * probe apply; the member is found by its exact path, nothing past `maxBytes` is inflated, and the result must match
 * the directory's size and CRC-32. Errors carry a code only, never member text.
 */
export async function readZipMember(read: IntakeRangeReader, size: number, path: string, maxBytes: number) {
  const { entry, ordinal, directoryOffset } = await locateZipMember(read, size, path);
  if (entry.size > maxBytes || entry.compressed > maxBytes + RANGE_BYTES) throw new Error('ZIP_LAYER_SIZE');
  if (entry.method !== 0 && entry.method !== 8) throw new Error('ZIP_COMPRESSION_UNSUPPORTED');
  const start = await memberDataOffset(read, entry, directoryOffset);
  const chunks: Uint8Array[] = [];
  for (let at = start; at < start + entry.compressed; at += RANGE_BYTES) {
    chunks.push(await read(at, Math.min(start + entry.compressed, at + RANGE_BYTES)));
  }
  const compressed = Buffer.concat(chunks);
  let bytes: Uint8Array;
  try { bytes = entry.method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: maxBytes }); }
  catch { throw new Error('ZIP_MEMBER_INTEGRITY'); }
  if (bytes.length !== entry.size || crc32(bytes) !== entry.crc) throw new Error('ZIP_MEMBER_INTEGRITY');
  return { bytes, ordinal, compressedBytes: entry.compressed, crc32: entry.crc };
}

/**
 * ZL1. Streams a located member's bytes in order: its compressed bytes are read in 1 MiB ranges and inflated as a
 * stream, so neither the member nor its compressed bytes are held whole. Nothing past the directory's size is
 * inflated; the size and CRC-32 are checked after the last chunk, before the stream ends.
 */
export async function* streamZipMember(read: IntakeRangeReader, member: ZipMemberLocation) {
  const { entry } = member;
  if (entry.method !== 0 && entry.method !== 8) throw new Error('ZIP_COMPRESSION_UNSUPPORTED');
  const start = await memberDataOffset(read, entry, member.directoryOffset);
  const compressed = Readable.from((async function* () {
    for (let at = start; at < start + entry.compressed; at += RANGE_BYTES) {
      yield await read(at, Math.min(start + entry.compressed, at + RANGE_BYTES));
    }
  })(), { objectMode: false });
  const chunks = entry.method === 0 ? compressed : pipeline(compressed, createInflateRaw(), () => {});
  let bytes = 0;
  let crc = 0;
  try {
    for await (const chunk of chunks as AsyncIterable<Buffer>) {
      bytes += chunk.length;
      if (bytes > entry.size) throw new Error('ZIP_MEMBER_INTEGRITY');
      crc = crc32(chunk, crc);
      yield chunk;
    }
  } catch (error) {
    // A damaged deflate stream is the member's fault; a storage read's own error passes through unchanged.
    const code = (error as { code?: unknown }).code;
    throw typeof code === 'string' && code.startsWith('Z_') ? new Error('ZIP_MEMBER_INTEGRITY') : error;
  }
  if (bytes !== entry.size || crc !== entry.crc) throw new Error('ZIP_MEMBER_INTEGRITY');
}
