import {
  splitPackageReviewGeometry, requireQualifiedGeometryRecords, qualifiedGeometryRecordPins, geometryPin,
  isQualifiedPin, withUspAnalyticalReaderTx, PACKAGE_REVIEW_MARGIN_METRES, PACKAGE_REVIEW_VALIDATOR,
  type PackageReviewContextPin, type PackageReviewScope,
} from '../usp/geometry';
import { canonical } from '../cases/domain';
import {
  assertSourceBuildingPackageAuthorityTx, commitSourceBuildingsTx, isGeometryFreePackage,
  lockSourceBuildingCasesTx, reviewSourceBuildings,
} from '../usp/ingestion/source-building-review';
import type {GisGeometryDisposition} from '@ulpin/contracts';
import {gisQuarantine,withSetAside} from './gis-quarantine';
import {displayAreaProposals,proposalRuleBody,type RuleCondition} from './area-display-proposals';
import { documentProfileFormats, documentLimitMiB } from "../../shared/document-formats";
import { areaSceneAssets } from "../spatial/scene-assets";
import { usesGeographicNeighbours } from "../../shared/neighbour-scenario-policy";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { isDeepStrictEqual } from "node:util";
import { STREAMING_VECTOR_LIMITS } from "@ulpin/contracts/usp";
import type { SourceRangeReference } from "@ulpin/contracts";
import { readStreamingFeatures } from "../usp/ingestion/streaming-vector-reader";
import { recordCommittedExteriorsTx } from './exterior-records';
import { redactDerivative } from '../usp/ingest/redact';
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
import { query, transaction } from "../../infrastructure/db";
import { settings } from "../../infrastructure/config";
import { AppError, conflict, notFound } from "../../infrastructure/errors";
import { putOriginal, readObject, sha256 } from "../../infrastructure/storage";
import { propertyIdentifier } from "../../shared/identifiers";
import { originalAttempt } from "../cases/original-attempt";
import { checkAssociations, enrichFindings } from "../officer/officer";
import { localOperatorSubject } from "../usp/principal";
import { assertPackageDocumentAuthority } from "./package-authority";
import { partStageTimer, type PartTiming, type ProvedAreaPartInput } from "../usp/ingestion/proved-area-part";
import { assertProvedPartBounds } from "../usp/ingestion/intake-package-cuts";
import { assertAreaRowLive } from "./area-retire";

export type Mapping = {
  sourceKeyConversion?: "feature_position@1";
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
  disposition?: GisGeometryDisposition;
};
/** A processor image without the requested operation: an unavailable service, but never a transient one. */
export const AREA_PROCESSOR_OPERATION = "AREA_PROCESSOR_OPERATION";

