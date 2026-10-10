import { createInflateRaw, constants } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { INTAKE_PROBE_LIMITS as limits, type IntakeCard, type IntakeMember } from '@ulpin/contracts/usp';
import { applyShapefileCompanions } from './intake-headers';

export type IntakeRangeReader = (start: number, end: number) => Promise<Uint8Array>;
type Entry = { name: string; size: number; compressed: number; method: number; flags: number; offset: number };
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
    const name = new TextDecoder(flags & 2048 ? 'utf-8' : 'windows-1252', { fatal: true })
      .decode(directory.subarray(at + 46, at + 46 + names));
    entries.push({ name, flags, method: directory.readUInt16LE(at + 10),
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

async function memberHead(read: IntakeRangeReader, entry: Entry, directoryOffset: number): Promise<Uint8Array> {
  if (entry.offset + 30 > directoryOffset) throw new Error('ZIP_MEMBER_RANGE');
  const header = Buffer.from(await read(entry.offset, entry.offset + 30));
  if (header.readUInt32LE(0) !== 0x04034b50 || header.readUInt16LE(8) !== entry.method
    || header.readUInt16LE(6) !== entry.flags) throw new Error('ZIP_LOCAL_HEADER_INVALID');
  const offset = entry.offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
  if (offset + entry.compressed > directoryOffset) throw new Error('ZIP_MEMBER_RANGE');
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

function groupSidecars(inspected: Awaited<ReturnType<typeof inspectEntry>>[], card: IntakeCard) {
  const sidecar = /\.(?:shx|dbf|prj|cpg|tfw|jgw|pgw|wld|aux\.xml)$/i;
  const primary = /\.(?:shp|tif|tiff|png|jpg|jpeg)$/i;
  const grouped = new Set<string>();
  for (const item of inspected.filter(item => primary.test(item.member.name))) {
    const base = item.member.name.replace(primary, '').toLowerCase();
    const companions = inspected.filter(other => other.member.name.replace(sidecar, '').toLowerCase() === base
      && sidecar.test(other.member.name));
    item.member.companions = companions.map(other => other.member.name);
    for (const other of companions) {
      grouped.add(other.member.name);
      if (other.member.refusalCode) {
        card.limits.push(`${other.member.refusalCode}: companion ${other.member.name} kept but not probed.`);
      }
    }
    if (item.member.card?.format === 'shapefile') {
      const bytes = new Map<string, Uint8Array>();
      for (const other of companions) {
        const extension = other.member.name.split('.').pop()!.toLowerCase();
        if (!other.bytes || other.member.refusalCode) continue;
        if (extension === 'prj' && other.bytes.length !== other.member.sizeBytes) continue;
        bytes.set(extension, other.bytes);
      }
      const merged = { ...item.member.card, members: [] };
      applyShapefileCompanions(merged, bytes);
      item.member.card = shallowCard(merged);
    }
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
    if (workbook?.bytes && workbook.bytes.length === workbook.member.sizeBytes) {
      const text = new TextDecoder().decode(workbook.bytes);
      const sheets = [...text.matchAll(/<(?:\w+:)?sheet\b[^>]*\bname="([^"]+)"[^>]*\/?\s*>/g)];
      card.sheets = sheets.map(match => ({ name: match[1], count: null }));
    }
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

export async function probeZip(card: IntakeCard, read: IntakeRangeReader, size: number, tail: Uint8Array,
  probe: MemberProbe, depth = 0) {
  const end = Buffer.from(tail);
  const at = endRecord(end);
  if (at < 0) {
    card.limits.push('ZIP end record outside bounded tail; ZIP64 or long comment needs native reader.');
    return;
  }
  const count = end.readUInt16LE(at + 10);
  const bytes = end.readUInt32LE(at + 12);
  const offset = end.readUInt32LE(at + 16);
  const fail = (code: string) => { card.limits.push(`${code}: archive kept, directory/member probe refused.`); };
  if (depth > limits.nestingDepth) {
    fail('ZIP_NESTING_LIMIT');
    return;
  }
  if (count > limits.members) {
    fail('ZIP_MEMBER_LIMIT');
    return;
  }
  if (bytes > limits.directoryBytes) {
    fail('ZIP_DIRECTORY_LIMIT');
    return;
  }
  if (end.readUInt16LE(at + 4) || end.readUInt16LE(at + 6)) {
    fail('ZIP_MULTIDISK_UNSUPPORTED');
    return;
  }
  if (offset + bytes > size - tail.length + at) {
    fail('ZIP_DIRECTORY_INVALID');
    return;
  }
  const entries = directoryEntries(Buffer.from(await read(offset, offset + bytes)), count);
  if (new Set(entries.map(entry => entry.name)).size !== entries.length) {
    fail('ZIP_DUPLICATE_PATH');
    return;
  }
  if (entries.reduce((sum, entry) => sum + entry.size, 0) > limits.expandedBytes) {
    fail('ZIP_EXPANDED_LIMIT');
    return;
  }
  card.depth = 'structure';
  card.counts.members = count;
  const office = entries.some(entry => entry.name === 'xl/workbook.xml' || entry.name === 'word/document.xml')
    || entries.some(entry => entry.name === 'mimetype') && entries.some(entry => entry.name === 'content.xml');
  const inspected: Awaited<ReturnType<typeof inspectEntry>>[] = [];
  for (const entry of entries.filter(entry => !entry.name.endsWith('/'))) {
    // Office signatures/sheet lists come from the directory plus workbook/mimetype, never cells/document text.
    if (office && !['xl/workbook.xml', 'mimetype'].includes(entry.name)) {
      inspected.push({ member: { name: entry.name, sizeBytes: entry.size, compressedBytes: entry.compressed,
        format: 'unknown', family: 'unknown', refusalCode: zipMemberRefusal(entry, depth), companions: [], card: null },
      bytes: null });
    } else inspected.push(await inspectEntry(read, entry, offset, probe));
  }
  officeKind(card, inspected);
  groupSidecars(inspected, card);
}
