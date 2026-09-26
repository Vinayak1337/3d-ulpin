import type { SceneEngine } from '@ulpin/scene';
import type { SceneLabel } from './labels';
import styles from './MapWorkspace.module.css';

/** HTML labels projected from 3D anchors; hidden when the anchor is behind the camera or off screen. */
export function SceneLabels({ engine, labels, tick }: { engine: SceneEngine | null; labels: SceneLabel[]; tick: number }) {
  void tick;
  if (!engine) return null;
  return (
    <div className={styles.labels} aria-hidden="true">
      {labels.map((label) => {
        const position = engine.project(label.id);
        if (!position?.visible) return null;
        return (
          <span key={`${label.kind}:${label.id}`} className={`${styles.label} ${styles[`label_${label.kind.replace('-', '_')}`] ?? ''}`}
            style={{ transform: `translate(${position.x}px, ${position.y}px) translate(-50%, -115%)` }}>
            {label.text}
          </span>
        );
      })}
    </div>
  );
}
