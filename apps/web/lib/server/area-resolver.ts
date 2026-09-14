import { randomUUID } from "node:crypto";
import { query, transaction } from "./db";
import { getArea } from "./areas";
import { conflict, notFound, AppError } from "./errors";

export async function syncLegacyIdentifiers() {
  // A reviewed stored association is a resolver binding, never an assertion of national issuance.
  await query(`INSERT INTO external_identifiers(id,scheme,normalized_value,issuer,record_id,evidence,verification_state)
    SELECT gen_random_uuid(),'official_ulpin',upper(trim(r.body->>'officialUlpin')),'legacy reviewed registry',r.id,
    jsonb_build_object('sourceBindings',r.body->'evidence','association','reviewed registry assertion; issuing authority not independently verified'),'validated'
    FROM registry_records r WHERE r.revision>0 AND length(trim(COALESCE(r.body->>'officialUlpin','')))>0
    ON CONFLICT DO NOTHING`);
  await query(`UPDATE external_identifiers e SET valid_to=now() FROM registry_records r
    WHERE e.record_id=r.id AND e.issuer='legacy reviewed registry' AND e.valid_to IS NULL
    AND e.normalized_value<>upper(trim(COALESCE(r.body->>'officialUlpin','')))`);
  await query(`UPDATE external_identifiers e SET valid_to=NULL FROM registry_records r
    WHERE e.record_id=r.id AND e.issuer='legacy reviewed registry' AND e.valid_to IS NOT NULL
    AND e.normalized_value=upper(trim(COALESCE(r.body->>'officialUlpin','')))`);
}
export async function resolveAreaIdentifier(identifier: string) {
  await syncLegacyIdentifiers();
  const value = identifier.trim(),
    normalized = value.toUpperCase();
  const [physical, registry, sites] = await Promise.all([
    query(
      `SELECT DISTINCT f.* FROM physical_features f WHERE f.revision>0 AND
      (upper(f.identifier)=$1 OR upper(f.id::text)=$1 OR f.id IN (SELECT feature_id FROM external_identifiers WHERE normalized_value=$1 AND valid_to IS NULL AND verification_state='validated'))`,
      [normalized],
    ),
    query(
      `SELECT DISTINCT r.* FROM registry_records r WHERE r.revision>0 AND
      (upper(r.identifier)=$1 OR upper(r.id::text)=$1 OR r.id IN (SELECT record_id FROM external_identifiers WHERE normalized_value=$1 AND valid_to IS NULL AND verification_state='validated') OR r.id IN (SELECT record_id FROM registry_aliases WHERE upper(alias)=$1))`,
      [normalized],
    ),
    query(
      "SELECT s.*,a.id area_id,a.reference area_reference FROM registry_sites s LEFT JOIN map_areas a ON a.site_id=s.id WHERE upper(s.identifier)=$1 OR upper(s.id::text)=$1",
      [normalized],
    ),
  ]);
  const matches: Record<string, unknown>[] = [];
  for (const row of physical.rows) {
    const area = await getArea(row.area_id),
      evidence = (
        await query(
          "SELECT scheme,normalized_value,issuer,evidence,verification_state FROM external_identifiers WHERE feature_id=$1 AND normalized_value=$2 AND valid_to IS NULL",
          [row.id, normalized],
        )
      ).rows;
    // Spatial intersections are context, not inferred legal parcel ownership associations.
    const related =
      row.body.kind === "parcel"
        ? (
            await query(
              "SELECT body FROM physical_features WHERE area_id=$1 AND revision>0 AND body->>'kind'='building' AND ST_Intersects(geometry,ST_SetSRID(ST_GeomFromGeoJSON($2),0))",
              [row.area_id, JSON.stringify(row.body.geometry)],
            )
          ).rows.map((r) => ({
            feature: r.body,
            relationship:
              "horizontal intersection; parcel association unverified",
          }))
        : [];
    matches.push({
      kind: "physical_feature",
      feature: row.body,
      areaIds: [area.id],
      area,
      matchEvidence: evidence.length
        ? evidence
        : [{ scheme: "app_identifier", value }],
      relatedBuildings: related,
      parentParcels: [],
      selectionGeometry: row.body.geographicGeometry,
      contextExtent: area.geographicExtent,
      url: `/areas/${area.id}?feature=${encodeURIComponent(row.id)}`,
    });
  }
  for (const row of registry.rows) {
    const area = (
      await query("SELECT id FROM map_areas WHERE site_id=$1", [row.site_id])
    ).rows[0];
    const links = (
      await query(
        "SELECT r.*,l.kind relationship FROM registry_links l JOIN registry_records r ON r.id=l.target_id WHERE l.record_id=$1 AND r.revision>0",
        [row.id],
      )
    ).rows;
    const related = (
      await query(
        "SELECT r.* FROM registry_links l JOIN registry_records r ON r.id=l.record_id WHERE l.target_id=$1 AND r.kind='building' AND r.revision>0",
        [row.id],
      )
    ).rows;
    matches.push({
      kind: "registry_record",
      record: {
        ...row.body,
        id: row.id,
        identifier: row.identifier,
        siteId: row.site_id,
        revision: row.revision,
      },
      areaIds: area ? [area.id] : [],
      parentParcels: links
        .filter((r) => r.kind === "parcel")
        .map((r) => ({ ...r.body, id: r.id, identifier: r.identifier })),
      relatedBuildings: related.map((r) => ({
        ...r.body,
        id: r.id,
        identifier: r.identifier,
      })),
      matchEvidence: (
        await query(
          "SELECT scheme,issuer,evidence,verification_state FROM external_identifiers WHERE record_id=$1 AND normalized_value=$2 AND valid_to IS NULL",
          [row.id, normalized],
        )
      ).rows,
      url: `/registry/${encodeURIComponent(row.identifier)}`,
    });
  }
  for (const row of sites.rows)
    matches.push({
      kind: "site",
      site: { id: row.id, identifier: row.identifier, name: row.name },
      areaIds: row.area_id ? [row.area_id] : [],
      matchEvidence: [{ scheme: "app_identifier", value }],
      relatedBuildings: [],
      parentParcels: [],
      url: row.area_reference ? `/areas/${row.area_id}` : `/sites/${row.id}`,
    });
  return {
    status:
      matches.length === 0
        ? "not_found"
        : matches.length === 1
          ? "matched"
          : "ambiguous",
    message:
      matches.length === 0
        ? "Not present in loaded data."
        : matches.length > 1
          ? "Several loaded records assert this identifier. Choose a match and inspect its evidence."
          : undefined,
    matches,
  };
}
export async function bindExternalIdentifier(input: {
  featureId?: string;
  recordId?: string;
  scheme: "official_ulpin" | "source_property_id" | "nyc_bin";
  value: string;
  issuer: string;
  sourceId: string;
  locator: string;
  expectedRevision: number;
}) {
  return transaction(async (client) => {
    const isPhysical = !!input.featureId,
      target = input.featureId || input.recordId!;
    const row =
      (
        await client.query(
          isPhysical
            ? "SELECT * FROM physical_features WHERE id=$1 FOR UPDATE"
            : "SELECT * FROM registry_records WHERE id=$1 FOR UPDATE",
          [target],
        )
      ).rows[0] || notFound();
    if (row.revision === 0 || row.revision !== input.expectedRevision)
      conflict("Bind identifiers only to the current recorded revision.");
    if (
      input.scheme === "official_ulpin" &&
      (isPhysical ? row.body.kind : row.kind) !== "parcel"
    )
      throw new AppError(
        422,
        "PARCEL_REQUIRED",
        "An official ULPIN assertion must target a parcel. A building source ID is a separate identifier.",
      );
    const areaId = isPhysical ? row.area_id : row.site_id;
    const source = (
      await client.query(
        "SELECT s.id FROM sources s JOIN cases c ON c.id=s.case_id JOIN map_areas a ON a.site_id=c.site_id WHERE s.id=$1 AND a.id=$2",
        [input.sourceId, areaId],
      )
    ).rows[0];
    if (!source)
      throw new AppError(
        422,
        "EVIDENCE_REQUIRED",
        "The identifier must cite a source belonging to the target area.",
      );
    const normalized = input.value.trim().toUpperCase();
    const evidence = {
      sourceRevisionId: input.sourceId,
      locator: input.locator,
      acceptedBy: "local operator",
      meaning:
        "Identifier association; not independent certification of issuance",
    };
    await client.query(
      "INSERT INTO external_identifiers(id,scheme,normalized_value,issuer,record_id,feature_id,source_id,evidence,verification_state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'validated') ON CONFLICT DO NOTHING",
      [
        randomUUID(),
        input.scheme,
        normalized,
        input.issuer,
        input.recordId,
        input.featureId,
        input.sourceId,
        evidence,
      ],
    );
    return { scheme: input.scheme, value: normalized, evidence };
  });
}
