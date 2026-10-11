import { countsLine, type Package, type Target } from './model';
import styles from './Run.module.css';

const findingWords: Record<string, string> = {
  BOUNDARY_CONTACT: 'Boundary contact only; no positive footprint-area overlap',
  HORIZONTAL_INTERSECTION: 'Horizontal line or point intersection',
  BUILDING_FOOTPRINT_OVERLAP: 'Building footprints overlap horizontally',
  BUILDING_ROAD_OVERLAP: 'Building and road overlap horizontally',
  BUILDING_PUBLIC_LAND_OVERLAP: 'Building and public land overlap horizontally',
  UTILITY_HORIZONTAL_INTERSECTION: 'Building and utility intersect horizontally',
  UTILITY_VERTICAL_UNRESOLVED: 'The utility relationship lacks evidence for a 3D check',
};

export function Findings({ counts }: { counts: Package['findingCounts'] }) {
  if (counts === null) return <p className="ul-help">Review findings are not available.</p>;
  if (Object.keys(counts).length === 0) return <p className="ul-help">The review names no findings.</p>;
  return <ul className={styles.findings}>
    {Object.entries(counts).map(([code, count]) => <li key={code}>
      {count} · {findingWords[code] ?? 'Finding words are not supplied'} <span className="ul-mono">({code})</span>
    </li>)}
  </ul>;
}

export function PackageDetails({ pkg, targets, confirming = false }: {
  pkg: Package; targets: readonly Target[]; confirming?: boolean;
}) {
  const reasons = [...new Set(targets.filter(target => target.packageId === pkg.packageId)
    .flatMap(target => target.reason ? [target.reason] : []))];
  return <div className={styles.package}>
    <h3 className="studio-heading">Package <span className="ul-mono">{pkg.packageId}</span></h3>
    <p className="ul-help">Revision {pkg.revision}</p>
    <p>{confirming ? `${pkg.counts.ready} ready buildings will be recorded.` : countsLine(pkg.counts)}</p>
    <Findings counts={pkg.findingCounts} />
    {!pkg.reviewFingerprint ? <>
      <p>Not ready to confirm: this package has no review of its current revision.</p>
      {reasons.map(reason => <p key={reason}>{reason}</p>)}
    </> : null}
  </div>;
}

export function Packages({ packages, targets, truncated }: {
  packages: readonly Package[]; targets: readonly Target[]; truncated: boolean;
}) {
  return <div className={styles.stack}>
    {packages.map(pkg => <PackageDetails key={pkg.packageId} pkg={pkg} targets={targets} />)}
    {truncated ? <p>More packages belong to this batch than this read lists. Only the listed packages can be
      named in this confirmation.</p> : null}
  </div>;
}
