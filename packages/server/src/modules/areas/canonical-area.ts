import { NormalizedAreaSchema, type NormalizedArea, type NormalizedBuilding } from '@ulpin/contracts';
import { areaContext } from './areas';
import { AppError } from '../../infrastructure/errors';
import { assertCanonicalAreaScope, canonicalBuilding, canonicalCitations, canonicalFrame, canonicalValue, geographicToEnu, ENU_METHOD, projectionDigest, revalidateCanonicalSources } from '../registry/canonical-building';
import { localOperatorSubject } from '../usp/principal';

export async function canonicalArea(areaId: string): Promise<NormalizedArea> {
  localOperatorSubject();
  const context = await areaContext(areaId), frame = canonicalFrame(context.area);
  await assertCanonicalAreaScope(context.area);
  const buildings: NormalizedBuilding[] = [];
  const features = (context.displayFeatures ?? context.features).filter(f => f.kind === 'building');
  // Bound concurrent use of the existing register reader (no competing graph/SQL authority).
  for (let i = 0; i < features.length; i += 4)
    buildings.push(...await Promise.all(features.slice(i, i + 4).map(f => canonicalBuilding(f.id, 'current', context))));
  const result: NormalizedArea = { schemaVersion: 'normalized-building/1', revisionId: 'pending', frame,
    buildings: buildings.map(b => ({ buildingId: b.buildingId, revisionId: b.revisionId, recordState: b.recordState, name: b.name,
      footprint: b.footprint, heightM: b.heightM, heightState: b.heightState })), baseFeatures: [], overlays: [], tilesets: [],
    gaps: ['No qualified overlay/tileset supplied by the area context; presentation scene assets are not analytical tilesets.'] };
  if (!context.area.reference) result.gaps.push('Geographic placement unknown; no invented ENU origin.');
  for (const f of (context.displayFeatures ?? context.features).filter(f => f.kind !== 'building')) {
    const citations = await canonicalCitations(f.evidence, context.area.siteId), polygons = geographicToEnu(f.geographicGeometry, frame);
    const band = f.verticalExtent;
    result.baseFeatures.push({ id: f.id, kind: f.kind as NormalizedArea['baseFeatures'][number]['kind'],
      polygons: canonicalValue(polygons, polygons ? f.revision === 0 || ('displayState' in f && f.displayState === 'unrecorded_proposal') ? 'candidate' : 'source_supported' : 'unknown', citations, ENU_METHOD, 'm'),
      name: canonicalValue(f.name, 'source_supported', citations), lowerM: canonicalValue(band?.lower ?? null, band?.evidenceState === 'unresolved' ? 'candidate' : band?.evidenceState ?? 'unknown', citations, 'source_literal', 'm'),
      upperM: canonicalValue(band?.upper ?? null, band?.evidenceState === 'unresolved' ? 'candidate' : band?.evidenceState ?? 'unknown', citations, 'source_literal', 'm'), network: canonicalValue<string>(null) });
    if (!polygons) result.gaps.push(`${f.id}: non-polygon context retained in source; no guessed ribbon width or area.`);
  }
  result.revisionId = projectionDigest(result);
  // Building values retain their building dependency revision. Context values pin the complete area projection.
  for (const f of result.baseFeatures) for (const v of [f.polygons, f.name, f.lowerM, f.upperM, f.network]) v.revisionId = result.revisionId;
  await revalidateCanonicalSources(result, context.area.siteId);
  if ((await assertCanonicalAreaScope(context.area)).revision !== context.area.revision)
    throw new AppError(409, 'CANONICAL_INPUT_CHANGED', 'The area changed during projection; read again.');
  return NormalizedAreaSchema.parse(result);
}