export async function areaGeo<T>(
  operation: "normalize" | "check" | "extract" | "crop" | "profile" | "inspect-gis" | "inspect-archive-member"
    | "build-prisms" | "resolve-geojson-crs" | "plan-readiness" | "plan-reading",
  input: unknown,
  maxResultBytes?: number,
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
    // The processor answers 404 for an operation it does not route; the same image cannot pass on a retry.
    if (response.status === 404 || response.status === 405) throw new AppError(503, AREA_PROCESSOR_OPERATION,
      `The area processor in use does not offer the ${operation} operation.`);
    throw new AppError(
      response.status === 422 ? 422 : 503,
      "AREA_PROCESSING",
      typeof error.detail === "string"
        ? error.detail
        : "The area processor could not complete this operation.",
    );
  }
  if(maxResultBytes===undefined)return response.json();
  if(!Number.isSafeInteger(maxResultBytes)||maxResultBytes<1)throw new Error('Invalid processor response cap.');
  const reader=response.body?.getReader(),chunks:Uint8Array[]=[];let size=0;
  if(!reader)throw new AppError(503,'AREA_PROCESSING','The processor returned no result body.');
  try{
    while(true){
      const {done,value}=await reader.read();if(done)break;
      size+=value.byteLength;
      if(size>maxResultBytes)throw new AppError(413,'AREA_RESULT_LIMIT','The processor result exceeds its byte cap.');
      chunks.push(value);
    }
  }catch(error){await reader.cancel().catch(()=>{});throw error;}
  finally{reader.releaseLock();}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
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
export async function listAreas(includeArchived = false, client?: PoolClient, readOnly = false): Promise<MapArea[]> {
  const run = client ? client.query.bind(client) : query;
  // Include legacy sites added after the additive migration, without georeferencing them.
  if (!readOnly) await run(
    "INSERT INTO map_areas(id,site_id,name) SELECT id,id,name FROM registry_sites ON CONFLICT(site_id) DO NOTHING",
  );
  return (
    await run(
      `SELECT a.*, (SELECT count(*) FROM physical_features f WHERE f.revision>0 AND (f.area_id=a.id OR EXISTS (SELECT 1 FROM block_group_memberships gm JOIN block_groups gg ON gg.id=gm.group_id WHERE gm.feature_id=f.id AND gg.area_id=a.id))) feature_count,
        (SELECT CASE WHEN count(*)=0 THEN 'empty' WHEN bool_and(f.body->>'worldStatus'='synthetic') THEN 'demonstration' WHEN bool_and(f.body->>'worldStatus'='observed') THEN 'real' ELSE 'mixed' END FROM physical_features f WHERE f.revision>0 AND (f.area_id=a.id OR EXISTS (SELECT 1 FROM block_group_memberships gm JOIN block_groups gg ON gg.id=gm.group_id WHERE gm.feature_id=f.id AND gg.area_id=a.id))) data_kind,
        COALESCE((SELECT jsonb_agg(jsonb_strip_nulls(to_jsonb(u))) FROM administrative_units u JOIN area_memberships m ON m.unit_id=u.id WHERE m.area_id=a.id),'[]') administrative_units FROM map_areas a WHERE ($1::boolean OR a.archived_at IS NULL) ORDER BY (a.reference IS NOT NULL) DESC,a.created_at DESC`,
      [includeArchived],
    )
  ).rows.map(areaFrom);
}
export async function getArea(id: string, client?: PoolClient): Promise<MapArea> {
  const area = (await listAreas(true, client, true)).find((a) => a.id === id);
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
/** Checks, exports and other analytical reads of an area stay bounded to this many features. */
const AREA_FEATURE_LIMIT = 2000;
/** The area screen's display reads (context and canonical projection) draw up to this many features. */
export const AREA_DISPLAY_LIMIT = 10000;
async function loadAreaFeatures(
  area: MapArea,
  client?: PoolClient,
  limit = AREA_FEATURE_LIMIT,
): Promise<PhysicalFeature[]> {
  const sql = `SELECT f.body,f.area_id,CASE WHEN f.area_id<>$1 AND $2::integer IS NOT NULL THEN ST_AsGeoJSON(ST_Translate(ST_Transform(f.geographic_geometry,$2::integer),-($3::double precision),-($4::double precision)),9,0) END local_geometry
    FROM physical_features f WHERE f.revision>0 AND (f.area_id=$1 OR EXISTS (
      SELECT 1 FROM block_group_memberships m JOIN block_groups g ON g.id=m.group_id WHERE m.feature_id=f.id AND g.area_id=$1
    )) ORDER BY f.identifier LIMIT $5`;
  const values = [
    area.id,
    area.reference ? Number(area.reference.analysisCrs.split(":")[1]) : null,
    ...(area.reference?.origin ?? [null, null]),
    limit + 1,
  ];
  const rows = (await (client ? client.query(sql, values) : query(sql, values)))
    .rows;
  if (rows.length > limit)
    throw new AppError(
      422,
      "AREA_LIMIT",
      `This block and its explicit group members exceed ${limit.toLocaleString("en-US")} features. ` +
        "Choose a smaller bounded group.",
    );
  return projectedFeatures(rows, area);
}
/** Whether the latest check still describes the area; a check of an earlier area revision is stale as it stands. */
async function checkIsStale(check: AreaCheck, features: PhysicalFeature[], area: MapArea): Promise<boolean> {
  if (check.areaRevision !== area.revision) return true;
  const effective = await withNeighbours(features, area);
  return check.inputFingerprint !== sha256(JSON.stringify({
    features: effective,
    associations: await checkAssociations(effective.map((f) => f.id)),
    reference: area.reference,
    validator: "area-check-officer-v1",
  }));
}
export async function areaContext(id: string, limit = AREA_FEATURE_LIMIT): Promise<AreaContext> {
  const area = await getArea(id);
  const [features, packages, checks] = await Promise.all([
    loadAreaFeatures(area, undefined, limit),
    transaction(async client => {
      const rows = await areaDisplayPackages(client, id);
      return {rows,displayFeatures:await displayAreaProposals(client,area,rows,limit)};
    }),
    query(
      "SELECT body FROM area_check_runs WHERE area_id=$1 ORDER BY created_at DESC LIMIT 1",
      [id],
    ),
  ]);
  const currentFeatures = features;
  const proposalIds=new Set(packages.displayFeatures.map(feature=>feature.id));
  const displayFeatures=[...currentFeatures.filter(feature=>!proposalIds.has(feature.id)),...packages.displayFeatures];
  if (displayFeatures.length > limit) {
    const most = limit.toLocaleString("en-US");
    throw new AppError(422, "AREA_LIMIT", `Choose an area with at most ${most} display features.`);
  }
  const latestCheck = checks.rows[0]?.body as AreaCheck | undefined;
  if (latestCheck) latestCheck.stale = await checkIsStale(latestCheck, currentFeatures, area);
  return {
    area,
    features: currentFeatures,
    displayFeatures,
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
    packages: packages.rows,
    latestCheck: latestCheck || null,
  };
}
/** The packages whose proposals an area's display reads draw, newest first, each past its document authority: the
 * newest 30 whole packages, or with ruleOnly every package of the area, its features keeping only the fields the
 * proposal rule reads and only those the condition keeps. */
export async function areaDisplayPackages(client: PoolClient, id: string, ruleOnly = false,
  kept?: RuleCondition): Promise<ImportPackage[]> {
  const rows = await client.query(ruleOnly
    ? `SELECT ${proposalRuleBody(kept?.sql)} body FROM import_packages WHERE area_id=$1 ORDER BY created_at DESC`
    : "SELECT body FROM import_packages WHERE area_id=$1 ORDER BY created_at DESC LIMIT 30",
    [id, ...kept?.values ?? []]);
  for (const row of rows.rows) await assertAreaPackageAuthority(client, row.body);
  return rows.rows.map(row => row.body);
}
async function assertAreaPackageAuthority(client: PoolClient, pkg: ImportPackage): Promise<ImportPackage> {
  if (isGeometryFreePackage(pkg)) {
    await assertSourceBuildingPackageAuthorityTx(client, pkg.id);
    return pkg;
  }
  return assertPackageDocumentAuthority(client, pkg);
}

export async function getPackage(id: string, client?: PoolClient): Promise<ImportPackage> {
  const read=async(current:PoolClient)=>{
    const pkg:ImportPackage=(await current.query("SELECT body FROM import_packages WHERE id=$1",[id])).rows[0]?.body||notFound('Import package not found.');
    return assertAreaPackageAuthority(current,pkg);
  };
  return client?read(client):transaction(read);
}
type DraftFeatureWrite = { feature: PhysicalFeature; recordId: string | null; linkedRevision?: number };

/** The site row is already locked. A draft's outline is displayed but never becomes recorded geometry.
 * Redrafting moves only a never-recorded outline; a recorded row stays unchanged. */
export async function writeDraftFeaturesTx(client: PoolClient, namespace: string, drafts: DraftFeatureWrite[]) {
  const fresh = drafts.filter(draft => draft.linkedRevision === undefined);
  if (fresh.length) {
    const rows = fresh.map(({ feature: f, recordId }) => ({ id: f.id, area_id: f.areaId, record_id: recordId,
      identifier: f.identifier, body: f, outline: f.geographicGeometry }));
    await client.query(`INSERT INTO physical_features(id,area_id,record_id,identifier,body,geographic_geometry)
      SELECT id,area_id,record_id,identifier,body,ST_SetSRID(ST_GeomFromGeoJSON(outline::text),4326)
      FROM jsonb_to_recordset($1::jsonb)
      AS f(id uuid,area_id uuid,record_id uuid,identifier text,body jsonb,outline jsonb)`, [JSON.stringify(rows)]);
  }
  // Existing rows retain their source-order locks; only fresh identities use batched inserts.
  for (const { feature: f, linkedRevision } of drafts) {
    if (linkedRevision === 0) await client.query(`UPDATE physical_features
      SET geographic_geometry=ST_SetSRID(ST_GeomFromGeoJSON($2),4326) WHERE id=$1 AND revision=0`,
    [f.id, JSON.stringify(f.geographicGeometry)]);
  }
  if (fresh.length) await client.query(`INSERT INTO source_feature_links(namespace,source_key,area_id,feature_id)
    SELECT $1,source_key,area_id,feature_id FROM jsonb_to_recordset($2::jsonb)
    AS l(source_key text,area_id uuid,feature_id uuid)`, [namespace, JSON.stringify(fresh.map(({ feature: f }) =>
    ({ source_key: f.sourceKey, area_id: f.areaId, feature_id: f.id })))]);
}

async function savePackage(client: PoolClient, pkg: ImportPackage) {
  await assertPackageDocumentAuthority(client, pkg);
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
  if (isGeometryFreePackage(pkg)) {
    throw new AppError(422, 'SOURCE_BUILDING_CORRECTION_REQUIRED',
      'Source-only declarations cannot use GIS geometry editing or staged document extraction.');
  }
  await assertPackageDocumentAuthority(client, pkg);
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
/** Placement binds an intake case's site, never its calculation frame or edit counter. */
export async function bindRetainedCaseTx(client: PoolClient, caseId: string | undefined, site: { id: string }) {
  if (!caseId) return;
  const row = (await client.query('SELECT id,site_id,archived,frame FROM cases WHERE id=$1 FOR UPDATE',
    [caseId])).rows[0];
  if (!row) notFound('Retained original case not found.');
  if (row.archived)
    throw new AppError(403, 'AREA_SOURCE_DENIED', "This retained original's case is archived.");
  if (row.site_id === site.id) return;
  if (row.site_id !== null)
    throw new AppError(403, 'AREA_SOURCE_DENIED', 'This retained original belongs to a case of another site.');
  if (row.frame?.id !== 'UNASSIGNED')
    throw new AppError(403, 'AREA_SOURCE_DENIED',
      "This retained original's case has a frame of its own; place the file from an intake case.");
  await client.query('UPDATE cases SET site_id=$2, updated_at=now() WHERE id=$1', [caseId, site.id]);
}

/** All-or-none locators: never pair accepted ordinals or reserialized features with original bytes. */
export async function importedGeojsonRanges(bytes: Uint8Array, data: unknown,
  candidates: Pick<NormalizedFeature, "sourceFeatureIndex" | "sourceGeometry" | "properties">[]) {
  const ranges = new Map<number, SourceRangeReference>();
  const rows = (data as { features?: unknown[] })?.features;
  if (!Array.isArray(rows)) return ranges;
  try {
    await readStreamingFeatures(Readable.from([Buffer.from(bytes)]), "feature-collection", async item => {
      if (!isDeepStrictEqual(item.feature, rows[item.index])) throw new Error("Feature pairing changed");
      ranges.set(item.index, { format: "geojson", featureIndex: item.index,
        byteStart: item.start, byteEnd: item.end, rawSha256: sha256(item.raw),
        readerVersion: STREAMING_VECTOR_LIMITS.version });
    });
    if (ranges.size !== rows.length) throw new Error("Feature count changed");
    const indexes = new Set<number>();
    for (const candidate of candidates) {
      const index = candidate.sourceFeatureIndex;
      if (index === undefined || !ranges.has(index) || indexes.has(index)) throw new Error("Missing index");
      indexes.add(index);
      const row = rows[index] as { geometry?: unknown; properties?: Record<string, unknown> };
      if (!isDeepStrictEqual(row.geometry, candidate.sourceGeometry)) throw new Error("Geometry pairing changed");
      for (const [name, value] of Object.entries(candidate.properties))
        if (!isDeepStrictEqual(row.properties?.[name], value)) throw new Error("Properties pairing changed");
    }
    return ranges;
  } catch {
    return new Map<number, SourceRangeReference>();
  }
}

type AreaImportInput = {
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
  /** Manual ingestion only: reuse the pinned retained original, never copy or replace it. */
  retainedOriginal?: { sourceId: string; sourceSha256: string };
  requireNewArea?: boolean;
  /** Internal derived-source adapter only; original image evidence remains linked. */
  derivedObservation?: {
    sourceRevisionId: string;
    sourceSha256: string;
    part: import("@ulpin/contracts").DocumentPart;
    page: number;
    receipt: Record<string, unknown>;
  };
};

export async function ingestArea(input: AreaImportInput, externalClient?: PoolClient): Promise<ImportPackage> {
  const run = externalClient ? externalClient.query.bind(externalClient) : query;
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
  const area = await importAreaDestination(input, externalClient);
  const digest = sha256(input.bytes);
  const operationKey = sha256(
    JSON.stringify({
      destination: area?.id || seedKey,
      namespace: input.namespace,
      format: input.format,
      layer: input.layer ?? null,
      digest,
      retainedSourceId: input.retainedOriginal?.sourceId,
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
  const readRetry = async (client: PoolClient) => {
    const retry = (
      await client.query(
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
              retainedSourceId: input.retainedOriginal?.sourceId,
              worldStatus: input.worldStatus || "observed",
              sourceCrs: input.sourceCrs,
            }),
          ),
        ],
      )
    ).rows[0];
    return retry ? assertPackageDocumentAuthority(client, retry.body) : undefined;
  };
  const retry = externalClient ? await readRetry(externalClient) : await transaction(readRetry);
  if (retry) return retry;
  if (
    area &&
    input.expectedAreaRevision !== undefined &&
    area.revision !== input.expectedAreaRevision
  )
    conflict("Area changed; refresh before importing.");
  const normalized = await normalizeAreaImport(input, data, area);
  const quarantine=gisQuarantine(normalized.disposition,digest);
  if(!normalized.features.length)
    throw new AppError(422,'GIS_ALL_GEOMETRIES_REJECTED','No source geometries were accepted. The original was not imported and no area or records were created.',{quarantine:quarantine?{...quarantine,message:quarantine.message.replace('Original retained unchanged','Original not imported')}:undefined});
  const retained = input.retainedOriginal
    ? (await run("SELECT id,case_id,sha256,object_key FROM sources WHERE id=$1 FOR SHARE", [input.retainedOriginal.sourceId])).rows[0]
    : undefined;
  if (input.retainedOriginal && (!externalClient || !retained || retained.sha256 !== digest || digest !== input.retainedOriginal.sourceSha256))
    conflict("The retained GIS original does not match this transaction's source pin.");
  const sourceRanges = input.format === "geojson"
    ? await importedGeojsonRanges(input.bytes, data, normalized.features)
    : new Map<number, SourceRangeReference>();
  return persistPreparedAreaImport(input, {
    area, seedKey, digest, operationKey, normalized, quarantine, retained, sourceRanges,
  }, externalClient);
}

/** Internal streamed import only. The caller's transaction also publishes its intake part and targets. */
export async function ingestProvedAreaPart(input: ProvedAreaPartInput, client: PoolClient,
  timing?: PartTiming, witness?: import("../usp/ingestion/proved-area-part").ProvedAreaPartWitness)
  : Promise<ImportPackage> {
  const mark = partStageTimer(timing);
  const { prepareProvedAreaPartTx, provedPartOperationKey } = await import("../usp/ingestion/proved-area-part");
  const operationKey = provedPartOperationKey(input);
  const part = await prepareProvedAreaPartTx(client, input, witness);
  assertProvedPartBounds(part.features, part.ranges, part.metadata);
  mark('prepare');
  const importSignature = sha256(JSON.stringify({ operationKey, destination: input.destination,
    featureIndexes: input.features.map(feature => feature.featureIndex) }));
  const prior = (await client.query("SELECT body FROM import_packages WHERE operation_key=$1", [operationKey])).rows[0];
  mark('priorBodyRead');
  if (prior) {
    if (prior.body.importSignature !== importSignature) conflict("This cut index already names different features or a destination.");
    return assertPackageDocumentAuthority(client, prior.body);
  }
  const adapter: AreaImportInput = {
    ...input.destination, bytes: new Uint8Array(), filename: part.source.name, format: "geojson", mapping: part.mapping,
    retainedOriginal: { sourceId: input.sourceId, sourceSha256: input.sourceSha256 },
  };
  const area = await importAreaDestination(adapter, client);
  const data = { ...part.metadata, type: "FeatureCollection", features: part.features };
  mark('destination');
  const normalized = await normalizeAreaImport(adapter, data, area, part.positions);
  mark('normalizeRequest');
  remapProvedPartIndexes(normalized, part.features, [...part.ranges.keys()]);
  const quarantine = gisQuarantine(normalized.disposition, input.sourceSha256);
  if (!normalized.features.length)
    throw new AppError(422, "GIS_ALL_GEOMETRIES_REJECTED", "No geometries in this proved part were accepted.", { quarantine });
  return persistPreparedAreaImport(adapter, {
    area, seedKey: `${adapter.namespace}:${adapter.name}`, digest: input.sourceSha256, operationKey,
    normalized, quarantine, retained: part.source, sourceRanges: part.ranges, provedPart: { importSignature },
  }, client, timing);
}

function remapProvedPartIndexes(normalized: Normalized, features: Record<string, unknown>[], indexes: number[]) {
  const globalIndex = (local: number | undefined) => {
    if (local === undefined || !Number.isSafeInteger(local) || indexes[local] === undefined)
      conflict("The normalizer did not retain this proved part's exact feature pairing.");
    return indexes[local];
  };
  for (const candidate of normalized.features) {
    const feature = features[candidate.sourceFeatureIndex!];
    if (!feature || !isDeepStrictEqual(feature.geometry, candidate.sourceGeometry))
      conflict("The normalized geometry differs from its proved raw feature.");
    const properties = feature.properties as Record<string, unknown> | null;
    for (const [name, value] of Object.entries(candidate.properties))
      if (!isDeepStrictEqual(properties?.[name], value)) conflict("The normalized properties lost their raw pairing.");
    candidate.sourceFeatureIndex = globalIndex(candidate.sourceFeatureIndex);
  }
  for (const rejection of normalized.disposition?.rejections ?? [])
    rejection.featureIndex = globalIndex(rejection.featureIndex);
}

type PreparedAreaImport = {
  area?: MapArea;
  seedKey: string;
  digest: string;
  operationKey: string;
  normalized: Normalized;
  quarantine: ReturnType<typeof gisQuarantine>;
  retained?: Record<string, any>;
  sourceRanges: Map<number, SourceRangeReference>;
  provedPart?: { importSignature: string };
};

async function importAreaDestination(input: Pick<AreaImportInput, "areaId" | "namespace" | "name">,
  externalClient?: PoolClient) {
  const run = externalClient ? externalClient.query.bind(externalClient) : query;
  // Import needs the destination's frame and revision, not display counts across every area's features.
  const [where, key] = input.areaId ? ['id=$1', input.areaId]
    : ['seed_key=$1', `${input.namespace}:${input.name}`];
  const existingArea = (await run(`SELECT * FROM map_areas WHERE ${where}`, [key])).rows[0];
  if (!existingArea && input.areaId) notFound("Map area not found.");
  return existingArea ? areaFrom(existingArea) : undefined;
}

/** The normalizer rejects an outline kind's pins and lines one by one; the package counts them by kind. */
async function normalizeAreaImport(input: AreaImportInput, data: unknown, area?: MapArea, sourcePositions?: number[]) {
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
    ...(input.mapping.sourceKeyConversion === "feature_position@1" && sourcePositions ? { sourcePositions } : {}),
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
  const disposition = withSetAside(normalized.disposition, input.mapping.kind, data);
  return disposition === normalized.disposition ? normalized : { ...normalized, disposition };
}

/** Shared persistence of normalized candidates; a proved part never stores its temporary collection. */
async function persistPreparedAreaImport(input: AreaImportInput, prepared: PreparedAreaImport,
  externalClient?: PoolClient, timing?: PartTiming): Promise<ImportPackage> {
  const mark = partStageTimer(timing);
  const { area, seedKey, digest, operationKey, normalized, quarantine, retained, sourceRanges } = prepared;
  const sourceId = retained?.id || randomUUID(),
    objectKey = retained?.object_key || `areas/${sourceId}/${digest}`;
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
    if (!retained) {
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
    }
    const persist = async (client: PoolClient) => {
      if (input.derivedObservation) {
        const original = (await client.query("SELECT sha256 FROM sources WHERE id=$1 FOR SHARE", [input.derivedObservation.sourceRevisionId])).rows[0];
        if (!original || original.sha256 !== input.derivedObservation.sourceSha256 || input.derivedObservation.part.sourceRevisionId !== input.derivedObservation.sourceRevisionId)
          conflict("The retained image evidence changed before creating this derived draft.");
      }
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
      mark('persistencePriorBodyRead');
      if (prior) {
        if (prepared.provedPart && prior.body.importSignature !== prepared.provedPart.importSignature)
          conflict("This cut index already names different features or a destination.");
        return assertPackageDocumentAuthority(client, prior.body);
      }
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
      if (input.requireNewArea && areaRow) conflict("The destination was created before execution; pin its current area explicitly.");
      if (areaRow) assertAreaRowLive(areaRow);
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
      const caseId = prepared.provedPart ? retained!.case_id : randomUUID(),
        packageId = randomUUID();
      const site = (
        await client.query(
          "SELECT * FROM registry_sites WHERE id=$1 FOR UPDATE",
          [areaRow.site_id],
        )
      ).rows[0];
      await bindRetainedCaseTx(client, retained?.case_id, site);
      if (!prepared.provedPart) await client.query(
        "INSERT INTO cases(id,name,description,frame,site_id,archived) VALUES($1,$2,$3,$4,$5,$6)",
        [
          caseId,
          input.name,
          "Canonical v2 physical observations; no rights assertion.",
          site.frame,
          site.id,
          // A fresh original needs an active source context. The unused package
          // workspace for a retained original keeps its previous archived state.
          Boolean(retained),
        ],
      );
      if (!retained) await client.query(
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
            ...(quarantine?{quarantine:gisQuarantine(normalized.disposition,digest,sourceId,1)}:{}),
          },
        ],
      );
      mark('persistenceDestination');
      const features: PhysicalFeature[] = [];
      const derivedPartId = input.derivedObservation ? randomUUID() : undefined;
      const linkedRows = (await client.query(`SELECT f.*,l.source_key FROM source_feature_links l
        JOIN physical_features f ON f.id=l.feature_id WHERE l.namespace=$1 AND l.source_key=ANY($2::text[])`,
      [input.namespace, normalized.features.map(candidate => candidate.sourceKey)])).rows;
      const linkedByKey = new Map(linkedRows.map(row => [row.source_key, row]));
      const nextOrdinals = new Map<string, number>();
      const reservations: Record<string, unknown>[] = [];
      const drafts: DraftFeatureWrite[] = [];
      for (const candidate of normalized.features) {
        const linked = linkedByKey.get(candidate.sourceKey);
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
          let ordinal = nextOrdinals.get(candidate.kind);
          if (ordinal === undefined) ordinal = Number((await client.query(
            "SELECT COALESCE(MAX(ordinal),0)+1 n FROM registry_records WHERE site_id=$1 AND kind=$2",
            [site.id, candidate.kind],
          )).rows[0].n);
          nextOrdinals.set(candidate.kind, ordinal + 1);
          identifier = `${site.identifier}:${candidate.kind === "building" ? "B" : "P"}${String(ordinal).padStart(3, "0")}`;
          recordId = id;
          // Reserve the existing permanent identity. Physical geometry stays in its full v2 representation;
          // revision zero deliberately keeps it out of the legacy rights publication path.
          reservations.push({ id, site_id: site.id, kind: candidate.kind, ordinal, identifier, body: {
            alias: candidate.sourceKey, name: candidate.name, kind: candidate.kind, footprint: [],
            links: [], rights: [], evidence: [], synthetic: candidate.worldStatus === "synthetic",
            representation: "physical_exterior",
          } });
        }
        identifier ||= `OBS-${id}`;
        const feature: PhysicalFeature = {
          ...candidate,
          ...(input.derivedObservation ? {
            semantics: { ...candidate.semantics, evidenceState: "unresolved" as const },
            properties: { ...candidate.properties, spatialExtraction: input.derivedObservation.receipt },
          } : {}),
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
          sourceReference: ["gpkg", "shapefile_zip"].includes(input.format)
            ? (candidate.sourceReference ?? normalized.reference)
            : { ...normalized.reference,
                ...(sourceRanges.has(candidate.sourceFeatureIndex!)
                  ? { sourceRange: sourceRanges.get(candidate.sourceFeatureIndex!) } : {}) },
          id,
          identifier,
          areaId: areaRow.id,
          revision: linked?.revision || 0,
          sourceRevisionId: sourceId,
          datasetNamespace: input.namespace,
          evidence: [
            { sourceRevisionId: sourceId, featureId: candidate.sourceKey },
            ...(input.derivedObservation ? [{ sourceRevisionId: input.derivedObservation.sourceRevisionId, partId: derivedPartId!, page: input.derivedObservation.page }] : []),
          ],
          representation:
            candidate.kind === "building"
              ? "physical_exterior"
              : "physical_context",
        };
        features.push(feature);
        drafts.push({ feature, recordId, linkedRevision: linked?.revision });
      }
      if (reservations.length) await client.query(`INSERT INTO registry_records(id,site_id,kind,ordinal,identifier,body)
        SELECT id,site_id,kind,ordinal,identifier,body FROM jsonb_to_recordset($1::jsonb)
        AS r(id uuid,site_id uuid,kind text,ordinal int,identifier text,body jsonb)`, [JSON.stringify(reservations)]);
      await writeDraftFeaturesTx(client, input.namespace, drafts);
      mark('featureWrites');
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
        state: questions.length || quarantine ? "NEEDS_INPUT" : "READY_FOR_REVIEW",
        ...(quarantine?{quarantine:gisQuarantine(normalized.disposition,digest,sourceId,retained?Number((await client.query('SELECT revision FROM sources WHERE id=$1',[sourceId])).rows[0].revision):1)}:{}),
        sourceRevisionIds: [sourceId, ...(input.derivedObservation ? [input.derivedObservation.sourceRevisionId] : [])],
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
        parts: input.derivedObservation ? [{ ...input.derivedObservation.part, id: derivedPartId!, entityIds: features.map(f => f.id) }] : [],
        warnings: [...normalized.warnings, ...(quarantine?[quarantine.message]:[]), ...(input.derivedObservation ? ["Derived ML footprint proposals: review the retained original, model receipt and documented controls. Height and ownership are unknown; this draft is not survey evidence or statutory acceptance."] : [])],
        createdAt: new Date().toISOString(),
        sourceHash: digest,
        importSignature: prepared.provedPart?.importSignature || sha256(
          JSON.stringify({
            namespace: input.namespace,
            format: input.format,
            layer: input.layer ?? null,
            normalization: "canonical-area-officer-v1",
            name: input.name,
            areaId: areaRow.id,
            mapping: input.mapping,
            retainedSourceId: input.retainedOriginal?.sourceId,
            worldStatus: input.worldStatus || "observed",
            sourceCrs: input.sourceCrs,
          }),
        ),
        extent: normalized.extent,
        geographicExtent: normalized.geographicExtent,
      };
      await assertPackageDocumentAuthority(client, pkg);
      await client.query(
        "INSERT INTO import_packages(id,area_id,case_id,revision,state,body,operation_key) VALUES($1,$2,$3,1,$4,$5,$6)",
        [packageId, areaRow.id, caseId, pkg.state, pkg, operationKey],
      );
      await client.query(
        "INSERT INTO import_package_revisions(package_id,revision,body) VALUES($1,1,$2)",
        [packageId, pkg],
      );
      mark('packageWrite');
      return pkg;
    };
    return externalClient ? persist(externalClient) : transaction(persist);
  }, externalClient);
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
  // Source-only declarations have no geometry to qualify or analyse.
  features = features.filter(feature => feature.geometry !== null);
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
// Geographic bounds prefilter indexed rows; the final predicate checks the widened local-metre box.
const packageReviewBoundsSql = `WITH bounds AS MATERIALIZED (
  SELECT ST_MakeEnvelope($2,$3,$4,$5,0) local_extent,
    CASE WHEN $10::integer IS NULL THEN ST_MakeEnvelope($6,$7,$8,$9,4326) ELSE
      ST_Expand(ST_Envelope(ST_Transform(ST_SetSRID(ST_Translate(
        ST_Segmentize(ST_MakeEnvelope($2,$3,$4,$5,0),32),
        $11::double precision,$12::double precision),$10::integer),4326)),0.0000001)
    END geographic_extent
)`;
const packageSpatialContextSql = `SELECT id FROM physical_features
  WHERE area_id=$1 AND revision>0 AND id<>ALL($13::uuid[])
    AND geometry && (SELECT local_extent FROM bounds)
    AND ST_Intersects(geometry,(SELECT local_extent FROM bounds))
  UNION
  SELECT id FROM physical_features
  WHERE area_id<>$1 AND revision>0 AND id<>ALL($13::uuid[])
    AND $14::boolean AND body->>'worldStatus' IN ('observed','planned')
    AND geographic_geometry && (SELECT geographic_extent FROM bounds)
    AND ST_Intersects(ST_SetSRID(ST_Translate(ST_Transform(geographic_geometry,$10::integer),
      -($11::double precision),-($12::double precision)),0),(SELECT local_extent FROM bounds))`;
