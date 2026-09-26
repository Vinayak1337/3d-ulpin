import type { SceneEngine } from '@ulpin/scene';
import styles from './MapWorkspace.module.css';

const STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];

/** Readout = scale bar and N only; reference systems on hover (GOAL override 3). */
export function ScaleAndNorth({ engine, tick, title }: { engine: SceneEngine | null; tick: number; title: string }) {
  void tick;
  if (!engine) return null;
  const mpp = engine.metresPerPixel();
  const metres = STEPS.find((step) => step / mpp >= 60) ?? STEPS[STEPS.length - 1]!;
  const width = Math.round(metres / mpp);
  const heading = engine.headingDeg();
  const text = metres >= 1000 ? `${metres / 1000} km` : `${metres} m`;
  return (
    <div className={styles.scale} title={title}>
      <span className={styles.north} role="img" aria-label={`North arrow, view heading ${Math.round(heading)}°`}>
        <svg viewBox="0 0 16 16" width="16" height="16" style={{ transform: `rotate(${-heading}deg)` }} aria-hidden="true">
          <path d="M8 1.5 12 13 8 10.5 4 13Z" fill="currentColor" />
        </svg>
        <b>N</b>
      </span>
      <span className={styles.bar} style={{ width }} aria-hidden="true" />
      <span className="ul-num">{text}</span>
    </div>
  );
}
