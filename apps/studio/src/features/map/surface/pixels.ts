import type { PartDisplay } from './parts';
import { SurfaceRefusal, type TiffWindow } from './tiff';

/** What one raster part looks like on the map, and how it was shaded. */
export interface PartPicture {
  width: number;
  height: number;
  /** Canvas bytes, rows in the order written (first row along the part's NW–NE edge). */
  rgba: Uint8ClampedArray;
  /** RGB(A) drawn as written, or one band shaded by the item's stated range or the part's own range. */
  shading: 'as_written' | 'own_range' | 'item_range';
  /** The lowest and highest value used for shading; null when nothing is shaded. */
  range: [number, number] | null;
  /** Words for something written but not drawn; null when everything written is drawn. */
  note: string | null;
}

/** A pixel is drawn unless the mask hides it, or its value is NaN or the no-data value as written. */
function hidden(window: TiffWindow, pixel: number, value: number): boolean {
  if (window.mask && !window.mask[pixel]) return true;
  if (Number.isNaN(value)) return true;
  if (window.nodata === null) return false;
  return value === window.nodata || (window.sampleType === 'f32' && value === Math.fround(window.nodata));
}

function asWritten(window: TiffWindow): PartPicture {
  const { width, height, bands, samples, alpha } = window;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const ownAlpha = bands === 4 && alpha;
  for (let pixel = 0, at = 0; pixel < width * height; pixel++, at += bands) {
    const out = pixel * 4;
    const blank = [0, 1, 2].every((band) => hidden(window, pixel, samples[at + band]!));
    rgba[out] = samples[at]!;
    rgba[out + 1] = samples[at + 1]!;
    rgba[out + 2] = samples[at + 2]!;
    rgba[out + 3] = blank ? 0 : ownAlpha ? samples[at + 3]! : 255;
  }
  const note = bands === 4 && !alpha ? 'The fourth band is not marked alpha, so it is not drawn.' : null;
  return { width, height, rgba, shading: 'as_written', range: null, note };
}

function shaded(window: TiffWindow, valueRange?: PartDisplay['valueRange']): PartPicture {
  const { width, height, samples } = window;
  let low = Infinity, high = -Infinity;
  for (let pixel = 0; pixel < width * height; pixel++) {
    const value = samples[pixel]!;
    if (hidden(window, pixel, value)) continue;
    low = Math.min(low, value);
    high = Math.max(high, value);
  }
  const valid = Number.isFinite(low), shared = valueRange?.kind === 'band';
  if (shared) { low = valueRange.low; high = valueRange.high; }
  const rgba = new Uint8ClampedArray(width * height * 4);
  const span = high - low;
  for (let pixel = 0; pixel < width * height; pixel++) {
    const value = samples[pixel]!;
    if (hidden(window, pixel, value)) continue;
    const grey = span > 0 ? Math.round(Math.min(1, Math.max(0, (value - low) / span)) * 255) : 128;
    rgba.fill(grey, pixel * 4, pixel * 4 + 3);
    rgba[pixel * 4 + 3] = 255;
  }
  const range: [number, number] | null = Number.isFinite(low) ? [low, high] : null;
  const note = valid ? null : 'Every pixel of this part is no-data.';
  return { width, height, rgba, shading: shared ? 'item_range' : 'own_range', range, note };
}

/**
 * RGB or RGBA bytes are drawn as written; a single band uses the item's display range when stated, otherwise the
 * part's own lowest and highest value. Nothing is measured. No-data stays transparent; other layouts are refused.
 */
export function partPicture(window: TiffWindow, valueRange?: PartDisplay['valueRange']): PartPicture {
  if (window.bands === 1) return shaded(window, valueRange);
  if ((window.bands === 3 || window.bands === 4) && window.sampleType === 'u8') return asWritten(window);
  throw new SurfaceRefusal(`A part of ${window.bands} bands of ${window.sampleType} samples is not drawn; `
    + 'the map draws 8-bit RGB or RGBA, or one band shaded.');
}
