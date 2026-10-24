/**
 * The raster reader's own window layout (services/geo/geo/raster_window.py), decoded for display only: a classic
 * TIFF of at most 256 x 256 pixels and 4 bands in strips, uncompressed or deflate, samples interleaved, no
 * predictor, with an optional internal mask. Anything else is refused with words, never guessed at.
 */
export const TIFF_LIMITS = Object.freeze({ side: 256, bands: 4, bytes: 4 * 1024 * 1024, ifds: 4, entries: 64 });

/** A part the map does not draw: the words say why. Its outline is still drawn. */
export class SurfaceRefusal extends Error {}

export type Samples = Uint8Array | Int8Array | Uint16Array | Int16Array | Uint32Array | Int32Array | Float32Array
  | Float64Array;

export interface TiffWindow {
  width: number;
  height: number;
  bands: number;
  /** Bands interleaved per pixel, as written. */
  samples: Samples;
  sampleType: string;
  /** One byte per pixel, 0 where the mask hides it; null when the file has no mask. */
  mask: Uint8Array | null;
  /** The GDAL no-data value as written; null when absent. */
  nodata: number | null;
  /** The last band is marked alpha by ExtraSamples. */
  alpha: boolean;
}

const TAG = {
  subfile: 254, width: 256, height: 257, bits: 258, compression: 259, photometric: 262, stripOffsets: 273,
  samplesPerPixel: 277, rowsPerStrip: 278, stripBytes: 279, planar: 284, predictor: 317, tileWidth: 322,
  extraSamples: 338, sampleFormat: 339, gdalNodata: 42113,
} as const;
const TYPE_BYTES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 6: 1, 8: 2, 9: 4, 11: 4, 12: 8, 16: 8 };
const DEFLATE = new Set([8, 32946]);
const SAMPLES: Record<string, new (buffer: ArrayBuffer) => Samples> = {
  u8: Uint8Array, i8: Int8Array, u16: Uint16Array, i16: Int16Array, u32: Uint32Array, i32: Int32Array,
  f32: Float32Array, f64: Float64Array,
};

function refuse(words: string): never {
  throw new SurfaceRefusal(words);
}

type Ifd = Map<number, number[] | string>;

class Reader {
  readonly view: DataView;
  readonly little: boolean;
  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const order = String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0);
    if (order !== 'II' && order !== 'MM') refuse('This part is not a TIFF.');
    this.little = order === 'II';
    const magic = this.u16(2);
    if (magic === 43) refuse('This part is a BigTIFF, which is not the reader\'s window layout.');
    if (magic !== 42) refuse('This part is not a TIFF.');
  }

  u16(at: number): number {
    this.inside(at, 2);
    return this.view.getUint16(at, this.little);
  }

  u32(at: number): number {
    this.inside(at, 4);
    return this.view.getUint32(at, this.little);
  }

  inside(at: number, length: number): void {
    if (at < 0 || at + length > this.bytes.byteLength) refuse('This part\'s TIFF points outside its own bytes.');
  }

  /** Each image directory in order, at most the bounded count. */
  ifds(): Ifd[] {
    const out: Ifd[] = [];
    for (let at = this.u32(4); at; at = this.u32(at + 2 + 12 * (this.u16(at)))) {
      if (out.length === TIFF_LIMITS.ifds) refuse('This part\'s TIFF holds more images than the reader writes.');
      out.push(this.ifd(at));
    }
    return out;
  }

  private ifd(at: number): Ifd {
    const count = this.u16(at);
    if (count > TIFF_LIMITS.entries) refuse('This part\'s TIFF has more tags than the reader writes.');
    const tags: Ifd = new Map();
    for (let n = 0; n < count; n++) {
      const entry = at + 2 + 12 * n;
      const tag = this.u16(entry), type = this.u16(entry + 2), values = this.u32(entry + 4);
      const size = TYPE_BYTES[type];
      if (!size) continue;
      const start = size * values <= 4 ? entry + 8 : this.u32(entry + 8);
      this.inside(start, size * values);
      tags.set(tag, type === 2 ? this.ascii(start, values) : this.numbers(start, type, values));
    }
    return tags;
  }

  private ascii(at: number, length: number) {
    return new TextDecoder('latin1').decode(this.bytes.subarray(at, at + length)).replace(/\0+$/, '');
  }

  private numbers(at: number, type: number, count: number): number[] {
    const read: Record<number, (offset: number) => number> = {
      1: (o) => this.view.getUint8(o), 3: (o) => this.view.getUint16(o, this.little),
      4: (o) => this.view.getUint32(o, this.little), 6: (o) => this.view.getInt8(o),
      8: (o) => this.view.getInt16(o, this.little), 9: (o) => this.view.getInt32(o, this.little),
      11: (o) => this.view.getFloat32(o, this.little), 12: (o) => this.view.getFloat64(o, this.little),
    };
    const one = read[type];
    if (!one) return [];
    return Array.from({ length: count }, (_, n) => one(at + n * TYPE_BYTES[type]!));
  }
}