const unqualifiedContextCountSql = `SELECT count(*)::integer AS unqualified_count
  FROM scoped s JOIN physical_features f ON f.id=s.id
  WHERE NOT EXISTS (SELECT 1 FROM usp_analytic_geometry q
    WHERE q.namespace='area_feature' AND q.id=f.id AND q.revision=f.revision OFFSET 0)`;

const packageContextSql = `${packageReviewBoundsSql}, scoped AS MATERIALIZED (
  ${packageSpatialContextSql}
), selected AS MATERIALIZED (
  SELECT id FROM scoped
  UNION
  SELECT f.id FROM property_associations a JOIN physical_features f ON f.id=a.to_id
  WHERE a.from_id=ANY($13::uuid[]) AND a.relationship='occupies_parcel' AND a.status='confirmed'
    AND f.revision>0 AND f.id<>ALL($13::uuid[])
  UNION
  SELECT f.id FROM block_groups g JOIN block_group_memberships m ON m.group_id=g.id
  JOIN physical_features f ON f.id=m.feature_id
  WHERE g.area_id=$1 AND f.area_id<>$1 AND f.revision>0 AND f.id<>ALL($13::uuid[])
), context AS (
SELECT f.id,f.body,f.area_id,q.qualification_revision,q.metadata,
  CASE WHEN f.area_id<>$1 AND $10::integer IS NOT NULL THEN
    ST_AsGeoJSON(ST_Translate(ST_Transform(f.geographic_geometry,$10::integer),
      -($11::double precision),-($12::double precision)),9,0) END local_geometry,
  count(*) OVER() AS context_count
FROM selected s JOIN physical_features f ON f.id=s.id
JOIN LATERAL (SELECT qualification_revision,metadata FROM usp_analytic_geometry
  WHERE namespace='area_feature' AND id=f.id AND revision=f.revision OFFSET 0) q ON true
ORDER BY f.id LIMIT 2001
)
SELECT c.body,c.area_id,c.qualification_revision,c.metadata,c.local_geometry,c.context_count,u.unqualified_count
FROM (${unqualifiedContextCountSql}) u LEFT JOIN context c ON true
ORDER BY c.id`;

