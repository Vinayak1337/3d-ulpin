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
    /** Completeness over the outlines only, when the file also holds pins or lines. */
    outlineComplete?: boolean;
    unique: boolean;
    idEligible: boolean;
    /** Complete, unique safe integer tokens in the unchanged GeoJSON bytes, not parsed floats. */
    integerIdEligible?: boolean;
    /** The same fact over the outlines an outline kind draws, when the file also holds pins or lines. */
    outlineIntegerIdEligible?: boolean;
  }[];
  /** True only for complete, unique retained top-level GeoJSON Feature.id values. */
  featureIdEligible: boolean;
  featureIntegerIdEligible?: boolean;
  featureOutlineIntegerIdEligible?: boolean;
  suggestedIdField: string | null;
  suggestedNameField: string | null;
  suggestedTitle: string;
  suggestedNamespace: string;
}
