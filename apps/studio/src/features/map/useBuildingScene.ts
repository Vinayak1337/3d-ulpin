import { useMemo } from 'react';
import type { BuildingDetailInput, FindingInput, FootprintInput, MultiPolygon, StoreyInput } from '@ulpin/scene';
import type { BuildingLedger } from '@ulpin/api-client/draft';
import type { AreaFeature, BuildingRegister } from '../../api/queries';
import type { BuildingModel } from '../../model/building';
import type { ColourBy } from '../../state/selection';
import { polygonsOf, storeysFrom, toBase } from './footprints';
import { RIGHTS_TOKEN, ledgerSpace, tokenColour } from './ledger';
import { heightColour } from './heightBands';

/**
 * Scene inputs for an area with one building explored: the base map, every building (the explored one
 * storey by storey) and the explored building's levels and spaces, filled by the active Colour by.
 * `drawn` is the building footprints from the canonical records. Shared by the map workspace, the register
 * and the review workspace.
 */
export function useBuildingScene(features: AreaFeature[], feature: AreaFeature | null, model: BuildingModel | null, ledger: BuildingLedger | null | undefined, colour: Exclude<ColourBy, 'auto'>, drawn: FootprintInput[]) {
  const groundM = ledger?.groundElevationM ?? null;
  const base = useMemo(() => toBase(features), [features]);

  const storeys = useMemo(() => {
    const map = new Map<string, StoreyInput[]>();
    if (feature && model) {
      const s = storeysFrom(model, groundM, polygonsOf(feature.geometry));
      if (s) map.set(feature.id, s);
    }
    return map;
  }, [feature, model, groundM]);
  const footprints = useMemo(() => {
    const out = drawn.map((f) => (storeys.has(f.id) ? { ...f, storeys: storeys.get(f.id) } : f));
    if (colour !== 'height') return out;
    return out.map((f) => { const color = f.heightState === 'unknown' || f.heightState === 'unresolved' ? null : heightColour(f.heightM); return color ? { ...f, color } : f; });
  }, [drawn, storeys, colour]);

  const detail = useMemo<BuildingDetailInput | null>(() => {
    if (!model || !feature) return null;
    const rel = (v: number | null) => (v === null ? null : groundM === null ? v : v - groundM);
    const colours = { exclusive: tokenColour(RIGHTS_TOKEN.exclusive), shared: tokenColour(RIGHTS_TOKEN.shared), public: tokenColour(RIGHTS_TOKEN.public) };
    return {
      buildingId: feature.id,
      levels: model.levels.map((l) => ({
        id: l.id, order: l.order, lowerM: rel(l.lower), upperM: rel(l.upper),
        spaces: model.spaces.filter((s) => s.levelId === l.id && s.polygons.length).map((s) => {
          const rights = ledgerSpace(ledger, s.id)?.rights ?? 'unknown';
          const unverified = s.record.geometry ? !s.record.geometry.lowerVerified || !s.record.geometry.upperVerified : false;
          const fill = colour === 'rights'
            ? { color: rights === 'unknown' ? tokenColour(RIGHTS_TOKEN.unknown) : colours[rights], hatch: rights === 'unknown' || unverified }
            : { hatch: unverified };
          return { id: s.id, polygons: s.polygons, lowerM: rel(s.lower), upperM: rel(s.upper), fill };
        }),
      })),
    };
  }, [model, feature, ledger, colour, groundM]);

  return { base, footprints, detail, groundM };
}

/** A finding's volume in scene metres (above ground), from its geometry and recorded limits. */
export function findingVolume(finding: BuildingRegister['findings'][number], groundM: number | null): FindingInput {
  const q = (finding.quantities ?? {}) as Record<string, number>;
  const polygons = finding.geometry ? polygonsOf(finding.geometry as never) : [];
  const lower = typeof q.lowerM === 'number' ? q.lowerM - (groundM ?? 0) : 0;
  const upper = typeof q.upperM === 'number' ? q.upperM - (groundM ?? 0) : lower;
  return { id: finding.id, polygons: polygons as MultiPolygon, lowerM: lower, upperM: upper, participants: finding.featureIds };
}
