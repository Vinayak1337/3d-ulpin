import { areaSceneAssets } from "./scene-assets";
import { usesGeographicNeighbours } from "./neighbour-scenario-policy";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type {
  ParcelIdentifier,
  MapArea,
  AreaContext,
  AreaReference,
  AreaHeight,
  PhysicalFeature,
  NormalizedFeature,
  ImportPackage,
  AreaCheck,
  AreaFinding,
  AdministrativeUnit,
  FactCandidate,
} from "@ulpin/contracts";
import { query, transaction } from "./db";
import { settings } from "./config";
import { AppError, conflict, notFound } from "./errors";
import { putOriginal, readObject, sha256 } from "./storage";
import { propertyIdentifier } from "../identifiers";
import { originalAttempt } from "./original-attempt";
import { checkAssociations, enrichFindings } from "./officer";

export type Mapping = {
  idField?: string;
  nameField?: string;
  kind: PhysicalFeature["kind"];
  heightField?: string;
  heightUnit?: "m" | "ft";
  heightMeaning?: string;
  identifierFields?: string[];
  geometryRole?: import("@ulpin/contracts").GeometryRole;
  geometryRoleField?: string;
  roleValues?: Record<string, string>;
  levelReference?: string;
  floorCountField?: string;
  approvalStatusField?: string;
  sourceDateField?: string;
  validFromField?: string;
  validToField?: string;
  horizontalUncertaintyField?: string;
  horizontalUncertaintyUnit?: "m" | "ft";
  worldStatusField?: string;
  worldStatusValues?: Record<string, string>;
  verticalExtent?: {
    lowerField: string;
    upperField: string;
    unit: "m" | "ft";
    reference: string;
  };
  utility?: Record<string, unknown>;
  utilityProfile?: Record<string, unknown>;
};
type Normalized = {
  reference: AreaReference;
  extent: NonNullable<MapArea["extent"]>;
  geographicExtent: NonNullable<MapArea["extent"]>;
  features: NormalizedFeature[];
  warnings: string[];
};
export async function areaGeo<T>(
  operation: "normalize" | "check" | "extract" | "crop" | "profile",
  input: unknown,
): Promise<T> {
  const response = await fetch(
    `${settings.geoUrl}/internal/area/${operation}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.geoToken}`,
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(60000),
    },
  );
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new AppError(
      response.status === 422 ? 422 : 503,
      "AREA_PROCESSING",
      typeof error.detail === "string"
        ? error.detail
        : "The area processor could not complete this operation.",
    );
  }
  return response.json();
}
function areaFrom(row: any): MapArea {
  return {
    id: row.id,
    siteId: row.site_id,
    name: row.name,
    revision: row.revision,
    reference: row.reference,
    extent: row.extent,
    geographicExtent: row.geographic_extent,
    administrativeUnits: row.administrative_units || [],
    dataKind: row.data_kind || "empty",
    featureCount: Number(row.feature_count || 0),
  };
}
export async function listAreas(includeArchived = false): Promise<MapArea[]> {
  // Include legacy sites added after the additive migration, without georeferencing them.
  await query(
    "INSERT INTO map_areas(id,site_id,name) SELECT id,id,name FROM registry_sites ON CONFLICT(site_id) DO NOTHING",
  );
  return (
    await query(
      `SELECT a.*, (SELECT count(*) FROM physical_features f WHERE f.revision>0 AND (f.area_id=a.id OR EXISTS (SELECT 1 FROM block_group_memberships gm JOIN block_groups gg ON gg.id=gm.group_id WHERE gm.feature_id=f.id AND gg.area_id=a.id))) feature_count,
        (SELECT CASE WHEN count(*)=0 THEN 'empty' WHEN bool_and(f.body->>'worldStatus'='synthetic') THEN 'demonstration' WHEN bool_and(f.body->>'worldStatus'='observed') THEN 'real' ELSE 'mixed' END FROM physical_features f WHERE f.revision>0 AND (f.area_id=a.id OR EXISTS (SELECT 1 FROM block_group_memberships gm JOIN block_groups gg ON gg.id=gm.group_id WHERE gm.feature_id=f.id AND gg.area_id=a.id))) data_kind,
        COALESCE((SELECT jsonb_agg(jsonb_strip_nulls(to_jsonb(u))) FROM administrative_units u JOIN area_memberships m ON m.unit_id=u.id WHERE m.area_id=a.id),'[]') administrative_units FROM map_areas a WHERE ($1::boolean OR a.archived_at IS NULL) ORDER BY (a.reference IS NOT NULL) DESC,a.created_at DESC`,
      [includeArchived],
    )
  ).rows.map(areaFrom);
}
export async function getArea(id: string): Promise<MapArea> {
  const area = (await listAreas(true)).find((a) => a.id === id);
  return area || notFound("Map area not found.");
}
async function projectedFeatures(
  rows: {
    body: PhysicalFeature;
    area_id: string;
    local_geometry: string | null;
  }[],
  area: MapArea,
): Promise<PhysicalFeature[]> {
  const features = rows.map((row) => {
    if (row.area_id === area.id) return row.body;
    if (!area.reference || !row.local_geometry)
      throw new AppError(
        422,
        "MEMBERSHIP_FRAME",
        "This block needs a valid analytical frame before another area's feature can be displayed.",
      );
    return {
      ...row.body,
      geometry: JSON.parse(row.local_geometry),
    } as PhysicalFeature;
  });
  const utilities = features.filter(
    (feature) =>
      feature.areaId !== area.id &&
      feature.kind === "utility" &&
      feature.utilityProfile,
  );
  if (utilities.length) {
    const resolved = await areaGeo<{
      profiles: {
        id: string;
        utilityProfile: PhysicalFeature["utilityProfile"];
      }[];
    }>("profile", { features: utilities });
    const profiles = new Map(
      resolved.profiles.map((item) => [item.id, item.utilityProfile]),
    );
    for (const feature of utilities) {
      if (!profiles.has(feature.id))
        throw new AppError(
          503,
          "MEMBERSHIP_PROFILE",
          "The processor did not return a profile for every shared utility.",
        );
      feature.utilityProfile = profiles.get(feature.id);
    }
  }
  return features;
}
async function loadAreaFeatures(
  area: MapArea,
  client?: PoolClient,
): Promise<PhysicalFeature[]> {
  const sql = `SELECT f.body,f.area_id,CASE WHEN f.area_id<>$1 AND $2::integer IS NOT NULL THEN ST_AsGeoJSON(ST_Translate(ST_Transform(f.geographic_geometry,$2::integer),-($3::double precision),-($4::double precision)),9,0) END local_geometry
    FROM physical_features f WHERE f.revision>0 AND (f.area_id=$1 OR EXISTS (
      SELECT 1 FROM block_group_memberships m JOIN block_groups g ON g.id=m.group_id WHERE m.feature_id=f.id AND g.area_id=$1
    )) ORDER BY f.identifier LIMIT 2001`;
  const values = [
    area.id,
    area.reference ? Number(area.reference.analysisCrs.split(":")[1]) : null,
    ...(area.reference?.origin ?? [null, null]),
  ];
  const rows = (await (client ? client.query(sql, values) : query(sql, values)))
    .rows;
  if (rows.length > 2000)
    throw new AppError(
      422,
      "AREA_LIMIT",
      "This block and its explicit group members exceed 2,000 features. Choose a smaller bounded group.",
    );
  return projectedFeatures(rows, area);
}
export async function areaContext(id: string): Promise<AreaContext> {
  const area = await getArea(id);
  const [features, packages, checks] = await Promise.all([
    loadAreaFeatures(area),
    query(
      "SELECT body FROM import_packages WHERE area_id=$1 ORDER BY created_at DESC LIMIT 30",
      [id],
    ),
    query(
      "SELECT body FROM area_check_runs WHERE area_id=$1 ORDER BY created_at DESC LIMIT 1",
      [id],
    ),
  ]);
  const currentFeatures = features;
  const latestCheck = checks.rows[0]?.body as AreaCheck | undefined;
  if (latestCheck) {
    const effective = await withNeighbours(currentFeatures, area);
    latestCheck.stale =
      latestCheck.areaRevision !== area.revision ||
      latestCheck.inputFingerprint !==
        sha256(
          JSON.stringify({
            features: effective,
            associations: await checkAssociations(effective.map((f) => f.id)),
            reference: area.reference,
            validator: "area-check-officer-v1",
          }),
        );
  }
  return {
    area,
    features: currentFeatures,
    parcelAssociations: (
      await query(
        `SELECT a.body FROM property_associations a JOIN physical_features f ON f.id=a.from_id JOIN physical_features p ON p.id=a.to_id WHERE a.relationship='occupies_parcel' AND a.status='confirmed' AND (a.body->>'fromRevision')::int=f.revision AND (a.body->>'toRevision')::int=p.revision AND p.id=ANY($1::uuid[])`,
        [currentFeatures.filter((f) => f.kind === "parcel").map((f) => f.id)],
      )
    ).rows.map((r) => r.body),
    parcelIdentifiers: (
      await query<ParcelIdentifier>(
        `SELECT e.feature_id "parcelId",e.scheme,e.normalized_value value,e.issuer,e.evidence FROM external_identifiers e WHERE e.feature_id=ANY($1::uuid[]) AND e.valid_to IS NULL AND e.verification_state='validated' AND e.scheme IN ('official_ulpin','demo_ulpin') ORDER BY e.feature_id,e.scheme,e.normalized_value`,
        [currentFeatures.filter((f) => f.kind === "parcel").map((f) => f.id)],
      )
    ).rows,
    sceneAssets: await areaSceneAssets(id),
    packages: packages.rows.map((r) => r.body),
    latestCheck: latestCheck || null,
  };
}
export async function getPackage(id: string): Promise<ImportPackage> {
  return (
    (await query("SELECT body FROM import_packages WHERE id=$1", [id])).rows[0]
      ?.body || notFound("Import package not found.")
  );
}
async function savePackage(client: PoolClient, pkg: ImportPackage) {
  await client.query(
    "UPDATE import_packages SET revision=$2,state=$3,body=$4 WHERE id=$1",
    [pkg.id, pkg.revision, pkg.state, pkg],
  );
  await client.query(
    "INSERT INTO import_package_revisions(package_id,revision,body) VALUES($1,$2,$3)",
    [pkg.id, pkg.revision, pkg],
  );
}
async function lockedPackage(
  client: PoolClient,
  id: string,
  expectedRevision: number,
): Promise<ImportPackage> {
  const pkg = (
    await client.query(
      "SELECT body FROM import_packages WHERE id=$1 FOR UPDATE",
      [id],
    )
  ).rows[0]?.body as ImportPackage | undefined;
  if (!pkg) notFound("Import package not found.");
  if (pkg.revision !== expectedRevision)
    conflict("Package changed. Refresh before editing or reviewing.");
  if (pkg.state === "COMMITTED")
    conflict(
      "This package is recorded. Import a revised source to propose a correction.",
    );
  return pkg;
}
function mergeExtent(
  a: MapArea["extent"],
  b: NonNullable<MapArea["extent"]>,
): NonNullable<MapArea["extent"]> {
  return a
    ? [
        Math.min(a[0], b[0]),
        Math.min(a[1], b[1]),
        Math.max(a[2], b[2]),
        Math.max(a[3], b[3]),
      ]
    : b;
}
export async function ingestArea(input: {
  bytes: Uint8Array;
  filename: string;
  format: "geojson" | "arcgis" | "gpkg" | "shapefile_zip";
  layer?: string;
  namespace: string;
  name: string;
  mapping: Mapping;
  areaId?: string;
  sourceCrs?: string;
  expectedAreaRevision?: number;
  worldStatus?: PhysicalFeature["worldStatus"];
  administrativeUnits?: Omit<AdministrativeUnit, "id">[];
  acquisitionId?: string;
}): Promise<ImportPackage> {
  if (input.bytes.length > 16 * 1024 * 1024 || !input.bytes.length)
    throw new AppError(
      413,
      "FILE_SIZE",
      "Choose a nonempty file up to 16 MiB.",
    );
  let data: unknown;
  try {
    data = ["gpkg", "shapefile_zip"].includes(input.format)
      ? undefined
      : JSON.parse(new TextDecoder().decode(input.bytes));
  } catch {
    throw new AppError(422, "INVALID_JSON", "Choose valid native GIS JSON.");
  }
  const seedKey = `${input.namespace}:${input.name}`;
  const existingArea = input.areaId
    ? await getArea(input.areaId)
    : (await query("SELECT * FROM map_areas WHERE seed_key=$1", [seedKey]))
        .rows[0];
  const area = existingArea
    ? "siteId" in existingArea
      ? (existingArea as MapArea)
      : areaFrom(existingArea)
    : undefined;
  const digest = sha256(input.bytes);
  const operationKey = sha256(
    JSON.stringify({
      destination: area?.id || seedKey,
      namespace: input.namespace,
      format: input.format,
      layer: input.layer ?? null,
      digest,
      mapping: input.mapping,
      worldStatus: input.worldStatus || "observed",
      sourceCrs: input.sourceCrs,
      normalization: "canonical-area-officer-v1",
      reference: area?.reference
        ? {
            analysisCrs: area.reference.analysisCrs,
            origin: area.reference.origin,
          }
        : null,
    }),
  );
  // A source revision retry remains idempotent after recording and after area changes.
  const retry = (
    await query(
      "SELECT body FROM import_packages WHERE body->>'sourceHash'=$1 AND body->>'importSignature'=$2 ORDER BY created_at LIMIT 1",
      [
        digest,
        sha256(
          JSON.stringify({
            namespace: input.namespace,
            format: input.format,
            layer: input.layer ?? null,
            normalization: "canonical-area-officer-v1",
            name: input.name,
            areaId: area?.id || null,
            mapping: input.mapping,
            worldStatus: input.worldStatus || "observed",
            sourceCrs: input.sourceCrs,
          }),
        ),
      ],
    )
  ).rows[0];
  if (retry) return retry.body;
  if (
    area &&
    input.expectedAreaRevision !== undefined &&
    area.revision !== input.expectedAreaRevision
  )
    conflict("Area changed; refresh before importing.");
  const normalized = await areaGeo<Normalized>("normalize", {
    format: input.format,
    data,
    ...(["gpkg", "shapefile_zip"].includes(input.format)
      ? {
          base64: Buffer.from(input.bytes).toString("base64"),
          layer: input.layer,
        }
      : {}),
    mapping: input.mapping,
    worldStatus: input.worldStatus || "observed",
    ...(area?.reference
      ? {
          reference: {
            analysisCrs: area.reference.analysisCrs,
            origin: area.reference.origin,
            ...(input.sourceCrs ? { sourceCrs: input.sourceCrs } : {}),
          },
        }
      : input.sourceCrs
        ? { reference: { sourceCrs: input.sourceCrs } }
        : {}),
  });
  const sourceId = randomUUID(),
    objectKey = `areas/${sourceId}/${digest}`;
  const utilityCandidates = normalized.features.filter(
    (f) => f.kind === "utility" && f.utilityProfile,
  );
  if (utilityCandidates.length) {
    for (const candidate of utilityCandidates)
      candidate.utilityProfile = {
        ...candidate.utilityProfile,
        evidence: [
          { sourceRevisionId: sourceId, featureId: candidate.sourceKey },
        ],
        ...(input.mapping.utility?.groundStartField ||
        input.mapping.utility?.groundEndField
          ? {
              groundEvidence: [
                { sourceRevisionId: sourceId, featureId: candidate.sourceKey },
              ],
            }
          : {}),
      };
    const resolved = await areaGeo<{
      profiles: {
        sourceKey: string;
        utilityProfile: Record<string, unknown>;
      }[];
    }>("profile", { features: utilityCandidates });
    for (const candidate of utilityCandidates)
      candidate.utilityProfile = resolved.profiles.find(
        (p) => p.sourceKey === candidate.sourceKey,
      )!.utilityProfile;
  }
  return originalAttempt("sources", sourceId, async (remember) => {
    remember(objectKey);
    await putOriginal(
      objectKey,
      input.bytes,
      input.format === "geojson"
        ? "application/geo+json"
        : input.format === "gpkg"
          ? "application/geopackage+sqlite3"
          : input.format === "shapefile_zip"
            ? "application/zip"
            : "application/json",
    );
    return transaction(async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [seedKey],
      );
      const prior = (
        await client.query(
          "SELECT body FROM import_packages WHERE operation_key=$1",
          [operationKey],
        )
      ).rows[0];
      if (prior) return prior.body;
      let areaRow = area
        ? (
            await client.query(
              "SELECT * FROM map_areas WHERE id=$1 FOR UPDATE",
              [area.id],
            )
          ).rows[0]
        : (
            await client.query(
              "SELECT * FROM map_areas WHERE seed_key=$1 FOR UPDATE",
              [seedKey],
            )
          ).rows[0];
      if (
        areaRow &&
        input.expectedAreaRevision !== undefined &&
        areaRow.revision !== input.expectedAreaRevision
      )
        conflict(
          "Area changed during normalization. Refresh before importing.",
        );
      if (!areaRow) {
        const id = randomUUID();
        const frame = {
          id: `AREA-${id}`,
          horizontalUnit: "m",
          verticalUnit: "m",
          benchmark: normalized.reference.verticalReference,
        };
        await client.query(
          "INSERT INTO registry_sites(id,identifier,name,frame,synthetic) VALUES($1,$2,$3,$4,$5)",
          [
            id,
            propertyIdentifier(id),
            input.name,
            frame,
            input.worldStatus === "synthetic" ||
              input.worldStatus === "hypothetical",
          ],
        );
        areaRow = (
          await client.query(
            "INSERT INTO map_areas(id,site_id,name,reference,seed_key) VALUES($1,$1,$2,$3,$4) RETURNING *",
            [id, input.name, normalized.reference, seedKey],
          )
        ).rows[0];
        for (const u of input.administrativeUnits || []) {
          const unitId = randomUUID();
          await client.query(
            "INSERT INTO administrative_units(id,kind,name,code,authority,source) VALUES($1,$2,$3,$4,$5,$6)",
            [unitId, u.kind, u.name, u.code, u.authority, u.source],
          );
          await client.query(
            "INSERT INTO area_memberships(area_id,unit_id) VALUES($1,$2)",
            [id, unitId],
          );
        }
      }
      if (
        areaRow.reference &&
        JSON.stringify([
          areaRow.reference.analysisCrs,
          areaRow.reference.origin,
        ]) !==
          JSON.stringify([
            normalized.reference.analysisCrs,
            normalized.reference.origin,
          ])
      )
        conflict(
          "Area reference changed. Retry using its retained coordinate frame.",
        );
      if (!areaRow.reference && areaRow.revision === 0) {
        const legacy = (
          await client.query(
            "SELECT count(*)::int n FROM registry_records WHERE site_id=$1 AND revision>0",
            [areaRow.site_id],
          )
        ).rows[0].n;
        if (legacy)
          throw new AppError(
            422,
            "PLACEMENT_REQUIRED",
            "Local registry geometry needs an evidenced placement before geographic data can be added.",
          );
        await client.query("UPDATE map_areas SET reference=$2 WHERE id=$1", [
          areaRow.id,
          normalized.reference,
        ]);
      }
      const caseId = randomUUID(),
        packageId = randomUUID();
      const site = (
        await client.query(
          "SELECT * FROM registry_sites WHERE id=$1 FOR UPDATE",
          [areaRow.site_id],
        )
      ).rows[0];
      await client.query(
        "INSERT INTO cases(id,name,description,frame,site_id,archived) VALUES($1,$2,$3,$4,$5,true)",
        [
          caseId,
          input.name,
          "Canonical v2 physical observations; no rights assertion.",
          site.frame,
          site.id,
        ],
      );
      await client.query(
        "INSERT INTO sources(id,case_id,family_id,revision,name,profile,mime_type,bytes,sha256,object_key,status,inspection) VALUES($1,$2,$1,1,$3,$4,$5,$6,$7,$8,'inspected',$9)",
        [
          sourceId,
          caseId,
          input.filename,
          `${input.format}-area-v2`,
          input.format === "geojson"
            ? "application/geo+json"
            : input.format === "gpkg"
              ? "application/geopackage+sqlite3"
              : input.format === "shapefile_zip"
                ? "application/zip"
                : "application/json",
          input.bytes.length,
          digest,
          objectKey,
          {
            status: "interpreted",
            reference: normalized.reference,
            featureCount: normalized.features.length,
            acquisitionId: input.acquisitionId,
            warnings: normalized.warnings,
          },
        ],
      );
      const features: PhysicalFeature[] = [];
      for (const candidate of normalized.features) {
        const linked = (
          await client.query(
            "SELECT f.* FROM source_feature_links l JOIN physical_features f ON f.id=l.feature_id WHERE l.namespace=$1 AND l.source_key=$2",
            [input.namespace, candidate.sourceKey],
          )
        ).rows[0];
        if (linked && linked.body.kind !== candidate.kind)
          throw new AppError(
            422,
            "FEATURE_KIND_CHANGED",
            "A stable source feature cannot change representation kind. Resolve its source association explicitly.",
          );
        if (
          linked &&
          ["synthetic", "hypothetical"].includes(linked.body.worldStatus) &&
          !["synthetic", "hypothetical"].includes(candidate.worldStatus)
        )
          throw new AppError(
            422,
            "WORLD_STATUS_PROMOTION",
            "A synthetic or hypothetical source identity cannot become a real observation through a classification change. Import separately evidenced real data under its actual source identity.",
          );
        if (linked && linked.area_id !== areaRow.id)
          throw new AppError(
            422,
            "FEATURE_ALREADY_MAPPED",
            "This source feature belongs to an existing area. Open that area to update it.",
          );
        let id = linked?.id || randomUUID(),
          identifier = linked?.identifier as string | undefined;
        let recordId: string | null = linked?.record_id || null;
        if (
          !identifier &&
          (candidate.kind === "building" || candidate.kind === "parcel")
        ) {
          const ordinal = Number(
            (
              await client.query(
                "SELECT COALESCE(MAX(ordinal),0)+1 n FROM registry_records WHERE site_id=$1 AND kind=$2",
                [site.id, candidate.kind],
              )
            ).rows[0].n,
          );
          identifier = `${site.identifier}:${candidate.kind === "building" ? "B" : "P"}${String(ordinal).padStart(3, "0")}`;
          recordId = id;
          // Reserve the existing permanent identity. Physical geometry stays in its full v2 representation;
          // revision zero deliberately keeps it out of the legacy rights publication path.
          await client.query(
            "INSERT INTO registry_records(id,site_id,kind,ordinal,identifier,body) VALUES($1,$2,$3,$4,$5,$6)",
            [
              id,
              site.id,
              candidate.kind,
              ordinal,
              identifier,
              {
                alias: candidate.sourceKey,
                name: candidate.name,
                kind: candidate.kind,
                footprint: [],
                links: [],
                rights: [],
                evidence: [],
                synthetic: candidate.worldStatus === "synthetic",
                representation: "physical_exterior",
              },
            ],
          );
        }
        identifier ||= `OBS-${id}`;
        const feature: PhysicalFeature = {
          ...candidate,
          ...(candidate.verticalExtent
            ? {
                verticalExtent: {
                  ...candidate.verticalExtent,
                  evidence: [
                    {
                      sourceRevisionId: sourceId,
                      featureId: candidate.sourceKey,
                    },
                  ],
                },
              }
            : {}),
          ...(candidate.utilityProfile
            ? {
                utilityProfile: {
                  ...candidate.utilityProfile,
                  evidence: [
                    {
                      sourceRevisionId: sourceId,
                      featureId: candidate.sourceKey,
                    },
                  ],
                  ...(input.mapping.utility?.groundStartField ||
                  input.mapping.utility?.groundEndField
                    ? {
                        groundEvidence: [
                          {
                            sourceRevisionId: sourceId,
                            featureId: candidate.sourceKey,
                          },
                        ],
                      }
                    : {}),
                },
              }
            : {}),
          height: {
            ...candidate.height,
            evidence: [
              { sourceRevisionId: sourceId, featureId: candidate.sourceKey },
            ],
            method: "native_parse",
          },
          sourceReference: normalized.reference,
          id,
          identifier,
          areaId: areaRow.id,
          revision: linked?.revision || 0,
          sourceRevisionId: sourceId,
          datasetNamespace: input.namespace,
          evidence: [
            { sourceRevisionId: sourceId, featureId: candidate.sourceKey },
          ],
          representation:
            candidate.kind === "building"
              ? "physical_exterior"
              : "physical_context",
        };
        features.push(feature);
        if (!linked) {
          await client.query(
            "INSERT INTO physical_features(id,area_id,record_id,identifier,body) VALUES($1,$2,$3,$4,$5)",
            [id, areaRow.id, recordId, identifier, feature],
          );
          await client.query(
            "INSERT INTO source_feature_links(namespace,source_key,area_id,feature_id) VALUES($1,$2,$3,$4)",
            [input.namespace, candidate.sourceKey, areaRow.id, id],
          );
        }
      }
      const questions = features
        .filter((f) => f.kind === "building" && f.height.value === null)
        .map((f) => ({
          kind: "missing_height" as const,
          id: randomUUID(),
          entityId: f.id,
          property: "building.exteriorHeight",
          message: `${f.name}: no usable exterior height. Keep the footprint in 2D or enter a labeled display estimate.`,
          blocks:
            "Source-backed exterior volume checks; footprint recording can proceed.",
        }));
      const pkg: ImportPackage & {
        sourceHash: string;
        importSignature: string;
        extent: Normalized["extent"];
        geographicExtent: Normalized["geographicExtent"];
      } = {
        id: packageId,
        schemaVersion: "ulpin-canonical/2",
        areaId: areaRow.id,
        name: input.name,
        datasetNamespace: input.namespace,
        revision: 1,
        state: questions.length ? "NEEDS_INPUT" : "READY_FOR_REVIEW",
        sourceRevisionIds: [sourceId],
        features,
        questions,
        factCandidates: features
          .filter((f) => f.height.value !== null)
          .map((f) => ({
            id: randomUUID(),
            entityId: f.id,
            property: "building.exteriorHeight",
            value: f.height.value,
            unit: "m",
            referenceFrameId: f.height.reference,
            evidence: f.evidence,
            method: "native_parse",
            evidenceState: "source_supported",
            worldStatus: f.worldStatus,
          })),
        parts: [],
        warnings: normalized.warnings,
        createdAt: new Date().toISOString(),
        sourceHash: digest,
        importSignature: sha256(
          JSON.stringify({
            namespace: input.namespace,
            format: input.format,
            layer: input.layer ?? null,
            normalization: "canonical-area-officer-v1",
            name: input.name,
            areaId: areaRow.id,
            mapping: input.mapping,
            worldStatus: input.worldStatus || "observed",
            sourceCrs: input.sourceCrs,
          }),
        ),
        extent: normalized.extent,
        geographicExtent: normalized.geographicExtent,
      };
      await client.query(
        "INSERT INTO import_packages(id,area_id,case_id,revision,state,body,operation_key) VALUES($1,$2,$3,1,$4,$5,$6)",
        [packageId, areaRow.id, caseId, pkg.state, pkg, operationKey],
      );
      await client.query(
        "INSERT INTO import_package_revisions(package_id,revision,body) VALUES($1,1,$2)",
        [packageId, pkg],
      );
      return pkg;
    });
  });
}

