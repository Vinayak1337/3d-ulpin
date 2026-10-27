import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { partPicture } from './pixels';
import { decodePart } from './decode';
import { decodeTiff, SurfaceRefusal } from './tiff';

/**
 * test_only: a TIFF in the layout raster_window.py writes (seen on the reader's NYC windows): little-endian, strips of
 * `rows` rows, deflate, chunky, no predictor, then an internal 1-bit mask image (NewSubfileType 4).
 */
interface Fixture {
  width: number; height: number; bands: number; bits: number; format: 1 | 2 | 3; samples: Uint8Array;
  photometric?: number; extra?: number; nodata?: string; mask?: Uint8Array; compression?: number; tiled?: boolean;
  rows?: number;
}

type Entry = [tag: number, type: 2 | 3 | 4, values: number[] | string];

function strips(bytes: Uint8Array, rowBytes: number, height: number, rows: number, compression: number) {
  const out: Uint8Array[] = [];
  for (let row = 0; row < height; row += rows) {
    const raw = bytes.subarray(row * rowBytes, Math.min(height, row + rows) * rowBytes);
    out.push(compression === 1 ? raw : new Uint8Array(deflateSync(raw)));
  }
  return out;
}

function writeTiff(f: Fixture): ArrayBuffer {
  const rows = f.rows ?? 8, compression = f.compression ?? 8;
  const images: { entries: Entry[]; data: Uint8Array[] }[] = [];
  const main: Entry[] = [[256, 3, [f.width]], [257, 3, [f.height]], [258, 3, Array(f.bands).fill(f.bits)],
    [259, 3, [compression]], [262, 3, [f.photometric ?? (f.bands >= 3 ? 2 : 1)]], [277, 3, [f.bands]],
    [278, 3, [rows]], [284, 3, [1]], [317, 3, [1]], [339, 3, Array(f.bands).fill(f.format)]];
  if (f.extra !== undefined) main.push([338, 3, [f.extra]]);
  if (f.nodata !== undefined) main.push([42113, 2, `${f.nodata}\0`]);
  if (f.tiled) main.push([322, 3, [256]]);
  const stride = f.width * f.bands * (f.bits / 8);
  images.push({ entries: main, data: strips(f.samples, stride, f.height, rows, compression) });
  if (f.mask) {
    const rowBytes = Math.ceil(f.width / 8), packed = new Uint8Array(rowBytes * f.height);
    f.mask.forEach((on, pixel) => {
      const row = Math.floor(pixel / f.width), col = pixel % f.width;
      if (on) packed[row * rowBytes + (col >> 3)]! |= 0x80 >> (col & 7);
    });
    images.push({ entries: [[254, 4, [4]], [256, 3, [f.width]], [257, 3, [f.height]], [258, 3, [1]],
      [259, 3, [compression]], [262, 3, [4]], [277, 3, [1]], [278, 3, [rows]], [284, 3, [1]]],
    data: strips(packed, rowBytes, f.height, rows, compression) });
  }
  const chunks: number[] = [0x49, 0x49, 42, 0, 0, 0, 0, 0];
  const u16 = (at: number, v: number) => { chunks[at] = v & 255; chunks[at + 1] = v >> 8; };
  const u32 = (at: number, v: number) => { for (let i = 0; i < 4; i++) chunks[at + i] = (v >>> (8 * i)) & 255; };
  const push = (bytes: ArrayLike<number>) => {
    const at = chunks.length;
    for (const b of Array.from(bytes)) chunks.push(b);
    return at;
  };
  let link = 4;
  for (const image of images) {
    const offsets = image.data.map((strip) => push(strip));
    const entries: Entry[] = [...image.entries, [273, 4, offsets], [279, 4, image.data.map((s) => s.length)]];
    entries.sort((a, b) => a[0] - b[0]);
    const values = entries.map(([, type, v]) => {
      const bytes = typeof v === 'string' ? Array.from(v, (c) => c.charCodeAt(0))
        : v.flatMap((n) => (type === 3 ? [n & 255, n >> 8] : [n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24]));
      return { bytes, count: typeof v === 'string' ? v.length : v.length };
    });
    const ifd = chunks.length;
    u32(link, ifd);
    push(new Uint8Array(2 + entries.length * 12 + 4));
    u16(ifd, entries.length);
    entries.forEach(([tag, type], n) => {
      const at = ifd + 2 + n * 12, { bytes, count } = values[n]!;
      u16(at, tag); u16(at + 2, type); u32(at + 4, count);
      if (bytes.length <= 4) bytes.forEach((b, i) => { chunks[at + 8 + i] = b; });
      else u32(at + 8, push(bytes));
    });
    link = ifd + 2 + entries.length * 12;
  }
  return new Uint8Array(chunks).buffer;
}

