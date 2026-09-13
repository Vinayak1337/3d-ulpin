import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import type {
  RegistryBody,
  RegistryRecord,
  RegistrySite,
  RegistryDraft,
  RegistryReview,
  RegistryDetail,
  RegistryQuery,
  BuildResult,
  SourceRevision,
} from "@ulpin/contracts";
import { query, transaction } from "./db";
import { settings } from "./config";
import { AppError, conflict, notFound } from "./errors";
import { assertRegistrySourceFrame } from './registry-import-evidence';
import { propertyIdentifier } from "../identifiers";
import { fingerprint, sourceFrom } from "./domain";
import {
  frameSchema,
  footprintSchema,
  unitSchema,
  idSchema,
  pointSchema,
  finite,
} from "./validation";

const binding = z
  .object({ sourceId: idSchema, locator: z.string().trim().min(1).max(500) })
  .strict();
export function openRegistryRing(ring: RegistryBody["footprint"]) {
  const first = ring[0],
    last = ring.at(-1);
  return ring.length > 3 && first[0] === last?.[0] && first[1] === last?.[1]
    ? ring.slice(0, -1)
    : ring;
}
export const recordBodySchema = z
  .object({
    alias: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(120),
    kind: z.enum(["parcel", "building", "floor", "space"]),
    use: z.enum(["apartment", "common", "basement", "utility"]).optional(),
    footprint: footprintSchema,
    geometry: unitSchema.strict().optional(),
    links: z
      .array(
        z
          .object({
            targetId: idSchema,
            type: z.enum(["within", "floor", "serves", "crosses"]),
          })
          .strict(),
      )
      .max(30),
    rights: z
      .array(
        z
          .object({
            party: z.string().trim().min(1).max(150),
            type: z.enum(["ownership_claim", "shared_use", "easement"]),
            evidence: binding,
          })
          .strict(),
      )
      .max(30),
    evidence: z.array(binding).max(30),
    officialUlpin: z.string().trim().min(1).max(100).optional(),
    synthetic: z.boolean(),
  })
  .strict();
export const editDraftSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    recordId: idSchema,
    body: recordBodySchema,
  })
  .strict();
export const querySchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("point"),
      frame: frameSchema.strict(),
      point: pointSchema,
    })
    .strict(),
  z
    .object({
      mode: z.literal("volume"),
      frame: frameSchema.strict(),
      footprint: footprintSchema,
      lower: finite,
      upper: finite,
    })
    .strict(),
]);
const siteFrom = (r: any): RegistrySite => ({
  id: r.id,
  identifier: r.identifier,
  name: r.name,
  frame: r.frame,
  revision: r.revision,
  synthetic: r.synthetic,
});
const recordFrom = (r: any): RegistryRecord => ({
  ...r.body,
  id: r.id,
  siteId: r.site_id,
  identifier: r.identifier,
  revision: r.revision,
});
const draftFrom = (r: any): RegistryDraft => ({
  id: r.id,
  siteId: r.site_id,
  caseId: r.case_id,
  revision: r.revision,
  status: r.status,
  records: r.records,
  createdAt: new Date(r.created_at).toISOString(),
});
export const ringGeometry = (points: number[][]) =>
  JSON.stringify({ type: "Polygon", coordinates: [[...points, points[0]]] });