export async function answerQuestion(
  id: string,
  expectedRevision: number,
  questionId: string,
  answer: NonNullable<ImportPackage["questions"][number]["answer"]>,
) {
  return transaction(async (client) => {
    const pkg = await lockedPackage(client, id, expectedRevision),
      q = pkg.questions.find((q) => q.id === questionId);
    if (!q) notFound("Question not found.");
    const feature = pkg.features.find((f) => f.id === q.entityId)!;
    if (
      q.property === "building.exteriorHeight" &&
      q.kind !== "conflicting_claims"
    ) {
      if (answer.choice === "estimate") {
        if (
          answer.value === undefined ||
          !Number.isFinite(answer.value) ||
          answer.value <= 0 ||
          answer.value > 1000
        )
          throw new AppError(
            422,
            "HEIGHT_RANGE",
            "An estimate must be greater than zero and at most 1,000 metres.",
          );
        feature.height = {
          ...feature.height,
          value: answer.value,
          state: "estimated",
          meaning: "operator display estimate",
          reference: "building-relative; not aligned between features",
          evidence: [],
          method: "human_entry",
          claimId: undefined,
        };
        pkg.factCandidates.push({
          id: randomUUID(),
          entityId: feature.id,
          property: "building.exteriorHeight",
          value: answer.value,
          unit: "m",
          referenceFrameId: feature.height.reference,
          evidence: [],
          method: "human_entry",
          evidenceState: "estimated",
          worldStatus: feature.worldStatus,
        });
      } else if (answer.choice === "keep_2d")
        feature.height = { ...feature.height, value: null, state: "unknown" };
      else
        throw new AppError(
          422,
          "ANSWER_TYPE",
          "Choose 2D or an explicit display estimate.",
        );
    } else {
      const claim = pkg.factCandidates.find(
        (c) =>
          c.id === answer.claimId &&
          c.entityId === q.entityId &&
          c.property === q.property,
      );
      if (answer.choice !== "select_claim" || !claim)
        throw new AppError(
          422,
          "CLAIM_REQUIRED",
          "Choose one of the retained source claims.",
        );
      if (claim.property === "building.exteriorHeight") {
        if (
          typeof claim.value !== "number" ||
          claim.value <= 0 ||
          claim.value > 1000 ||
          claim.unit !== "m" ||
          !claim.referenceFrameId
        )
          throw new AppError(
            422,
            "HEIGHT_REFERENCE",
            "Applying an exterior height requires metres, a positive value and an explicit building reference.",
          );
        feature.height = {
          state: "source_supported",
          value: claim.value,
          unit: "m",
          meaning:
            claim.method === "native_parse"
              ? "native source exterior height"
              : "operator-transcribed document exterior height",
          reference: claim.referenceFrameId,
          evidence: claim.evidence,
          claimId: claim.id,
          method:
            claim.method === "native_parse" ? "native_parse" : "human_entry",
        };
      }
    }
    q.answer = answer;
    delete pkg.review;
    pkg.revision++;
    pkg.state = pkg.questions.some((q) => !q.answer)
      ? "NEEDS_INPUT"
      : "READY_FOR_REVIEW";
    await savePackage(client, pkg);
    return pkg;
  });
}
async function withNeighbours(
  features: PhysicalFeature[],
  area: MapArea,
  client?: PoolClient,
): Promise<PhysicalFeature[]> {
  if (!area.reference || !features.length) return features;
  const positions: number[][] = [];
  function visit(value: unknown) {
    if (!Array.isArray(value)) return;
    if (
      value.length === 2 &&
      typeof value[0] === "number" &&
      typeof value[1] === "number"
    )
      positions.push(value);
    else value.forEach(visit);
  }
  features.forEach((f) => visit(f.geographicGeometry.coordinates));
  if (!positions.length) return features;
  const xs = positions.map((p) => p[0]),
    ys = positions.map((p) => p[1]);
  const extent = [
    Math.min(...xs),
    Math.min(...ys),
    Math.max(...xs),
    Math.max(...ys),
  ];
  // Only source-observed/planned data participates in automatic geographic
  // neighbourhoods. Synthetic copies must not contaminate reference checks.
  // Explicit parcel associations and block memberships intentionally bypass
  // the automatic-neighbour rule, preserving deliberate cross-block links.
  const sql = `SELECT body,area_id,ST_AsGeoJSON(ST_Translate(ST_Transform(geographic_geometry,$6::integer),-($7::double precision),-($8::double precision)),9,0) local_geometry FROM physical_features
    WHERE area_id<>$1 AND id<>ALL($9::uuid[]) AND revision>0 AND (($10::boolean AND body->>'worldStatus' IN ('observed','planned') AND ST_Intersects(geographic_geometry,ST_MakeEnvelope($2,$3,$4,$5,4326))) OR id IN (SELECT to_id FROM property_associations WHERE from_id=ANY($9::uuid[]) AND relationship='occupies_parcel' AND status='confirmed') OR id IN (SELECT m.feature_id FROM block_group_memberships m JOIN block_groups g ON g.id=m.group_id WHERE g.area_id=$1)) ORDER BY id LIMIT 2001`;
  const values = [
    area.id,
    ...extent,
    Number(area.reference.analysisCrs.split(":")[1]),
    ...area.reference.origin,
    features.map((f) => f.id),
    usesGeographicNeighbours(features),
  ];
  const rows = (await (client ? client.query(sql, values) : query(sql, values)))
    .rows;
  if (rows.length + features.length > 2000)
    throw new AppError(
      422,
      "AREA_LIMIT",
      "This area and its crossing neighbours exceed 2,000 features. Choose a smaller bounded area.",
    );
  return [...features, ...(await projectedFeatures(rows, area))].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
}
async function effectiveFeatures(pkg: ImportPackage, area: MapArea) {
  const current = (
    await query(
      "SELECT body FROM physical_features WHERE area_id=$1 AND revision>0 ORDER BY identifier",
      [pkg.areaId],
    )
  ).rows.map((r) => r.body as PhysicalFeature);
  const replaced = new Set(pkg.features.map((f) => f.id));
  return withNeighbours(
    [...current.filter((f) => !replaced.has(f.id)), ...pkg.features],
    area,
  );
}
export async function rebasePackage(id: string, expectedRevision: number) {
  return transaction(async (client) => {
    const pkg = await lockedPackage(client, id, expectedRevision);
    await client.query("SELECT id FROM map_areas WHERE id=$1 FOR UPDATE", [
      pkg.areaId,
    ]);
    for (const feature of pkg.features) {
      const row =
        (
          await client.query(
            "SELECT revision FROM physical_features WHERE id=$1",
            [feature.id],
          )
        ).rows[0] || notFound("A source feature identity is unavailable.");
      feature.revision = row.revision;
    }
    pkg.revision++;
    delete pkg.review;
    pkg.state = pkg.questions.some((q) => !q.answer)
      ? "NEEDS_INPUT"
      : "READY_FOR_REVIEW";
    pkg.warnings.push(
      "Operator refreshed the proposal baseline against current observations. Proposed source geometry is retained; a fresh review is required.",
    );
    await savePackage(client, pkg);
    return pkg;
  });
}
export async function createPackageCorrection(id: string, requestKey: string) {
  return transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      requestKey,
    ]);
    const retry = (
      await client.query(
        "SELECT body FROM import_packages WHERE operation_key=$1",
        [`correction:${id}:${requestKey}`],
      )
    ).rows[0];
    if (retry) return retry.body as ImportPackage;
    const row =
      (
        await client.query(
          "SELECT * FROM import_packages WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0] || notFound();
    const original = row.body as ImportPackage;
    if (original.state !== "COMMITTED")
      conflict(
        "Continue reviewing this package before creating a later correction.",
      );
    const next: ImportPackage = {
      ...original,
      id: randomUUID(),
      revision: 1,
      state: "READY_FOR_REVIEW",
      createdAt: new Date().toISOString(),
      name: `Correction · ${original.name}`,
    };
    delete next.review;
    delete next.acknowledgement;
    await client.query("SELECT id FROM map_areas WHERE id=$1 FOR UPDATE", [
      original.areaId,
    ]);
    next.features = [];
    for (const feature of original.features) {
      const current = (
        await client.query(
          "SELECT body FROM physical_features WHERE id=$1 AND revision>0",
          [feature.id],
        )
      ).rows[0];
      if (current) next.features.push(current.body);
    }
    next.sourceRevisionIds = [
      ...new Set([
        ...next.sourceRevisionIds,
        ...next.features.flatMap((f) => [
          f.sourceRevisionId,
          ...f.evidence.map((e) => e.sourceRevisionId),
          ...(f.height.evidence || []).map((e) => e.sourceRevisionId),
        ]),
      ]),
    ];
    next.factCandidates = [...next.factCandidates];
    for (const feature of next.features.filter(
      (f) => f.height.value !== null && f.height.state === "source_supported",
    )) {
      if (
        !next.factCandidates.some(
          (c) =>
            c.entityId === feature.id &&
            c.property === "building.exteriorHeight" &&
            c.value === feature.height.value &&
            c.evidence.some(
              (e) => e.sourceRevisionId === feature.sourceRevisionId,
            ),
        )
      )
        next.factCandidates.push({
          id: randomUUID(),
          entityId: feature.id,
          property: "building.exteriorHeight",
          value: feature.height.value,
          unit: "m",
          referenceFrameId: feature.height.reference,
          evidence: feature.evidence,
          method: "native_parse",
          evidenceState: "source_supported",
          worldStatus: feature.worldStatus,
        });
    }
    next.questions = next.questions
      .filter(
        (q) =>
          q.kind !== "missing_height" ||
          next.features.some(
            (f) => f.id === q.entityId && f.height.value === null,
          ),
      )
      .map((q) => ({ ...q, id: randomUUID(), answer: undefined }));
    next.state = next.questions.length ? "NEEDS_INPUT" : "READY_FOR_REVIEW";
    next.warnings = [
      ...next.warnings,
      "Correction proposal prepared from current observations. Recording requires a new review; existing geometry remains current until then.",
    ];
    await client.query(
      "INSERT INTO import_packages(id,area_id,case_id,revision,state,body,operation_key) VALUES($1,$2,$3,1,$4,$5,$6)",
      [
        next.id,
        next.areaId,
        row.case_id,
        next.state,
        next,
        `correction:${id}:${requestKey}`,
      ],
    );
    await client.query(
      "INSERT INTO import_package_revisions(package_id,revision,body) VALUES($1,1,$2)",
      [next.id, next],
    );
    return next;
  });
}
export async function reviewPackage(id: string, expectedRevision: number) {
  const pkg = await getPackage(id),
    area = await getArea(pkg.areaId);
  if (pkg.revision !== expectedRevision) conflict();
  const features = await effectiveFeatures(pkg, area);
  const associations = await checkAssociations(features.map((f) => f.id));
  const result = await areaGeo<{ findings: AreaFinding[]; coverage: string[] }>(
    "check",
    { features, associations, reference: area.reference },
  );
  result.findings = await enrichFindings(result.findings, features, area.id);
  for (const question of pkg.questions.filter(
    (q) => q.kind === "conflicting_claims" && !q.answer,
  ))
    result.findings.push({
      id: question.id,
      category: "document",
      code: "UNRESOLVED_DOCUMENT_CLAIMS",
      message: question.message,
      featureIds: [question.entityId],
    });
  return transaction(async (client) => {
    const current = await lockedPackage(client, id, expectedRevision);
    const areaRow = (
      await client.query("SELECT * FROM map_areas WHERE id=$1 FOR UPDATE", [
        pkg.areaId,
      ])
    ).rows[0];
    if (areaRow.revision !== area.revision)
      conflict("Area changed during review; run a fresh check.");
    // Height questions only block 3D conclusions. The operator may review footprint observations independently.
    current.revision++;
    current.state = "REVIEWED";
    current.review = {
      areaRevision: area.revision,
      packageRevision: current.revision,
      inputFingerprint: sha256(
        JSON.stringify({
          features,
          associations,
          reference: area.reference,
          areaRevision: area.revision,
          packageRevision: current.revision,
          validator: "area-check-officer-v1",
        }),
      ),
      findings: result.findings,
      coverage: result.coverage,
    };
    await savePackage(client, current);
    return current;
  });
}
export async function commitPackage(
  id: string,
  expectedRevision: number,
  acknowledgement: string,
) {
  return transaction(async (client) => {
    // Single-operator acceptance is serialized across areas so a cross-area neighbour cannot change after fingerprint validation.
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('physical-area-recording',0))",
    );
    // Same local lock order as review/edit: package, then area. Retry after a successful commit returns its result.
    const raw = (
      await client.query(
        "SELECT body FROM import_packages WHERE id=$1 FOR UPDATE",
        [id],
      )
    ).rows[0];
    if (!raw) notFound();
    const pkg = raw.body as ImportPackage & {
      extent: Normalized["extent"];
      geographicExtent: Normalized["extent"];
    };
    if (pkg.state === "COMMITTED") return pkg;
    if (
      pkg.revision !== expectedRevision ||
      !pkg.review ||
      pkg.review.packageRevision !== pkg.revision
    )
      conflict("Review the current package before recording.");
    const areaRow = (
      await client.query("SELECT * FROM map_areas WHERE id=$1 FOR UPDATE", [
        pkg.areaId,
      ])
    ).rows[0];
    if (areaRow.revision !== pkg.review.areaRevision)
      conflict("Area neighbours changed; review the proposed update again.");
    if (!acknowledgement.trim())
      throw new AppError(
        422,
        "ACKNOWLEDGEMENT_REQUIRED",
        "Acknowledge that these are physical observations and describe unresolved findings.",
      );
    const current = (
        await client.query(
          "SELECT body FROM physical_features WHERE area_id=$1 AND revision>0 ORDER BY identifier",
          [pkg.areaId],
        )
      ).rows.map((r) => r.body as PhysicalFeature),
      replaced = new Set(pkg.features.map((f) => f.id));
    const effective = await withNeighbours(
      [...current.filter((f) => !replaced.has(f.id)), ...pkg.features],
      areaFrom(areaRow),
      client,
    );
    if (
      sha256(
        JSON.stringify({
          features: effective,
          associations: await checkAssociations(
            effective.map((f) => f.id),
            client,
          ),
          reference: areaRow.reference,
          areaRevision: areaRow.revision,
          packageRevision: pkg.revision,
          validator: "area-check-officer-v1",
        }),
      ) !== pkg.review.inputFingerprint
    )
      conflict("The review fingerprint no longer matches.");
    for (const feature of pkg.features) {
      const stored = (
        await client.query(
          "SELECT revision FROM physical_features WHERE id=$1 FOR UPDATE",
          [feature.id],
        )
      ).rows[0];
      if (stored.revision !== feature.revision)
        conflict(
          "One observation changed. Refresh the proposal baseline and review its correction.",
        );
      feature.revision++;
      await client.query(
        "UPDATE physical_features SET revision=$2,body=$3,geometry=ST_SetSRID(ST_GeomFromGeoJSON($4),0),geographic_geometry=ST_SetSRID(ST_GeomFromGeoJSON($5),4326) WHERE id=$1",
        [
          feature.id,
          feature.revision,
          feature,
          JSON.stringify(feature.geometry),
          JSON.stringify(feature.geographicGeometry),
        ],
      );
      await client.query(
        "INSERT INTO physical_feature_revisions(feature_id,revision,body,package_id,area_revision) VALUES($1,$2,$3,$4,$5)",
        [feature.id, feature.revision, feature, pkg.id, areaRow.revision + 1],
      );
      // New source revisions supersede assertions from this dataset while preserving their history.
      await client.query(
        "UPDATE external_identifiers SET valid_to=now() WHERE feature_id=$1 AND issuer=$2 AND valid_to IS NULL",
        [feature.id, feature.datasetNamespace],
      );
      await client.query(
        "INSERT INTO external_identifiers(id,scheme,normalized_value,issuer,feature_id,source_id,evidence,verification_state) VALUES($1,'source_feature_id',$2,$3,$4,$5,$6,'validated') ON CONFLICT DO NOTHING",
        [
          randomUUID(),
          feature.sourceKey.trim().toUpperCase(),
          feature.datasetNamespace,
          feature.id,
          feature.sourceRevisionId,
          JSON.stringify(feature.evidence),
        ],
      );
      const bin = feature.properties.bin;
      if (bin && feature.datasetNamespace === "nyc-building-footprints")
        await client.query(
          "INSERT INTO external_identifiers(id,scheme,normalized_value,issuer,feature_id,source_id,evidence,verification_state) VALUES($1,'nyc_bin',$2,$3,$4,$5,$6,'validated') ON CONFLICT DO NOTHING",
          [
            randomUUID(),
            String(bin).trim().toUpperCase(),
            feature.datasetNamespace,
            feature.id,
            feature.sourceRevisionId,
            JSON.stringify(feature.evidence),
          ],
        );
    }
    await client.query(
      "UPDATE map_areas SET revision=revision+1,extent=$2,geographic_extent=$3 WHERE id=$1",
      [
        pkg.areaId,
        JSON.stringify(mergeExtent(areaRow.extent, pkg.extent)),
        JSON.stringify(
          mergeExtent(areaRow.geographic_extent, pkg.geographicExtent),
        ),
      ],
    );
    pkg.revision++;
    pkg.state = "COMMITTED";
    pkg.acknowledgement = acknowledgement.trim();
    await savePackage(client, pkg);
    return pkg;
  });
}

