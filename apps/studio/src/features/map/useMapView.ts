import { useCallback, useState } from 'react';
import type { SceneLayers, SceneLook } from '@ulpin/scene';

export interface MapView {
  look: SceneLook;
  layers: SceneLayers;
  /** Recorded road and park names on the map. */
  labels: boolean;
  /**
   * Source imagery and measured point overlays, when the area has them. Imagery is null until the viewer
   * chooses: the map then shows the pictures an area's canonical read lists, and no other imagery.
   */
  overlays: { imagery: boolean | null; lidar: boolean };
}

/** Only listed canonical pictures default on; a supplemental aerial needs the viewer's explicit choice. */
export function imageryVisibility(preference: boolean | null, hasListedPictures: boolean) {
  return { retained: preference ?? hasListedPictures, aerial: preference === true };
}

const KEY = 'bhuaayam.mapView';
const DEFAULT: MapView = {
  look: 'enhanced', layers: { parcels: true, roads: true, publicLand: true, trees: true }, labels: true,
  overlays: { imagery: null, lidar: false },
};

type SavedView = Partial<MapView> & { overlayPreferenceVersion?: number };

/**
 * Older preferences enabled aerial imagery automatically; they require a new explicit choice. Version 1 stored
 * imagery off whether or not it was chosen, so only its point-overlay choice is kept.
 */
function savedOverlays(saved: SavedView): MapView['overlays'] {
  if (saved.overlayPreferenceVersion === 2) return { ...DEFAULT.overlays, ...saved.overlays };
  if (saved.overlayPreferenceVersion === 1) return { ...DEFAULT.overlays, lidar: saved.overlays?.lidar ?? false };
  return DEFAULT.overlays;
}

function read(): MapView {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as SavedView | null;
    if (!saved) return DEFAULT;
    return {
      look: saved.look ?? DEFAULT.look, labels: saved.labels ?? DEFAULT.labels,
      layers: { ...DEFAULT.layers, ...saved.layers }, overlays: savedOverlays(saved),
    };
  } catch {
    return DEFAULT;
  }
}

/** Display appearance and layers. Kept per browser; never affects records. */
export function useMapView() {
  const [view, setView] = useState<MapView>(read);
  const update = useCallback((patch: Partial<MapView>) => {
    setView((current) => {
      const next = { ...current, ...patch, layers: { ...current.layers, ...patch.layers }, overlays: { ...current.overlays, ...patch.overlays } };
      try {
        localStorage.setItem(KEY, JSON.stringify({ ...next, overlayPreferenceVersion: 2 }));
      } catch { /* storage unavailable: keep in memory */ }
      return next;
    });
  }, []);
  return [view, update] as const;
}
