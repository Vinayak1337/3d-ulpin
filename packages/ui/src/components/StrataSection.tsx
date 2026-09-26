export interface StrataLevel {
  id: string;
  label: string;
  lower: number | null;
  upper: number | null;
  estimated?: boolean;
}

/**
 * Vertical section of one building on its parcel: every recorded level at its real elevation, the
 * ground line and the selected level named. Levels with unknown limits are left out, never guessed.
 */
export function StrataSection({ parcel, levels, selectedId, selectedLabel, ground, datum }: {
  parcel: string | null; levels: StrataLevel[]; selectedId: string | null; selectedLabel?: string; ground: number | null; datum: string | null;
}) {
  const known = levels.filter((l): l is StrataLevel & { lower: number; upper: number } => l.lower !== null && l.upper !== null);
  if (!known.length) return null;
  const W = 520, H = 300, top = 24, bottom = H - 20;
  const lo = Math.min(...known.map((l) => l.lower), ground ?? Infinity) - 2;
  const hi = Math.max(...known.map((l) => l.upper)) + 2;
  const y = (m: number) => top + ((hi - m) / (hi - lo)) * (bottom - top);
  const groundY = ground !== null ? y(ground) : bottom;
  const x0 = 150, x1 = 370;
  const selected = known.find((l) => l.id === selectedId) ?? null;
  const roof = known.reduce((a, b) => (b.upper > a.upper ? b : a));
  const unit = datum ? ` m · ${datum}` : ' m';
  return (
    <figure className="ul-panel ul-strata">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Vertical section${parcel ? ` of parcel ${parcel}` : ''}${selected ? `, ${selectedLabel ?? selected.label} highlighted` : ''}`}>
        <rect className="ul-strata__sky" x="0" y="0" width={W} height={groundY} />
        <rect className="ul-strata__soil" x="0" y={groundY} width={W} height={H - groundY} />
        {known.map((l) => {
          const on = l.id === selectedId;
          return (
            <g key={l.id}>
              <rect className={on ? 'ul-strata__sel' : 'ul-strata__level'} x={x0} y={y(l.upper)} width={x1 - x0} height={Math.max(1, y(l.lower) - y(l.upper))}
                strokeDasharray={l.estimated ? '4 3' : undefined} />
              {on ? <text className="ul-strata__on" x={x0 + 10} y={(y(l.upper) + y(l.lower)) / 2 + 4}>{selectedLabel ?? l.label}</text> : null}
              {on ? <text className="ul-strata__num" x={x1 + 12} y={(y(l.upper) + y(l.lower)) / 2 + 4}>{l.lower.toFixed(1)} to {l.upper.toFixed(1)}{unit}</text> : null}
            </g>
          );
        })}
        {roof.id !== selectedId ? <text className="ul-strata__num" x={x1 + 12} y={y(roof.upper) + 4}>{roof.upper.toFixed(1)} roof</text> : null}
        <line className="ul-strata__ground" x1="0" y1={groundY} x2={W} y2={groundY} />
        {ground !== null ? <text className="ul-strata__num" x="8" y={groundY - 6}>{ground.toFixed(1)} ground</text> : null}
        {parcel ? <text className="ul-strata__num" x="8" y={H - 6}>Parcel {parcel}</text> : null}
      </svg>
    </figure>
  );
}
