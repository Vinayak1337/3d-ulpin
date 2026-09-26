import type { KeyboardEvent } from 'react';

export interface RailLevel {
  id: string;
  label: string;
  /** Lower elevation in the named reference; null = unknown ("?" with the hatch). */
  lower: number | null;
  estimated?: boolean;
  belowGround?: boolean;
}

/**
 * Vertical level picker in source order. The vertical reference is named once at the top; each level
 * shows its lower elevation; the ground line sits between the last above- and first below-ground level.
 */
export function LevelRail({ levels, reference, ground, selected, onSelect }: {
  levels: RailLevel[]; reference: string | null; ground?: number | null; selected?: string | null; onSelect: (id: string) => void;
}) {
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const index = levels.findIndex((level) => level.id === selected);
    const next = levels[Math.min(levels.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)))];
    if (next) onSelect(next.id);
  };
  const firstBelow = levels.findIndex((level) => level.belowGround);
  return (
    <div className="ul-levelrail ul-float" role="listbox" aria-label="Levels" tabIndex={0} onKeyDown={onKey}>
      <span className="ul-levelrail__ref">{reference ? `m · ${reference}` : 'Vertical reference not stated'}</span>
      {levels.map((level, index) => (
        <div key={level.id} style={{ display: 'contents' }}>
          {index === firstBelow && index > 0 ? (
            <span className="ul-ground">{ground === null || ground === undefined ? 'ground' : `${ground} ground`}</span>
          ) : null}
          <button
            type="button"
            role="option"
            aria-selected={level.id === selected}
            className="ul-level"
            onClick={() => onSelect(level.id)}
            tabIndex={-1}
          >
            <span className="ul-level__label">{level.label}</span>
            <em className={level.lower === null ? 'ul-level__unknown' : undefined}>
              {level.lower === null ? '?' : `${level.lower.toFixed(1)}${level.estimated ? ' est.' : ''}`}
            </em>
          </button>
        </div>
      ))}
    </div>
  );
}
