/** Curated sources: metadata access, successful acquisition and reuse are separate gates. */
export interface SourceCatalogEntry {
  id: string;
  name: string;
  provider: string;
  datasetId: string;
  datasetUrl: string;
  metadataUrl: string;
  queryUrl: string;
  coverage: string;
  sourceCRS: string;
  status: "metadata_verified" | "download_verified";
  license: {
    status: "public_open_data_terms" | "unresolved";
    url: string;
    note: string;
  };
  acquisitionEnabled: boolean;
  retrievedAt: string;
  updateFrequency: string;
  privacyAllowlist: readonly string[];
  adapter: {
    id: string;
    version: string;
    format: "geojson" | "arcgis";
    idField: string;
    heightField: string | null;
    heightUnit: "ft" | null;
    heightMeaning: string;
  };
  limits: { maxFeatures: number; requiresBoundedArea: boolean };
  snapshot?: {
    areaKey: string;
    name: string;
    sourceFile: string;
    manifestFile: string;
    sha256: string;
    featureCount: number;
    bboxWgs84: readonly [number, number, number, number];
  };
  limitations: readonly string[];
}

export const SOURCE_CATALOG: readonly SourceCatalogEntry[] = [
  {
    id: "nyc-building-footprints",
    name: "NYC building footprints",
    provider: "City of New York Office of Technology and Innovation (OTI)",
    datasetId: "5zhs-2jue",
    datasetUrl:
      "https://data.cityofnewyork.us/City-Government/BUILDING/5zhs-2jue",
    metadataUrl:
      "https://github.com/CityOfNewYork/nyc-geo-metadata/blob/main/Metadata/Metadata_BuildingFootprints.md",
    queryUrl: "https://data.cityofnewyork.us/resource/5zhs-2jue.geojson",
    coverage: "New York City; cached area is in the Bronx",
    sourceCRS: "EPSG:4326",
    status: "download_verified",
    license: {
      status: "public_open_data_terms",
      url: "https://opendata.cityofnewyork.us/overview/#termsofuse",
      note: "Public informational data under NYC Open Data and NYC.gov terms; retain OTI attribution. No warranty or endorsement.",
    },
    acquisitionEnabled: true,
    retrievedAt: "2026-09-14",
    updateFrequency:
      "Provider reports daily edits and weekly public releases; the bundled area is a prior snapshot.",
    privacyAllowlist: [
      "the_geom",
      "doitt_id",
      "bin",
      "base_bbl",
      "height_roof",
      "ground_elevation",
      "feature_code",
      "geom_source",
      "last_edited_date",
    ],
    adapter: {
      id: "nyc-building-footprints",
      version: "1",
      format: "geojson",
      idField: "doitt_id",
      heightField: "height_roof",
      heightUnit: "ft",
      heightMeaning:
        "Reported roof height above each building's ground; use a building-relative base until vertical reference review.",
    },
    limits: { maxFeatures: 100, requiresBoundedArea: true },
    snapshot: {
      areaKey: "nyc-bronx-353927-context",
      name: "Bronx building context around OTI 353927",
      sourceFile: "fixtures/real-area/original.geojson",
      manifestFile: "fixtures/real-area/manifest.json",
      sha256:
        "869c5dc4fb50d71be4f62f4a2936c29bd95ade14c712bdf4f51986841d82771a",
      featureCount: 62,
      bboxWgs84: [-73.8715, 40.8993, -73.8688, 40.90125],
    },
    limitations: [
      "Exterior building footprints and source height attributes do not establish parcels, interior floors or ownership.",
      "A constant-height exterior envelope is an approximation. Ground elevation datum is not stated per feature.",
      "NYC BIN may be duplicated or unknown; DOITT_ID is the provider's stable feature key. Neither identifier is an official ULPIN.",
      "The bounded query selects whole buildings contained by its box and excludes crossing buildings; no roads or utilities are included.",
    ],
  },
  {
    id: "gmda-svamitav-builtup",
    name: "GMDA-hosted SVAMITVA built-up areas",
    provider: "GMDA public ArcGIS service directory",
    datasetId: "svamitav_Prod/MapServer/1",
    datasetUrl:
      "https://onemapdepts.gmda.gov.in/server/rest/services/svamitav_Prod/MapServer",
    metadataUrl:
      "https://onemapdepts.gmda.gov.in/server/rest/services/svamitav_Prod/MapServer/1",
    queryUrl:
      "https://onemapdepts.gmda.gov.in/server/rest/services/svamitav_Prod/MapServer/1/query",
    coverage:
      "Advertised service extent; locality and coincident parcel/road coverage unverified",
    sourceCRS: "EPSG:32643",
    status: "metadata_verified",
    license: {
      status: "unresolved",
      url: "https://www.gmda.gov.in/policies.html",
      note: "GMDA's current copyright policy requires prior permission by email for reproduction. Item metadata has empty licenseInfo/accessInformation; no dataset-specific grant was found. Feature acquisition and bundling remain disabled pending permission.",
    },
    acquisitionEnabled: false,
    retrievedAt: "2026-09-15",
    updateFrequency: "Not stated in inspected provider metadata",
    privacyAllowlist: [
      "OBJECTID",
      "Uniq_Id",
      "State_C",
      "District_C",
      "Block_C",
      "Tehsil_C",
      "Village_C",
      "Vill_Name",
      "LGD_Code",
      "No_Floors",
    ],
    adapter: {
      id: "gmda-svamitav-builtup",
      version: "candidate-1",
      format: "arcgis",
      idField: "Uniq_Id",
      heightField: null,
      heightUnit: null,
      heightMeaning:
        "No_Floors is an unverified floor-count field, not measured height. No default extrusion is evidence.",
    },
    limits: { maxFeatures: 100, requiresBoundedArea: true },
    limitations: [
      "Metadata only: no GMDA feature values were downloaded for this snapshot.",
      "Bounded aggregate queries around Islampur, Wazirabad and Farrukhnagar returned zero built-up, parcel and road features in each tested envelope. This is not evidence that the entire service is empty or that utility layers coincide.",
      "Administrative code authorities, source identifiers, building semantics and floor values require verification.",
      "Never request all fields. Owner names, personal identifiers and free-text remarks are excluded from the allowlist.",
      "A source Uniq_Id is not an official ULPIN without a verified identifier assertion.",
    ],
  },
];

export function getSourceCatalogEntry(
  id: string,
): SourceCatalogEntry | undefined {
  return SOURCE_CATALOG.find((source) => source.id === id);
}
