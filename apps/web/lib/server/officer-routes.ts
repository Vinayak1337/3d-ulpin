import { readWorkQueue } from "./work-queue";
import { preparationContinuation } from "./preparation-continuation";
import { exportBlock } from "./block-export";
import { z } from "zod";
import {
  buildingDossier,
  openPreparation,
  changeAssociation,
  createBlockGroup,
} from "./officer";
import {
  appendPreparationFacts,
  resolvePreparationFact,
  preparationRequirements,
  setPreparationPlacement,
  prepareDetails,
  factProperties,
} from "./officer-preparation";
import {
  createInvestigation,
  getInvestigation,
  updateInvestigation,
  exportRegister,
} from "./officer-investigations";
import { getPackage } from "./areas";
import { importRegistryCase } from "./registry-seed";
import { prepareRegistryReview, draftDetail } from "./registry";
import { query } from "./db";
import { AppError, conflict, notFound } from "./errors";
const uuid = z.string().uuid(),
  rev = z.number().int().nonnegative(),
  str = z.string().trim().min(1).max(200),
  reason = z.string().trim().min(1).max(2000);
export const locatorSchema = z
  .object({
    sourceRevisionId: uuid,
    partId: uuid.optional(),
    featureId: z.string().max(150).optional(),
    page: z.number().int().positive().optional(),
    row: z.number().int().positive().optional(),
    jsonPointer: z.string().max(500).optional(),
    region: z
      .object({
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
        width: z.number().positive().max(1),
        height: z.number().positive().max(1),
        unit: z.literal("normalized"),
      })
      .optional(),
  })
  .strict();
const evidence = z.array(locatorSchema).min(1).max(30),
  point = z.tuple([
    z.number().finite().min(-1e7).max(1e7),
    z.number().finite().min(-1e7).max(1e7),
  ]),
  status = z.enum([
    "OPEN",
    "NEEDS_EVIDENCE",
    "READY_FOR_REVIEW",
    "REVIEWED",
    "CLOSED",
  ]);
const json = (v: unknown, s = 200) =>
  Response.json(v, { status: s, headers: { "Cache-Control": "no-store" } });
