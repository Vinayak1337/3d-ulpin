import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { CaretDown, CaretUp, CornersOut } from '@phosphor-icons/react';
import type { BaseFeatureInput, FootprintInput, SceneEngine } from '@ulpin/scene';
import { boundsOf } from '@ulpin/scene';
import { Button, Icon, SegmentedControl } from '@ulpin/ui';
import styles from './MapControls.module.css';

/** Top-left of the canvas: 3D / 2D camera and Fit (back to the whole area or selection). */
export function MapControls({ flat, onFlat, onFit }: { flat: boolean; onFlat: (flat: boolean) => void; onFit: () => void }) {
  return (
    <div className={styles.controls}>
      <SegmentedControl label="Camera" value={flat ? '2d' : '3d'} onChange={(v) => onFlat(v === '2d')}
        options={[{ value: '3d', label: '3D' }, { value: '2d', label: '2D' }]} />
      <Button icon={CornersOut} className={styles.fit} onClick={onFit} title="Fit the view to the area or the selection">Fit</Button>
    </div>
  );
}

const W = 200, H = 150, PAD = 8;

/**
 * Block overview: the whole area from above, with the part in view outlined. A click moves the view there.
 * Drawn from the same footprints and base map as the scene.
 */
export function BlockOverview({ engine, buildings, base, selectedId, tick, open, onToggle }: {
  engine: SceneEngine | null; buildings: FootprintInput[]; base: BaseFeatureInput[]; selectedId: string | null; tick: number;
  open: boolean; onToggle: () => void;
}) {
  const mapRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState(false);
  const frame = useMemo(() => {
    // Frame the buildings (roads and land can run far beyond them), with a margin.
    const inner = boundsOf(buildings) ?? boundsOf(base.filter((f) => f.kind !== 'utility'));
    if (!inner) return null;
    const margin = Math.max(inner.maxX - inner.minX, inner.maxY - inner.minY) * 0.12 + 10;
    const b = { minX: inner.minX - margin, maxX: inner.maxX + margin, minY: inner.minY - margin, maxY: inner.maxY + margin };
    const span = Math.max(b.maxX - b.minX, (b.maxY - b.minY) * (W / H), 1);
    const scale = (W - PAD * 2) / span;
    const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
    return {
      scale,
      toPx: (x: number, y: number): [number, number] => [W / 2 + (x - cx) * scale, H / 2 - (y - cy) * scale],
      toLocal: (px: number, py: number): [number, number] => [cx + (px - W / 2) / scale, cy - (py - H / 2) / scale],
    };
  }, [buildings, base]);

  // The map layer: base features and footprints; redrawn when the data or selection changes.
  useEffect(() => {
    const canvas = mapRef.current;
    if (!canvas || !frame || !open) return;
    const ctx = setup(canvas);
    const css = getComputedStyle(canvas);
    const token = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    ctx.fillStyle = token('--ui-map-ground', '#e9eeec');
    ctx.fillRect(0, 0, W, H);
    const fill = (polygons: FootprintInput['polygons'], color: string) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      for (const polygon of polygons) for (const ring of polygon) ring.forEach(([x, y], i) => { const [px, py] = frame.toPx(x, y); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
      ctx.fill('evenodd');
    };
    for (const f of base) {
      if (f.kind === 'road') fill(f.polygons, token('--ui-map-road', '#dce2e2'));
      else if (f.kind === 'public_land') fill(f.polygons, token('--ui-map-public-land', '#dde8e0'));
      else if (f.kind === 'water') fill(f.polygons, token('--ui-map-water', '#cfe1ec'));
    }
    for (const b of buildings) fill(b.polygons, b.id === selectedId ? token('--ui-primary', '#235347') : token('--ui-map-building-edge', '#a9b5b2'));
  }, [frame, buildings, base, selectedId, open]);

  // The view layer: the ground area in view, redrawn every rendered frame.
  useEffect(() => {
    const canvas = viewRef.current;
    if (!canvas || !frame || !engine || !open) return;
    const ctx = setup(canvas);
    ctx.clearRect(0, 0, W, H);
    const corners = engine.viewFootprint().map(([x, y]) => frame.toPx(x, y));
    const css = getComputedStyle(canvas);
    const primary = css.getPropertyValue('--ui-primary').trim() || '#235347';
    ctx.beginPath();
    corners.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = `${primary}22`;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = primary;
    ctx.stroke();
    const [tx, ty] = frame.toPx(...engine.targetXY());
    ctx.fillStyle = primary;
    ctx.beginPath(); ctx.arc(tx, ty, 2.5, 0, Math.PI * 2); ctx.fill();
  }, [frame, engine, tick, open, hover]);

  if (!frame) return null;
  const onClick = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const [x, y] = frame.toLocal(event.clientX - rect.left, event.clientY - rect.top);
    engine?.panTo(x, y);
  };
  return (
    <div className={`${styles.overview} ${open ? '' : styles.closed}`}>
      {open ? (
        <div className={styles.overviewMap}>
          <canvas ref={mapRef} width={W} height={H} aria-hidden="true" />
          <canvas ref={viewRef} width={W} height={H} className={styles.viewLayer} onPointerUp={onClick}
            onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}
            role="img" aria-label="Block overview. Click to move the view there." />
        </div>
      ) : null}
      <button type="button" className={styles.overviewToggle} onClick={onToggle} aria-expanded={open}>
        Block overview <Icon icon={open ? CaretDown : CaretUp} size={16} />
      </button>
    </div>
  );
}

function setup(canvas: HTMLCanvasElement) {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== W * ratio) { canvas.width = W * ratio; canvas.height = H * ratio; }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return ctx;
}
