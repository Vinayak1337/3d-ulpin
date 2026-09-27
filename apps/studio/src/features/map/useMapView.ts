import { useCallback, useState } from 'react';
import type { SceneLayers, SceneLook } from '@ulpin/scene';

export interface MapView {
  look: SceneLook;
  layers: SceneLayers;
  /** Recorded road and park names on the map. */
  labels: boolean;
  /** Source imagery and measured point overlays, when the area has them. */
  overlays: { imagery: boolean; lidar: boolean };
}

const KEY = 'bhuaayam.mapView';
const DEFAULT: MapView = { look: 'enhanced', layers: { parcels: true, roads: true, publicLand: true, trees: true }, labels: true, overlays: { imagery: true, lidar: false } };

function read(): MapView {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<MapView> | null;
    if (!saved) return DEFAULT;
    return { look: saved.look ?? DEFAULT.look, labels: saved.labels ?? DEFAULT.labels, layers: { ...DEFAULT.layers, ...saved.layers }, overlays: { ...DEFAULT.overlays, ...saved.overlays } };
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
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage unavailable: keep in memory */ }
      return next;
    });
  }, []);
  return [view, update] as const;
}