type ReviewDependencyPins = {
  reference: string;
  ownFeatures: string;
  associations: string;
  context: PackageReviewContextPin[];
};
type ReviewPinnedPackage = ImportPackage & { reviewDependencyPins?: ReviewDependencyPins };
type ReviewAssociations = Awaited<ReturnType<typeof checkAssociations>>;
type ReviewContextRow = {
  body: PhysicalFeature;
  area_id: string;
  local_geometry: string | null;
  qualification_revision: number;
  metadata: unknown;
  context_count: number | string;
};
type ReviewSnapshot = {
  features: PhysicalFeature[];
  scope: PackageReviewScope;
  associations: ReviewAssociations;
};

function geometryExtent(features: PhysicalFeature[], geographic = false): [number, number, number, number] {
  const bounds: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  const visit = (coordinates: unknown) => {
    if (!Array.isArray(coordinates)) return;
    if (coordinates.length === 2 && coordinates.every(value => typeof value === 'number')) {
      bounds[0] = Math.min(bounds[0], coordinates[0]);
      bounds[1] = Math.min(bounds[1], coordinates[1]);
      bounds[2] = Math.max(bounds[2], coordinates[0]);
      bounds[3] = Math.max(bounds[3], coordinates[1]);
    } else coordinates.forEach(visit);
  };
  for (const feature of features) {
    visit((geographic ? feature.geographicGeometry : feature.geometry)?.coordinates);
  }
  if (!bounds.every(Number.isFinite)) {
    throw new AppError(422, 'AREA_REVIEW_EXTENT', 'The package needs a finite geometry extent before review.');
  }
  return bounds;
}

