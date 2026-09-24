import { useRef, useState, type KeyboardEvent } from 'react';
import { cx } from '../cx';

export interface Level {
  /** Short level label in source order: Roof, F8 … F1, G, B1, B2. */
  id: string;
  /** Lower elevation in the named vertical reference, e.g. "233.8". */
  elevation: string;
  /** Limits estimated rather than documented: shows a trailing "est.". */
  estimated?: boolean;
  /** Below the ground line (basements). */
  belowGround?: boolean;
  /** Show as a ghost (hidden above an isolated level). */
  ghost?: boolean;
  /** Tooltip, e.g. "Ground, stilt parking". */
  title?: string;
}

export interface LevelRailProps {
  /** Every level top to bottom (roof, floors, ground, basements) in source order. */
  levels: Level[];
  /** Vertical reference named once at the top, e.g. "m · SD-1". Never relabel a local height as mean sea level. */
  reference: string;
  /** Ground elevation shown on the ground line, e.g. "212.4". */
  ground?: string;
  /** Selected level id (controlled). */
  selected?: string;
  defaultSelected?: string;
  onSelect?: (id: string) => void;
}

/**
 * A vertical level picker floating on the right edge of the canvas; arrow keys move the selection.
 */
export function LevelRail({ levels, reference, ground, selected, defaultSelected, onSelect }: LevelRailProps) {
  const [inner, setInner] = useState(defaultSelected);
  const current = selected ?? inner;
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const pick = (id: string) => {
    setInner(id);
    onSelect?.(id);
  };
  const onKey = (e: KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = Math.max(0, Math.min(levels.length - 1, i + d));
    pick(levels[n].id);
    refs.current[n]?.focus();
  };
  const firstBelow = levels.findIndex((l) => l.belowGround);
  return (
    <div className="ul-float ul-levelrail" role="listbox" aria-label="Levels">
      <div className="ul-caption" style={{ padding: '2px 8px' }}>
        {reference}
      </div>
      {levels.map((l, i) => (
        <LevelRow key={l.id} l={l} i={i} showGround={i === firstBelow} ground={ground} current={current} pick={pick} onKey={onKey} refs={refs} />
      ))}
      {firstBelow === -1 && ground && <div className="ul-ground">{ground} ground</div>}
    </div>
  );
}

function LevelRow({
  l,
  i,
  showGround,
  ground,
  current,
  pick,
  onKey,
  refs,
}: {
  l: Level;
  i: number;
  showGround: boolean;
  ground?: string;
  current?: string;
  pick: (id: string) => void;
  onKey: (e: KeyboardEvent, i: number) => void;
  refs: { current: Array<HTMLButtonElement | null> };
}) {
  return (
    <>
      {showGround && <div className="ul-ground">{ground ? `${ground} ground` : 'ground'}</div>}
      <button
        ref={(el) => {
          refs.current[i] = el;
        }}
        type="button"
        role="option"
        aria-selected={l.id === current}
        title={l.title}
        className={cx('ul-level', l.ghost && 'ul-level--ghost')}
        onClick={() => pick(l.id)}
        onKeyDown={(e) => onKey(e, i)}
      >
        <span>{l.id}</span>
        <em>
          {l.elevation}
          {l.estimated ? ' est.' : ''}
        </em>
      </button>
    </>
  );
}