export async function runAreaCheck(
  areaId: string,
  expectedRevision: number,
): Promise<AreaCheck> {
  const context = await areaContext(areaId);
  if (context.area.revision !== expectedRevision) conflict();
  const checkFeatures = await withNeighbours(context.features, context.area);
  const associations = await checkAssociations(checkFeatures.map((f) => f.id));
  const check: AreaCheck = {
    id: randomUUID(),
    areaId,
    areaRevision: expectedRevision,
    status: "running",
    findings: [],
    coverage: [],
    inputFingerprint: sha256(
      JSON.stringify({
        features: checkFeatures,
        associations,
        reference: context.area.reference,
        validator: "area-check-officer-v1",
      }),
    ),
    createdAt: new Date().toISOString(),
  };
  await query(
    "INSERT INTO area_check_runs(id,area_id,area_revision,status,input_fingerprint,body) VALUES($1,$2,$3,$4,$5,$6)",
    [
      check.id,
      areaId,
      expectedRevision,
      check.status,
      check.inputFingerprint,
      check,
    ],
  );
  try {
    const result = await areaGeo<{
      findings: AreaFinding[];
      coverage: string[];
    }>("check", {
      features: checkFeatures,
      associations,
      reference: context.area.reference,
    });
    result.findings = await enrichFindings(
      result.findings,
      checkFeatures,
      areaId,
    );
    Object.assign(check, {
      findings: result.findings,
      coverage: result.coverage,
      status: "completed",
    });
  } catch (error) {
    check.status = "failed";
    check.error =
      error instanceof AppError
        ? error.message
        : "Area check failed. Retry when the local processor is available.";
  }
  await query("UPDATE area_check_runs SET status=$2,body=$3 WHERE id=$1", [
    check.id,
    check.status,
    check,
  ]);
  const latestArea = await getArea(areaId),
    latestFeatures = (
      await query(
        "SELECT body FROM physical_features WHERE area_id=$1 AND revision>0 ORDER BY identifier",
        [areaId],
      )
    ).rows.map((r) => r.body as PhysicalFeature);
  check.stale =
    latestArea.revision !== expectedRevision ||
    check.inputFingerprint !==
      sha256(
        JSON.stringify({
          features: await withNeighbours(latestFeatures, latestArea),
          associations: await checkAssociations(
            (await withNeighbours(latestFeatures, latestArea)).map((f) => f.id),
          ),
          reference: latestArea.reference,
          validator: "area-check-officer-v1",
        }),
      );
  return check;
}

