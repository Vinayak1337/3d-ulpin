import { describe, expect, it } from 'vitest';
import { LAS_LIMITS, placeBatch, readLasRecords, type PlacedCorners } from './las';
import { SurfaceRefusal } from './tiff';

/** test_only: LAS 1.4 format-6 records as point_batch.py writes them, X, Y and Z int32 at bytes 0, 4 and 8. */
function records(points: [number, number, number][]): ArrayBuffer {
  const view = new DataView(new ArrayBuffer(points.length * LAS_LIMITS.record));
  points.forEach(([x, y, z], n) => {
    view.setInt32(n * 30, x, true);
    view.setInt32(n * 30 + 4, y, true);
    view.setInt32(n * 30 + 8, z, true);
    view.setUint16(n * 30 + 12, 999, true); // intensity, never read
  });
  return view.buffer;
}

/** A 100 m square placed rotated a quarter turn: NW, NE, SE, SW. */
const turned: PlacedCorners = [[0, 0], [0, -100], [-100, -100], [-100, 0]];

describe('a batch of LAS records', () => {
  it('reads a batch of 8,192 points and lays each flat at its place in the placed corners', () => {
    const points = Array.from({ length: 8192 },
      (_, n): [number, number, number] => [n % 128, Math.floor(n / 128), n % 7]);
    points[0] = [0, 0, 5]; // the SW corner of the native extent
    const read = readLasRecords(records(points));
    expect(read.count).toBe(8192);
    const { positions, colors, sizeM } = placeBatch(read, turned);
    expect(positions.length).toBe(8192 * 3);
    expect(colors.length).toBe(8192 * 3);
    expect(sizeM).toBeGreaterThan(0);
    expect(Array.from(positions.subarray(0, 3))).toEqual([-100, 0, 0]); // SW
    const ne = 127 + 63 * 128; // x 127, y 63: the NE corner
    expect(Array.from(positions.subarray(ne * 3, ne * 3 + 3))).toEqual([0, -100, 0]);
    expect(positions.filter((_, i) => i % 3 === 2).every((z) => z === 0)).toBe(true);
  });

  it('uses the source record stride for ordinary LAS and RGB/NIR formats', () => {
    for (const length of [20, 26, 28, 30, 34, 36, 38]) {
      const view = new DataView(new ArrayBuffer(2 * length));
      view.setInt32(0, 125, true);
      view.setInt32(length, 250, true);
      view.setInt32(length + 4, -50, true);
      const read = readLasRecords(view.buffer, length);
      expect(Array.from(read.x)).toEqual([125, 250]);
      expect(Array.from(read.y)).toEqual([0, -50]);
    }
    expect(() => readLasRecords(new ArrayBuffer(44), 22)).toThrow(SurfaceRefusal);
  });

  it('colours by Z rank within the batch and never lets Z move a point', () => {
    const low = placeBatch(readLasRecords(records([[0, 0, -50], [10, 10, 7], [5, 5, 3]])), turned);
    const high = placeBatch(readLasRecords(records([[0, 0, 900000], [10, 10, 1000000], [5, 5, 950000]])), turned);
    expect(Array.from(high.positions)).toEqual(Array.from(low.positions));
    expect(Array.from(high.colors)).toEqual(Array.from(low.colors));
    const blue = Array.from(low.colors.subarray(0, 3)), red = Array.from(low.colors.subarray(3, 6));
    expect(blue[2]!).toBeGreaterThan(blue[0]!);
    expect(red[0]!).toBeGreaterThan(red[2]!);
  });

  it('refuses a batch over 8,192 points or not whole records, with words', () => {
    const over = records(Array.from({ length: 8193 }, () => [0, 0, 0]));
    expect(() => readLasRecords(over)).toThrow('This batch holds 8193 points; the reader writes at most 8192.');
    expect(() => readLasRecords(new ArrayBuffer(31))).toThrow(SurfaceRefusal);
  });
});

/** Real reader batches: lidar.*.bin in the ULPIN_SURFACE_WINDOWS folder, written by point_batch.py. */
const REAL = process.env.ULPIN_SURFACE_WINDOWS;
describe.skipIf(!REAL)('the reader\'s real NYC point batches', () => {
  it('places and colours every point of each batch, and times each part', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const timings: Record<string, { ms: number; points: number }> = {};
    for (const name of readdirSync(REAL!).filter((file) => file.endsWith('.bin')).sort()) {
      const bytes = readFileSync(`${REAL}/${name}`);
      const started = performance.now();
      const placed = placeBatch(readLasRecords(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length)),
        turned);
      timings[name] = { ms: Math.round((performance.now() - started) * 10) / 10, points: placed.positions.length / 3 };
      expect(placed.positions.every(Number.isFinite)).toBe(true);
    }
    console.info(JSON.stringify(timings));
    expect(Object.keys(timings).length).toBeGreaterThan(0);
  });
});