export async function registryGeo<T>(
  operation: "check" | "query",
  input: unknown,
): Promise<T> {
  const response = await fetch(
    `${settings.geoUrl}/internal/registry/${operation}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.geoToken}`,
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(30000),
    },
  );
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new AppError(
      response.status === 422 ? 422 : 503,
      "REGISTRY_PROCESSING",
      error.detail || "Registry processor is unavailable.",
    );
  }
  return response.json();
}
export async function listSites() {
  return (await query("SELECT * FROM registry_sites ORDER BY name")).rows.map(
    siteFrom,
  );
}
export async function createSite(
  name: string,
  frame: RegistrySite["frame"],
  synthetic = true,
) {
  const id = randomUUID();
  return siteFrom(
    (
      await query(
        "INSERT INTO registry_sites(id,identifier,name,frame,synthetic) VALUES($1,$2,$3,$4,$5) RETURNING *",
        [id, propertyIdentifier(id), name, frame, synthetic],
      )
    ).rows[0],
  );
}
async function siteRow(client: PoolClient, id: string, lock = false) {
  return (
    (
      await client.query(
        `SELECT * FROM registry_sites WHERE id=$1 ${lock ? "FOR UPDATE" : ""}`,
        [id],
      )
    ).rows[0] ?? notFound("Site not found.")
  );
}
async function currentRecords(client: PoolClient, id: string) {
  return (
    await client.query(
      "SELECT * FROM registry_records WHERE site_id=$1 AND revision>0 ORDER BY kind,ordinal",
      [id],
    )
  ).rows.map(recordFrom);
}
export async function siteDetail(id: string): Promise<RegistryDetail> {
  return transaction(async (client) => {
    await client.query(
      "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY",
    );
    const site = siteFrom(await siteRow(client, id));
    const records = await currentRecords(client, id);
    const sources = (
      await client.query(
        "SELECT s.* FROM sources s JOIN cases c ON c.id=s.case_id WHERE c.site_id=$1 ORDER BY s.created_at",
        [id],
      )
    ).rows.map(sourceFrom);
    const drafts = (
      await client.query(
        "SELECT * FROM registry_drafts WHERE site_id=$1 ORDER BY created_at DESC",
        [id],
      )
    ).rows.map(draftFrom);
    return { site, records, sources, drafts };
  });
}
export async function resolveRecord(identifier: string) {
  return transaction(async (client) => {
    await client.query(
      "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY",
    );
    const row =
      (
        await client.query(
          `SELECT r.* FROM registry_records r WHERE r.revision>0 AND (r.identifier=$1 OR r.id::text=$1 OR r.id IN(SELECT record_id FROM registry_aliases WHERE alias=$1))`,
          [identifier],
        )
      ).rows[0] ?? notFound("No current registry record has this identifier.");
    const record = recordFrom(row);
    const history = (
      await client.query(
        "SELECT revision,body,site_revision,created_at FROM registry_revisions WHERE record_id=$1 ORDER BY revision DESC",
        [row.id],
      )
    ).rows;
    return {
      record,
      site: siteFrom(await siteRow(client, row.site_id)),
      history,
    };
  });
}
async function reserveRecord(
  client: PoolClient,
  site: RegistrySite,
  body: RegistryBody,
): Promise<RegistryRecord> {
  const id = randomUUID(),
    prefix = { parcel: "P", building: "B", floor: "F", space: "S" }[body.kind];
  const ordinal = Number(
    (
      await client.query(
        "SELECT COALESCE(MAX(ordinal),0)+1 AS n FROM registry_records WHERE site_id=$1 AND kind=$2",
        [site.id, body.kind],
      )
    ).rows[0].n,
  );
  const identifier = `${site.identifier}:${prefix}${String(ordinal).padStart(3, "0")}`;
  const normalized = {
    ...body,
    footprint: openRegistryRing(body.footprint),
    geometry: body.geometry
      ? {
          ...body.geometry,
          footprint: openRegistryRing(body.geometry.footprint),
          id,
          alias: body.alias,
          name: body.name,
        }
      : undefined,
  };
  await client.query(
    "INSERT INTO registry_records(id,site_id,kind,ordinal,identifier,body) VALUES($1,$2,$3,$4,$5,$6)",
    [id, site.id, body.kind, ordinal, identifier, normalized],
  );
  return { ...normalized, id, siteId: site.id, identifier, revision: 0 };
}
export async function createRegistryDraft(
  siteId: string,
  recordId?: string,
  body?: RegistryBody,
  requestKey?: string,
) {
  return transaction(async (client) => {
    const site = siteFrom(await siteRow(client, siteId, true));
    if (requestKey) {
      const previous = (
        await client.query(
          "SELECT * FROM registry_drafts WHERE site_id=$1 AND request_key=$2",
          [siteId, requestKey],
        )
      ).rows[0];
      if (previous) return draftFrom(previous);
    }
    let record: RegistryRecord;
    if (recordId) {
      const row =
        (
          await client.query(
            "SELECT * FROM registry_records WHERE id=$1 AND site_id=$2 AND revision>0",
            [recordId, siteId],
          )
        ).rows[0] ?? notFound();
      record = recordFrom(row);
      const existing = (
        await client.query(
          "SELECT * FROM registry_drafts WHERE site_id=$1 AND status='draft' AND records @> $2::jsonb ORDER BY created_at DESC LIMIT 1",
          [siteId, JSON.stringify([{ id: recordId }])],
        )
      ).rows[0];
      if (existing) return draftFrom(existing);
    } else {
      if (!body)
        throw new AppError(
          422,
          "RECORD_REQUIRED",
          "Provide a new record or an existing target.",
        );
      if (!requestKey)
        throw new AppError(
          422,
          "REQUEST_KEY_REQUIRED",
          "New records require a persistent requestKey UUID for safe retries.",
        );
      record = await reserveRecord(client, site, body);
    }
    const caseId = randomUUID(),
      id = randomUUID();
    await client.query(
      "INSERT INTO cases(id,name,description,frame,site_id,archived) VALUES($1,$2,$3,$4,$5,true)",
      [
        caseId,
        `Draft · ${record.alias}`,
        "Registry preparation workspace; technical demo review only.",
        site.frame,
        siteId,
      ],
    );
    return draftFrom(
      (
        await client.query(
          "INSERT INTO registry_drafts(id,site_id,case_id,records,request_key) VALUES($1,$2,$3,$4,$5) RETURNING *",
          [id, siteId, caseId, JSON.stringify([record]), requestKey || null],
        )
      ).rows[0],
    );
  });
}
export async function draftDetail(id: string) {
  return draftFrom(
    (await query("SELECT * FROM registry_drafts WHERE id=$1", [id])).rows[0] ??
      notFound(),
  );
}
export async function editRegistryDraft(
  id: string,
  input: z.infer<typeof editDraftSchema>,
) {
  return transaction(async (client) => {
    const d =
      (
        await client.query(
          "SELECT * FROM registry_drafts WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0] ?? notFound();
    if (d.status !== "draft" || d.revision !== input.expectedRevision)
      conflict();
    const old =
      (d.records as RegistryRecord[]).find((r) => r.id === input.recordId) ??
      notFound();
    if (old.kind !== input.body.kind)
      throw new AppError(
        422,
        "RECORD_KIND",
        "A correction cannot change the record kind.",
      );
    const value = {
      ...input.body,
      footprint: openRegistryRing(input.body.footprint),
      id: old.id,
      siteId: old.siteId,
      identifier: old.identifier,
      revision: old.revision,
    };
    if (value.geometry) {
      value.geometry = {
        ...value.geometry,
        id: old.id,
        alias: value.alias,
        name: value.name,
        footprint: value.footprint,
      };
      if (old.geometry && old.geometry.lower !== value.geometry.lower)
        value.geometry.lowerVerified = false;
      if (old.geometry && old.geometry.upper !== value.geometry.upper)
        value.geometry.upperVerified = false;
    }
    const records = d.records.map((r: RegistryRecord) =>
      r.id === old.id ? value : r,
    );
    return draftFrom(
      (
        await client.query(
          "UPDATE registry_drafts SET records=$2,revision=revision+1 WHERE id=$1 RETURNING *",
          [id, JSON.stringify(records)],
        )
      ).rows[0],
    );
  });
}
async function evidenceChecks(
  client: PoolClient,
  site: RegistrySite,
  records: RegistryRecord[],
) {
  for (const r of records) {
    recordBodySchema.parse(bodyOnly(r));
    if (site.synthetic && r.officialUlpin)
      throw new AppError(
        422,
        "SYNTHETIC_ULPIN",
        "Synthetic records cannot assert an official parcel ULPIN.",
      );
    if (r.kind !== "space" && r.geometry)
      throw new AppError(
        422,
        "CONTEXT_VOLUME",
        "Only spatial units carry an ownership-space volume.",
      );
    for (const link of r.links) {
      const target = records.find((x) => x.id === link.targetId);
      const allowed =
        target &&
        target.id !== r.id &&
        (link.type === "floor"
          ? r.kind === "space" && target.kind === "floor"
          : link.type === "serves"
            ? r.kind === "space" && target.kind === "building"
            : link.type === "crosses"
              ? ["space", "building"].includes(r.kind) &&
                target.kind === "parcel"
              : r.kind === "floor"
                ? target.kind === "building"
                : r.kind === "building"
                  ? target.kind === "parcel"
                  : r.kind === "space" &&
                    ["building", "parcel"].includes(target.kind));
      if (!allowed)
        throw new AppError(
          422,
          "INVALID_RELATIONSHIP",
          "Choose a compatible related record in this site.",
        );
    }
    if (r.synthetic !== site.synthetic)
      throw new AppError(
        422,
        "PROVENANCE",
        "Record classification must match the site.",
      );
    if (r.kind === "space" && (!r.geometry || !r.use))
      throw new AppError(
        422,
        "SPACE_GEOMETRY",
        "A spatial unit needs geometry and a use classification.",
      );
    if (
      r.geometry &&
      (r.geometry.id !== r.id ||
        fingerprint(openRegistryRing(r.footprint)) !==
          fingerprint(openRegistryRing(r.geometry.footprint)))
    )
      throw new AppError(
        422,
        "SPACE_GEOMETRY",
        "Record and volume footprints must agree.",
      );
    if (r.geometry)
      for (const component of ["lower", "upper"] as const) {
        if (!r.geometry[`${component}Verified`]) continue;
        const b = r.geometry.bindings[component];
        const source = b
          ? (
              await client.query("SELECT inspection FROM sources WHERE id=$1", [
                b.sourceId,
              ])
            ).rows[0]
          : null;
        const row = source?.inspection?.levels?.find(
          (l: any) => l.alias === r.alias && l.locator === b?.locator,
        );
        if (
          !row ||
          row[component] !== r.geometry[component] ||
          row.benchmark !== site.frame.benchmark
        )
          throw new AppError(
            422,
            "LEVEL_EVIDENCE",
            "A verified elevation must match its bound level-source row.",
          );
      }
    const references = [
      ...r.evidence,
      ...r.rights.map((x) => x.evidence),
      ...Object.values(r.geometry?.bindings ?? {}),
    ];
    if (!r.evidence.length)
      throw new AppError(
        422,
        "EVIDENCE_REQUIRED",
        `${r.alias} needs source evidence.`,
      );
    for (const b of references) {
      if (!b) continue;
      const source = (
        await client.query(
          "SELECT s.* FROM sources s JOIN cases c ON c.id=s.case_id WHERE s.id=$1 AND c.site_id=$2",
          [b.sourceId, site.id],
        )
      ).rows[0];
      if (
        !source ||
        !(
          source.status === "ready" ||
          (source.status === "needs_input" &&
            (source.inspection?.image ||
              source.inspection?.levels?.length ||
              source.inspection?.controls?.length ||
              source.inspection?.features?.length))
        )
      )
        throw new AppError(
          422,
          "EVIDENCE_UNAVAILABLE",
          "Evidence must be a parsed source within this site. Partial sources can support valid rows or human review; verified elevations must match their bound source row.",
        );
      assertRegistrySourceFrame(site.frame,sourceFrom(source));
    }
  }
}
export function bodyOnly(r: RegistryRecord): RegistryBody {
  const {
    id: _id,
    identifier: _identifier,
    siteId: _siteId,
    revision: _revision,
    ...body
  } = r;
  if (body.geometry) {
    const {
      area: _area,
      height: _height,
      volume: _volume,
      ...spec
    } = body.geometry;
    return { ...body, geometry: spec as any };
  }
  return body;
}
export async function prepareRegistryReview(
  draftId: string,
  expectedRevision: number,
  expectedSiteRevision: number,
): Promise<RegistryReview> {
  const snapshot = await transaction(async (client) => {
    await client.query(
      "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY",
    );
    const d = draftFrom(
      (
        await client.query("SELECT * FROM registry_drafts WHERE id=$1", [
          draftId,
        ])
      ).rows[0] ?? notFound(),
    );
    const site = siteFrom(await siteRow(client, d.siteId));
    if (
      d.status !== "draft" ||
      d.revision !== expectedRevision ||
      site.revision !== expectedSiteRevision
    )
      conflict("Draft or neighbours changed. Refresh and build checks again.");
    const current = await currentRecords(client, d.siteId),
      ids = new Set(d.records.map((r) => r.id));
    const combined = [...current.filter((r) => !ids.has(r.id)), ...d.records];
    await evidenceChecks(client, site, combined);
    return { d, site, current, combined };
  });
  const inputFingerprint = fingerprint({
    validatorVersion: "registry-relationships-v2",
    records: snapshot.combined,
    frame: snapshot.site.frame,
    draftRevision: expectedRevision,
    siteRevision: expectedSiteRevision,
  });
  const result = await registryGeo<BuildResult>("check", {
    frame: snapshot.site.frame,
    validatorVersion: "registry-relationships-v2",
    records: snapshot.combined,
    inputFingerprint,
  });
  const computed = new Map(result.units.map((u) => [u.id, u]));
  const review: RegistryReview = {
    id: randomUUID(),
    draftId,
    draftRevision: expectedRevision,
    siteRevision: expectedSiteRevision,
    inputFingerprint,
    findings: result.findings,
    before: snapshot.current.filter((r) =>
      snapshot.d.records.some((x) => x.id === r.id),
    ),
    records: snapshot.d.records.map((r) => ({
      ...r,
      footprint: computed.get(r.id)?.footprint ?? openRegistryRing(r.footprint),
      geometry: computed.get(r.id) ?? r.geometry,
    })),
    committed: false,
  };
  await query(
    "INSERT INTO registry_reviews(id,draft_id,body) VALUES($1,$2,$3)",
    [review.id, draftId, review],
  );
  return review;
}
export async function commitRegistryReview(
  id: string,
  acknowledgement: string,
): Promise<RegistryReview> {
  return transaction(async (client) => {
    const initial =
      (await client.query("SELECT * FROM registry_reviews WHERE id=$1", [id]))
        .rows[0] ?? notFound();
    const draft = (
      await client.query("SELECT * FROM registry_drafts WHERE id=$1", [
        initial.draft_id,
      ])
    ).rows[0];
    const site = siteFrom(await siteRow(client, draft.site_id, true));
    const d = (
      await client.query(
        "SELECT * FROM registry_drafts WHERE id=$1 FOR UPDATE",
        [draft.id],
      )
    ).rows[0];
    const row = (
      await client.query(
        "SELECT * FROM registry_reviews WHERE id=$1 FOR UPDATE",
        [id],
      )
    ).rows[0];
    const review = row.body as RegistryReview;
    if (row.committed)
      return {
        ...review,
        committed: true,
        acknowledgement: row.acknowledgement,
      };
    if (
      d.status !== "draft" ||
      d.revision !== review.draftRevision ||
      site.revision !== review.siteRevision
    )
      conflict(
        "Draft or neighbours changed. Build and review a fresh snapshot.",
      );
    if (review.findings.some((f) => f.severity === "error"))
      throw new AppError(
        422,
        "BLOCKING_FINDINGS",
        "Resolve blocking findings before recording.",
      );
    if (
      review.findings.some((f) => f.severity === "warning") &&
      !acknowledgement.trim()
    )
      throw new AppError(
        422,
        "ACKNOWLEDGEMENT_REQUIRED",
        "Explain why the remaining warnings are acknowledged.",
      );
    const current = await currentRecords(client, site.id),
      ids = new Set((d.records as RegistryRecord[]).map((r) => r.id));
    const combined = [...current.filter((r) => !ids.has(r.id)), ...d.records];
    if (
      fingerprint({
        validatorVersion: "registry-relationships-v2",
        records: combined,
        frame: site.frame,
        draftRevision: d.revision,
        siteRevision: site.revision,
      }) !== review.inputFingerprint
    )
      conflict("Review inputs changed.");
    await evidenceChecks(client, site, combined);
    const next = site.revision + 1;
    for (const record of review.records) {
      const body = { ...record };
      delete (body as any).id;
      delete (body as any).siteId;
      delete (body as any).identifier;
      delete (body as any).revision;
      const revision = record.revision + 1;
      await client.query(
        "UPDATE registry_records SET body=$2,revision=$3,footprint=ST_SetSRID(ST_GeomFromGeoJSON($4),0) WHERE id=$1",
        [record.id, body, revision, ringGeometry(record.footprint)],
      );
      await client.query(
        "INSERT INTO registry_revisions(record_id,revision,body,site_revision) VALUES($1,$2,$3,$4)",
        [record.id, revision, body, next],
      );
      await client.query("DELETE FROM registry_links WHERE record_id=$1", [
        record.id,
      ]);
      for (const link of record.links)
        await client.query(
          "INSERT INTO registry_links(record_id,target_id,kind) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
          [record.id, link.targetId, link.type],
        );
      await client.query("DELETE FROM registry_rights WHERE record_id=$1", [
        record.id,
      ]);
      for (const [i, right] of record.rights.entries())
        await client.query(
          "INSERT INTO registry_rights(record_id,ordinal,body) VALUES($1,$2,$3)",
          [record.id, i, right],
        );
    }
    await client.query("UPDATE registry_sites SET revision=$2 WHERE id=$1", [
      site.id,
      next,
    ]);
    await client.query(
      "UPDATE registry_drafts SET status='recorded' WHERE id=$1",
      [d.id],
    );
    await client.query(
      "UPDATE registry_reviews SET committed=true,acknowledgement=$2 WHERE id=$1",
      [id, acknowledgement.trim()],
    );
    return {
      ...review,
      committed: true,
      acknowledgement: acknowledgement.trim(),
    };
  });
}
export async function registryQuery(
  siteId: string,
  input: z.infer<typeof querySchema>,
): Promise<RegistryQuery> {
  const snapshot = await transaction(async (client) => {
    await client.query(
      "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY",
    );
    const site = siteFrom(await siteRow(client, siteId));
    if (fingerprint(site.frame) !== fingerprint(input.frame))
      throw new AppError(
        422,
        "FRAME_MISMATCH",
        "Use this site’s coordinate frame and vertical benchmark.",
      );
    let rows;
    if (input.mode === "point")
      rows = (
        await client.query(
          "SELECT * FROM registry_records WHERE site_id=$1 AND kind='space' AND revision>0 AND ST_Intersects(footprint,ST_SetSRID(ST_MakePoint($2,$3),0))",
          [siteId, ...input.point],
        )
      ).rows;
    else {
      if (input.upper <= input.lower)
        throw new AppError(
          422,
          "VERTICAL_LIMITS",
          "Upper elevation must exceed lower elevation.",
        );
      const valid = (
        await client.query(
          "SELECT ST_IsValid(g) AND ST_Area(g)>0 AS valid FROM (SELECT ST_SetSRID(ST_GeomFromGeoJSON($1),0) g) s",
          [ringGeometry(input.footprint)],
        )
      ).rows[0].valid;
      if (!valid)
        throw new AppError(
          422,
          "INVALID_POLYGON",
          "Draw a valid, non-intersecting polygon.",
        );
      rows = (
        await client.query(
          "SELECT * FROM registry_records WHERE site_id=$1 AND kind='space' AND revision>0 AND ST_Intersects(footprint,ST_SetSRID(ST_GeomFromGeoJSON($2),0))",
          [siteId, ringGeometry(input.footprint)],
        )
      ).rows;
    }
    return { site, records: rows.map(recordFrom) };
  });
  const result = await registryGeo<{ results: RegistryQuery["results"] }>(
    "query",
    {
      ...input,
      frame: snapshot.site.frame,
      queryFrame: input.frame,
      records: snapshot.records,
    },
  );
  return {
    siteId,
    registryRevision: snapshot.site.revision,
    frame: snapshot.site.frame,
    synthetic: snapshot.site.synthetic,
    mode: input.mode,
    input:
      input.mode === "point"
        ? { mode: input.mode, point: input.point }
        : {
            mode: input.mode,
            footprint: input.footprint,
            lower: input.lower,
            upper: input.upper,
          },
    ...result,
  };
}
// Called by the explicit import flow; the caller already owns the site lock.
export { reserveRecord, siteFrom };
