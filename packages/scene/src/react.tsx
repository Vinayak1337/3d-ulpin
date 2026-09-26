import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { SceneEngine, type SceneEngineOptions } from './engine';
import { readPalette } from './palette';
import type { BaseFeatureInput, BuildingDetailInput, FootprintInput, Measurement, Pick, SceneState, Trench } from './types';

export interface SceneViewProps {
  base?: BaseFeatureInput[];
  buildings: FootprintInput[];
  detail: BuildingDetailInput | null;
  state: SceneState;
  /** Grow newly added buildings in (live import). */
  growNew?: boolean;
  onPick?: (pick: Pick) => void;
  onHover?: (pick: Pick) => void;
  onView?: () => void;
  onMeasure?: (measurement: Measurement) => void;
  onTrench?: (trench: Trench) => void;
  /** Receives the engine once it exists, for camera commands and overlays. */
  onReady?: (engine: SceneEngine | null) => void;
  className?: string;
  style?: CSSProperties;
  label: string;
}

const NO_BASE: BaseFeatureInput[] = [];

/**
 * Thin React adapter: one engine per mount, props forwarded as imperative calls.
 * Callbacks go through a ref so a new closure never rebuilds the scene.
 */
export function SceneView({ base = NO_BASE, buildings, detail, state, growNew, onPick, onHover, onView, onMeasure, onTrench, onReady, className, style, label }: SceneViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<SceneEngine | null>(null);
  const callbacks = useRef({ onPick, onHover, onView, onMeasure, onTrench });
  callbacks.current = { onPick, onHover, onView, onMeasure, onTrench };

  useEffect(() => {
    const options: SceneEngineOptions = {
      palette: readPalette(),
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      onPick: (pick) => callbacks.current.onPick?.(pick),
      onHover: (pick) => callbacks.current.onHover?.(pick),
      onView: () => callbacks.current.onView?.(),
      onMeasure: (m) => callbacks.current.onMeasure?.(m),
      onTrench: (t) => callbacks.current.onTrench?.(t),
    };
    const created = new SceneEngine(containerRef.current!, options);
    setEngine(created);
    return () => {
      created.dispose();
      setEngine(null);
    };
  }, []);

  useEffect(() => { onReady?.(engine); }, [engine, onReady]);
  useEffect(() => { engine?.setBase(base); }, [engine, base]);
  useEffect(() => { engine?.setBuildings(buildings, { growNew }); }, [engine, buildings, growNew]);
  useEffect(() => { engine?.setBuildingDetail(detail); }, [engine, detail]);
  useEffect(() => { engine?.setState(state); }, [engine, state]);

  return <div ref={containerRef} className={className} style={style} role="img" aria-label={label} />;
}
