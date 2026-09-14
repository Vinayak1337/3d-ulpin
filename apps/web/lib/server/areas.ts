import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type {
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

export type Mapping = {
  idField?: string;
  nameField?: string;
  kind: PhysicalFeature["kind"];
  heightField?: string;
  heightUnit?: "m" | "ft";
  heightMeaning?: string;
  identifierFields?: string[];
};
type Normalized = {
  reference: AreaReference;
  extent: NonNullable<MapArea["extent"]>;
  geographicExtent: NonNullable<MapArea["extent"]>;
  features: NormalizedFeature[];
  warnings: string[];
};
export async function areaGeo<T>(
  operation: "normalize" | "check" | "extract",
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
  };
}
export async function listAreas(): Promise<MapArea[]> {
  // Include legacy sites added after the additive migration, without georeferencing them.
  await query(
    "INSERT INTO map_areas(id,site_id,name) SELECT id,id,name FROM registry_sites ON CONFLICT(site_id) DO NOTHING",
  );
  return (
    await query(
      `SELECT a.*, COALESCE((SELECT jsonb_agg(jsonb_strip_nulls(to_jsonb(u))) FROM administrative_units u JOIN area_memberships m ON m.unit_id=u.id WHERE m.area_id=a.id),'[]') administrative_units FROM map_areas a ORDER BY (a.reference IS NOT NULL) DESC,a.created_at DESC`,
    )
  ).rows.map(areaFrom);
}
export async function getArea(id: string): Promise<MapArea> {
  const area = (await listAreas()).find((a) => a.id === id);
  return area || notFound("Map area not found.");
}
export async function areaContext(id: string): Promise<AreaContext> {
  const area = await getArea(id);
  const [features, packages, checks] = await Promise.all([
    query(
      "SELECT body FROM physical_features WHERE area_id=$1 AND revision>0 ORDER BY identifier",
      [id],
    ),
    query(
      "SELECT body FROM import_packages WHERE area_id=$1 ORDER BY created_at DESC LIMIT 30",
      [id],
    ),
    query(
      "SELECT body FROM area_check_runs WHERE area_id=$1 ORDER BY created_at DESC LIMIT 1",
      [id],
    ),
  ]);
  const currentFeatures = features.rows.map((r) => r.body as PhysicalFeature);
  const latestCheck = checks.rows[0]?.body as AreaCheck | undefined;
  if (latestCheck)
    latestCheck.stale =
      latestCheck.areaRevision !== area.revision ||
      latestCheck.inputFingerprint !==
        sha256(
          JSON.stringify({
            features: await withNeighbours(currentFeatures, area),
            reference: area.reference,
            validator: "area-check-v2",
          }),
        );
  return {
    area,
    features: currentFeatures,
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
  format: "geojson" | "arcgis";
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
    data = JSON.parse(new TextDecoder().decode(input.bytes));
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
      digest,
      mapping: input.mapping,
      worldStatus: input.worldStatus || "observed",
      sourceCrs: input.sourceCrs,
      normalization: "canonical-area-v2",
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
  return originalAttempt("sources", sourceId, async (remember) => {
    remember(objectKey);
    await putOriginal(
      objectKey,
      input.bytes,
      input.format === "geojson" ? "application/geo+json" : "application/json",
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
          "INSERT INTO registry_sites(id,identifier,name,frame,synthetic) VALUES($1,$2,$3,$4,false)",
          [id, propertyIdentifier(id), input.name, frame],
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
  const sql = `SELECT body,ST_AsGeoJSON(ST_Translate(ST_Transform(geographic_geometry,$6::integer),-($7::double precision),-($8::double precision)),9,0) local_geometry FROM physical_features
    WHERE area_id<>$1 AND revision>0 AND ST_Intersects(geographic_geometry,ST_MakeEnvelope($2,$3,$4,$5,4326)) ORDER BY id LIMIT 2001`;
  const values = [
    area.id,
    ...extent,
    Number(area.reference.analysisCrs.split(":")[1]),
    ...area.reference.origin,
  ];
  const rows = (await (client ? client.query(sql, values) : query(sql, values)))
    .rows;
  if (rows.length + features.length > 2000)
    throw new AppError(
      422,
      "AREA_LIMIT",
      "This area and its crossing neighbours exceed 2,000 features. Choose a smaller bounded area.",
    );
  return [
    ...features,
    ...rows.map((r) => ({ ...r.body, geometry: JSON.parse(r.local_geometry) })),
  ].sort((a, b) => a.id.localeCompare(b.id));
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
  const result = await areaGeo<{ findings: AreaFinding[]; coverage: string[] }>(
    "check",
    { features, reference: area.reference },
  );
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
          reference: area.reference,
          areaRevision: area.revision,
          packageRevision: current.revision,
          validator: "area-check-v2",
        }),
      ),
      ...result,
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
          reference: areaRow.reference,
          areaRevision: areaRow.revision,
          packageRevision: pkg.revision,
          validator: "area-check-v2",
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
        reference: context.area.reference,
        validator: "area-check-v2",
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
    }>("check", { features: checkFeatures, reference: context.area.reference });
    Object.assign(check, result, { status: "completed" });
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
          reference: latestArea.reference,
          validator: "area-check-v2",
        }),
      );
  return check;
}

