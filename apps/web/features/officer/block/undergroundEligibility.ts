import type { BuildingDossier } from "@ulpin/contracts";

/** A negative number only means below grade when the saved datum explicitly defines grade zero. */
function hasGroundZero(reference: string): boolean {
  const value = reference.trim().toLowerCase();
  return /^ground-relative:[^\s]+$/.test(value);
}

/** Scene and record datums must match; this adapter never invents a vertical transform. */
export function eligibleUndergroundRecordIds(
  dossier: BuildingDossier | null | undefined,
  sceneVerticalReference: string | null,
): ReadonlySet<string> {
  const ids = new Set<string>();
  if (!dossier || !sceneVerticalReference) return ids;
  for (const detail of dossier.detailedScene) {
    const reference = detail.verticalReference;
    if (!reference || reference !== sceneVerticalReference ||
        !hasGroundZero(reference) ||
        !detail.record.evidence.length ||
        !detail.geographicGeometry ||
        !Number.isFinite(detail.lower) || !Number.isFinite(detail.upper) ||
        detail.lower! >= detail.upper! || detail.lower! >= 0) continue;
    ids.add(detail.record.id);
  }
  return ids;
}
