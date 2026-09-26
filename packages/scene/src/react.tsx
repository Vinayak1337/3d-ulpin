import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { SceneEngine, type SceneEngineOptions } from './engine';
import { readPalette } from './palette';
import type { FootprintInput } from './types';

export interface SceneViewProps {
  footprints: FootprintInput[];
  selectedId: string | null;
  onPick?: (id: string | null) => void;
  onHover?: (id: string | null) => void;
  onView?: () => void;
  /** Receives the engine once it exists, for camera commands and overlays. */
  onReady?: (engine: SceneEngine | null) => void;
  className?: string;
  style?: CSSProperties;
  label: string;
}

/**
 * Thin React adapter: creates one engine per mount and forwards prop changes.
 * Callbacks go through a ref so a new closure never rebuilds the scene.
 */
export function SceneView({ footprints, selectedId, onPick, onHover, onView, onReady, className, style, label }: SceneViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<SceneEngine | null>(null);
  const callbacks = useRef({ onPick, onHover, onView });
  callbacks.current = { onPick, onHover, onView };

  useEffect(() => {
    const container = containerRef.current!;
    const options: SceneEngineOptions = {
      palette: readPalette(),
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      onPick: (id) => callbacks.current.onPick?.(id),
      onHover: (id) => callbacks.current.onHover?.(id),
      onView: () => callbacks.current.onView?.(),
    };
    const created = new SceneEngine(container, options);
    setEngine(created);
    return () => {
      created.dispose();
      setEngine(null);
    };
  }, []);

  useEffect(() => {
    onReady?.(engine);
  }, [engine, onReady]);

  useEffect(() => {
    engine?.setFootprints(footprints);
  }, [engine, footprints]);

  useEffect(() => {
    engine?.select(selectedId);
  }, [engine, selectedId]);

  return <div ref={containerRef} className={className} style={style} role="img" aria-label={label} />;
}
