export interface ImageryProfile {
  width: number;
  height: number;
  bands: number;
  projectedCSTypeGeoKey: number | undefined;
}

export type ImageryReply = { profile: ImageryProfile; rgba?: Uint8ClampedArray } | { error: string };

/** Keep the browser preview's existing size and verified-profile refusals in one place. */
export function imageryRefusal(profile: ImageryProfile): string | null {
  if (profile.width * profile.height > 16_000_000) {
    return 'Raster exceeds the bounded browser preview size';
  }
  if (![3, 4].includes(profile.bands) || profile.projectedCSTypeGeoKey !== 3857) {
    return 'Only the verified Web Mercator RGB/RGBA imagery profile is supported';
  }
  return null;
}

/** Interleaved RGB/RGBA samples to canvas bytes; preserve source row order and canvas clamping. */
export function rasterToRgba(raster: ArrayLike<number>, pixels: number, bands: 3 | 4): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(pixels * 4);
  for (let pixel = 0, sample = 0; pixel < pixels; pixel++, sample += bands) {
    const offset = pixel * 4;
    rgba[offset] = raster[sample]!;
    rgba[offset + 1] = raster[sample + 1]!;
    rgba[offset + 2] = raster[sample + 2]!;
    rgba[offset + 3] = bands === 4 ? raster[sample + 3]! : 255;
  }
  return rgba;
}
