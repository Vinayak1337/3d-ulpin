import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { SceneEngine, type SceneEngineOptions } from './engine';
import { readPalette } from './palette';
import type { BuildingDetailInput, FootprintInput, Pick, SceneState } from './types';

export interface SceneViewProps {
  buildings: FootprintInput[];
  detail: BuildingDetailInput | null;
  state: SceneState;
  /** Grow newly added buildings in (live import). */
  growNew?: boolean;
  onPick?: (pick: Pick) => void;
  onHover?: (pick: Pick) => void;
  onView?: () => void;
  /** Receives the engine once it exists, for camera commands and overlays. */
  onReady?: (engine: SceneEngine | null) => void;
  className?: string;
  style?: CSSProperties;
  label: string;
}

/**
 * Thin React adapter: one engine per mount, props forwarded as imperative calls.
 * Callbacks go through a ref so a new closure never rebuilds the scene.
 */
export function SceneView({ buildings, detail, state, growNew, onPick, onHover, onView, onReady, className, style, label }: SceneViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<SceneEngine | null>(null);
  const callbacks = useRef({ onPick, onHover, onView });
  callbacks.current = { onPick, onHover, onView };

  useEffect(() => {
    const options: SceneEngineOptions = {
      palette: readPalette(),
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      onPick: (pick) => callbacks.current.onPick?.(pick),
      onHover: (pick) => callbacks.current.onHover?.(pick),
      onView: () => callbacks.current.onView?.(),
    };
    const created = new SceneEngine(containerRef.current!, options);
    setEngine(created);
    return () => {
      created.dispose();
      setEngine(null);
    };
  }, []);

  useEffect(() => { onReady?.(engine); }, [engine, onReady]);
  useEffect(() => { engine?.setBuildings(buildings, { growNew }); }, [engine, buildings, growNew]);
  useEffect(() => { engine?.setBuildingDetail(detail); }, [engine, detail]);
  useEffect(() => { engine?.setState(state); }, [engine, state]);

  return <div ref={containerRef} className={className} style={style} role="img" aria-label={label} />;
}
