import type { CSSProperties } from 'react';
import { Badge } from './Badge';
import { EvidenceChip, type EvidenceChipProps } from './EvidenceChip';

export interface CarpetAreaCheckProps {
  /** Unit name for the title. */
  unit: string;
  /** Floor area inside external walls, m². */
  grossInternal: number;
  /** Deductions, e.g. [{ label: 'Less service shaft', area: 0.88 }, { label: 'Less exclusive balcony', area: 4.2 }]. Internal partitions stay included (RERA s.2(k)). */
  deductions: Array<{ label: string; area: number }>;
  /** Declared carpet area, m². */
  declared: number;
  /** Source of the declared figure. */
  declaredEvidence?: EvidenceChipProps;
  /** Review threshold in %; a difference above it becomes Needs review. */
  tolerancePct: number;
  style?: CSSProperties;
}

const m2 = (n: number) => `${n.toFixed(2)} m²`;

/**
 * Recomputes RERA carpet area from the unit's plan components and compares it with the declared figure, showing the arithmetic.
 */
export function CarpetAreaCheck({ unit, grossInternal, deductions, declared, declaredEvidence, tolerancePct, style }: CarpetAreaCheckProps) {
  const computed = deductions.reduce((a, d) => a - d.area, grossInternal);
  const diff = declared - computed;
  const pct = (Math.abs(diff) / computed) * 100;
  const over = pct > tolerancePct;
  return (
    <div className="ul-panel" style={{ maxWidth: 520, ...style }}>
      <div className="ul-panel__head">
        <h3 className="ul-panel__title">Carpet area · {unit}</h3>
        {over ? <Badge status="Needs review" /> : <Badge tone="success" icon="check-circle">Within tolerance</Badge>}
      </div>
      <div className="ul-panel__body ul-stack">
        <table className="ul-table">
          <tbody>
            <tr>
              <td>Floor area inside external walls</td>
              <td className="ul-r ul-num">{m2(grossInternal)}</td>
            </tr>
            {deductions.map((d) => (
              <tr key={d.label}>
                <td>{d.label}</td>
                <td className="ul-r ul-num">−{m2(d.area)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Carpet area, computed</td>
              <td className="ul-r ul-num">{m2(computed)}</td>
            </tr>
          </tfoot>
        </table>
        <dl className="ul-dl">
          <dt>Declared</dt>
          <dd>
            {m2(declared)} {declaredEvidence && <EvidenceChip {...declaredEvidence} />}
          </dd>
          <dt>Difference</dt>
          <dd>
            {diff >= 0 ? '+' : '−'}
            {m2(Math.abs(diff))} ({pct.toFixed(1)} %) · tolerance {tolerancePct} %
          </dd>
        </dl>
      </div>
    </div>
  );
}