const first = (ifd: Ifd, tag: number, fallback?: number): number => {
  const value = ifd.get(tag);
  if (Array.isArray(value) && value.length) return value[0]!;
  return fallback ?? refuse(`This part's TIFF lacks tag ${tag}.`);
};
const list = (ifd: Ifd, tag: number): number[] => {
  const value = ifd.get(tag);
  return Array.isArray(value) ? value : refuse(`This part's TIFF lacks tag ${tag}.`);
};

/** Inflates one zlib strip into exactly `length` bytes, refusing a strip that holds more or less. */
async function inflate(data: Uint8Array, length: number): Promise<Uint8Array> {
  const out = new Uint8Array(length);
  const reader = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
  let at = 0;
  try {
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      if (at + chunk.value.byteLength > length) {
        await reader.cancel();
        refuse('A strip of this part holds more than its rows.');
      }
      out.set(chunk.value, at);
      at += chunk.value.byteLength;
    }
  } catch (error) {
    if (error instanceof SurfaceRefusal) throw error;
    refuse('A strip of this part could not be inflated.');
  }
  if (at !== length) refuse('A strip of this part holds fewer bytes than its rows.');
  return out;
}

/** The strips of one image, each inflated or copied, joined in row order. */
async function stripBytes(reader: Reader, ifd: Ifd, rowBytes: number, height: number): Promise<Uint8Array> {
  const compression = first(ifd, TAG.compression, 1);
  if (compression !== 1 && !DEFLATE.has(compression)) refuse(`This part is compressed with TIFF scheme `
    + `${compression}; the map reads only the reader's own deflate or uncompressed strips.`);
  if (ifd.has(TAG.tileWidth)) refuse('This part is tiled; the map reads only the reader\'s own strips.');
  if (first(ifd, TAG.predictor, 1) !== 1) refuse('This part uses a TIFF predictor, which the reader never writes.');
  const offsets = list(ifd, TAG.stripOffsets), counts = list(ifd, TAG.stripBytes);
  const rows = Math.min(first(ifd, TAG.rowsPerStrip, height), height);
  if (rows < 1 || offsets.length !== Math.ceil(height / rows) || counts.length !== offsets.length)
    refuse('This part\'s strips do not cover its rows.');
  const out = new Uint8Array(rowBytes * height);
  for (let strip = 0; strip < offsets.length; strip++) {
    const length = rowBytes * Math.min(rows, height - strip * rows);
    reader.inside(offsets[strip]!, counts[strip]!);
    const data = reader.bytes.subarray(offsets[strip]!, offsets[strip]! + counts[strip]!);
    if (compression === 1 && data.byteLength !== length) refuse('An uncompressed strip of this part is cut short.');
    out.set(compression === 1 ? data : await inflate(data, length), strip * rows * rowBytes);
  }
  return out;
}

