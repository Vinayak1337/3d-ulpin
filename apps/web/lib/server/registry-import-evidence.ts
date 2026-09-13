import type {
  CoordinateFrame,
  ContextFeature,
  ComputedUnit,
  SourceRevision,
  SourceBinding,
} from "@ulpin/contracts";
import { AppError } from "./errors";

export function assertRegistrySourceFrame(site: CoordinateFrame, source: SourceRevision) {
  const frame=source.inspection?.frame;
  if(frame && (frame.id!==site.id || frame.benchmark!==site.benchmark || frame.horizontalUnit!==site.horizontalUnit || frame.verticalUnit!==site.verticalUnit))
    throw new AppError(422,'EVIDENCE_FRAME','The source declares a different frame or benchmark. Reconcile the source explicitly before using it in this site.');
}

export function unitImportEvidence(unit: ComputedUnit): SourceBinding[] {
  const bindings = Object.values(unit.bindings).filter(
    (b): b is SourceBinding => Boolean(b),
  );
  if (unit.calibration)
    bindings.push({
      sourceId: unit.calibration.sourceId,
      locator: `page ${unit.calibration.page}, calibrated plan`,
    });
  const unique = [
    ...new Map(bindings.map((b) => [`${b.sourceId}:${b.locator}`, b])).values(),
  ];
  if (!unique.length)
    throw new AppError(
      422,
      "IMPORT_EVIDENCE",
      `${unit.alias} has no bound source evidence. Bind an inspected source in preparation before importing.`,
    );
  return unique;
}

export function contextImportEvidence(
  context: ContextFeature,
  sources: SourceRevision[],
  units: ComputedUnit[],
): SourceBinding {
  if (context.evidence) return context.evidence;
  // Older snapshots did not store context bindings. Recover only an unambiguous
  // matching feature, preferring sources actually bound by the built units.
  const bound = new Set(
    units.flatMap((u) =>
      Object.values(u.bindings)
        .filter(Boolean)
        .map((b) => b!.sourceId),
    ),
  );
  const matches = sources.filter(
    (s) =>
      s.status === "ready" &&
      s.inspection?.features?.some(
        (f) =>
          f.alias === context.alias &&
          f.kind === context.kind &&
          JSON.stringify(f.footprint) === JSON.stringify(context.footprint),
      ),
  );
  const preferred = matches.filter((s) => bound.has(s.id));
  const candidates = preferred.length ? preferred : matches;
  if (candidates.length !== 1)
    throw new AppError(
      422,
      "IMPORT_CONTEXT_EVIDENCE",
      `${context.alias}: the context source is missing or ambiguous. Re-prepare with the intended spatial source and rebuild before importing.`,
    );
  return { sourceId: candidates[0].id, locator: `feature ${context.alias}` };
}
