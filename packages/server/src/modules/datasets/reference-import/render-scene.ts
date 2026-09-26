import { geometryPoints, type SpatialGeometry } from "@ulpin/contracts";
import type { ReferenceDisplayOptions } from "./display";
import type { AdaptedReferenceScene, ReferenceDiagnostic } from "./adapter";

/** Compatibility DTO for the existing pure Three builders. Geometry is projected from the v2 candidate. */
export function toReferenceRenderScene(data: AdaptedReferenceScene, options: Pick<ReferenceDisplayOptions, "frameId"> = {}) {
  const frameId = options.frameId ?? (data.input.frames.frames.length === 1 ? data.input.frames.frames[0].ref.id : undefined);
  if (!frameId || !data.input.frames.frames.some(f => f.ref.id === frameId)) throw new Error("Choose one named frame; unrelated frames cannot be overlaid implicitly");
  const diagnostics: ReferenceDiagnostic[] = [];
  const sourceGeometry = new Map(data.source.geometries.map(g => [g.id, g]));
  const geometries = data.input.geometry.representations.flatMap(rep => {
    if (rep.frame?.ref.id !== frameId) {
      diagnostics.push({ code: "OTHER_RENDER_FRAME", severity: "unsupported", objectId: rep.entity.id, geometryId: rep.ref.id, message: "Representation retained in another frame; a reviewed transform is required" });
      return [];
    }
    const profile = rep.geometry;
    if (profile.profile !== "planar" && profile.profile !== "prism") {
      diagnostics.push({ code: "UNAVAILABLE_RENDER_GEOMETRY", severity: "unsupported", objectId: rep.entity.id, geometryId: rep.ref.id, message: "Original native geometry retained; no supported canonical inline display profile" });
      return [];
    }
    const geometry = profile.profile === "prism" ? profile.footprint : profile.geometry;
    const interval = profile.profile === "prism" ? profile.interval : null;
    const raw = sourceGeometry.get(rep.ref.id)!;
    const displayUnreferencedHeight=interval===null&&raw.baseElevationM===null&&typeof raw.heightM==='number'&&raw.heightM>0&&(geometry.type==='Polygon'||geometry.type==='MultiPolygon');
    if(displayUnreferencedHeight)diagnostics.push({code:'DISPLAY_UNREFERENCED_HEIGHT',severity:'notice',objectId:rep.entity.id,geometryId:rep.ref.id,message:'Supplied height displayed at an arbitrary ground plane; absolute base elevation and analytical vertical interval remain unavailable.'});
    if (interval === null) diagnostics.push({ code: raw.baseElevationM === null ? "DISPLAY_ZERO_ONLY" : "DISPLAY_BASE_ONLY", severity: "notice", objectId: rep.entity.id, geometryId: rep.ref.id,
      message: "Display placement only; unknown height does not establish an analytical vertical interval" });
    return [{ ...raw, id: rep.ref.id, objectId: rep.entity.id, version: rep.revision,
      frameId: rep.frame!.ref.id, type: geometry.type, coordinates: geometry.coordinates,
      baseElevationM: interval?.lowerMetres ?? raw.baseElevationM, heightM: interval ? interval.upperMetres - interval.lowerMetres : displayUnreferencedHeight ? raw.heightM : null }];
  });
  const points = geometries.flatMap(g => geometryPoints({ type: g.type, coordinates: g.coordinates } as SpatialGeometry));
  if (points.some(p => p.some(v => !Number.isFinite(v) || Math.abs(v) > 5000))) throw new Error("Reference display is bounded to 5 km from its named origin");
  const extent = points.reduce((b,p) => [Math.min(b[0],p[0]),Math.min(b[1],p[1]),Math.max(b[2],p[0]),Math.max(b[3],p[1])], [Infinity,Infinity,-Infinity,-Infinity]);
  const { sceneDecoration: _unqualifiedDecoration, ...receiptFields } = data.source;
  const supportedIds = new Set(geometries.map(g => g.id));
  const scene = {
    ...receiptFields,
    metadata: { ...data.source.metadata, extent: points.length ? extent : null },
    frames: data.source.frames.filter(f => f.id === frameId),
    schemaVersion: "1.0.0" as const,
    projectionVersion: "ulpin-reference-render/1" as const,
    canonicalSchemaVersion: data.input.schemaVersion,
    canonicalSnapshotDigest: data.snapshot.manifest.inputDigest,
    objects: data.source.objects.map(o => ({ ...o, geometryId: o.geometryId && supportedIds.has(o.geometryId) ? o.geometryId : null })),
    geometries,
  };
  return { scene, diagnostics, bindings: data.input.geometry.representations.map(r => ({ geometryId: r.ref.id, entity: r.entity, representation: { ref: r.ref, revision: r.revision } })) };
}