function sampleKind(ifd: Ifd, bands: number): string {
  const bits = list(ifd, TAG.bits), formats = ifd.has(TAG.sampleFormat) ? list(ifd, TAG.sampleFormat) : [1];
  if (bits.length !== bands || new Set(bits).size !== 1 || new Set(formats).size !== 1)
    refuse('The bands of this part have different sample types.');
  const kind = `${({ 1: 'u', 2: 'i', 3: 'f' } as Record<number, string>)[formats[0]!] ?? '?'}${bits[0]}`;
  return SAMPLES[kind] ? kind : refuse(`This part's samples (${kind}) are not drawn by the map.`);
}

function toSamples(bytes: Uint8Array, kind: string, little: boolean): Samples {
  const size = Number(kind.slice(1)) / 8;
  // Browsers are little-endian: a big-endian file's samples are turned around once.
  if (!little && size > 1) for (let at = 0; at < bytes.length; at += size) bytes.subarray(at, at + size).reverse();
  return new SAMPLES[kind]!(bytes.buffer as ArrayBuffer);
}

/** The internal mask image (NewSubfileType 4): one byte per pixel, 0 where hidden. */
async function maskOf(reader: Reader, ifd: Ifd | undefined, width: number, height: number) {
  if (!ifd) return null;
  if (first(ifd, TAG.width) !== width || first(ifd, TAG.height) !== height || first(ifd, TAG.bits, 1) !== 1)
    refuse('This part\'s mask does not match its pixels.');
  const rowBytes = Math.ceil(width / 8);
  const packed = await stripBytes(reader, ifd, rowBytes, height);
  const mask = new Uint8Array(width * height);
  for (let row = 0; row < height; row++) for (let col = 0; col < width; col++)
    mask[row * width + col] = (packed[row * rowBytes + (col >> 3)]! >> (7 - (col & 7))) & 1;
  return mask;
}

/** Decodes one raster part written by the reader, or refuses it with words. */
export async function decodeTiff(buffer: ArrayBuffer): Promise<TiffWindow> {
  if (buffer.byteLength > TIFF_LIMITS.bytes) refuse('This part is larger than the reader\'s 4 MiB window.');
  const reader = new Reader(new Uint8Array(buffer));
  const [image, ...rest] = reader.ifds();
  if (!image) refuse('This part\'s TIFF holds no image.');
  const width = first(image, TAG.width), height = first(image, TAG.height);
  const bands = first(image, TAG.samplesPerPixel, 1);
  if (width < 1 || height < 1 || width > TIFF_LIMITS.side || height > TIFF_LIMITS.side)
    refuse(`This part is ${width} x ${height} pixels; the reader writes at most 256 x 256.`);
  if (bands < 1 || bands > TIFF_LIMITS.bands) refuse(`This part has ${bands} bands; the reader writes at most 4.`);
  if (bands > 1 && first(image, TAG.planar, 1) !== 1) refuse('This part stores its bands apart, '
    + 'which the reader never writes.');
  if (![1, 2].includes(first(image, TAG.photometric, 1))) refuse('The colour model of this part is not one the '
    + 'reader writes (grey or RGB).');
  const kind = sampleKind(image, bands);
  const rowBytes = width * bands * (Number(kind.slice(1)) / 8);
  const samples = toSamples(await stripBytes(reader, image, rowBytes, height), kind, reader.little);
  const maskIfd = rest.find((ifd) => (first(ifd, TAG.subfile, 0) & 4) === 4);
  const nodata = image.get(TAG.gdalNodata);
  const extra = image.has(TAG.extraSamples) ? list(image, TAG.extraSamples) : [];
  return {
    width, height, bands, samples, sampleType: kind, mask: await maskOf(reader, maskIfd, width, height),
    nodata: typeof nodata === 'string' && nodata.trim() ? Number(nodata) : null,
    alpha: [1, 2].includes(extra[extra.length - 1] ?? 0),
  };
}