export async function attachDocument(
  id: string,
  expectedRevision: number,
  file: {
    bytes: Uint8Array;
    name: string;
    format: "pdf" | "docx" | "text" | "png" | "jpeg";
    entityIds: string[];
  },
) {
  if (!file.bytes.length || file.bytes.length > 16 * 1024 * 1024)
    throw new AppError(
      413,
      "FILE_SIZE",
      "Choose a nonempty document up to 16 MiB.",
    );
  const pkg = await getPackage(id);
  if (pkg.revision !== expectedRevision || pkg.state === "COMMITTED")
    conflict();
  if (file.entityIds.some((id) => !pkg.features.some((f) => f.id === id)))
    throw new AppError(
      422,
      "ASSOCIATION",
      "Choose buildings present in this package.",
    );
  const mime = {
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    text: "text/plain",
    png: "image/png",
    jpeg: "image/jpeg",
  }[file.format];
  const sourceId = randomUUID(),
    digest = sha256(file.bytes),
    key = `areas/${sourceId}/${digest}`;
  return originalAttempt("sources", sourceId, async (remember) => {
    remember(key);
    await putOriginal(key, file.bytes, mime);
    const extracted =
      file.format === "png" || file.format === "jpeg"
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
          }>("extract", {
            format: file.format,
            base64: Buffer.from(file.bytes).toString("base64"),
          });
    return transaction(async (client) => {
      const current = await lockedPackage(client, id, expectedRevision);
      const row = (
        await client.query("SELECT case_id FROM import_packages WHERE id=$1", [
          id,
        ])
      ).rows[0];
      await client.query(
        "INSERT INTO sources(id,case_id,family_id,revision,name,profile,mime_type,bytes,sha256,object_key,status,inspection) VALUES($1,$2,$1,1,$3,$4,$5,$6,$7,$8,'inspected',$9)",
        [
          sourceId,
          row.case_id,
          file.name,
          `${file.format}-reference-v2`,
          mime,
          file.bytes.length,
          digest,
          key,
          { status: "reference_only", partCount: extracted.parts.length },
        ],
      );
      current.sourceRevisionIds.push(sourceId);
      current.warnings.push(...(extracted.warnings || []));
      if (!extracted.parts.length)
        current.warnings.push(
          `${file.name}: no native text was extracted. Original retained; manual reading or calibration is required.`,
        );
      current.parts.push(
        ...extracted.parts.map((part) => ({
          id: randomUUID(),
          sourceRevisionId: sourceId,
          locator: part.locator.label,
          text: part.text,
          entityIds: file.entityIds,
        })),
      );
      current.revision++;
      delete current.review;
      current.state = current.questions.some((q) => !q.answer)
        ? "NEEDS_INPUT"
        : "READY_FOR_REVIEW";
      await savePackage(client, current);
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