type CopySourceRow = {
  id: string;
  case_id: string;
  revision: number;
  name: string;
  profile: string;
  mime_type: string;
  bytes: number;
  sha256: string;
  object_key: string;
};
const copyFormats: Record<string, DocumentFile["format"]> = {
  "plan-pdf-v1": "pdf",
  "plan-png-v1": "png",
  "levels-csv-v1": "csv",
};
function sourceCopyFingerprint(rows: CopySourceRow[]) {
  return sha256(
    JSON.stringify(
      rows
        .map((row) => [
          row.id,
          row.case_id,
          row.revision,
          row.name,
          row.profile,
          row.mime_type,
          Number(row.bytes),
          row.sha256,
          row.object_key,
        ])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ),
  );
}
async function copiedOperation(
  client: PoolClient,
  targetCaseId: string,
  copy: CopyBatch,
) {
  const existing = (
    await client.query(
      "SELECT payload_hash FROM operations WHERE case_id=$1 AND operation_key=$2 AND kind='copy-case-documents'",
      [targetCaseId, copy.operationKey],
    )
  ).rows[0];
  if (existing && existing.payload_hash !== copy.payloadHash)
    throw new AppError(
      409,
      "COPY_ALREADY_RECORDED",
      "These selected originals were already copied with a different assignment request. Refresh the preparation.",
    );
  return !!existing;
}
async function copySources(
  client: PoolClient,
  packageId: string,
  copy: Pick<CopyBatch, "caseId" | "buildingId" | "sourceIds">,
): Promise<CopySourceRow[]> {
  const target = (
    await client.query(
      "SELECT case_id FROM building_preparations WHERE package_id=$1 AND building_id=$2",
      [packageId, copy.buildingId],
    )
  ).rows[0];
  if (!target)
    throw new AppError(
      422,
      "PREPARATION_BUILDING",
      "The destination must be this building's canonical preparation package.",
    );
  if (
    !(
      await client.query("SELECT id FROM cases WHERE id=$1 FOR SHARE", [
        copy.caseId,
      ])
    ).rows.length
  )
    notFound("The original case no longer exists.");
  const owners = (
    await client.query(
      `
    SELECT building_id FROM building_preparations WHERE case_id=$1
    UNION SELECT f.id AS building_id FROM registry_case_feature_mappings m JOIN physical_features f ON (f.id=m.record_id OR f.record_id=m.record_id) WHERE m.case_id=$1 AND f.body->>'kind'='building'
    UNION SELECT a.from_id AS building_id FROM registry_case_feature_mappings m JOIN property_associations a ON a.to_id=m.record_id WHERE m.case_id=$1 AND a.relationship IN ('detailed_record','shared_space') AND a.status <> 'rejected'`,
      [copy.caseId],
    )
  ).rows;
  if (owners.some((owner) => owner.building_id !== copy.buildingId))
    throw new AppError(
      422,
      "CASE_ALREADY_ASSIGNED",
      "This case belongs to another property. Documents cannot be reassigned through the unassigned-document flow.",
    );
  const rows = (
    await client.query<CopySourceRow>(
      "SELECT id,case_id,revision,name,profile,mime_type,bytes,sha256,object_key FROM sources WHERE case_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR SHARE",
      [copy.caseId, copy.sourceIds],
    )
  ).rows;
  if (rows.length !== copy.sourceIds.length)
    throw new AppError(
      422,
      "SOURCE_OWNERSHIP",
      "Every selected source revision must belong to the specified original case.",
    );
  let total = 0;
  for (const row of rows) {
    if (!Object.hasOwn(copyFormats, row.profile))
      throw new AppError(
        422,
        "COPY_PROFILE",
        "Only PDF plans, PNG plans and levels CSV sources can be assigned. Other source profiles require their own explicit import mapping.",
      );
    const limit =
      row.profile === "plan-png-v1" ? 16 * 1024 * 1024 : 10 * 1024 * 1024;
    if (Number(row.bytes) <= 0 || Number(row.bytes) > limit)
      throw new AppError(
        413,
        "COPY_SIZE",
        "Each PDF or CSV must be at most 10 MiB; each PNG at most 16 MiB.",
      );
    total += Number(row.bytes);
  }
  if (total > 64 * 1024 * 1024)
    throw new AppError(
      413,
      "COPY_SIZE",
      "Select at most 64 MiB of documents in one assignment.",
    );
  return rows;
}