function contextParameters(pkg: ImportPackage, area: MapArea, extent: number[]) {
  const ownGeometry = pkg.features.filter(feature => feature.geometry !== null);
  return [area.id, ...extent, ...geometryExtent(ownGeometry, true),
    area.reference ? Number(area.reference.analysisCrs.split(':')[1]) : null,
    ...(area.reference?.origin ?? [null, null]), pkg.features.map(feature => feature.id),
    Boolean(area.reference) && usesGeographicNeighbours(ownGeometry)];
}

async function checkedAssociations(features: PhysicalFeature[], client?: PoolClient) {
  const ids = new Set(features.map(feature => feature.id));
  return (await checkAssociations([...ids], client))
    .filter(link => ids.has(link.buildingId) && ids.has(link.parcelId))
    .sort((first, second) => first.id.localeCompare(second.id));
}

async function effectiveFeatures(pkg: ImportPackage, area: MapArea, client?: PoolClient): Promise<ReviewSnapshot> {
  if (pkg.features.length > 2000) {
    throw new AppError(422, 'AREA_LIMIT', 'A package review supports at most 2,000 own features.');
  }
  const ownGeometry = pkg.features.filter(feature => feature.geometry !== null);
  const bounds = geometryExtent(ownGeometry);
  const margin = PACKAGE_REVIEW_MARGIN_METRES;
  const extent: PackageReviewScope['extent'] = [bounds[0] - margin, bounds[1] - margin,
    bounds[2] + margin, bounds[3] + margin];
  const run = client ? client.query.bind(client) : query;
  const result = (await run(packageContextSql, contextParameters(pkg, area, extent))).rows;
  // The count's left join retains one null context row when no qualified context exists.
  const rows = result.filter(row => row.body !== null) as ReviewContextRow[];
  const contextCount = Number(rows[0]?.context_count ?? rows.length);
  if (contextCount > 2000) {
    throw new AppError(422, 'AREA_CONTEXT_LIMIT',
      `This package has ${pkg.features.length} own features and ${contextCount} qualified context features; `
        + 'the context limit is 2,000. Choose a smaller review scope.',
      { ownCount: pkg.features.length, contextCount, contextLimit: 2000 });
  }
  const qualified = await qualifiedGeometryRecordPins('FIND', 'area_feature', rows.map(row => row.body), client);
  const canonicalRows = rows.filter(row => isQualifiedPin(qualified, geometryPin('area_feature', row.body)));
  const contextPins = canonicalRows.map(row => ({ id: row.body.id, revision: row.body.revision,
    qualification: { revision: Number(row.qualification_revision), fingerprint: sha256(canonical(row.metadata)) } }));
  const features = [...ownGeometry, ...await projectedFeatures(canonicalRows, area)]
    .sort((first, second) => first.id.localeCompare(second.id));
  return { features, scope: { extent, contextPins, areaRevisionAtReview: area.revision,
    unqualifiedInScope: Number(result[0]?.unqualified_count ?? 0) },
    associations: await checkedAssociations(features, client) };
}

