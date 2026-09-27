import type { SceneEngine } from '@ulpin/scene';
import type { SceneLabel } from './labels';
import styles from './MapWorkspace.module.css';

/** Place names show once their place is at least this wide on screen. */
const MIN_PLACE_PX = 36;

type Rect = { x0: number; y0: number; x1: number; y1: number };
const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/**
 * HTML labels projected from 3D anchors; hidden when the anchor is behind the camera or off screen.
 * Place names (kind `street`) yield: they hide while their place is too small to read, and never overlap
 * another label; larger places win.
 */
export function SceneLabels({ engine, labels, tick }: { engine: SceneEngine | null; labels: SceneLabel[]; tick: number }) {
  void tick;
  if (!engine) return null;
  const placed: Rect[] = [];
  const shown: { label: SceneLabel; x: number; y: number }[] = [];
  const rectFor = (label: SceneLabel, x: number, y: number): Rect => {
    const w = label.text.length * (label.kind === 'street' ? 6.4 : 6.8) + 16, h = 20;
    return { x0: x - w / 2, x1: x + w / 2, y0: y - h * 1.15, y1: y - h * 0.15 };
  };
  for (const label of labels) {
    if (label.kind === 'street') continue;
    const p = engine.project(label.id);
    if (!p?.visible) continue;
    placed.push(rectFor(label, p.x, p.y));
    shown.push({ label, x: p.x, y: p.y });
  }
  const places = labels.filter((l) => l.kind === 'street')
    .map((label) => ({ label, size: engine.anchorPixelSize(label.id) ?? MIN_PLACE_PX }))
    .filter((p) => p.size >= MIN_PLACE_PX)
    .sort((a, b) => b.size - a.size);
  for (const { label } of places) {
    const p = engine.project(label.id);
    if (!p?.visible) continue;
    const rect = rectFor(label, p.x, p.y);
    if (placed.some((r) => overlaps(r, rect))) continue;
    placed.push(rect);
    shown.unshift({ label, x: p.x, y: p.y });
  }
  return (
    <div className={styles.labels} aria-hidden="true">
      {shown.map(({ label, x, y }) => (
        <span key={`${label.kind}:${label.id}`} className={`${styles.label} ${styles[`label_${label.kind.replace('-', '_')}`] ?? ''}`}
          style={{ transform: `translate(${x}px, ${y}px) translate(-50%, -115%)` }}>
          {label.text}
        </span>
      ))}
    </div>
  );
}
