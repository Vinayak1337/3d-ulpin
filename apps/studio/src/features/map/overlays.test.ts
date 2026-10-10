import { describe, expect, it } from 'vitest';
import type { NormalizedArea } from '@ulpin/contracts/canonical-scene';
import {
  imageryAttribution, imageryFailureNote, loadRetainedImages, sceneCorners, type CanonicalImageOverlay,
} from './overlays';

type RetainedImagery = NonNullable<NormalizedArea['imagery']>[number];

// Chip d01b30d6 of item 0092d536 as the Karnataka area's canonical read states it (MP2 step0.json).
const NW: [number, number] = [-3.6128005703240436, 7.36751799767577];
const NE: [number, number] = [75.86881191692643, 7.3676216438576745];
const SE: [number, number] = [75.86903384387628, -73.67507166945104];
const SW: [number, number] = [-3.6128111382114905, -73.67517531583292];
const UPSTREAM = 'RAMP (Replicable AI for Microplanning), DevGlobal / TaQadam / B.O.T; '
  + 'Maxar Open Data Program imagery; distributed by Radiant Earth MLHub';

function overlay(id: string): CanonicalImageOverlay {
  return { id, kind: 'image', corners: [NW, NE, SE, SW], originalUrl: `/api/v1/pictures/${id}`, citations: [] };
}

function imagery(chips: number): RetainedImagery {
  const chip = {
    chipId: 'c', sourceId: 's', sourceSha256: 'a'.repeat(64), sourceCrs: 'EPSG:4326',
    affine: [1, 0, 0, 0, -1, 0], width: 256, height: 256, originalUrl: 'https://example.org/c.tif',
    acquiredAt: '2026-10-09T19:06:59.925527+00:00', licence: 'CC-BY-NC-4.0', upstreamConditions: UPSTREAM,
  };
  return {
    clusterId: '6933:7322:1640', classification: 'test_only', analyticalEligibility: 'not_assessed',
    chips: Array.from({ length: chips }, () => chip),
  } as RetainedImagery;
}

describe('sceneCorners', () => {
  it('turns the read order NW, NE, SE, SW into the scene order SW, SE, NE, NW', () => {
    expect(sceneCorners([NW, NE, SE, SW])).toEqual([SW, SE, NE, NW]);
  });

  it('refuses an overlay without four corners', () => {
    expect(() => sceneCorners([NW, NE, SE])).toThrow('four corners');
  });
});

describe('imageryAttribution', () => {
  it('states the sources and licence once per entry, the test-data state and an unknown capture date', () => {
    const states = 'Test data, not official imagery · Not assessed for measurement · Capture date unknown';
    expect(imageryAttribution([imagery(22)])).toEqual([`${UPSTREAM} · CC-BY-NC-4.0 · ${states}`]);
  });

  it('never gives the date the file was retained as a capture date', () => {
    expect(imageryAttribution([imagery(1)])[0]).not.toContain('2026');
  });
});

describe('imageryFailureNote', () => {
  it('names the pictures that did not load by count', () => {
    expect(imageryFailureNote({ listed: 22, failed: 3 })).toBe('3 of 22 images did not load');
    expect(imageryFailureNote({ listed: 1, failed: 1 })).toBe('1 of 1 image did not load');
  });

  it('says nothing when every picture loaded', () => {
    expect(imageryFailureNote({ listed: 22, failed: 0 })).toBeNull();
  });
});

describe('loadRetainedImages', () => {
  const canvas = {} as HTMLCanvasElement;

  it('keeps the pictures that load when one fails, and counts the failure', async () => {
    const read = async (url: string) => {
      if (url.endsWith('/b')) throw new Error('404');
      return canvas;
    };
    const listed = [overlay('a'), overlay('b'), overlay('c')];
    const images = await loadRetainedImages(listed, new AbortController().signal, read);
    expect(images.overlays.map((o) => o.id)).toEqual(['a', 'c']);
    expect(images.overlays[0]!.corners).toEqual([SW, SE, NE, NW]);
    expect({ listed: images.listed, failed: images.failed }).toEqual({ listed: 3, failed: 1 });
  });

  it('asks for each listed picture once and stops when the map aborts', async () => {
    const controller = new AbortController();
    const asked: string[] = [];
    const read = async (url: string) => {
      asked.push(url);
      controller.abort();
      return canvas;
    };
    await expect(loadRetainedImages([overlay('a'), overlay('b')], controller.signal, read)).rejects.toThrow();
    expect(asked).toEqual(['/api/v1/pictures/a', '/api/v1/pictures/b']);
  });
});