/** No qualified feature anywhere means no qualified context can enter any of the review's selectors.
 * Any available qualification keeps the full spatial/pin reader, including entry and departure checks. */
async function reviewSnapshotUnderLock(pkg: ImportPackage, area: MapArea, before: ReviewSnapshot,
  client: PoolClient): Promise<ReviewSnapshot> {
  if (before.scope.contextPins.length) return effectiveFeatures(pkg, area, client);
  const qualified = await withUspAnalyticalReaderTx(client, 'FIND', reader => reader.query(
    "SELECT id FROM usp_analytic_geometry WHERE namespace='area_feature' LIMIT 1"));
  if (qualified.rows.length) return effectiveFeatures(pkg, area, client);
  const features = pkg.features.filter(feature => feature.geometry !== null)
    .sort((first, second) => first.id.localeCompare(second.id));
  return { features, scope: before.scope,
    associations: await checkedAssociations(features, client) };
}

function reviewDependencies(pkg: ImportPackage, area: MapArea, snapshot: ReviewSnapshot): ReviewDependencyPins {
  return { reference: sha256(canonical(area.reference)),
    ownFeatures: sha256(canonical([...pkg.features].sort((first, second) => first.id.localeCompare(second.id)))),
    associations: sha256(canonical(snapshot.associations)),
    context: [...snapshot.scope.contextPins].sort((first, second) => first.id.localeCompare(second.id)) };
}

