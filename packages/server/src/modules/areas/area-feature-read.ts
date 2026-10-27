import type { AreaContext, MapArea } from '@ulpin/contracts';
import { query, transaction } from '../../infrastructure/db';
import { notFound } from '../../infrastructure/errors';
import { areaProposals, type ProposalFeature, type ProposalPackage } from './area-display-proposals';
import { areaDisplayPackages, getArea } from './areas';

type DisplayFeature = NonNullable<AreaContext['displayFeatures']>[number];
type RulePackage = ProposalPackage<ProposalFeature>;
/** One feature as its area displays it, null when the area does not display it, and the display packages naming
 * it; a package's features may keep only the fields the proposal rule reads. */
export type AreaFeatureRead = { area: MapArea; feature: DisplayFeature | null; packages: RulePackage[] };

/** The one feature a package holds, matched by identifier inside that package's body; no other feature is sent. */
const PACKAGE_FEATURE_SQL = `SELECT e.feature FROM import_packages p
  CROSS JOIN LATERAL jsonb_array_elements(p.body->'features') e(feature) WHERE p.id=$1 AND e.feature->>'id'=$2`;

/** One feature of an area without reading the area's other features: a proposal when the window reads draw it,
 * decided by the same packages and rule, otherwise its recorded row, and null when it is neither. */
export async function areaFeatureRead(featureId: string): Promise<AreaFeatureRead> {
  const row = (await query('SELECT area_id,revision,body FROM physical_features WHERE id=$1', [featureId])).rows[0];
  if (!row) notFound('Physical feature not found.');
  const area = await getArea(row.area_id);
  return transaction(async client => {
    const rules: RulePackage[] = await areaDisplayPackages(client, area.id, true);
    const packages = namingPackages(rules, featureId);
    const [drawn] = await areaProposals(client, area, rules, Infinity, featureId);
    if (drawn) {
      const body = (await client.query(PACKAGE_FEATURE_SQL, [drawn.packageId, featureId])).rows[0].feature;
      const feature = { ...body, displayState: 'unrecorded_proposal' as const, proposalPackageId: drawn.packageId };
      return { area, feature, packages };
    }
    return { area, feature: row.revision > 0 ? row.body : null, packages };
  });
}

/** The same read from an area context already held. */
export function contextFeatureRead(context: AreaContext, featureId: string): AreaFeatureRead {
  const feature = (context.displayFeatures ?? context.features).find(item => item.id === featureId) ?? null;
  return { area: context.area, feature, packages: namingPackages(context.packages, featureId) };
}

function namingPackages(packages: RulePackage[], featureId: string): RulePackage[] {
  return packages.filter(pkg => pkg.features.some(item => item.id === featureId));
}
