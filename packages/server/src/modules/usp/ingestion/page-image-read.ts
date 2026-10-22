import sharp from 'sharp';
import { INTAKE_PAGE_IMAGE_LIMITS as limits, type IntakeCard, type IntakePageImageLabel,
  type IntakePageImageRead } from '@ulpin/contracts/usp';
import { sha256 } from '../../../infrastructure/storage';

/**
 * G23. Pass 1 of a page image: what its own bytes state, read natively, and one bounded preview. No model, no
 * provider, no OCR, no geometry and no georeference. Unknown stays null; nothing is guessed from the file name.
 */
export type PageImageFormat = IntakePageImageRead['format'];
export type PageImageHeader = Omit<IntakePageImageRead, 'version' | 'preview' | 'previewLimit' | 'label'>
  & { georeferenced: boolean };
export type PageImagePreview = { bytes: Buffer; width: number; height: number; orientationApplied: number | null };

const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
const PNG_BANDS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
// ModelPixelScale, ModelTiepoint, ModelTransformation, GeoKeyDirectory: any one places the image on the ground.
const GEO_TAGS = new Set([33550, 33922, 34264, 34735]);

const FORMATS: readonly string[] = ['jpeg', 'png', 'tiff'] satisfies PageImageFormat[];
export const asPageImageFormat = (format: unknown) =>
  typeof format === 'string' && FORMATS.includes(format) ? format as PageImageFormat : null;

/** A page image is a JPEG or PNG by signature, or a TIFF the probe read without any georeference tag (D1, D4). */
export const pageImageFormat = (card: IntakeCard | null) => card?.family === 'image' ? asPageImageFormat(card.format)
  : null;

function emptyHeader(format: PageImageFormat): PageImageHeader {
  return { format, width: null, height: null, bands: null, bitDepth: null, orientation: null, captureTime: null,
    locationStated: false, dpi: null, georeferenced: false };
}

type Ifd = { tags: Map<number, { type: number; count: number; at: number }>; read: TiffReader };
type TiffReader = { little: boolean; u16: (at: number) => number; u32: (at: number) => number; bytes: Buffer;
  base: number };
const SIZES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1 };

function tiffReader(bytes: Buffer, base: number): TiffReader | null {
  if (base + 8 > bytes.length) return null;
  const order = bytes.toString('latin1', base, base + 2);
  if (order !== 'II' && order !== 'MM') return null;
  const little = order === 'II';
  const u16 = (at: number) => little ? bytes.readUInt16LE(base + at) : bytes.readUInt16BE(base + at);
  const u32 = (at: number) => little ? bytes.readUInt32LE(base + at) : bytes.readUInt32BE(base + at);
  return u16(2) === 42 ? { little, u16, u32, bytes, base } : null;
}

/** One IFD's entries with their value offsets, relative to the TIFF header; entries outside the bytes are skipped. */
function readIfd(read: TiffReader, offset: number): Ifd | null {
  const limit = read.bytes.length - read.base;
  if (offset < 8 || offset + 2 > limit) return null;
  const entries = read.u16(offset);
  const tags: Ifd['tags'] = new Map();
  for (let index = 0; index < entries && offset + 2 + index * 12 + 12 <= limit; index++) {
    const entry = offset + 2 + index * 12;
    const type = read.u16(entry + 2), count = read.u32(entry + 4), size = (SIZES[type] ?? 0) * count;
    const at = size <= 4 ? entry + 8 : read.u32(entry + 8);
    if (size && at + size <= limit) tags.set(read.u16(entry), { type, count, at });
  }
  return { tags, read };
}

function ifdNumber(ifd: Ifd, tag: number): number | null {
  const entry = ifd.tags.get(tag);
  if (!entry) return null;
  if (entry.type === 3) return ifd.read.u16(entry.at);
  if (entry.type === 4) return ifd.read.u32(entry.at);
  if (entry.type === 5) {
    const denominator = ifd.read.u32(entry.at + 4);
    return denominator ? ifd.read.u32(entry.at) / denominator : null;
  }
  return null;
}

function ifdText(ifd: Ifd, tag: number): string | null {
  const entry = ifd.tags.get(tag);
  if (!entry || entry.type !== 2) return null;
  const start = ifd.read.base + entry.at;
  const value = ifd.read.bytes.toString('latin1', start, start + entry.count).replace(/\0.*$/s, '').trim();
  return value && value.length <= 64 && /^[\x20-\x7e]+$/.test(value) ? value : null;
}

