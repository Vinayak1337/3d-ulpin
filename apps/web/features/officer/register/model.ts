import type {
  AreaGeometry,
  BuildingDossier,
  DossierSource,
  RegistryRecord,
  SourceLocator,
} from "@ulpin/contracts";

export const number = (value: number | null | undefined, unit = "") =>
  value == null || !Number.isFinite(value)
    ? "Not supplied"
    : `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}${unit ? ` ${unit}` : ""}`;
export const words = (value: string) =>
  value
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());
export const date = (value: string) =>
  new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
export const dateTime = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
export function locator(value: SourceLocator) {
  return (
    [
      value.page && `Page ${value.page}`,
      value.row && `Row ${value.row}`,
      value.featureId && `Feature ${value.featureId}`,
      value.jsonPointer,
      value.partId && `Part ${value.partId.slice(0, 8)}`,
      value.region && "Selected image region",
    ]
      .filter(Boolean)
      .join(" · ") || "Original source"
  );
}
export function sourceKind(
  source: DossierSource,
): "Photos" | "Plans & drawings" | "Documents" | "Data" {
  if (/\.(png|jpe?g|webp)$/i.test(source.name)) return "Photos";
  if (
    /plan|section|drawing|dxf|elevation/i.test(
      `${source.name} ${source.profile}`,
    )
  )
    return "Plans & drawings";
  if (
    /\.(json|geojson|csv|gpkg|zip)$/i.test(source.name) ||
    /geojson|gis|canonical/i.test(source.profile)
  )
    return "Data";
  return "Documents";
}
export function polygons(geometry: AreaGeometry): number[][][][] {
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  if (geometry.type === "GeometryCollection")
    return geometry.geometries.flatMap(polygons);
  return [];
}
/** Display primitives preserve the recorded geometry type; coordinates remain in its local frame. */
export function geometryParts(geometry: AreaGeometry): {
  polygons: number[][][][];
  lines: number[][][];
  points: number[][];
} {
  if (geometry.type === "GeometryCollection")
    return geometry.geometries.map(geometryParts).reduce(
      (all, item) => ({
        polygons: [...all.polygons, ...item.polygons],
        lines: [...all.lines, ...item.lines],
        points: [...all.points, ...item.points],
      }),
      { polygons: [], lines: [], points: [] },
    );
  return {
    polygons: polygons(geometry),
    lines:
      geometry.type === "LineString"
        ? [geometry.coordinates]
        : geometry.type === "MultiLineString"
          ? geometry.coordinates
          : [],
    points:
      geometry.type === "Point"
        ? [geometry.coordinates]
        : geometry.type === "MultiPoint"
          ? geometry.coordinates
          : [],
  };
}
export function recordGeometry(
  dossier: BuildingDossier,
  record: RegistryRecord,
): AreaGeometry {
  return (
    dossier.detailedScene.find((item) => item.record.id === record.id)
      ?.localGeometry ?? {
      type: "Polygon",
      coordinates: [
        [
          ...record.footprint,
          ...(record.footprint.length ? [record.footprint[0]] : []),
        ],
      ],
    }
  );
}
export function recordEvidence(
  dossier: BuildingDossier,
  record: RegistryRecord,
) {
  return record.evidence.flatMap((binding) => {
    const source = dossier.sources.find((item) => item.id === binding.sourceId);
    return source ? [{ source, locator: binding.locator }] : [];
  });
}
export function historyEntries(dossier: BuildingDossier) {
  return [
    ...dossier.sources.map((source) => ({
      id: `source-${source.id}`,
      title: "Source retained",
      detail: `${source.name} · revision ${source.revision}`,
      time: source.createdAt,
      type: "Sources",
      sourceId: source.id,
    })),
    ...dossier.associations.map((item) => ({
      id: `association-${item.id}`,
      title: `${words(item.relationship)} · ${item.status}`,
      detail: item.reason,
      time: item.updatedAt,
      type: "Associations",
      actor: item.actor,
    })),
    ...dossier.investigations.flatMap((item) =>
      item.history.map((entry, index) => ({
        id: `${item.id}-${index}`,
        title: `${item.reference} · ${words(entry.status)}`,
        detail: entry.reason,
        time: entry.time,
        type: "Investigations",
        actor: entry.actor,
      })),
    ),
    ...dossier.packages.flatMap((pkg) =>
      (pkg.factDecisions ?? []).map((entry, index) => ({
        id: `${pkg.id}-${index}`,
        title: "Source fact reviewed",
        detail: entry.reason,
        time: entry.time,
        type: "Reviews",
        actor: entry.actor,
      })),
    ),
  ].sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
}
