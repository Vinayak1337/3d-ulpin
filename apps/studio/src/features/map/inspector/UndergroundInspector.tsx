import { Ruler } from '@phosphor-icons/react';
import type { Trench } from '@ulpin/scene';
import { Button, DigColumn, EmptyState, type DigBand } from '@ulpin/ui';
import type { AreaFeature } from '../../../api/queries';
import { ringsIntersect } from '../geometry';
import { polygonsOf } from '../footprints';

const NETWORK_TOKEN: Record<string, string> = {
  water: '--ui-utility-water', sewer: '--ui-utility-sewer', gas: '--ui-utility-gas', electric: '--ui-utility-electric',
  telecom: '--ui-utility-telecom', metro: '--ui-rights-public',
};

/**
 * Underground screening below a drawn trench: every recorded utility the trench crosses, down to the
 * screening depth, with the gaps between them as Unknown rows. Never a clearance.
 */
export function UndergroundInspector({ utilities, trench, onClear }: { utilities: AreaFeature[]; trench: Trench | null; onClear: () => void }) {
  if (!trench?.ring) {
    return (
      <section className="ul-panel" style={{ alignSelf: 'start' }}>
        <div className="ul-panel__body">
          <EmptyState icon={Ruler} title="Draw a trench">
            {trench?.points.length === 1 ? 'Click the second end of the trench on the ground.' : 'Click two points on the ground to draw a trench. Everything recorded below it is listed here.'}
          </EmptyState>
        </div>
      </section>
    );
  }
  const ring = trench.ring;
  const bands = utilities
    .filter((u) => u.verticalExtent && polygonsOf(u.geometry).some((p) => p[0] && ringsIntersect(ring, p[0] as [number, number][])))
    .map((u) => ({ feature: u, top: -u.verticalExtent!.upper, bottom: -u.verticalExtent!.lower }))
    .sort((a, b) => a.top - b.top);
  const range = Math.max(20, ...bands.map((b) => Math.ceil(b.bottom / 5) * 5));
  const rows: DigBand[] = [];
  let depth = 0;
  for (const band of bands) {
    if (band.top - depth > 0.05) rows.push({ id: `gap-${depth}`, depth: `${depth.toFixed(1)} to ${band.top.toFixed(1)} m`, unknown: true, label: <><strong>Unknown</strong> · no utility survey</> });
    const profile = (band.feature.utilityProfile ?? {}) as Record<string, unknown>;
    const details = [
      typeof profile.quality_level === 'string' ? `quality ${profile.quality_level}` : null,
      typeof profile.protection === 'string' ? profile.protection : null,
      profile.tolerance === null || profile.tolerance === undefined ? 'tolerance not stated' : `± ${String(profile.tolerance)}`,
    ].filter(Boolean).join(' · ');
    rows.push({
      id: band.feature.id, depth: `${band.top.toFixed(1)} to ${band.bottom.toFixed(1)} m`,
      color: `var(${NETWORK_TOKEN[String(profile.network)] ?? '--ui-utility-water'})`,
      label: <><strong>{band.feature.name}</strong> · {details}</>,
    });
    depth = band.bottom;
  }
  if (range - depth > 0.05) rows.push({ id: 'gap-end', depth: `${depth.toFixed(1)} to ${range.toFixed(1)} m`, unknown: true, label: <><strong>Unknown</strong> · no utility survey</> });
  return (
    <DigColumn
      range={`0 to ${range} m`}
      bands={rows}
      actions={<Button variant="ghost" onClick={onClear}>Draw another trench</Button>}
    />
  );
}
