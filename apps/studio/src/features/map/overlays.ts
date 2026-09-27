import { useQuery } from '@tanstack/react-query';
import type { OverlayInput } from '@ulpin/scene';

/** A supplemental dataset as the area context lists it (imagery, point cloud, elevation). */
export interface SupplementalDataset {
  sourceId: string;
  name: string;
  layer: string;
  format: string;
  captureYear?: number;
  sha256?: string;
  crs?: string;
  bounds4326?: [number, number, number, number];
  originalUrl?: string;
  derivedSurface?: { originalUrl: string; sha256?: string; resolutionM: number; verticalReference?: string; recipe?: string } | null;
}

export interface AreaReference { origin?: [number, number] | null; analysisCrs?: string | null }

/** WGS84 → UTM (Krüger series), for placing geographic corners in the area's projected frame. */
export function utmForward(lon: number, lat: number, zone: number, south = false): [number, number] {
  const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996;
  const e2 = f * (2 - f), ep2 = e2 / (1 - e2);
  const phi = (lat * Math.PI) / 180, lam = (lon * Math.PI) / 180, lam0 = (((zone - 1) * 6 - 180 + 3) * Math.PI) / 180;
  const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  const T = Math.tan(phi) ** 2, C = ep2 * Math.cos(phi) ** 2, A = Math.cos(phi) * (lam - lam0);
  const M = a * ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * phi - ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * phi)
    + ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * phi) - ((35 * e2 ** 3) / 3072) * Math.sin(6 * phi));
  const x = k0 * N * (A + ((1 - T + C) * A ** 3) / 6 + ((5 - 18 * T + T ** 2 + 72 * C - 58 * ep2) * A ** 5) / 120) + 500000;
  let y = k0 * (M + N * Math.tan(phi) * (A ** 2 / 2 + ((5 - T + 9 * C + 4 * C ** 2) * A ** 4) / 24 + ((61 - 58 * T + T ** 2 + 600 * C - 330 * ep2) * A ** 6) / 720));
  if (south) y += 10000000;
  return [x, y];
}

/** UTM zone of an EPSG:326xx / 327xx / NAD83 269xx / 6330-series code, or null. */
export function utmZone(crs: string | null | undefined): { zone: number; south: boolean } | null {
  const code = Number(/EPSG:(\d+)/.exec(crs ?? '')?.[1]);
  if (code >= 32601 && code <= 32660) return { zone: code - 32600, south: false };
  if (code >= 32701 && code <= 32760) return { zone: code - 32700, south: true };
  if (code >= 26901 && code <= 26923) return { zone: code - 26900, south: false };
  if (code >= 6330 && code <= 6348) return { zone: code - 6329, south: false }; // NAD83(2011) UTM 1N–19N
  return null;
}

/** Height ramp for measured points: low (street) blue-grey to high (roofs) warm. */
function heightColour(t: number): [number, number, number] {
  const stops: [number, [number, number, number]][] = [[0, [0.27, 0.42, 0.62]], [0.25, [0.31, 0.62, 0.66]], [0.5, [0.55, 0.74, 0.47]], [0.75, [0.93, 0.76, 0.35]], [1, [0.88, 0.4, 0.27]]];
  const c = Math.min(1, Math.max(0, t));
  for (let i = 1; i < stops.length; i++) {
    const [t1, c1] = stops[i]!, [t0, c0] = stops[i - 1]!;
    if (c <= t1) { const k = (c - t0) / (t1 - t0); return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k]; }
  }
  return stops[stops.length - 1]![1];
}

export interface LoadedOverlay {
  input: OverlayInput;
  /** Layer key and what the overlay shows, for the Layers panel. */
  layer: 'imagery' | 'lidar';
  label: string;
  note: string;
  caption: string;
}

async function readTiff(url: string, signal: AbortSignal) {
  if (new URL(url, location.origin).origin !== location.origin) throw new Error("Overlay URL must use the application API");
  const { fromArrayBuffer } = await import('geotiff');
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  const tiff = await fromArrayBuffer(await response.arrayBuffer());
  const image = await tiff.getImage();
  if (image.getWidth() * image.getHeight() > 16_000_000) throw new Error("Raster exceeds the bounded browser preview size");
  return image;
}