async function body(r: Request) {
  if (Number(r.headers.get("content-length") ?? 0) > 1024 * 1024)
    throw new AppError(
      413,
      "INPUT_LIMIT",
      "This request exceeds the bounded input limit.",
    );
  try {
    return await r.json();
  } catch {
    throw new AppError(400, "INVALID_JSON", "Provide a valid request body.");
  }
}
export async function officerRoutes(
  r: Request,
  p: string[],
): Promise<Response | null> {
  const method = r.method;
  if (p[0] === "work-queue" && p.length === 1 && method === "GET") return json(await readWorkQueue(new URL(r.url)));
  if(p[0]==='physical-features'&&p.length===3&&p[2]==='revisions'&&method==='GET'){
    const id=uuid.parse(p[1]),url=new URL(r.url);
    const before=url.searchParams.has('before')?z.coerce.number().int().positive().parse(url.searchParams.get('before')):2147483647;
    const current=(await query("SELECT f.revision FROM physical_features f JOIN map_areas a ON a.id=f.area_id WHERE f.id=$1 AND f.revision>0 AND a.archived_at IS NULL",[id])).rows[0]??notFound();
    const rows=await query('SELECT revision,created_at AS "createdAt",area_revision AS "areaRevision",package_id AS "packageId",body FROM physical_feature_revisions WHERE feature_id=$1 AND revision<$2 ORDER BY revision DESC LIMIT 51',[id,before]);
    const values=rows.rows.slice(0,50);
    return json({featureId:id,currentRevision:current.revision,revisions:values,nextBefore:rows.rows.length>50?values.at(-1)?.revision:null,scope:'Retained physical-feature revisions only; registry and neighbours are not reconstructed at an invented historical date.'});
  }
  if (
    p[0] === "areas" &&
    p.length === 3 &&
    p[2] === "register" &&
    method === "GET"
  )
    return exportBlock(
      uuid.parse(p[1]),
      z
        .enum(["json", "pdf", "zip"])
        .parse(new URL(r.url).searchParams.get("format") || "json"),
    );
  if (p[0] === "property-directory" && p.length === 1 && method === "GET") {
    const areaId = uuid.parse(new URL(r.url).searchParams.get("area"));
    const rows = await query(
      `WITH RECURSIVE buildings AS (
      SELECT f.id,f.revision FROM physical_features f WHERE f.revision>0 AND f.body->>'kind'='building' AND (f.area_id=$1 OR EXISTS(SELECT 1 FROM block_group_memberships m JOIN block_groups g ON g.id=m.group_id WHERE m.feature_id=f.id AND g.area_id=$1))
    ), roots AS (
      SELECT b.id building_id,r.id record_id FROM buildings b JOIN registry_records r ON r.id=b.id AND r.revision>0
      UNION SELECT b.id,t.id FROM buildings b JOIN property_associations a ON a.from_id=b.id JOIN registry_records t ON t.id=a.to_id WHERE a.relationship IN ('detailed_record','shared_space') AND a.status='confirmed' AND (a.body->>'fromRevision')::int=b.revision AND (a.body->>'toRevision')::int=t.revision
    ), related AS (
      SELECT * FROM roots UNION SELECT x.building_id,l.record_id FROM related x JOIN registry_links l ON l.target_id=x.record_id WHERE l.kind IN ('within','floor','serves')
    ) SELECT b.id "buildingId",count(DISTINCT r.id) FILTER(WHERE r.kind='space')::integer spaces,count(DISTINCT r.id) FILTER(WHERE r.kind='floor')::integer floors FROM buildings b LEFT JOIN related x ON x.building_id=b.id LEFT JOIN registry_records r ON r.id=x.record_id AND r.revision>0 GROUP BY b.id ORDER BY b.id LIMIT 2000`,
      [areaId],
    );
    return json(rows.rows);
  }
  if (p[0] === "workspace-directory" && p.length === 1 && method === "GET") {
    const rows = await query(
      `SELECT c.id,c.name,c.revision,c.updated_at "updatedAt",b.building_id "buildingId",b.body->>'areaId' "areaId",f.body->>'name' "propertyName",(SELECT count(*)::integer FROM sources s WHERE s.case_id=c.id) "sourceCount" FROM cases c LEFT JOIN building_preparations b ON b.case_id=c.id LEFT JOIN physical_features f ON f.id=b.building_id WHERE (NOT c.archived OR b.id IS NOT NULL) AND NOT EXISTS (SELECT 1 FROM map_areas a WHERE a.archived_at IS NOT NULL AND (a.site_id=c.site_id OR a.id=f.area_id)) ORDER BY c.updated_at DESC,c.id LIMIT 100`,
    );
    return json(rows.rows);
  }
  if (p[0] === "buildings" && p.length === 3) {
    const id = uuid.parse(p[1]);
    if (p[2] === "dossier" && method === "GET")
      return json(await buildingDossier(id));
    if (p[2] === "register" && method === "GET")
      return exportRegister(
        id,
        z
          .enum(["json", "csv", "html", "pdf", "zip"])
          .parse(new URL(r.url).searchParams.get("format") ?? "json"),
        undefined,
        new URL(r.url).searchParams.has("record")
          ? uuid.parse(new URL(r.url).searchParams.get("record"))
          : undefined,
      );
    if (p[2] === "preparation-cases" && method === "POST") {
      const b = z
        .object({ expectedRevision: rev, requestKey: uuid })
        .strict()
        .parse(await body(r));
      return json(await openPreparation(id, b.expectedRevision), 201);
    }
    if (p[2] === "detail-review" && method === "POST") {
      const b = z
          .object({ expectedRevision: rev })
          .strict()
          .parse(await body(r)),
        prep =
          (
            await query(
              "SELECT body FROM building_preparations WHERE building_id=$1",
              [id],
            )
          ).rows[0]?.body ?? notFound();
      const continuation = await preparationContinuation(prep.packageId);
      if (continuation.caseRevision !== b.expectedRevision ||
          !["ready", "reviewed", "recorded"].includes(continuation.status))
        conflict("The preparation changed. Build the current source facts before reviewing.");
      if (continuation.review) return json(continuation.review);
      const d = await buildingDossier(id);
      const draftId = await importRegistryCase(
        d.area.siteId,
        prep.caseId,
        b.expectedRevision,
      );
      const draft = await draftDetail(draftId);
      return json(
        await prepareRegistryReview(
          draftId,
          draft.revision,
          d.revisions.registry,
        ),
        201,
      );
    }
  }
  if (p[0] === "property-associations" && p.length === 1 && method === "POST")
    return json(
      await changeAssociation(
        z
          .object({
            id: uuid.optional(),
            fromId: uuid,
            toId: uuid,
            relationship: z.enum([
              "occupies_parcel",
              "representation_of",
              "detailed_record",
              "shared_space",
            ]),
            status: z.enum(["suggested", "confirmed", "rejected"]),
            expectedRevision: rev,
            expectedFromRevision: rev,
            expectedToRevision: rev,
            evidence,
            reason,
          })
          .strict()
          .parse(await body(r)),
      ),
      201,
    );
  if (p[0] === "block-groups" && p.length === 1 && method === "POST")
    return json(
      await createBlockGroup(
        z
          .object({
            areaId: uuid,
            name: str,
            kind: z.enum([
              "analysis_extent",
              "layout_block",
              "development_block",
              "ward",
              "locality",
            ]),
            authority: str.optional(),
            code: str.optional(),
            boundary: z.any(),
            evidence,
            featureIds: z.array(uuid).min(1).max(2000),
            expectedRevision: rev,
          })
          .strict()
          .parse(await body(r)),
      ),
      201,
    );
  if (p[0] === "import-packages" && p.length === 3) {
    const id = uuid.parse(p[1]);
    if (p[2] === "continuation" && method === "GET")
      return json(await preparationContinuation(id));
    if (p[2] === "requirements" && method === "GET")
      return json(await preparationRequirements(id));
    if (p[2] === "preparation-facts" && method === "POST") {
      const b = z
        .object({
          expectedRevision: rev,
          entityId: uuid.optional(),
          subject: z.string().trim().min(1).max(60).optional(),
          property: z.enum(factProperties),
          value: z.unknown(),
          unit: str.optional(),
          referenceFrameId: str.optional(),
          evidence,
        })
        .strict()
        .parse(await body(r));
      const pkg = await getPackage(id);
      return json(
        await appendPreparationFacts(id, b.expectedRevision, [
          {
            entityId: b.entityId ?? pkg.features[0].id,
            subject: b.subject,
            property: b.property,
            value: b.value,
            unit: b.unit,
            referenceFrameId: b.referenceFrameId,
            evidence: b.evidence,
            method: "human_entry",
            evidenceState: "source_supported",
            worldStatus: pkg.features[0].worldStatus,
          },
        ]),
        201,
      );
    }
    if (p[2] === "resolve-fact" && method === "POST") {
      const b = z
        .object({ expectedRevision: rev, claimId: uuid, reason })
        .strict()
        .parse(await body(r));
      return json(
        await resolvePreparationFact(
          id,
          b.expectedRevision,
          b.claimId,
          b.reason,
        ),
      );
    }
    if (p[2] === "placement" && method === "POST") {
      const b = z
        .object({
          expectedRevision: rev,
          sourceFrame: str,
          verticalReference: str,
          sourceVerticalReference: str.optional(),
          verticalOffset: z.number().finite().min(-10000).max(10000),
          controlPoints: z
            .array(z.object({ source: point, target: point }))
            .length(2)
            .optional(),
          evidence,
          reason,
        })
        .strict()
        .parse(await body(r));
      return json(await setPreparationPlacement(id, b.expectedRevision, b));
    }
    if (p[2] === "prepare-details" && method === "POST") {
      const b = z
        .object({ expectedRevision: rev })
        .strict()
        .parse(await body(r));
      return json(await prepareDetails(id, b.expectedRevision), 201);
    }
  }
  if (p[0] === "investigations") {
    if (p.length === 1 && method === "POST")
      return json(
        await createInvestigation(
          z
            .object({
              buildingId: uuid,
              expectedRevision: rev,
              requestKey: uuid.optional(),
              reference: str,
              classification: str,
              checkId: uuid.optional(),
              findingIds: z.array(uuid).max(200).optional(),
              notes: z.string().max(10000).optional(),
            })
            .strict()
            .parse(await body(r)),
        ),
        201,
      );
    if (p.length >= 2) {
      const id = uuid.parse(p[1]);
      if (p.length === 2 && method === "GET")
        return json(await getInvestigation(id));
      if (p.length === 2 && method === "PATCH") {
        const b = z
          .object({
            expectedRevision: rev,
            status: status.optional(),
            notes: z.string().max(10000).optional(),
            nextAction: reason.optional(),
            reason,
          })
          .strict()
          .parse(await body(r));
        return json(await updateInvestigation(id, b.expectedRevision, b));
      }
      if (p.length === 3 && p[2] === "requests" && method === "POST") {
        const b = z
          .object({ expectedRevision: rev, question: reason })
          .strict()
          .parse(await body(r));
        return json(
          await updateInvestigation(id, b.expectedRevision, {
            question: b.question,
            reason: "In-app evidence request created.",
          }),
          201,
        );
      }
      if (
        p.length === 5 &&
        p[2] === "requests" &&
        p[4] === "answer" &&
        method === "POST"
      ) {
        const b = z
          .object({
            expectedRevision: rev,
            response: reason,
            evidence: z.array(locatorSchema).max(30).optional(),
          })
          .strict()
          .parse(await body(r));
        return json(
          await updateInvestigation(id, b.expectedRevision, {
            requestId: uuid.parse(p[3]),
            response: b.response,
            evidence: b.evidence,
            reason: "Response to evidence request recorded.",
          }),
        );
      }
      if (p.length === 3 && p[2] === "export" && method === "GET") {
        const i = await getInvestigation(id);
        return exportRegister(
          i.buildingId,
          z
            .enum(["json", "csv", "html", "pdf"])
            .parse(new URL(r.url).searchParams.get("format") ?? "json"),
          id,
        );
      }
    }
  }
  return null;
}