export async function copyCaseDocuments(
  id: string,
  input: {
    expectedRevision: number;
    caseId: string;
    sourceIds: string[];
    buildingId: string;
    reason: string;
  },
): Promise<ImportPackage> {
  if (
    !input.sourceIds.length ||
    input.sourceIds.length > 20 ||
    new Set(input.sourceIds).size !== input.sourceIds.length
  )
    throw new AppError(
      422,
      "COPY_SELECTION",
      "Select between one and twenty distinct source revisions.",
    );
  const reason = input.reason.trim();
  if (!reason || reason.length > 2000)
    throw new AppError(
      422,
      "COPY_REASON",
      "Record an assignment reason of one to 2,000 characters.",
    );
  const sourceIds = [...input.sourceIds].sort();
  const copy: CopyBatch = {
    caseId: input.caseId,
    buildingId: input.buildingId,
    sourceIds,
    reason,
    operationKey: sha256(
      JSON.stringify([
        "copy-case-documents",
        id,
        input.caseId,
        input.buildingId,
        sourceIds,
      ]),
    ),
    payloadHash: sha256(JSON.stringify([input.expectedRevision, reason])),
    sourceFingerprint: "",
  };
  const { rows, replay } = await transaction(async (client) => {
    const rows = await copySources(client, id, copy);
    const pkg = (
      await client.query("SELECT case_id FROM import_packages WHERE id=$1", [
        id,
      ])
    ).rows[0];
    return { rows, replay: await copiedOperation(client, pkg.case_id, copy) };
  });
  copy.sourceFingerprint = sourceCopyFingerprint(rows);
  if (replay) return getPackage(id);
  const copiedAt = new Date().toISOString(),
    files: DocumentFile[] = [];
  for (const source of rows) {
    const bytes = await readObject(source.object_key);
    if (
      bytes.length !== Number(source.bytes) ||
      sha256(bytes) !== source.sha256
    )
      throw new AppError(
        422,
        "COPY_SOURCE_INTEGRITY",
        "The retained original does not match its recorded byte count and hash. Assignment was not saved.",
      );
    if (
      source.profile === "plan-png-v1" &&
      Buffer.from(bytes.subarray(0, 8)).toString("hex") !== "89504e470d0a1a0a"
    )
      throw new AppError(
        422,
        "COPY_FORMAT",
        "The selected PNG source does not contain a PNG file.",
      );
    files.push({
      bytes,
      name: source.name,
      format: copyFormats[source.profile],
      entityIds: [input.buildingId],
      copiedFrom: {
        caseId: input.caseId,
        sourceRevisionId: source.id,
        sourceHash: source.sha256,
        sourceRevision: source.revision,
        sourceProfile: source.profile,
        reason,
        copiedAt,
        actor: "local-demo-operator",
      },
    });
  }
  return attachDocumentBatch(id, input.expectedRevision, files, copy);
}