function packageReviewFingerprint(pkg: ImportPackage, area: MapArea, snapshot: ReviewSnapshot, revision: number) {
  return sha256(canonical({ features: [...pkg.features].sort((first, second) => first.id.localeCompare(second.id)),
    packageRevision: revision, reference: area.reference,
    context: [...snapshot.scope.contextPins].sort((first, second) => first.id.localeCompare(second.id)),
    associations: snapshot.associations, validator: PACKAGE_REVIEW_VALIDATOR,
    extent: snapshot.scope.extent, marginMetres: PACKAGE_REVIEW_MARGIN_METRES }));
}
async function reviewPinDifference(before: ReviewDependencyPins, after: ReviewDependencyPins, client: PoolClient) {
  if (before.reference !== after.reference) return 'The area reference changed; review again.';
  const oldPins = new Map(before.context.map(pin => [pin.id, pin]));
  const newPins = new Map(after.context.map(pin => [pin.id, pin]));
  const ids = [...new Set([...oldPins.keys(), ...newPins.keys()])].sort();
  for (const id of ids) {
    const previous = oldPins.get(id);
    const current = newPins.get(id);
    if (!previous) return `Recorded context feature ${id} entered the checked context; review again.`;
    if (!current) {
      const row = (await client.query('SELECT revision FROM physical_features WHERE id=$1', [id])).rows[0];
      if (row && Number(row.revision) !== previous.revision) {
        return `Recorded context feature ${id} changed from revision ${previous.revision} to ${row.revision}; `
          + 'review again.';
      }
      return `Recorded context feature ${id} left the checked context or lost its geometry qualification; review again.`;
    }
    if (previous.revision !== current.revision) {
      return `Recorded context feature ${id} changed from revision ${previous.revision} to ${current.revision}; `
        + 'review again.';
    }
    if (canonical(previous.qualification) !== canonical(current.qualification)) {
      return `The geometry qualification of recorded context feature ${id} changed; review again.`;
    }
  }
  if (before.ownFeatures !== after.ownFeatures) return 'The package observations changed; review again.';
  if (before.associations !== after.associations) return 'An association among the checked features changed; review again.';
  return 'The checked extent or review validator changed; review again.';
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
    if (retry) return assertPackageDocumentAuthority(client, retry.body);
    const row =
      (
        await client.query(
          "SELECT * FROM import_packages WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0] || notFound();
    const original = await assertPackageDocumentAuthority(client, row.body);
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
    await assertPackageDocumentAuthority(client, next);
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
export async function reviewPackage(id: string, expectedRevision: number, timing?: PartTiming) {
  const mark = partStageTimer(timing);
  const pkg = await getPackage(id);
  mark('getPackage');
  if (isGeometryFreePackage(pkg)) return reviewSourceBuildings(id, expectedRevision);
  if (pkg.sourceWorkspace) throw new AppError(422, "SOURCE_WORKSPACE", "Review the derived footprint draft or assign documents to a property before recording.");
  const areaRow = (await query("SELECT * FROM map_areas WHERE id=$1", [pkg.areaId])).rows[0]
    || notFound("Map area not found.");
  const area = areaFrom(areaRow);
  mark('areaRead');
  if (pkg.revision !== expectedRevision) conflict();
  const snapshot = await effectiveFeatures(pkg, area);
  mark('effectiveFeatures');
  const admission = await splitPackageReviewGeometry(snapshot.features, pkg, snapshot.scope);
  mark('split');
  await requireQualifiedGeometryRecords('FIND', 'area_feature', admission.requireQualification);
  mark('qualification');
  const checkFeatures = admission.checkFeatures;
  const checkLinks = snapshot.associations;
  const result = await areaGeo<{ findings: AreaFinding[]; coverage: string[] }>(
    "check",
    { features: checkFeatures, associations: checkLinks, reference: area.reference },
  );
  mark('geoCheck');
  result.coverage.push(...admission.coverage);
  result.findings = await enrichFindings(result.findings, checkFeatures, area.id);
  mark('enrichFindings');
  const inputFingerprint = packageReviewFingerprint(pkg, area, snapshot, expectedRevision + 1);
  const dependencies = reviewDependencies(pkg, area, snapshot);
  mark('fingerprint');
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
  const reviewed = await transaction(async (client) => {
    mark('transactionBegin');
    const current = await lockedPackage(client, id, expectedRevision) as ReviewPinnedPackage;
    mark('packageLock');
    const lockedArea = areaFrom((await client.query("SELECT * FROM map_areas WHERE id=$1 FOR UPDATE",
      [pkg.areaId])).rows[0]);
    mark('areaLock');
    const latest = await reviewSnapshotUnderLock(current, lockedArea, snapshot, client);
    mark('effectiveFeaturesLocked');
    if (packageReviewFingerprint(current, lockedArea, latest, expectedRevision + 1) !== inputFingerprint) {
      conflict(await reviewPinDifference(dependencies, reviewDependencies(current, lockedArea, latest), client));
    }
    mark('fingerprintLocked');
    // Height questions only block 3D conclusions. The operator may review footprint observations independently.
    current.revision++;
    current.state = "REVIEWED";
    current.reviewDependencyPins = dependencies;
    current.review = {
      areaRevision: area.revision,
      packageRevision: current.revision,
      inputFingerprint,
      findings: result.findings,
      coverage: result.coverage,
      scope: { validator: PACKAGE_REVIEW_VALIDATOR, marginMetres: PACKAGE_REVIEW_MARGIN_METRES,
        extent: snapshot.scope.extent, contextCount: snapshot.scope.contextPins.length,
        unqualifiedInScope: snapshot.scope.unqualifiedInScope, areaRevisionAtReview: area.revision },
    };
    await savePackage(client, current);
    mark('save');
    return current;
  });
  mark('commit');
  return reviewed;
}
export async function commitPackage(
  id: string,
  expectedRevision: number,
  acknowledgement: string,
) {
  return transaction(async (client) => {
    await lockSourceBuildingCasesTx(client, id);
    // Single-operator acceptance is serialized across areas so a cross-area neighbour cannot change after fingerprint validation.
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('physical-area-recording',0))",
    );
    // Lock order: existing document cases, recording, package case, package, area.
    // Recording comes first here: legacy placement holds it before locking a case.
    // SHARE excludes workspace's FOR UPDATE until publication commits; never upgrade the case lock.
    await client.query(
      'SELECT id FROM cases WHERE id=(SELECT case_id FROM import_packages WHERE id=$1) FOR SHARE', [id],
    );
    // Retry after a successful commit returns its result.
    const raw = (
      await client.query(
        "SELECT body FROM import_packages WHERE id=$1 FOR UPDATE",
        [id],
      )
    ).rows[0];
    if (!raw) notFound();
    if (isGeometryFreePackage(raw.body)) {
      return commitSourceBuildingsTx(client, raw.body, expectedRevision, acknowledgement);
    }
    const pkg = raw.body as ReviewPinnedPackage & {
      extent: Normalized["extent"];
      geographicExtent: Normalized["extent"];
    };
    await assertPackageDocumentAuthority(client, pkg);
    if (pkg.sourceWorkspace) throw new AppError(422, "SOURCE_WORKSPACE", "Source workspaces cannot be recorded as physical features.");
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
    if (pkg.review.scope?.validator !== PACKAGE_REVIEW_VALIDATOR || !pkg.reviewDependencyPins) {
      conflict("This review uses the previous review scope; review again before recording.");
    }
    if (!acknowledgement.trim())
      throw new AppError(
        422,
        "ACKNOWLEDGEMENT_REQUIRED",
        "Acknowledge that these are physical observations and describe unresolved findings.",
      );
    const area = areaFrom(areaRow);
    const snapshot = await effectiveFeatures(pkg, area, client);
    if (packageReviewFingerprint(pkg, area, snapshot, pkg.revision) !== pkg.review.inputFingerprint) {
      conflict(await reviewPinDifference(pkg.reviewDependencyPins, reviewDependencies(pkg, area, snapshot), client));
    }
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
    await recordCommittedExteriorsTx(client, pkg.areaId, pkg.features);
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
  await requireQualifiedGeometryRecords('FIND', 'area_feature', checkFeatures);
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
const copyFormats = documentProfileFormats;
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
  // Check the marked-source boundary before destination/association work. New
  // staged documents cannot enter the historical parser/copy/placeholder path.
  const {documentAuthorityTx}=await import('../usp/ingestion/document-authority');
  const selected=(await client.query('SELECT * FROM sources WHERE case_id=$1 AND id=ANY($2::uuid[]) ORDER BY id',[copy.caseId,copy.sourceIds])).rows;
  for(const source of selected)await documentAuthorityTx(client,source,'copy');
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
        "Only supported PDF, PNG, JPEG, CSV, text and DOCX references can be assigned. Other profiles require explicit import mapping.",
      );
    const limit = documentLimitMiB(copyFormats[row.profile]) * 1024 * 1024;
    if (Number(row.bytes) <= 0 || Number(row.bytes) > limit)
      throw new AppError(
        413,
        "COPY_SIZE",
        `Each ${copyFormats[row.profile].toUpperCase()} must be at most ${documentLimitMiB(copyFormats[row.profile])} MiB.`,
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
  const actor = localOperatorSubject();
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
    actor,
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
        actor,
      },
    });
  }
  // Repeat the same authority after object I/O; copySources also runs again in
  // the publication transaction. A newly marked/revoked source cannot publish.
  await transaction(client=>copySources(client,id,copy));
  return attachDocumentBatch(id, input.expectedRevision, files, copy);
}

