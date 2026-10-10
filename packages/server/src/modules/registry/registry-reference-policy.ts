/** Native reference documents may evidence a manually reviewed party/use claim,
 * never coordinates or verified levels. The caller also checks site membership
 * and existence of the exact retained document part. */
export function permitsReferenceRightSource(source: {
  status?: string;
  profile?: string;
  inspection?: { status?: string; partCount?: number } | null;
}, purpose: "record" | "geometry" | "right"): boolean {
  return purpose === "right" && source.status === "inspected" &&
    ["text-reference-v2", "pdf-reference-v2", "docx-reference-v2"].includes(source.profile || "") &&
    source.inspection?.status === "reference_only" &&
    Number.isInteger(source.inspection.partCount) && Number(source.inspection.partCount) > 0;
}

/** A reviewed record may cite a native text/CSV part without claiming geometry or rights. */
export function permitsReferenceRecordSource(source: {
  status?: string;
  profile?: string;
  inspection?: { status?: string; partCount?: number } | null;
}, purpose: "record" | "geometry" | "right"): boolean {
  return purpose === "record" && source.status === "inspected" &&
    ["text-reference-v2", "csv-reference-v2"].includes(source.profile || "") &&
    source.inspection?.status === "reference_only" &&
    Number.isInteger(source.inspection.partCount) && (source.inspection.partCount ?? 0) > 0;
}

/** Only a record claim may cite an interpreted native map feature; the caller proves its committed observation. */
export function permitsFeatureRecordSource(source: {
  status?: string;
  profile?: string;
  inspection?: { status?: string } | null;
}, purpose: "record" | "geometry" | "right"): boolean {
  return purpose === "record" && source.status === "inspected" && source.inspection?.status === "interpreted" &&
    ["geojson-area-v2", "arcgis-area-v2", "gpkg-area-v2", "shapefile_zip-area-v2"].includes(source.profile || "");
}
