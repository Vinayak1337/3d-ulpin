import { useCallback, useState } from 'react';
import type { SceneLayers, SceneLook } from '@ulpin/scene';

export interface MapView {
  look: SceneLook;
  layers: SceneLayers;
  /** Recorded road and park names on the map. */
  labels: boolean;
}

const KEY = 'bhuaayam.mapView';
const DEFAULT: MapView = { look: 'enhanced', layers: { parcels: true, roads: true, publicLand: true, trees: true }, labels: true };

function read(): MapView {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<MapView> | null;
    if (!saved) return DEFAULT;
    return { look: saved.look ?? DEFAULT.look, labels: saved.labels ?? DEFAULT.labels, layers: { ...DEFAULT.layers, ...saved.layers } };
  } catch {
    return DEFAULT;
  }
}

/** Display appearance and layers. Kept per browser; never affects records. */
export function useMapView() {
  const [view, setView] = useState<MapView>(read);
  const update = useCallback((patch: Partial<MapView>) => {
    setView((current) => {
      const next = { ...current, ...patch, layers: { ...current.layers, ...patch.layers } };
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage unavailable: keep in memory */ }
      return next;
    });
  }, []);
  return [view, update] as const;
}