const positive = (value: number | null) => value !== null && Number.isFinite(value) && value > 0 ? value : null;
const round = (value: number) => Math.round(value * 100) / 100;

/** EXIF/TIFF resolution as stated: unit 2 is the inch, 3 the centimetre; with no unit stated TIFF means the inch. */
function ifdDpi(ifd: Ifd, statedIn: 'exif' | 'tiff'): PageImageHeader['dpi'] {
  const x = positive(ifdNumber(ifd, 282)), y = positive(ifdNumber(ifd, 283));
  const unit = ifdNumber(ifd, 296) ?? 2;
  if (x === null || y === null || (unit !== 2 && unit !== 3)) return null;
  const scale = unit === 3 ? 2.54 : 1;
  return { x: round(x * scale), y: round(y * scale), statedIn };
}

/** The facts an EXIF or TIFF IFD0 states: orientation, capture time, GPS presence, resolution, georeference. */
function readTiffFacts(header: PageImageHeader, read: TiffReader, statedIn: 'exif' | 'tiff', image: boolean) {
  const ifd0 = readIfd(read, read.u32(4));
  if (!ifd0) return;
  const orientation = ifdNumber(ifd0, 274);
  if (orientation !== null && orientation >= 1 && orientation <= 8) header.orientation = orientation;
  header.locationStated ||= ifd0.tags.has(34853);
  header.dpi ??= ifdDpi(ifd0, statedIn);
  const exifAt = ifdNumber(ifd0, 34665);
  const exif = exifAt === null ? null : readIfd(read, exifAt);
  if (exif) header.captureTime ??= ifdText(exif, 36867);
  if (!image) return;
  header.georeferenced = [...ifd0.tags.keys()].some(tag => GEO_TAGS.has(tag));
  header.width = ifdNumber(ifd0, 256);
  header.height = ifdNumber(ifd0, 257);
  header.bands = ifdNumber(ifd0, 277) ?? 1;
  header.bitDepth = ifdNumber(ifd0, 258) ?? 1;
}

function readJpeg(bytes: Buffer, header: PageImageHeader) {
  for (let at = 2; at + 4 <= bytes.length && bytes[at] === 0xff;) {
    const marker = bytes[at + 1];
    if (marker === 0xff) { at++; continue; }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { at += 2; continue; }
    if (marker === 0xda || marker === 0xd9) return;
    const length = bytes.readUInt16BE(at + 2), data = at + 4;
    if (length < 2 || data + length - 2 > bytes.length) return;
    if (marker === 0xe0 && bytes.toString('latin1', data, data + 5) === 'JFIF\0' && length >= 16) {
      const unit = bytes[data + 7], x = bytes.readUInt16BE(data + 8), y = bytes.readUInt16BE(data + 10);
      // Unit 0 states an aspect ratio only, never a density.
      if ((unit === 1 || unit === 2) && x && y) header.dpi ??= { x: round(unit === 2 ? x * 2.54 : x),
        y: round(unit === 2 ? y * 2.54 : y), statedIn: 'jfif' };
    }
    if (marker === 0xe1 && bytes.toString('latin1', data, data + 6) === 'Exif\0\0') {
      const read = tiffReader(bytes.subarray(0, data + length - 2), data + 6);
      if (read) readTiffFacts(header, read, 'exif', false);
    }
    if (SOF.has(marker) && length >= 8) {
      header.bitDepth = bytes[data];
      header.height = bytes.readUInt16BE(data + 1) || null;
      header.width = bytes.readUInt16BE(data + 3);
      header.bands = bytes[data + 5];
      return;
    }
    at = data + length - 2;
  }
}

