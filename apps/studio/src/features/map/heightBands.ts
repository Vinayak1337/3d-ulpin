import { tokenColour } from './ledger';
import type { AreaFeature } from '../../api/queries';

/** Colour by height: source-supported roof height above each building's own base, in fixed bands. */
export const HEIGHT_BANDS = [
  { max: 10, label: 'Under 10 m', color: 'var(--ui-seq-100)' },
  { max: 20, label: '10–20 m', color: 'var(--ui-seq-250)' },
  { max: 40, label: '20–40 m', color: 'var(--ui-seq-400)' },
  { max: 80, label: '40–80 m', color: 'var(--ui-seq-550)' },
  { max: Infinity, label: '80 m and over', color: 'var(--ui-seq-700)' },
] as const;

/** The band colour of a source-supported height; null when the height is unknown (drawn as usual). */
export function heightColour(heightM: number | null | undefined): string | null {
  if (typeof heightM !== 'number' || !Number.isFinite(heightM) || heightM <= 0) return null;
  return tokenColour(HEIGHT_BANDS.find((b) => heightM < b.max)!.color.slice(4, -1));
}

/** Buildings per band, plus those whose height is unknown. */
export function heightCounts(buildings: AreaFeature[]): { counts: number[]; unknown: number } {
  const counts = HEIGHT_BANDS.map(() => 0);
  let unknown = 0;
  for (const b of buildings) {
    const h = b.height?.value;
    const known = typeof h === 'number' && Number.isFinite(h) && h > 0 && b.height.state !== 'unknown' && b.height.state !== 'unresolved';
    if (!known) { unknown += 1; continue; }
    counts[HEIGHT_BANDS.findIndex((band) => h < band.max)]! += 1;
  }
  return { counts, unknown };
}
