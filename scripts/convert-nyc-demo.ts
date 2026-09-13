import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pool, query } from "../apps/web/lib/server/db";

// Bounded conversion of the pinned NYC original, not a general GIS importer.
const directory = new URL("../fixtures/real-nyc/", import.meta.url);
try {
  const raw = await readFile(new URL("original.geojson", directory));
  const original = JSON.parse(raw.toString("utf8"));
  if (original.type !== "FeatureCollection" || original.features.length !== 1)
    throw new Error("Expected exactly one NYC building feature.");
  const feature = original.features[0],
    properties = feature.properties;
  if (properties.doitt_id !== "353927" || properties.feature_code !== "2100")
    throw new Error(
      "This adapter is limited to the documented NYC building 353927.",
    );
  if (
    feature.geometry.type !== "MultiPolygon" ||
    feature.geometry.coordinates.length !== 1 ||
    feature.geometry.coordinates[0].length !== 1
  )
    throw new Error(
      "Only one polygon without holes is supported; no geometry was dropped.",
    );
  const heightFeet = Number(properties.height_roof);
  if (!Number.isFinite(heightFeet) || heightFeet <= 0)
    throw new Error(
      "The original lacks a usable roof height; no height will be invented.",
    );
  const converted = (
    await query(
      `WITH projected AS (
    SELECT ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON($1),4326),2263) AS shape
  ) SELECT ST_AsGeoJSON(ST_Scale(ST_Translate(shape,-ST_XMin(shape),-ST_YMin(shape)),1200.0/3937,1200.0/3937)) AS geometry,
    ST_XMin(shape) AS origin_x,ST_YMin(shape) AS origin_y,
    ST_Area(shape)*power(1200.0/3937,2) AS area_m2,PostGIS_Full_Version() AS engine FROM projected`,
      [JSON.stringify(feature.geometry)],
    )
  ).rows[0];
  const footprint = JSON.parse(converted.geometry).coordinates[0][0].slice(
    0,
    -1,
  );
  const frame = {
    id: "NYC-DOITT-353927-LOCAL-M",
    horizontalUnit: "m",
    verticalUnit: "m",
    benchmark: "NYC-353927-RELATIVE-GROUND",
  };
  const spatial = {
    profile: "parcel-local-json-v1",
    frame,
    features: [
      {
        alias: "NYC-B353927",
        name: "NYC OTI building 353927 (public footprint)",
        kind: "building",
        footprint,
      },
      {
        alias: "NYC-ENV353927",
        name: "Exterior envelope only; interior floors unknown",
        kind: "unit",
        footprint,
      },
    ],
  };
  const heightMetres = Number((heightFeet * 0.3048).toFixed(6));
  const csv = `alias,lower,upper,unit,benchmark,method\nNYC-ENV353927,0,${heightMetres},m,${frame.benchmark},NYC OTI DOITT 353927 height_roof ${heightFeet} ft converted to metres; zero at building base; constant-envelope approximation\n`;
  const provenance = {
    classification:
      "public real-world building footprint and reported roof-height attributes; derived constant-height envelope",
    provider: "City of New York Office of Technology and Innovation (OTI)",
    dataset: "https://data.cityofnewyork.us/City-Government/BUILDING/5zhs-2jue",
    originalDownload:
      "https://data.cityofnewyork.us/resource/5zhs-2jue.geojson?doitt_id=353927",
    metadata:
      "https://github.com/CityOfNewYork/nyc-geo-metadata/blob/main/Metadata/Metadata_BuildingFootprints.md",
    terms: "https://opendata.cityofnewyork.us/overview/#termsofuse",
    retrievedOn: "2026-09-13",
    originalFile: "original.geojson",
    originalSha256: createHash("sha256").update(raw).digest("hex"),
    sourceKey: {
      doitt_id: properties.doitt_id,
      bin: properties.bin,
      sourceLastEdited: properties.last_edited_date,
      geometrySource: properties.geom_source,
    },
    conversion: {
      inputCRS: "EPSG:4326 (GeoJSON longitude/latitude)",
      projectedCRS: "EPSG:2263 (US survey feet)",
      originProjected: [converted.origin_x, converted.origin_y],
      xyMetresPerSurveyFoot: 1200 / 3937,
      roofHeightFeet: heightFeet,
      roofMetresPerFoot: 0.3048,
      roofHeightMetres: heightMetres,
      verticalReference:
        "Zero normalized to this building's ground; no absolute datum transform performed",
      engine: converted.engine,
    },
    checks: {
      projectedFootprintAreaM2: converted.area_m2,
      expectedEnvelopeVolumeM3: converted.area_m2 * heightMetres,
      interiorFloorsInSource: false,
    },
    limitations: [
      "No interior room, floor, ownership or parcel boundary is supplied by this building footprint.",
      "The prism is an approximation, not a measured watertight building solid or legal unit.",
      "Published roof-height units are treated as feet; original values and conversion factor are retained for review.",
      "Source SHAPE_AREA and SHAPE_LENGTH are not used; projected geometry determines quantities.",
      "A new workspace gets its own prototype ID; NYC BIN/DOITT identifiers are preserved as source references, never replaced by an official ULPIN.",
    ],
  };
  await writeFile(
    new URL("spatial.json", directory),
    JSON.stringify(spatial, null, 2) + "\n",
  );
  await writeFile(new URL("levels-r1.csv", directory), csv);
  await writeFile(
    new URL("provenance.json", directory),
    JSON.stringify(provenance, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      doittId: properties.doitt_id,
      vertices: footprint.length,
      heightMetres,
      areaM2: converted.area_m2,
      expectedVolumeM3: provenance.checks.expectedEnvelopeVolumeM3,
    }),
  );
} finally {
  await pool().end();
}