/** Official imagery draped where it covers: corners from its recorded geographic bounds. */
async function imageryOverlay(d: SupplementalDataset, ref: AreaReference, signal: AbortSignal): Promise<LoadedOverlay | null> {
  const utm = utmZone(ref.analysisCrs);
  if (!d.originalUrl || !d.bounds4326 || !utm || !ref.origin || !/^EPSG:32[67]\d{2}$/.test(ref.analysisCrs ?? '')) return null;
  const image = await readTiff(d.originalUrl, signal);
  const width = image.getWidth(), height = image.getHeight();
  const raster = (await image.readRasters({ interleave: true })) as unknown as Uint8Array;
  const bands = image.getSamplesPerPixel();
  if (![3, 4].includes(bands) || image.getGeoKeys().ProjectedCSTypeGeoKey !== 3857) throw new Error("Only the verified Web Mercator RGB/RGBA imagery profile is supported");
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const pixels = ctx.createImageData(width, height);
  for (let i = 0, j = 0; i < width * height; i++, j += bands) {
    pixels.data[i * 4] = raster[j]!; pixels.data[i * 4 + 1] = raster[j + 1]!; pixels.data[i * 4 + 2] = raster[j + 2]!;
    pixels.data[i * 4 + 3] = bands > 3 ? raster[j + 3]! : 255;
  }
  ctx.putImageData(pixels, 0, 0);
  // CanvasTexture already flips source rows for UV north-up; do not flip twice.
  const [west, south, east, north] = d.bounds4326;
  const local = (lon: number, lat: number): [number, number] => {
    const [x, y] = utmForward(lon, lat, utm.zone, utm.south);
    return [x - ref.origin![0], y - ref.origin![1]];
  };
  return {
    layer: 'imagery',
    label: `Aerial imagery ${d.captureYear ?? ''}`.trim(),
    caption: `Aerial ${d.captureYear ?? 'date unknown'} · georeferenced`,
    note: `${d.name}: uploaded imagery draped only within its source coverage; this is a flat image, not a 3D surface.`,
    input: { id: d.sourceId, kind: 'image', corners: [local(west, south), local(east, south), local(east, north), local(west, north)], image: canvas },
  };
}

/** The point cloud's derived 2 m surface as measured points, coloured by height; empty cells stay empty. */
async function lidarOverlay(d: SupplementalDataset, ref: AreaReference, signal: AbortSignal): Promise<LoadedOverlay | null> {
  const surface = d.derivedSurface;
  const pointZone = utmZone(d.crs), areaZone = utmZone(ref.analysisCrs);
  if (!surface?.originalUrl || !ref.origin || !pointZone || !areaZone || pointZone.zone !== areaZone.zone || pointZone.south !== areaZone.south) return null;
  const image = await readTiff(surface.originalUrl, signal);
  const sourceCode = image.getGeoKeys().ProjectedCSTypeGeoKey;
  if (`EPSG:${sourceCode}` !== d.crs || (d.crs !== ref.analysisCrs && !(sourceCode === 6347 && ref.analysisCrs === "EPSG:32618"))) throw new Error("Horizontal frame needs a qualified overlay transform");
  const [x0, , , y1] = image.getBoundingBox();
  const [rx, ry] = image.getResolution();
  const width = image.getWidth(), height = image.getHeight();
  const values = (await image.readRasters({ samples: [0], interleave: true })) as unknown as Float32Array;
  const nodata = image.getGDALNoData();
  const cells: [number, number, number][] = [];
  for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
    const z = values[row * width + col]!;
    if (!Number.isFinite(z) || (nodata !== null && z === nodata)) continue;
    cells.push([x0! + (col + 0.5) * rx! - ref.origin[0], y1! + (row + 0.5) * ry! - ref.origin[1], z]);
  }
  if (!cells.length) return null;
  // Heights are NAVD88; the scene's ground is each building's own base. Place the lowest measured cells at
  // ground level (the 2nd percentile), so the surface sits on the map without claiming a datum tie.
  const sorted = cells.map((c) => c[2]).sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.02)]!, top = sorted[Math.floor(sorted.length * 0.98)]!;
  const positions = new Float32Array(cells.length * 3), colors = new Float32Array(cells.length * 3);
  cells.forEach(([x, y, z], i) => {
    positions.set([x, y, z - floor], i * 3);
    colors.set(heightColour((z - floor) / Math.max(1, top - floor)), i * 3);
  });
  return {
    layer: 'lidar',
    label: `LiDAR surface ${d.captureYear ?? ''}`.trim(),
    caption: `LiDAR ${d.captureYear ?? "date unknown"} · approximate alignment`,
    note: `Highest measured return per ${surface.resolutionM} m cell (${cells.length.toLocaleString('en-IN')} cells), coloured by source elevation. Display uses a constant ${(-floor).toFixed(2)} m vertical offset; original elevations and gaps are retained. Horizontal datum alignment is approximate and the surface is not tied to building bases or used for measurement.`,
    input: { id: `${d.sourceId}:surface`, kind: 'points', positions, colors, sizeM: surface.resolutionM * 0.9 },
  };
}

/** Loads the drawable supplemental datasets of an area (imagery, point-cloud surface). */
export function useOverlays(areaId: string, datasets: SupplementalDataset[] | undefined, reference: AreaReference | null | undefined) {
  const key = JSON.stringify({ datasets, reference });
  return useQuery({
    queryKey: ['overlays', areaId, key],
    enabled: Boolean(datasets?.length && reference?.origin),
    staleTime: Infinity,
    queryFn: async ({ signal }) => {
      const out: LoadedOverlay[] = [];
      const warnings: string[] = [];
      for (const d of datasets ?? []) {
        try {
          const loaded = d.layer === 'imagery' && d.format === 'geotiff' ? await imageryOverlay(d, reference!, signal)
            : d.layer === 'point_cloud' ? await lidarOverlay(d, reference!, signal) : null;
          if (loaded) out.push(loaded);
          else if (d.layer === "imagery" || d.layer === "point_cloud") warnings.push(`${d.name}: no supported overlay frame is available.`);
        } catch (error) {
          if (signal.aborted) throw error;
          warnings.push(`${d.name}: ${error instanceof Error ? error.message : 'overlay could not be loaded'}`);
        }
      }
      return { overlays: out, warnings };
    },
  });
}
