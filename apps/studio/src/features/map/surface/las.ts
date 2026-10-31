import { POINT_BATCH_RECORD_LENGTHS } from '@ulpin/contracts/usp/plain';
import type { PartDisplay } from './parts';
import { POINT_BATCH_LIMITS } from '@ulpin/contracts/upload-reader-limits';
import { SurfaceRefusal } from './tiff';

/** Native LAS batches; format 6 remains the default for earlier stored display reads. */
export const LAS_LIMITS = Object.freeze({ record: 30, points: POINT_BATCH_LIMITS.batchPoints });
/** Drawn point size in metres. */
export const POINT_SIZE_M = 0.6;

type XY = readonly [number, number];
/** Placed corners in local metres, as the display read lists them: NW, NE, SE, SW. */
export type PlacedCorners = readonly [XY, XY, XY, XY];

/** The raw X, Y and Z integers of a batch's records; scale and offset are the reader's, never applied here. */
export function readLasRecords(buffer: ArrayBuffer, recordLength: number = LAS_LIMITS.record) {
  if (!(Object.values(POINT_BATCH_RECORD_LENGTHS) as number[]).includes(recordLength))
    throw new SurfaceRefusal('This batch has an unsupported LAS record length.');
  const count = buffer.byteLength / recordLength;
  if (!Number.isInteger(count) || count < 1) throw new SurfaceRefusal('This batch is not whole native LAS records.');
  if (count > LAS_LIMITS.points) throw new SurfaceRefusal(`This batch holds ${count} points; the reader writes `
    + `at most ${LAS_LIMITS.points}.`);
  const view = new DataView(buffer);
  const x = new Int32Array(count), y = new Int32Array(count), z = new Int32Array(count);
  for (let n = 0, at = 0; n < count; n++, at += recordLength) {
    x[n] = view.getInt32(at, true);
    y[n] = view.getInt32(at + 4, true);
    z[n] = view.getInt32(at + 8, true);
  }
  return { count, x, y, z };
}

/** Low to high: blue-grey, teal, green, amber, red. */
const RAMP: readonly (readonly [number, number, number])[] = [
  [0.27, 0.42, 0.62], [0.31, 0.62, 0.66], [0.55, 0.74, 0.47], [0.93, 0.76, 0.35], [0.88, 0.4, 0.27],
];

function rampColour(t: number, out: Float32Array, at: number) {
  const scaled = Math.min(1, Math.max(0, t)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(scaled)), k = scaled - i;
  for (let c = 0; c < 3; c++) out[at + c] = RAMP[i]![c]! + (RAMP[i + 1]![c]! - RAMP[i]![c]!) * k;
}

const span = (values: Int32Array) => {
  let low = Infinity, high = -Infinity;
  for (const value of values) { low = Math.min(low, value); high = Math.max(high, value); }
  return [low, high - low] as const;
};

/**
 * Flat points at their placed XY. The display read places the batch's native XY extent at four corners; each point
 * keeps its place inside that extent, interpolated between the corners. Raw Z colours use the item's stated range,
 * or the batch's own rank when absent. Z never moves a point and is never a height of anything.
 */
export function placeBatch(records: ReturnType<typeof readLasRecords>, [nw, ne, se, sw]: PlacedCorners,
  valueRange?: PartDisplay['valueRange']) {
  const { count, x, y, z } = records;
  const [x0, dx] = span(x), [y0, dy] = span(y);
  const positions = new Float32Array(count * 3), colors = new Float32Array(count * 3);
  for (let n = 0; n < count; n++) {
    const u = dx ? (x[n]! - x0) / dx : 0.5, v = dy ? (y[n]! - y0) / dy : 0.5;
    for (let axis = 0; axis < 2; axis++) {
      const south = sw[axis]! + (se[axis]! - sw[axis]!) * u, north = nw[axis]! + (ne[axis]! - nw[axis]!) * u;
      positions[n * 3 + axis] = south + (north - south) * v;
    }
  }
  if (valueRange?.kind === 'z') {
    const dz = valueRange.high - valueRange.low;
    for (let n = 0; n < count; n++)
      rampColour(dz > 0 ? (z[n]! - valueRange.low) / dz : 0.5, colors, n * 3);
    return { positions, colors, sizeM: POINT_SIZE_M };
  }
  const order = Array.from({ length: count }, (_, n) => n).sort((a, b) => z[a]! - z[b]!);
  let rank = 0;
  order.forEach((n, at) => {
    if (at && z[n] !== z[order[at - 1]!]) rank = at; // equal Z, equal colour
    rampColour(count > 1 ? rank / (count - 1) : 0.5, colors, n * 3);
  });
  return { positions, colors, sizeM: POINT_SIZE_M };
}
