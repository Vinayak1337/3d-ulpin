import { afterEach, describe, expect, it, vi } from 'vitest';
import { imageryRefusal, rasterToRgba, type ImageryProfile, type ImageryReply } from './imagery-pixels';
import { useOverlays, type LoadedOverlay } from './overlays';

vi.mock('@tanstack/react-query', () => ({ useQuery: (options: unknown) => options }));
afterEach(() => vi.unstubAllGlobals());

const verified: ImageryProfile = { width: 768, height: 768, bands: 4, projectedCSTypeGeoKey: 3857 };
const profileMessage = 'Only the verified Web Mercator RGB/RGBA imagery profile is supported';

describe('imagery raster conversion', () => {
  it('preserves RGB values and adds opaque alpha', () => {
    expect([...rasterToRgba(new Uint8Array([0, 17, 255, 84, 73, 62]), 2, 3)])
      .toEqual([0, 17, 255, 255, 84, 73, 62, 255]);
  });

  it('preserves RGBA values including transparent pixels', () => {
    const raster = new Uint8Array([0, 17, 255, 0, 84, 73, 62, 129]);
    expect([...rasterToRgba(raster, 2, 4)]).toEqual([...raster]);
  });

  it('retains the prior canvas clamping for decoded numeric samples', () => {
    expect([...rasterToRgba([300, -1, 2.5], 1, 3)]).toEqual([255, 0, 2, 255]);
  });
});

class DecodeWorker {
  static latest: DecodeWorker;
  onmessage: ((event: { data: ImageryReply }) => void) | null = null;
  onerror = null;
  onmessageerror = null;
  postMessage = vi.fn();
  terminate = vi.fn();

  constructor() {
    DecodeWorker.latest = this;
  }
}

function startOverlay(signal: AbortSignal) {
  vi.stubGlobal('location', { origin: 'http://localhost' });
  vi.stubGlobal('Worker', DecodeWorker);
  const bytes = new ArrayBuffer(8);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => bytes })));
  const options = useOverlays('area', [{
    sourceId: 'imagery', name: 'Aerial', layer: 'imagery', format: 'geotiff',
    originalUrl: '/api/imagery', bounds4326: [-74.01, 40.71, -74, 40.72],
  }], { origin: [0, 0], analysisCrs: 'EPSG:32618' }) as unknown as {
    queryFn: (context: { signal: AbortSignal }) => Promise<{ overlays: LoadedOverlay[]; warnings: string[] }>;
  };
  return { bytes, result: options.queryFn({ signal }) };
}

async function workerReady(bytes: ArrayBuffer) {
  await vi.waitFor(() => expect(DecodeWorker.latest?.postMessage.mock.calls[0]?.[0]).toBe(bytes));
  return DecodeWorker.latest;
}

describe('imagery worker lifecycle', () => {
  it('puts the returned RGBA rows on the same canvas overlay without changing its metadata', async () => {
    const pixels = { data: new Uint8ClampedArray(8) };
    const ctx = { createImageData: vi.fn(() => pixels), putImageData: vi.fn() };
    const canvas = { width: 0, height: 0, getContext: vi.fn(() => ctx) };
    vi.stubGlobal('document', { createElement: vi.fn(() => canvas) });
    const { bytes, result } = startOverlay(new AbortController().signal);
    const worker = await workerReady(bytes);
    const rgba = new Uint8ClampedArray([1, 2, 3, 4, 5, 6, 7, 8]);
    worker.onmessage!({ data: { profile: { ...verified, width: 1, height: 2 }, rgba } });
    const loaded = await result;
    expect(loaded.warnings).toEqual([]);
    expect(loaded.overlays).toHaveLength(1);
    expect(loaded.overlays[0]).toMatchObject({
      layer: 'imagery', label: 'Aerial', caption: 'Aerial date unknown · georeferenced',
      note: 'Aerial: georeferenced image; source coverage only.',
      input: { id: 'imagery', kind: 'image', role: 'ground', image: canvas },
    });
    expect(pixels.data).toEqual(rgba);
    expect(ctx.putImageData).toHaveBeenCalledWith(pixels, 0, 0);
    expect(canvas.width).toBe(1);
    expect(canvas.height).toBe(2);
  });

  it('transfers the fetched bytes and raises each refusal on the main thread without adding imagery', async () => {
    const profiles = [
      { ...verified, width: 4001, height: 4000 },
      { ...verified, bands: 1 },
      { ...verified, projectedCSTypeGeoKey: 6347 },
    ];
    for (const profile of profiles) {
      const { bytes, result } = startOverlay(new AbortController().signal);
      const worker = await workerReady(bytes);
      expect(worker.postMessage).toHaveBeenCalledWith(bytes, [bytes]);
      worker.onmessage!({ data: { profile } });
      expect(await result).toEqual({ overlays: [], warnings: [`Aerial: ${imageryRefusal(profile)}`] });
      expect(worker.terminate).toHaveBeenCalledOnce();
    }
  });

  it('terminates a decoding worker on abort and never returns an overlay', async () => {
    const controller = new AbortController();
    const { bytes, result } = startOverlay(controller.signal);
    const rejection = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    const worker = await workerReady(bytes);
    controller.abort();
    await rejection;
    worker.onmessage!({ data: { profile: verified, rgba: new Uint8ClampedArray(4) } });
    expect(worker.terminate).toHaveBeenCalled();
  });

  it('does not start a worker if the caller is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const previous = DecodeWorker.latest;
    const { result } = startOverlay(controller.signal);
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(DecodeWorker.latest).toBe(previous);
  });
});

describe('existing imagery refusals', () => {
  it('refuses more than sixteen million pixels with the original size message', () => {
    expect(imageryRefusal({ ...verified, width: 4001, height: 4000 }))
      .toBe('Raster exceeds the bounded browser preview size');
    expect(imageryRefusal({ ...verified, width: 4000, height: 4000 })).toBeNull();
  });

  it('refuses bands other than RGB or RGBA with the original profile message', () => {
    expect(imageryRefusal({ ...verified, bands: 1 })).toBe(profileMessage);
    expect(imageryRefusal({ ...verified, bands: 2 })).toBe(profileMessage);
    expect(imageryRefusal({ ...verified, bands: 5 })).toBe(profileMessage);
    expect(imageryRefusal({ ...verified, bands: 3 })).toBeNull();
  });

  it('refuses non-Web-Mercator and unstated frames with the original profile message', () => {
    expect(imageryRefusal({ ...verified, projectedCSTypeGeoKey: 6347 })).toBe(profileMessage);
    expect(imageryRefusal({ ...verified, projectedCSTypeGeoKey: undefined })).toBe(profileMessage);
    expect(imageryRefusal(verified)).toBeNull();
  });
});
