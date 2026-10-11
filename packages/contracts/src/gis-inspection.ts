/** Read-only source metadata. Suggestions never establish geometry meaning or authority. */
export interface GisInspection {
  quarantine?: import('./gis-quarantine').GisQuarantine;
  format: "geojson" | "arcgis" | "gpkg" | "shapefile_zip";
  sourceSha256: string;
  bytes: number;
  layers: string[];
  layer: string | null;
  sourceCrs: string | null;
  crsEvidence: string | null;
  /** Horizontal unit named by the resolved CRS; older inspections may omit it. */
  crsUnit?: string | null;
  featureCount: number | null;
  geometryTypes: string[];
  fields: {
    name: string;
    complete: boolean;
    unique: boolean;
    idEligible: boolean;
    /** Complete, unique safe integer tokens in the unchanged GeoJSON bytes, not parsed floats. */
    integerIdEligible?: boolean;
  }[];
  /** True only for complete, unique retained top-level GeoJSON Feature.id values. */
  featureIdEligible: boolean;
  featureIntegerIdEligible?: boolean;
  suggestedIdField: string | null;
  suggestedNameField: string | null;
  suggestedTitle: string;
  suggestedNamespace: string;
}