/** Sets the first value of a tag of the first image, in place. */
function patchTag(buffer: ArrayBuffer, tag: number, value: number) {
  const view = new DataView(buffer), ifd = view.getUint32(4, true);
  for (let n = 0; n < view.getUint16(ifd, true); n++) {
    const at = ifd + 2 + n * 12;
    if (view.getUint16(at, true) !== tag) continue;
    if (view.getUint16(at + 2, true) === 3) view.setUint16(at + 8, value, true);
    else view.setUint32(at + 8, value, true);
  }
}

const rgba = (width: number, height: number) =>
  Uint8Array.from({ length: width * height * 4 }, (_, i) => (i * 7) % 256);

function demFixture() {
  const width = 64, height = 143, nodata = -3.4028234663852886e38;
  const values = Float32Array.from({ length: width * height }, (_, i) => (i % 5 === 0 ? nodata : 10 + (i % 97) / 4));
  const mask = Uint8Array.from({ length: width * height }, (_, i) => (i < width ? 0 : 1));
  return { values, mask, fixture: { width, height, bands: 1, bits: 32, format: 3 as const, rows: 32,
    samples: new Uint8Array(values.buffer), nodata: '-3.4028234663852886e+38', mask } };
}

describe('the reader\'s own TIFF window', () => {
  it('reads an RGBA window with its alpha band and mask, and draws it as written', async () => {
    const samples = rgba(256, 256), mask = Uint8Array.from({ length: 256 * 256 }, (_, i) => (i % 9 ? 1 : 0));
    const window = await decodeTiff(writeTiff({ width: 256, height: 256, bands: 4, bits: 8, format: 1, samples,
      extra: 2, mask }));
    expect([window.width, window.height, window.bands, window.sampleType, window.alpha])
      .toEqual([256, 256, 4, 'u8', true]);
    expect(Array.from(window.samples.subarray(0, 8))).toEqual(Array.from(samples.subarray(0, 8)));
    const picture = partPicture(window);
    expect(picture.shading).toBe('as_written');
    expect(Array.from(picture.rgba.subarray(4, 8))).toEqual(Array.from(samples.subarray(4, 8)));
    expect(picture.rgba[3]).toBe(0); // pixel 0 is masked
    expect(picture.note).toBeNull();
  });

  it('draws three bands opaque and says a fourth band not marked alpha is not drawn', async () => {
    const rgb = await decodeTiff(writeTiff({ width: 10, height: 3, bands: 3, bits: 8, format: 1,
      samples: rgba(10, 3).subarray(0, 90) }));
    expect(partPicture(rgb).rgba[3]).toBe(255);
    const four = await decodeTiff(writeTiff({ width: 10, height: 3, bands: 4, bits: 8, format: 1,
      samples: rgba(10, 3), extra: 0 }));
    expect(partPicture(four).note).toBe('The fourth band is not marked alpha, so it is not drawn.');
  });

  it('reads a single-band float window and shades it grey by the part\'s own range, no-data transparent', async () => {
    const { values, mask, fixture } = demFixture();
    const window = await decodeTiff(writeTiff(fixture));
    expect(window.sampleType).toBe('f32');
    expect(Array.from(window.samples.subarray(64, 70))).toEqual(Array.from(values.subarray(64, 70)));
    expect(Array.from(window.mask!.subarray(62, 66))).toEqual(Array.from(mask.subarray(62, 66)));
    const picture = partPicture(window);
    const valid = Array.from(values).filter((v, i) => i % 5 && mask[i]);
    expect(picture.shading).toBe('own_range');
    expect(picture.range).toEqual([Math.min(...valid), Math.max(...valid)]);
    expect(picture.rgba[(fixture.width + 1) * 4 + 3]).toBe(0); // pixel 65 holds the no-data value as written
    expect(picture.rgba[3]).toBe(0); // masked
    const high = values.indexOf(Math.max(...valid), fixture.width);
    expect(Array.from(picture.rgba.subarray(high * 4, high * 4 + 4))).toEqual([255, 255, 255, 255]);
  });

  it('shades adjacent one-band parts on one stated range, clamps, and keeps no-data cut out', async () => {
    const valueRange = { kind: 'band' as const, low: 0, high: 100, basis: 'test_only overview control' };
    const pictures = [];
    for (const values of [[0, 50, 60, -1, 101, -999, 50], [40, 50, 100, -10, 120, -999, 50]]) {
      const bytes = writeTiff({ width: 7, height: 1, bands: 1, bits: 32, format: 3,
        samples: new Uint8Array(new Float32Array(values).buffer), nodata: '-999',
        mask: new Uint8Array([1, 1, 1, 1, 1, 1, 0]) });
      const reply = await decodePart({ kind: 'raster', bytes, valueRange });
      if (!('kind' in reply) || reply.kind !== 'raster') throw new Error('Expected a picture.');
      pictures.push(reply.picture);
      const own = partPicture(await decodeTiff(bytes));
      expect(own.shading).toBe('own_range');
      expect(own.range).toEqual([values[3], values[4]]);
      expect(own.rgba[4]).toBe(Math.round((50 - values[3]!) / (values[4]! - values[3]!) * 255));
      expect(reply.picture.shading).toBe('item_range');
      expect(reply.picture.range).toEqual([0, 100]);
      const greys = Array.from(reply.picture.rgba.filter((_, i) => i % 4 === 0));
      expect(greys).toEqual([Math.round(values[0]! / 100 * 255), 128,
        Math.round(values[2]! / 100 * 255), 0, 255, 0, 0]);
      expect(reply.picture.rgba[23]).toBe(0); // no-data
      expect(reply.picture.rgba[27]).toBe(0); // mask
    }
    expect(pictures[0]!.rgba.slice(4, 8)).toEqual(pictures[1]!.rgba.slice(4, 8));
  });

  it('keeps an all-no-data part transparent on a stated range', async () => {
    const window = await decodeTiff(writeTiff({ width: 2, height: 1, bands: 1, bits: 8, format: 1,
      samples: new Uint8Array([0, 0]), nodata: '0' }));
    const valueRange = { kind: 'band' as const, low: 0, high: 100, basis: 'test_only overview control' };
    for (const range of [undefined, valueRange]) {
      const picture = partPicture(window, range);
      expect(picture.rgba.every(v => v === 0)).toBe(true);
      expect(picture.note).toBe('Every pixel of this part is no-data.');
    }
  });

  it('refuses a TIFF compressed other than the reader\'s deflate, with words', async () => {
    const lzw = writeTiff({ width: 4, height: 4, bands: 3, bits: 8, format: 1, samples: rgba(4, 4).subarray(0, 48),
      compression: 1 });
    patchTag(lzw, 259, 5);
    await expect(decodeTiff(lzw)).rejects.toThrow(/compressed with TIFF scheme 5; the map reads only the reader's own/);
  });

  it('refuses a tiled TIFF and a window over 256 pixels, with words', async () => {
    const tiled = writeTiff({ width: 4, height: 4, bands: 1, bits: 8, format: 1, samples: new Uint8Array(16),
      tiled: true });
    await expect(decodeTiff(tiled)).rejects.toThrow('This part is tiled; the map reads only the reader\'s own strips.');
    const wide = writeTiff({ width: 257, height: 1, bands: 1, bits: 8, format: 1, samples: new Uint8Array(257) });
    await expect(decodeTiff(wide)).rejects.toBeInstanceOf(SurfaceRefusal);
  });

  it('refuses a strip that inflates to more than its rows', async () => {
    const bytes = new Uint8Array(writeTiff({ width: 4, height: 2, bands: 1, bits: 8, format: 1,
      samples: new Uint8Array(8), rows: 2 }));
    const bomb = new Uint8Array(deflateSync(new Uint8Array(4096)));
    const copy = new Uint8Array(bytes.length + bomb.length);
    copy.set(bytes);
    copy.set(bomb, bytes.length);
    patchTag(copy.buffer, 273, bytes.length);
    patchTag(copy.buffer, 279, bomb.length);
    await expect(decodeTiff(copy.buffer)).rejects.toThrow('A strip of this part holds more than its rows.');
  });
});

/**
 * Real reader windows: set ULPIN_SURFACE_WINDOWS to a folder of artifacts written by raster_window.py, with the
 * reader's metadata of each in meta.json. Every pixel the reader counts as masked is transparent, and no other.
 */
const REAL = process.env.ULPIN_SURFACE_WINDOWS;
describe.skipIf(!REAL)('the reader\'s real NYC windows', () => {
  it('decodes every window, keeps the reader\'s masked pixels clear and times each part', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const meta = JSON.parse(readFileSync(`${REAL}/meta.json`, 'utf8'));
    const timings: Record<string, { ms: number; shading: string; range: [number, number] | null }> = {};
    for (const name of readdirSync(REAL!).filter((file) => file.endsWith('.tif')).sort()) {
      const bytes = readFileSync(`${REAL}/${name}`);
      const started = performance.now();
      const own = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length);
      const picture = partPicture(await decodeTiff(own));
      const ms = Math.round((performance.now() - started) * 10) / 10;
      timings[name] = { ms, shading: picture.shading, range: picture.range };
      const clear = picture.rgba.filter((value, i) => i % 4 === 3 && value === 0).length;
      expect(clear, name).toBe(meta[name].bands[0].maskedPixels);
    }
    console.info(JSON.stringify(timings));
    expect(Object.keys(timings).length).toBeGreaterThan(0);
  });
});
