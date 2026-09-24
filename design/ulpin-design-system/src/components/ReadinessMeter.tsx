import type { CSSProperties } from 'react';
import { Badge } from './Badge';
import { Panel } from './Panel';

export interface ReadinessDimension {
  /** Evidence, Geometry, Association, Consistency, Review or Freshness. */
  name: string;
  /** 0 to 1, or "unknown" (hatched bar; blocks an all-clear). */
  value: number | 'unknown';
  /** Right-hand word; defaults to "Ready" at 1, "Unknown" when unknown, else the percentage. */
  label?: string;
}

export interface ReadinessMeterProps {
  /** The named task, e.g. "Assign proposed 3D ULPIN". Readiness for one task says nothing about another. */
  task: string;
  /** Six dimensions: evidence, geometry, association, consistency, review, freshness. */
  dimensions: ReadinessDimension[];
  /** Render without the surrounding panel (inside an inspector or dialog). */
  bare?: boolean;
  style?: CSSProperties;
}

export const DEFAULT_READINESS_DIMENSIONS = ['Evidence', 'Geometry', 'Association', 'Consistency', 'Review', 'Freshness'];

/**
 * Readiness of one record for a named task, split into dimensions. No single overall score: the badge counts ready dimensions.
 */
export function ReadinessMeter({ task, dimensions, bare, style }: ReadinessMeterProps) {
  const ready = dimensions.filter((d) => d.value === 1).length;
  const rows = (
    <div className="ul-ready">
      {dimensions.map((d) => (
        <div key={d.name} className="ul-ready__row">
          <span>{d.name}</span>
          <div className="ul-ready__bar">
            {d.value === 'unknown' ? (
              <div className="ul-ready__fill ul-ready__fill--unknown" />
            ) : (
              <div className="ul-ready__fill" style={{ width: `${Math.round(Math.max(0, Math.min(1, d.value)) * 100)}%` }} />
            )}
          </div>
          <span>{d.label ?? (d.value === 'unknown' ? 'Unknown' : d.value === 1 ? 'Ready' : `${Math.round(d.value * 100)} %`)}</span>
        </div>
      ))}
    </div>
  );
  if (bare) return rows;
  return (
    <Panel
      style={{ maxWidth: 420, ...style }}
      title={task}
      aside={
        <Badge tone={ready === dimensions.length ? 'success' : 'warning'} icon={null}>
          {ready} of {dimensions.length}
        </Badge>
      }
    >
      {rows}
    </Panel>
  );
}
