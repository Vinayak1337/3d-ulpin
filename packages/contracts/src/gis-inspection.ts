/** Read-only source metadata. Suggestions never establish geometry meaning or authority. */
export interface GisInspection {
  format: "geojson" | "arcgis" | "gpkg" | "shapefile_zip";
  sourceSha256: string;
  bytes: number;
  layers: string[];
  layer: string | null;
  sourceCrs: string | null;
  crsEvidence: string | null;
  featureCount: number | null;
  geometryTypes: string[];
  fields: {
    name: string;
    complete: boolean;
    unique: boolean;
    idEligible: boolean;
  }[];
  /** True only for complete, unique retained top-level GeoJSON Feature.id values. */
  featureIdEligible: boolean;
  suggestedIdField: string | null;
  suggestedNameField: string | null;
  suggestedTitle: string;
  suggestedNamespace: string;
}