export type DocumentFile = {
  requestKey?: string;
  familyId?: string;
  referenceOnly?: boolean;
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
  actor: string;
  caseId: string;
  buildingId: string;
  sourceIds: string[];
  reason: string;
  operationKey: string;
  payloadHash: string;
  sourceFingerprint: string;
};
export const documentMime = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  text: "text/plain",
  csv: "text/csv",
  png: "image/png",
  jpeg: "image/jpeg",
};
export async function extractDocument(file: DocumentFile) {
  const extracted = file.format === "png" || file.format === "jpeg"
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
        format: file.format === "csv" && file.referenceOnly ? "csv_reference" : file.format,
        base64: Buffer.from(file.bytes).toString("base64"),
      });
  // Derived text and warnings are minimized independently of retained original bytes.
  return redactDerivative(extracted);
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
  const receipt = files.length === 1 && files[0].requestKey ? {
    key: `source-document:${id}:${files[0].requestKey}`,
    hash: sha256(JSON.stringify([files[0].name, files[0].format, files[0].entityIds,
      files[0].familyId ?? null, files[0].referenceOnly ?? false, sha256(files[0].bytes)])),
  } : null;
  async function replay(client?: PoolClient) {
    if (!receipt) return false;
    const row = (await (client ? client.query.bind(client) : query)(
      "SELECT o.payload_hash FROM operations o JOIN import_packages p ON p.case_id=o.case_id WHERE p.id=$1 AND o.operation_key=$2 AND o.kind='source-document'",
      [id, receipt.key],
    )).rows[0];
    if (row && row.payload_hash !== receipt.hash) conflict("This document receipt key was already used for different original bytes or associations.");
    return !!row;
  }
  if (await replay()) return pkg;
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
    if (file.referenceOnly && file.format !== "csv")
      throw new AppError(422, "REFERENCE_FORMAT", "Reference-table parsing requires a CSV original.");
    if (!file.bytes.length || file.bytes.length > documentLimitMiB(file.format) * 1024 * 1024)
      throw new AppError(
        413,
        "FILE_SIZE",
        `Choose a nonempty ${file.format.toUpperCase()} document up to ${documentLimitMiB(file.format)} MiB.`,
      );
    if (!file.entityIds.length && !pkg.sourceWorkspace)
      throw new AppError(422, "ASSOCIATION", "Unassigned documents require an explicit source workspace.");
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
    if (!extracted.parts.length)
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
      await assertPackageDocumentAuthority(client, row.body);
      if (await replay(client)) return row.body as ImportPackage;
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
        let familyId = sourceId, sourceRevision = 1;
        if (file.familyId) {
          const previous = (await client.query(
            `SELECT profile,revision FROM sources WHERE case_id=$1 AND family_id=$2
             ORDER BY revision DESC LIMIT 1 FOR UPDATE`, [row.case_id, file.familyId],
          )).rows[0];
          if (!previous) throw new AppError(422, 'UNKNOWN_SOURCE_FAMILY', 'Choose a source family in this preparation.');
          if (previous.profile !== `${file.format}-reference-v2`) {
            throw new AppError(422, 'PROFILE_CHANGED', 'A source revision must keep its native document format.');
          }
          familyId = file.familyId;
          sourceRevision = Number(previous.revision) + 1;
        }
        await client.query(
          "INSERT INTO sources(id,case_id,family_id,revision,name,profile,mime_type,bytes,sha256,object_key,status,inspection) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'inspected',$11)",
          [
            sourceId,
            row.case_id,
            familyId,
            sourceRevision,
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
      if (receipt) await client.query("INSERT INTO operations(case_id,operation_key,kind,payload_hash,result) VALUES($1,$2,'source-document',$3,$4)", [row.case_id,receipt.key,receipt.hash,{packageId:id,sourceRevisionIds:prepared.map(p=>p.sourceId)}]);
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
          "INSERT INTO events(id,case_id,kind,message,actor) VALUES($1,$2,'documents_assigned',$3,$4)",
          [
            randomUUID(),
            row.case_id,
            `Explicitly copied ${files.length} document(s) from case ${copy.caseId} to building ${copy.buildingId}. ${copy.reason}`,
            copy.actor,
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

/** The recorded features a check hashes: the area's own and its groups' members, less the area's own source-only
 * declarations, whose null geometry withNeighbours drops. */
const CHECKED_FEATURES_SQL = `physical_features f WHERE f.revision>0
  AND (f.area_id<>$1 OR f.body->'geometry' IS DISTINCT FROM 'null'::jsonb) AND (f.area_id=$1 OR EXISTS (
    SELECT 1 FROM block_group_memberships m JOIN block_groups g ON g.id=m.group_id
    WHERE m.feature_id=f.id AND g.area_id=$1
  ))`;

/** The features a check hashes, null when they exceed the limit; an area over the limit by its feature count is
 * counted first, no further than one past the limit, so its bodies are read only when they fit. */
async function checkedAreaFeatures(area: MapArea): Promise<PhysicalFeature[] | null> {
  const limit = AREA_FEATURE_LIMIT;
  if ((area.featureCount ?? limit + 1) > limit) {
    const sql = `SELECT count(*)::int n FROM (SELECT 1 FROM ${CHECKED_FEATURES_SQL} LIMIT $2) s`;
    if ((await query(sql, [area.id, limit + 1])).rows[0].n > limit) return null;
  }
  const sql = `SELECT f.body,f.area_id,CASE WHEN f.area_id<>$1 AND $2::integer IS NOT NULL THEN
    ST_AsGeoJSON(ST_Translate(ST_Transform(f.geographic_geometry,$2::integer),
      -($3::double precision),-($4::double precision)),9,0) END local_geometry
    FROM ${CHECKED_FEATURES_SQL} ORDER BY f.identifier LIMIT $5`;
  const values = [
    area.id,
    area.reference ? Number(area.reference.analysisCrs.split(":")[1]) : null,
    ...(area.reference?.origin ?? [null, null]),
    limit + 1,
  ];
  type Row = { body: PhysicalFeature; area_id: string; local_geometry: string | null };
  const rows = (await query<Row>(sql, values)).rows;
  return rows.length > limit ? null : projectedFeatures(rows, area);
}

/** The input fingerprint a completed check of the area holds while it is current, or null when the inputs it would
 * hash exceed the 2,000 features any check holds, so no stored check is current. The area's other features, which
 * a check never hashes, are not read. */
export async function currentAreaCheckFingerprint(areaId: string): Promise<string | null> {
  const area = await getArea(areaId);
  const checked = await checkedAreaFeatures(area);
  if (!checked) return null;
  let features: PhysicalFeature[];
  try {
    features = await withNeighbours(checked, area);
  } catch (error) {
    if (error instanceof AppError && error.code === "AREA_LIMIT") return null;
    throw error;
  }
  return sha256(
    JSON.stringify({
      features,
      associations: await checkAssociations(features.map((f) => f.id)),
      reference: area.reference,
      validator: "area-check-officer-v1",
    }),
  );
}
