import { CopyableId } from '../../identity/CopyableId';
import type { IntakeItem } from '../batch-model';
import { confirmingPackageWords, countsLine, reasonsBesideReview, reviewWords, type Package } from './model';
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

/** The batch's files as its manifest lists them; a package is named by the file it was drafted from. */
export type AnchorItems = readonly Pick<IntakeItem, 'itemId' | 'name'>[];

export function Findings({ counts }: { counts: Package['findingCounts'] }) {
  if (counts === null) return <p>Findings not available.</p>;
  if (Object.keys(counts).length === 0) return <p>No findings.</p>;
  return <ul className={styles.findings}>
    {Object.entries(counts).map(([code, count]) => <li key={code}>
      {count} · {findingWords[code] ?? <>A finding the Studio has no words for: <span
        className="ul-mono">{code}</span></>}
    </li>)}
  </ul>;
}

/** The package's heading: its file's name, or words when the manifest is not read or does not list that file. */
export function packageHeading(pkg: Pick<Package, 'anchorItemId'>, items: AnchorItems | undefined): string {
  if (!items) return 'Package';
  return items.find(item => item.itemId === pkg.anchorItemId)?.name
    ?? 'Package of a file the batch list does not name';
}

export function PackageDetails({ pkg, items, reasons = [], confirming = false }: {
  pkg: Package; items?: AnchorItems; reasons?: readonly string[]; confirming?: boolean;
}) {
  const review = reviewWords(pkg);
  return <div className={styles.package}>
    <h3 className="studio-heading">{packageHeading(pkg, items)}</h3>
    <p className="ul-caption">Package <CopyableId id={pkg.packageId} name="package identifier" /></p>
    {pkg.recordingConfirmationId ? <p>Being recorded by confirmation <CopyableId
      id={pkg.recordingConfirmationId} name="confirmation identifier" />.</p> : null}
    {review ? <>
      <p>{review}</p>
      {reasonsBesideReview(pkg, reasons).map(reason => <p key={reason}>{reason}</p>)}
    </> : <>
      <p className="ul-help">Revision {pkg.revision}</p>
      <p>{confirming ? confirmingPackageWords(pkg) : countsLine(pkg.counts)}</p>
      <Findings counts={pkg.findingCounts} />
      {pkg.state === 'COMMITTED' ? <p>This package is already recorded.</p> : null}
    </>}
  </div>;
}

export function Packages({ packages, items, reasons, truncated }: {
  packages: readonly Package[]; items?: AnchorItems; reasons: Record<string, string[]>; truncated: boolean;
}) {
  return <div className={styles.stack}>
    {packages.map(pkg => <PackageDetails key={pkg.packageId} pkg={pkg} items={items}
      reasons={reasons[pkg.packageId]} />)}
    {truncated ? <p>This batch has more packages than listed here.</p> : null}
  </div>;
}