type DocumentFile = {
  bytes: Uint8Array;
  name: string;
  format: "pdf" | "docx" | "text" | "csv" | "png" | "jpeg";
  entityIds: string[];
  copiedFrom?: Omit<
    NonNullable<import("@ulpin/contracts").DocumentPart["copiedFrom"]>,
    "locator"
  >;
};
type CopyBatch = {
  caseId: string;
  buildingId: string;
  sourceIds: string[];
  reason: string;
  operationKey: string;
  payloadHash: string;
  sourceFingerprint: string;
};
const documentMime = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  text: "text/plain",
  csv: "text/csv",
  png: "image/png",
  jpeg: "image/jpeg",
};
async function extractDocument(file: DocumentFile) {
  return file.format === "png" || file.format === "jpeg"
    ? {
        parts: [
          {
            locator: { label: "image" },
            text: "Image reference: manual calibration and interpretation required.",
          },
        ],
        warnings: [
          "Image received as reference only; no dimensions or geometry have been extracted.",
        ],
      }
    : await areaGeo<{
        parts: {
          locator: { label: string; page?: number; row?: number };
          text: string;
        }[];
        warnings?: string[];
        status?: string;
        candidates?: {
          subject: string;
          property: string;
          value: unknown;
          unit?: string;
          referenceFrameId?: string;
          partIndex: number;
        }[];
      }>("extract", {
        format: file.format,
        base64: Buffer.from(file.bytes).toString("base64"),
      });
}