function readPng(bytes: Buffer, header: PageImageHeader) {
  for (let at = 8; at + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(at), type = bytes.toString('latin1', at + 4, at + 8), data = at + 8;
    if (data + length + 4 > bytes.length || type === 'IEND') return;
    if (type === 'IHDR' && length >= 13) {
      header.width = bytes.readUInt32BE(data);
      header.height = bytes.readUInt32BE(data + 4);
      header.bitDepth = bytes[data + 8];
      header.bands = PNG_BANDS[bytes[data + 9]] ?? null;
    }
    if (type === 'pHYs' && length === 9 && bytes[data + 8] === 1) {
      // Pixels per metre; unit 0 states an aspect ratio only.
      const x = bytes.readUInt32BE(data), y = bytes.readUInt32BE(data + 4);
      if (x && y) header.dpi = { x: round(x * 0.0254), y: round(y * 0.0254), statedIn: 'png_phys' };
    }
    if (type === 'eXIf') {
      const read = tiffReader(bytes.subarray(0, data + length), data);
      if (read) readTiffFacts(header, read, 'exif', false);
    }
    at = data + length + 4;
  }
}

/** Header facts from the image's own bytes (the whole original, or its first bytes when it is above the bound). */
export function readPageImageHeader(bytes: Uint8Array, format: PageImageFormat): PageImageHeader {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const header = emptyHeader(format);
  if (format === 'jpeg') readJpeg(buffer, header);
  if (format === 'png') readPng(buffer, header);
  if (format === 'tiff') {
    const read = tiffReader(buffer, 0);
    if (read) readTiffFacts(header, read, 'tiff', true);
  }
  return header;
}

/**
 * One preview, longest side 1,024 px, orientation applied. libvips reads a JPEG at a reduced DCT scale (shrink on
 * load) and decodes PNG and stripped TIFF line by line, so no whole full-size pixel buffer is held; inputs above
 * INTAKE_PAGE_IMAGE_LIMITS.inputPixels are refused before decoding.
 */
export async function pageImagePreview(bytes: Uint8Array): Promise<PageImagePreview> {
  const image = sharp(bytes, { limitInputPixels: limits.inputPixels, sequentialRead: true, failOn: 'error' });
  // The orientation the decoder applies, which is the one the original states.
  const { orientation } = await image.metadata();
  const { data, info } = await image.rotate()
    .resize({ width: limits.previewSide, height: limits.previewSide, fit: 'inside', withoutEnlargement: true })
    .png().toBuffer({ resolveWithObject: true });
  if (data.length > limits.previewBytes) throw new Error('PAGE_IMAGE_PREVIEW_LIMIT');
  return { bytes: data, width: info.width, height: info.height, orientationApplied: orientation ?? null };
}

export const pageImagePreviewKey = (sourceId: string, bytes: Uint8Array) =>
  `page-image-previews/${sourceId}/${sha256(bytes)}.png`;

const grouped = (value: number) => value.toLocaleString('en-US');
const FORMAT_WORDS: Record<PageImageFormat, string> = { jpeg: 'JPEG', png: 'PNG', tiff: 'TIFF' };
const labelWords: Record<IntakePageImageLabel, string> = { plan: 'a plan', elevation: 'an elevation',
  photo: 'a photo', other: 'something else' };

/** What follows a label: no reader in the application takes a plan (or anything else) from a page image. */
function labelNextWords(label: IntakePageImageLabel): string {
  if (label !== 'plan') return 'It is kept as a labelled page image and is not read.';
  return 'It is kept as a labelled plan image and is not read: no plan reader in a batch takes a page image yet, '
    + 'so no text, rooms, levels or units come from it.';
}

/** D3. What it is, in an officer's words, from the read alone, and the question it rests on. */
export function pageImageWords(read: IntakePageImageRead): string {
  const size = read.width && read.height ? `${grouped(read.width)} x ${grouped(read.height)} ` : '';
  const facts = [read.captureTime ? `taken ${read.captureTime} as its EXIF states` : null,
    read.locationStated ? 'a location is stated in its EXIF but not used here' : 'no location stated',
    read.dpi ? `${read.dpi.x === read.dpi.y ? read.dpi.x : `${read.dpi.x} x ${read.dpi.y}`} DPI as stated` : null]
    .filter(Boolean).join(', ');
  const kept = `A ${size}${FORMAT_WORDS[read.format]} image, ${facts}. Kept for review as a page image`;
  const preview = read.preview ? '' : ` (${read.previewLimit ?? 'no preview was made'})`;
  if (read.label) return `${kept}${preview}. The officer said it shows ${labelWords[read.label.value]}; `
    + `this is a candidate label, not reviewed. ${labelNextWords(read.label.value)}`;
  return `${kept}${preview}. What does it show: a plan, an elevation, a photo or something else?`;
}
