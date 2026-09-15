import { randomUUID } from "node:crypto";
import { legacyUrl } from "../legacy-url";
import type { PoolClient } from "pg";
import type {
  ParcelIdentifier,
  AreaGeometry,
  AreaFinding,
  PhysicalFeature,
  BuildingDossier,
  PropertyAssociation,
  PreparationCase,
  SourceLocator,
  ImportPackage,
  RegistryRecord,
  BlockGroup,
} from "@ulpin/contracts";
import { query, transaction } from "./db";
import { getArea, getPackage, currentAreaCheckFingerprint } from "./areas";
import { AppError, conflict, notFound } from "./errors";
import { fingerprint } from "./domain";

export async function physicalFeature(
  id: string,
  client?: PoolClient,
): Promise<PhysicalFeature> {
  const r = await (client
    ? client.query(
        "SELECT body FROM physical_features WHERE id=$1 AND revision>0",
        [id],
      )
    : query("SELECT body FROM physical_features WHERE id=$1 AND revision>0", [
        id,
      ]));
  return (
    r.rows[0]?.body ??
    notFound("This physical property is not recorded in loaded data.")
  );
}
export async function validateLocators(
  evidence: SourceLocator[],
  entityIds: string[],
  client: PoolClient,
) {
  if (!evidence.length)
    throw new AppError(
      422,
      "EVIDENCE_REQUIRED",
      "Choose a supporting source feature, page, row or region.",
    );
  for (const e of evidence) {
    const source = (
      await client.query("SELECT id FROM sources WHERE id=$1", [
        e.sourceRevisionId,
      ])
    ).rows[0];
    if (!source)
      throw new AppError(
        422,
        "EVIDENCE_UNAVAILABLE",
        "A cited source is unavailable.",
      );
    const feature = (
      await client.query(
        `SELECT body FROM physical_features WHERE id=ANY($1::uuid[]) AND (body->>'sourceRevisionId'=$2 OR body->'evidence' @> $3::jsonb)`,
        [
          entityIds,
          e.sourceRevisionId,
          JSON.stringify([{ sourceRevisionId: e.sourceRevisionId }]),
        ],
      )
    ).rows;
    const part = e.partId
      ? (
          await client.query(
            `SELECT 1 FROM import_packages p, jsonb_array_elements(p.body->'parts') part WHERE part->>'id'=$1 AND part->>'sourceRevisionId'=$2 AND (part->'entityIds') ?| $3::text[] LIMIT 1`,
            [e.partId, e.sourceRevisionId, entityIds],
          )
        ).rows[0]
      : null;
    if (
      !(
        part ||
        (e.featureId && feature.some((r) => r.body.sourceKey === e.featureId))
      )
    )
      throw new AppError(
        422,
        "EVIDENCE_ASSOCIATION",
        "The locator must identify a source feature or document part associated with this property.",
      );
  }
}
export async function changeAssociation(input: {
  id?: string;
  fromId: string;
  toId: string;
  relationship: PropertyAssociation["relationship"];
  status: PropertyAssociation["status"];
  expectedRevision: number;
  expectedFromRevision: number;
  expectedToRevision: number;
  evidence: SourceLocator[];
  reason: string;
}) {
  return transaction(async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('physical-area-recording',0))",
    );
    const from = await physicalFeature(input.fromId, client);
    const target =
      input.relationship === "detailed_record" ||
      input.relationship === "shared_space"
        ? (
            await client.query(
              "SELECT id,site_id,revision,body FROM registry_records WHERE id=$1 AND revision>0",
              [input.toId],
            )
          ).rows[0]
        : await physicalFeature(input.toId, client);
    if (!target) notFound("Related property not found.");
    if (
      target.site_id &&
      target.site_id !== (await getArea(from.areaId)).siteId
    )
      throw new AppError(
        422,
        "PLACEMENT_REQUIRED",
        "Detailed records in another site need an evidenced placement bridge before they can join this property.",
      );
    if (from.id === input.toId)
      throw new AppError(
        422,
        "RELATIONSHIP",
        "Choose distinct representations.",
      );
    if (
      from.revision !== input.expectedFromRevision ||
      target.revision !== input.expectedToRevision
    )
      conflict(
        "A related property changed. Refresh before reviewing its association.",
      );
    if (
      input.relationship === "occupies_parcel" &&
      (from.kind !== "building" || target.kind !== "parcel")
    )
      throw new AppError(
        422,
        "RELATIONSHIP",
        "An occupation association links a building to a recorded parcel.",
      );
    const targetWorld =
      target.worldStatus ?? (target.body?.synthetic ? "synthetic" : "observed");
    if (
      ["synthetic", "hypothetical"].includes(from.worldStatus) !==
      ["synthetic", "hypothetical"].includes(targetWorld)
    )
      throw new AppError(
        422,
        "WORLD_STATUS",
        "Synthetic or hypothetical representations cannot be confirmed as the same real property.",
      );
    await validateLocators(input.evidence, [from.id, input.toId], client);
    const old = (
      await client.query(
        "SELECT body FROM property_associations WHERE from_id=$1 AND to_id=$2 AND relationship=$3 FOR UPDATE",
        [from.id, input.toId, input.relationship],
      )
    ).rows[0]?.body as PropertyAssociation | undefined;
    if ((old?.revision ?? 0) !== input.expectedRevision)
      conflict("Association changed. Reopen its evidence.");
    const a: PropertyAssociation = {
      id: old?.id ?? randomUUID(),
      revision: (old?.revision ?? 0) + 1,
      fromId: from.id,
      toId: input.toId,
      relationship: input.relationship,
      status: input.status,
      evidence: input.evidence,
      reason: input.reason,
      actor: "local-operator",
      updatedAt: new Date().toISOString(),
      fromRevision: from.revision,
      toRevision: target.revision,
    };
    await client.query(
      "INSERT INTO property_associations(id,from_id,to_id,relationship,revision,status,body) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(from_id,to_id,relationship) DO UPDATE SET revision=$5,status=$6,body=$7",
      [a.id, a.fromId, a.toId, a.relationship, a.revision, a.status, a],
    );
    await client.query(
      "INSERT INTO property_association_revisions(association_id,revision,body) VALUES($1,$2,$3)",
      [a.id, a.revision, a],
    );
    return a;
  });
}
export async function checkAssociations(
  featureIds: string[],
  client?: PoolClient,
) {
  const sql =
    "SELECT body FROM property_associations WHERE relationship='occupies_parcel' AND from_id=ANY($1::uuid[]) ORDER BY id";
  const rows = (
    await (client ? client.query(sql, [featureIds]) : query(sql, [featureIds]))
  ).rows;
  return rows.map(({ body: a }) => ({
    id: a.id,
    buildingId: a.fromId,
    parcelId: a.toId,
    status: a.status === "suggested" ? "candidate" : a.status,
    revision: a.revision,
    evidence: a.evidence,
    fromRevision: a.fromRevision,
    toRevision: a.toRevision,
  }));
}
export async function geographicGeometry(
  geometry: AreaGeometry,
  areaId: string,
): Promise<AreaGeometry> {
  return geographicGeometryInArea(geometry, await getArea(areaId));
}
async function geographicGeometryInArea(
  geometry: AreaGeometry,
  area: Awaited<ReturnType<typeof getArea>>,
): Promise<AreaGeometry> {
  if (!area.reference)
    throw new AppError(
      422,
      "PLACEMENT_REQUIRED",
      "This area has no geographic placement.",
    );
  const ref = area.reference;
  const r = await query(
    "SELECT ST_AsGeoJSON(ST_Transform(ST_SetSRID(ST_Translate(ST_GeomFromGeoJSON($1),$2::double precision,$3::double precision),$4::integer),4326),9,0) value",
    [
      JSON.stringify(geometry),
      ...ref.origin,
      Number(ref.analysisCrs.split(":")[1]),
    ],
  );
  return JSON.parse(r.rows[0].value);
}
export async function enrichFindings(
  findings: AreaFinding[],
  features: PhysicalFeature[],
  areaId: string,
) {
  return Promise.all(
    findings.map(async (f) => ({
      ...f,
      geographicGeometry: f.geometry
        ? await geographicGeometry(f.geometry, areaId)
        : undefined,
      participants: features.filter((p) => f.featureIds.includes(p.id)),
      evidence:
        f.evidence ??
        features
          .filter((p) => f.featureIds.includes(p.id))
          .flatMap((p) => p.evidence),
      inputRevisions: features
        .filter((p) => f.featureIds.includes(p.id))
        .map((p) => ({
          featureId: p.id,
          revision: p.revision,
          sourceRevisionId: p.sourceRevisionId,
        })),
    })),
  );
}
const recordFrom = (r: any): RegistryRecord => ({
  ...r.body,
  id: r.id,
  siteId: r.site_id,
  identifier: r.identifier,
  revision: r.revision,
});
export async function dossierSources(
  sourceIds: string[],
  evidence: SourceLocator[],
) {
  return (
    await query(
      "SELECT id,name,sha256,revision,profile,created_at FROM sources WHERE id=ANY($1::uuid[]) ORDER BY created_at",
      [[...new Set(sourceIds)]],
    )
  ).rows.map((r) => ({
    id: r.id,
    name: r.name,
    sha256: r.sha256,
    revision: r.revision,
    profile: r.profile,
    createdAt: new Date(r.created_at).toISOString(),
    url: `/api/v1/sources/${r.id}/file`,
    evidence: evidence.filter((e) => e.sourceRevisionId === r.id),
  }));
}
export async function buildingDossier(id: string): Promise<BuildingDossier> {
  const building = await physicalFeature(id),
    area = await getArea(building.areaId);
  const associations = (
    await query(
      "SELECT body FROM property_associations WHERE from_id=$1 OR to_id=$1 ORDER BY id",
      [id],
    )
  ).rows.map((r) => r.body as PropertyAssociation);
  const parcelRows = (
    await query(
      `SELECT DISTINCT p.body FROM physical_features p,physical_features b WHERE b.id=$1 AND p.revision>0 AND p.body->>'kind'='parcel' AND (p.id IN (SELECT to_id FROM property_associations WHERE from_id=$1 AND relationship='occupies_parcel' AND status<>'rejected') OR ST_Intersects(p.geographic_geometry,b.geographic_geometry)) LIMIT 100`,
      [id],
    )
  ).rows;
  const parcels = parcelRows.map((r) => {
    const a = associations.find(
      (a) =>
        a.fromId === id &&
        a.toId === r.body.id &&
        a.relationship === "occupies_parcel",
    );
    return {
      feature: r.body,
      association: a,
      status:
        a?.status === "confirmed" &&
        a.fromRevision === building.revision &&
        a.toRevision === r.body.revision
          ? ("confirmed" as const)
          : ("suggested" as const),
    };
  });
  const records = (
    await query(
      `WITH RECURSIVE related AS (SELECT r.id FROM registry_records r WHERE r.id=$1 OR r.id IN (SELECT a.to_id FROM property_associations a JOIN registry_records t ON t.id=a.to_id WHERE a.from_id=$1 AND a.relationship IN ('detailed_record','shared_space') AND a.status='confirmed' AND (a.body->>'fromRevision')::int=$2 AND (a.body->>'toRevision')::int=t.revision) UNION SELECT l.record_id FROM registry_links l JOIN related x ON l.target_id=x.id WHERE l.kind IN ('within','floor','serves')) SELECT r.* FROM registry_records r WHERE r.id IN (SELECT id FROM related) AND r.revision>0 ORDER BY r.kind,r.ordinal`,
      [id, building.revision],
    )
  ).rows.map(recordFrom);
  const staleDetailLinks = associations.filter(
    (a) =>
      a.fromId === id &&
      a.status === "confirmed" &&
      ["detailed_record", "shared_space"].includes(a.relationship) &&
      !records.some((r) => r.id === a.toId),
  );
  const preparations = (
    await query("SELECT body FROM building_preparations WHERE building_id=$1", [
      id,
    ])
  ).rows.map(
    (r) =>
      ({
        ...r.body,
        url: legacyUrl(`/properties/${id}/prepare`),
        returnUrl: legacyUrl(
          r.body.returnUrl || `/areas/${area.id}?feature=${id}`,
        ),
      }) as PreparationCase,
  );
  const packages = (
    await query(
      `SELECT body FROM import_packages WHERE body->'features' @> $1::jsonb ORDER BY created_at DESC LIMIT 30`,
      [JSON.stringify([{ id }])],
    )
  ).rows
    .map((r) => r.body as ImportPackage)
    .map((p) => {
      const features = p.features.filter((f) => f.id === id),
        parts = p.parts.filter((part) => part.entityIds.includes(id)),
        factCandidates = p.factCandidates.filter((f) => f.entityId === id);
      const sourceRevisionIds = [
        ...new Set([
          ...features.flatMap((f) => [
            f.sourceRevisionId,
            ...f.evidence.map((e) => e.sourceRevisionId),
          ]),
          ...parts.map((p) => p.sourceRevisionId),
          ...factCandidates.flatMap((f) =>
            f.evidence.map((e) => e.sourceRevisionId),
          ),
        ]),
      ];
      return {
        ...p,
        features,
        parts,
        factCandidates,
        sourceRevisionIds,
        questions: p.questions.filter((q) => q.entityId === id),
      };
    });
  const latest = (
    await query(
      "SELECT body FROM area_check_runs WHERE area_id=$1 AND status='completed' ORDER BY created_at DESC LIMIT 1",
      [area.id],
    )
  ).rows[0]?.body;
  const staleCheck = latest
    ? latest.areaRevision !== area.revision ||
      latest.inputFingerprint !== (await currentAreaCheckFingerprint(area.id))
    : false;
  const relationshipEvidence = [
    ...associations.flatMap((a) => a.evidence),
    ...parcels.flatMap((p) => p.feature.evidence),
    ...(staleCheck ? [] : (latest?.findings ?? []))
      .filter((f: AreaFinding) => f.featureIds.includes(id))
      .flatMap((f: AreaFinding) => f.evidence ?? []),
  ];
  const parcelIdentifiers = parcels.length
    ? (
        await query<ParcelIdentifier>(
          `SELECT feature_id "parcelId",scheme,normalized_value value,issuer,evidence FROM external_identifiers WHERE feature_id=ANY($1::uuid[]) AND valid_to IS NULL AND verification_state='validated' AND scheme IN ('official_ulpin','demo_ulpin') ORDER BY feature_id,scheme,normalized_value`,
          [parcels.map((p) => p.feature.id)],
        )
      ).rows
    : [];
  const sourceIds = [
    ...new Set([
      building.sourceRevisionId,
      ...parcelIdentifiers.flatMap((p) =>
        p.evidence?.sourceRevisionId ? [p.evidence.sourceRevisionId] : [],
      ),
      ...parcels.map((p) => p.feature.sourceRevisionId),
      ...relationshipEvidence.map((e) => e.sourceRevisionId),
      ...building.evidence.map((e) => e.sourceRevisionId),
      ...packages.flatMap((p) => p.sourceRevisionIds),
      ...records.flatMap((r) => r.evidence.map((e) => e.sourceId)),
    ]),
  ];
  const sources = await dossierSources(sourceIds, [
    ...building.evidence,
    ...relationshipEvidence,
    ...packages.flatMap((p) =>
      p.factCandidates
        .filter((f) => f.entityId === id)
        .flatMap((f) => f.evidence),
    ),
  ]);
  const site = (
    await query("SELECT revision,frame FROM registry_sites WHERE id=$1", [
      area.siteId,
    ])
  ).rows[0];
  const localGeometries = records
    .filter((r) => r.footprint.length >= 3)
    .map((r) => ({
      id: r.id,
      geometry: {
        type: "Polygon" as const,
        coordinates: [[...r.footprint, r.footprint[0]]],
      },
    }));
  // Project the complete record snapshot in one database request. Per-record
  // concurrent queries exhausted the small local pool for detailed buildings.
  if (localGeometries.length && !area.reference)
    throw new AppError(
      422,
      "PLACEMENT_REQUIRED",
      "This area has no geographic placement.",
    );
  const projected = localGeometries.length
    ? (
        await query<{ id: string; geometry: AreaGeometry }>(
          `SELECT item->>'id' id, ST_AsGeoJSON(ST_Transform(ST_SetSRID(ST_Translate(ST_GeomFromGeoJSON((item->'geometry')::text),$2::double precision,$3::double precision),$4::integer),4326),9,0)::jsonb geometry FROM jsonb_array_elements($1::jsonb) item`,
          [
            JSON.stringify(localGeometries),
            ...area.reference!.origin,
            Number(area.reference!.analysisCrs.split(":")[1]),
          ],
        )
      ).rows
    : [];
  const geographicById = new Map(
    projected.map((item) => [item.id, item.geometry]),
  );
  const localById = new Map(
    localGeometries.map((item) => [item.id, item.geometry]),
  );
  const detailedScene = records.map((r) => ({
    record: r,
    localGeometry: localById.get(r.id),
    geographicGeometry: geographicById.get(r.id),
    lower: r.geometry?.lower,
    upper: r.geometry?.upper,
    verticalReference: site.frame.benchmark,
  }));

  const groups = (
    await query(
      `SELECT g.body,COALESCE((SELECT jsonb_agg(m.feature_id) FROM block_group_memberships m WHERE m.group_id=g.id),'[]') members FROM block_groups g WHERE g.area_id=$1 OR g.id IN (SELECT group_id FROM block_group_memberships WHERE feature_id=$2)`,
      [area.id, id],
    )
  ).rows.map((r) => ({ ...r.body, featureIds: r.members }));
  const representations = (
    await query(
      "SELECT p.body FROM physical_features p WHERE p.id=$1 OR EXISTS(SELECT 1 FROM property_associations a WHERE a.relationship='representation_of' AND a.status='confirmed' AND ((a.from_id=$1 AND a.to_id=p.id AND (a.body->>'fromRevision')::int=$2 AND (a.body->>'toRevision')::int=p.revision) OR (a.to_id=$1 AND a.from_id=p.id AND (a.body->>'toRevision')::int=$2 AND (a.body->>'fromRevision')::int=p.revision)))",
      [id, building.revision],
    )
  ).rows.map((r) => r.body);
  return {
    building,
    canonicalBuildingId: id,
    area,
    representations,
    associations,
    parcels,
    parcelIdentifiers,
    groups,
    records,
    detailedScene,
    sources,
    preparations,
    packages,
    check: latest
      ? { id: latest.id, areaRevision: latest.areaRevision, stale: staleCheck }
      : undefined,
    issues: (staleCheck ? [] : (latest?.findings ?? [])).filter(
      (f: AreaFinding) => f.featureIds.includes(id),
    ),
    investigations: (
      await query(
        "SELECT body FROM officer_investigations WHERE building_id=$1 ORDER BY body->>'createdAt' DESC",
        [id],
      )
    ).rows.map((r) => r.body),
    missing: [
      ...staleDetailLinks.map(
        () =>
          "A linked detailed representation changed. Review its source association before using it for this property.",
      ),
      ...(!records.some((r) => r.kind === "space")
        ? [
            "No source-linked detailed spaces have been recorded for this property. Add its plans and sections.",
          ]
        : []),
      ...(!parcels.some((p) => p.status === "confirmed")
        ? ["No evidenced parcel association has been confirmed."]
        : []),
    ],
    revisions: {
      feature: building.revision,
      area: area.revision,
      registry: site.revision,
    },
  };
}
export async function openPreparation(
  buildingId: string,
  expectedRevision: number,
): Promise<PreparationCase> {
  return transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `preparation:${buildingId}`,
    ]);
    const building = await physicalFeature(buildingId, client);
    if (building.kind !== "building")
      throw new AppError(
        422,
        "BUILDING_REQUIRED",
        "Choose a building to prepare detailed spaces.",
      );
    const old = (
      await client.query(
        "SELECT body FROM building_preparations WHERE building_id=$1",
        [buildingId],
      )
    ).rows[0];
    if (old)
      return {
        ...old.body,
        url: legacyUrl(`/properties/${buildingId}/prepare`),
        returnUrl: legacyUrl(
          old.body.returnUrl ||
            `/areas/${building.areaId}?feature=${buildingId}`,
        ),
      };
    if (building.revision !== expectedRevision) conflict();
    const area = await getArea(building.areaId),
      site = (
        await client.query("SELECT * FROM registry_sites WHERE id=$1", [
          area.siteId,
        ])
      ).rows[0];
    const caseId = randomUUID(),
      id = randomUUID(),
      packageId = randomUUID(),
      now = new Date().toISOString();
    await client.query(
      "INSERT INTO cases(id,name,description,frame,site_id) VALUES($1,$2,$3,$4,$5)",
      [
        caseId,
        `${building.name} · details`,
        "Preparation for the same permanent building identity. No title or rights are inferred.",
        site.frame,
        site.id,
      ],
    );
    const pkg: ImportPackage = {
      id: packageId,
      schemaVersion: "ulpin-canonical/2",
      areaId: area.id,
      name: `${building.name} · related documents`,
      datasetNamespace: building.datasetNamespace,
      revision: 1,
      state: "NEEDS_INPUT",
      sourceRevisionIds: [
        ...new Set([
          building.sourceRevisionId,

          ...building.evidence.map((e) => e.sourceRevisionId),
        ]),
      ],
      features: [building],
      questions: [],
      factCandidates: [],
      parts: [],
      warnings: [
        "Detailed spaces require a source outline, explicit levels and evidenced placement.",
      ],
      createdAt: now,
    };
    await client.query(
      "INSERT INTO import_packages(id,area_id,case_id,revision,state,body,operation_key) VALUES($1,$2,$3,1,$4,$5,$6)",
      [
        packageId,
        area.id,
        caseId,
        pkg.state,
        pkg,
        `building-preparation:${buildingId}`,
      ],
    );
    await client.query(
      "INSERT INTO import_package_revisions(package_id,revision,body) VALUES($1,1,$2)",
      [packageId, pkg],
    );
    const prep: PreparationCase = {
      id,
      buildingId,
      areaId: area.id,
      caseId,
      packageId,
      revision: 1,
      buildingRevision: building.revision,
      placement: {
        id: randomUUID(),
        revision: 1,
        sourceFrame: site.frame.id,
        targetFrame: site.frame.id,
        method: "canonical_area",
        matrix: [1, 0, 0, 1, 0, 0],
        verticalReference: site.frame.benchmark,
        verticalOffset: null,
        evidence: building.evidence,
        status: "unresolved",
      },
      url: legacyUrl(`/properties/${buildingId}/prepare`),
      returnUrl: legacyUrl(`/areas/${area.id}?feature=${buildingId}`),
    };
    await client.query(
      "INSERT INTO building_preparations(id,building_id,case_id,package_id,body) VALUES($1,$2,$3,$4,$5)",
      [id, buildingId, caseId, packageId, prep],
    );
    await client.query(
      "INSERT INTO building_preparation_revisions(preparation_id,revision,body) VALUES($1,1,$2)",
      [id, prep],
    );
    return prep;
  });
}
export async function createBlockGroup(
  input: Omit<BlockGroup, "id" | "geographicBoundary"> & {
    expectedRevision: number;
  },
) {
  const area = await getArea(input.areaId);
  const operationKey = fingerprint({
    areaId: input.areaId,
    name: input.name,
    kind: input.kind,
    authority: input.authority,
    code: input.code,
    boundary: input.boundary,
    evidence: input.evidence,
    featureIds: [...input.featureIds].sort(),
  });
  return transaction(async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('physical-area-recording',0))",
    );
    const prior = (
      await client.query(
        "SELECT body FROM block_groups WHERE operation_key=$1",
        [operationKey],
      )
    ).rows[0];
    if (prior) return prior.body as BlockGroup;
    if (
      (
        await client.query("SELECT revision FROM map_areas WHERE id=$1", [
          area.id,
        ])
      ).rows[0].revision !== input.expectedRevision
    )
      conflict();
    const valid = (
      await client.query(
        "SELECT ST_IsValid(g) AND GeometryType(g) IN ('POLYGON','MULTIPOLYGON') AND ST_Area(g)>0 AND ST_NPoints(g)<=10000 valid FROM (SELECT ST_GeomFromGeoJSON($1) g) s",
        [JSON.stringify(input.boundary)],
      )
    ).rows[0]?.valid;
    if (!valid)
      throw new AppError(
        422,
        "GROUP_BOUNDARY",
        "Supply a valid bounded polygon for this group.",
      );
    await validateLocators(input.evidence, input.featureIds, client);
    for (const id of input.featureIds) await physicalFeature(id, client);
    const group: BlockGroup = {
      ...input,
      id: randomUUID(),
      revision: 1,
      geographicBoundary: await geographicGeometry(input.boundary, area.id),
    };
    await client.query(
      "INSERT INTO block_groups(id,area_id,body,operation_key) VALUES($1,$2,$3,$4)",
      [group.id, group.areaId, group, operationKey],
    );
    await client.query(
      "INSERT INTO block_group_revisions(group_id,revision,body) VALUES($1,1,$2)",
      [group.id, group],
    );
    for (const id of new Set(input.featureIds))
      await client.query(
        "INSERT INTO block_group_memberships(group_id,feature_id) VALUES($1,$2)",
        [group.id, id],
      );
    return group;
  });
}