export async function attachDocument(
  id: string,
  expectedRevision: number,
  file: DocumentFile,
) {
  return attachDocumentBatch(id, expectedRevision, [file]);
}

async function attachDocumentBatch(
  id: string,
  expectedRevision: number,
  files: DocumentFile[],
  copy?: CopyBatch,
) {
  const pkg = await getPackage(id);
  if (pkg.revision !== expectedRevision || pkg.state === "COMMITTED") {
    if (
      copy &&
      (await transaction(async (client) => {
        const row = (
          await client.query(
            "SELECT case_id FROM import_packages WHERE id=$1",
            [id],
          )
        ).rows[0];
        return copiedOperation(client, row.case_id, copy);
      }))
    )
      return pkg;
    conflict();
  }
  for (const file of files) {
    if (!file.bytes.length || file.bytes.length > 16 * 1024 * 1024)
      throw new AppError(
        413,
        "FILE_SIZE",
        "Choose a nonempty document up to 16 MiB.",
      );
    if (
      file.entityIds.some(
        (entityId) => !pkg.features.some((f) => f.id === entityId),
      )
    )
      throw new AppError(
        422,
        "ASSOCIATION",
        "Choose buildings present in this package.",
      );
  }
  const prepared: {
    file: DocumentFile;
    sourceId: string;
    digest: string;
    key: string;
    extracted: Awaited<ReturnType<typeof extractDocument>>;
  }[] = [];
  for (const file of files) {
    const sourceId = randomUUID(),
      digest = sha256(file.bytes),
      key = `areas/${sourceId}/${digest}`;
    const extracted = await extractDocument(file);
    if (!extracted.parts.length && file.copiedFrom)
      extracted.parts.push({
        locator: { label: "original file" },
        text: "No native text was extracted. Read the retained original; geometry and dimensions require explicit evidence.",
      });
    prepared.push({ file, sourceId, digest, key, extracted });
  }
  // All allocated sources are committed together. The first row owns cleanup for the entire attempt.
  return originalAttempt("sources", prepared[0].sourceId, async (remember) => {
    for (const item of prepared) {
      remember(item.key);
      await putOriginal(
        item.key,
        item.file.bytes,
        documentMime[item.file.format],
      );
    }
    return transaction(async (client) => {
      const row = (
        await client.query(
          "SELECT case_id,body FROM import_packages WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (!row) notFound("Import package not found.");
      if (copy) {
        const replay = await copiedOperation(client, row.case_id, copy);
        if (replay) return row.body as ImportPackage;
      }
      const current = await lockedPackage(client, id, expectedRevision);
      if (copy) {
        const selected = await copySources(client, id, copy);
        if (sourceCopyFingerprint(selected) !== copy.sourceFingerprint)
          conflict(
            "A selected original or its property association changed. Refresh before assigning documents.",
          );
        if (
          current.parts.some(
            (part) =>
              part.copiedFrom?.caseId === copy.caseId &&
              copy.sourceIds.includes(part.copiedFrom.sourceRevisionId),
          )
        )
          throw new AppError(
            409,
            "DOCUMENT_ALREADY_COPIED",
            "A selected document is already in this property's preparation. Select only new documents.",
          );
      }
      for (const { file, sourceId, digest, key, extracted } of prepared) {
        await client.query(
          "INSERT INTO sources(id,case_id,family_id,revision,name,profile,mime_type,bytes,sha256,object_key,status,inspection) VALUES($1,$2,$1,1,$3,$4,$5,$6,$7,$8,'inspected',$9)",
          [
            sourceId,
            row.case_id,
            file.name,
            `${file.format}-reference-v2`,
            documentMime[file.format],
            file.bytes.length,
            digest,
            key,
            {
              status: "reference_only",
              partCount: extracted.parts.length,
              ...(file.copiedFrom
                ? {
                    copiedFrom: {
                      ...file.copiedFrom,
                      locator: "original file",
                    },
                  }
                : {}),
            },
          ],
        );
        current.sourceRevisionIds.push(sourceId);
        current.warnings.push(...(extracted.warnings || []));
        if (!extracted.parts.length)
          current.warnings.push(
            `${file.name}: no native text was extracted. Original retained; manual reading or calibration is required.`,
          );
        const partsStart = current.parts.length;
        current.parts.push(
          ...extracted.parts.map((part) => ({
            id: randomUUID(),
            sourceRevisionId: sourceId,
            locator: part.locator.label,
            text: part.text,
            entityIds: file.entityIds,
            ...(file.copiedFrom
              ? {
                  copiedFrom: {
                    ...file.copiedFrom,
                    locator: part.locator.label,
                  },
                }
              : {}),
          })),
        );
        for (const candidate of "candidates" in extracted
          ? (extracted.candidates ?? [])
          : []) {
          const part = current.parts[partsStart + candidate.partIndex];
          if (!part) continue;
          for (const entityId of file.entityIds) {
            const property =
              candidate.property === "space.footprint"
                ? "space.geometry"
                : candidate.property;
            const competing = current.factCandidates.filter(
              (c) =>
                c.entityId === entityId &&
                c.subject === candidate.subject &&
                c.property === property &&
                JSON.stringify([
                  c.value,
                  c.unit ?? null,
                  c.referenceFrameId ?? null,
                ]) !==
                  JSON.stringify([
                    candidate.value,
                    candidate.unit ?? null,
                    candidate.referenceFrameId ?? null,
                  ]),
            );
            if (competing.length) {
              current.selectedClaimIds = (
                current.selectedClaimIds ?? []
              ).filter((id) => !competing.some((c) => c.id === id));
              current.questions.push({
                id: randomUUID(),
                kind: "conflicting_claims",
                entityId,
                property,
                message: `Sources disagree about ${candidate.subject}: ${property.split(".").at(-1)}. Review the source alternatives.`,
                blocks: "dependent detailed geometry",
              });
            }
            current.factCandidates.push({
              id: randomUUID(),
              entityId,
              subject: candidate.subject,
              property:
                candidate.property === "space.footprint"
                  ? "space.geometry"
                  : candidate.property,
              value: candidate.value,
              unit: candidate.unit,
              referenceFrameId: candidate.referenceFrameId,
              evidence: [{ sourceRevisionId: sourceId, partId: part.id }],
              method: "native_parse",
              evidenceState: "source_supported",
              worldStatus: current.features.find((f) => f.id === entityId)!
                .worldStatus,
            });
          }
        }
      }
      current.revision++;
      delete current.review;
      current.state = current.questions.some((q) => !q.answer)
        ? "NEEDS_INPUT"
        : "READY_FOR_REVIEW";
      await savePackage(client, current);
      if (copy) {
        await client.query(
          "INSERT INTO operations(case_id,operation_key,kind,payload_hash,result) VALUES($1,$2,'copy-case-documents',$3,$4)",
          [
            row.case_id,
            copy.operationKey,
            copy.payloadHash,
            {
              packageId: id,
              revision: current.revision,
              sourceRevisionIds: prepared.map((p) => p.sourceId),
            },
          ],
        );
        await client.query(
          "INSERT INTO events(id,case_id,kind,message) VALUES($1,$2,'documents_assigned',$3)",
          [
            randomUUID(),
            row.case_id,
            `Explicitly copied ${files.length} document(s) from case ${copy.caseId} to building ${copy.buildingId}. ${copy.reason}`,
          ],
        );
      }
      return current;
    });
  });
}

export async function addFact(
  id: string,
  expectedRevision: number,
  claim: Omit<FactCandidate, "id" | "method" | "evidenceState" | "worldStatus">,
) {
  return transaction(async (client) => {
    const pkg = await lockedPackage(client, id, expectedRevision),
      feature = pkg.features.find((f) => f.id === claim.entityId);
    if (!feature) notFound("Choose an entity from this package.");
    if (
      !claim.evidence.length ||
      claim.evidence.some(
        (e) =>
          !pkg.sourceRevisionIds.includes(e.sourceRevisionId) ||
          (!e.partId && e.featureId !== feature.sourceKey) ||
          (e.partId &&
            !pkg.parts.some(
              (p) =>
                p.id === e.partId &&
                p.sourceRevisionId === e.sourceRevisionId &&
                p.entityIds.includes(feature.id),
            )) ||
          (!e.partId && e.sourceRevisionId !== feature.sourceRevisionId),
      )
    )
      throw new AppError(
        422,
        "EVIDENCE_REQUIRED",
        "Bind the claim to a source part associated with this entity.",
      );
    const candidate: FactCandidate = {
      ...claim,
      id: randomUUID(),
      method: "human_entry",
      evidenceState: "source_supported",
      worldStatus: feature.worldStatus,
    };
    const competing = pkg.factCandidates.filter(
      (c) =>
        c.entityId === candidate.entityId &&
        c.property === candidate.property &&
        c.unit === candidate.unit &&
        c.referenceFrameId === candidate.referenceFrameId &&
        JSON.stringify(c.value) !== JSON.stringify(candidate.value),
    );
    pkg.factCandidates.push(candidate);
    if (competing.length || candidate.property === "building.exteriorHeight") {
      const old = pkg.questions.find(
        (q) =>
          q.entityId === feature.id &&
          q.property === candidate.property &&
          q.kind === "conflicting_claims",
      );
      if (old) delete old.answer;
      else
        pkg.questions.push({
          kind: "conflicting_claims",
          id: randomUUID(),
          entityId: feature.id,
          property: candidate.property,
          message: `${feature.name}: sources disagree about ${candidate.property}. Compare their locators and retain a reason for the selected claim.`,
          blocks:
            "Applying this fact to geometry; existing physical observations remain available.",
        });
    }
    pkg.revision++;
    delete pkg.review;
    pkg.state = pkg.questions.some((q) => !q.answer)
      ? "NEEDS_INPUT"
      : "READY_FOR_REVIEW";
    await savePackage(client, pkg);
    return pkg;
  });
}

export async function currentAreaCheckFingerprint(areaId: string) {
  const area = await getArea(areaId);
  const features = await withNeighbours(await loadAreaFeatures(area), area);
  return sha256(
    JSON.stringify({
      features,
      associations: await checkAssociations(features.map((f) => f.id)),
      reference: area.reference,
      validator: "area-check-officer-v1",
    }),
  );
}
