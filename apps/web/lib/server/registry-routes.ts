import { randomUUID } from "node:crypto";
import { legacyUrl } from "../legacy-url";
import { z } from "zod";
import { query } from "./db";
import { caseFrom } from "./domain";
import { AppError } from "./errors";
import { frameSchema, idSchema } from "./validation";
import {
  createSite,
  listSites,
  siteDetail,
  resolveRecord,
  createRegistryDraft,
  draftDetail,
  editRegistryDraft,
  editDraftSchema,
  recordBodySchema,
  prepareRegistryReview,
  commitRegistryReview,
  registryQuery,
  querySchema,
} from "./registry";
import { seedRegistry, importRegistryCase } from "./registry-seed";
const json = (x: unknown, status = 200) =>
  Response.json(x, { status, headers: { "Cache-Control": "no-store" } });
async function readBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new AppError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }
}
export async function registryRoutes(
  request: Request,
  p: string[],
): Promise<Response | null> {
  const method = request.method;
  if (p[0] === "registry-demo" && p.length === 1 && method === "POST")
    return json(await seedRegistry());
  if (p[0] === "registry-imports" && p.length === 1 && method === "POST") {
    const body = z
      .object({
        caseId: idSchema,
        expectedRevision: z.number().int().nonnegative(),
        destination: z.literal("separate-site"),
      })
      .strict()
      .parse(await readBody(request));
    const draftId = await importRegistryCase(
      null,
      body.caseId,
      body.expectedRevision,
    );
    const draft = await draftDetail(draftId);
    return json({ draftId, siteId: draft.siteId }, 201);
  }
  if (p[0] === "sites") {
    if (p.length === 1 && method === "GET") return json(await listSites());
    if (p.length === 1 && method === "POST") {
      const body = z
        .object({
          name: z.string().trim().min(1).max(100),
          frame: frameSchema.strict(),
          synthetic: z.boolean().default(true),
        })
        .strict()
        .parse(await readBody(request));
      return json(await createSite(body.name, body.frame, body.synthetic), 201);
    }
    const id = idSchema.parse(p[1]);
    if (p[2] === "import-options" && p.length === 3 && method === "GET") {
      await siteDetail(id);
      const rows = await query(
        "SELECT c.* FROM cases c WHERE NOT c.archived OR (c.site_id=$1 AND NOT EXISTS(SELECT 1 FROM registry_drafts d WHERE d.case_id=c.id) AND NOT EXISTS(SELECT 1 FROM registry_sites s WHERE s.seed_case_id=c.id)) ORDER BY c.updated_at DESC",
        [id],
      );
      return json(rows.rows.map(caseFrom));
    }
    if (p.length === 2 && method === "GET") return json(await siteDetail(id));
    if (p[2] === "workspace" && p.length === 3 && method === "POST") {
      const d = await siteDetail(id),
        caseId = randomUUID();
      await query(
        "INSERT INTO cases(id,name,description,frame,site_id,archived) VALUES($1,$2,$3,$4,$5,true)",
        [
          caseId,
          `Preparation · ${d.site.name}`,
          "Explicit site source preparation",
          d.site.frame,
          id,
        ],
      );
      return json({ id: caseId }, 201);
    }
    if (p[2] === "query" && p.length === 3 && method === "POST")
      return json(
        await registryQuery(id, querySchema.parse(await readBody(request))),
      );
    if (p[2] === "drafts" && p.length === 3 && method === "POST") {
      const body = z
        .object({
          recordId: idSchema.optional(),
          body: recordBodySchema.optional(),
          requestKey: idSchema.optional(),
        })
        .strict()
        .parse(await readBody(request));
      return json(
        await createRegistryDraft(
          id,
          body.recordId,
          body.body,
          body.requestKey,
        ),
        201,
      );
    }
    if (p[2] === "import" && p.length === 3 && method === "POST") {
      const body = z
        .object({
          caseId: idSchema,
          expectedRevision: z.number().int().nonnegative(),
        })
        .strict()
        .parse(await readBody(request));
      return json(
        {
          draftId: await importRegistryCase(
            id,
            body.caseId,
            body.expectedRevision,
          ),
        },
        201,
      );
    }
  }
  if (p[0] === "resolve" && p.length === 2 && method === "GET") {
    const sites = await listSites();
    const site = sites.find((s) => s.identifier === p[1] || s.id === p[1]);
    if (site) return json({ kind: "site", site });
    const legacy = (
      await query("SELECT * FROM registry_aliases WHERE alias=$1", [p[1]])
    ).rows[0];
    if (legacy && !legacy.record_id)
      return json({
        kind: "legacy_workspace",
        siteId: legacy.site_id,
        workspaceId: legacy.workspace_id,
        meaning: legacy.meaning,
        url: legacyUrl(`/?case=${legacy.workspace_id}`),
      });
    return json({
      kind: "record",
      ...(await resolveRecord(p[1])),
      ...(legacy ? { aliasMeaning: legacy.meaning } : {}),
    });
  }
  if (p[0] === "registry" && method === "GET") {
    if (p.length === 1) {
      const url = new URL(request.url),
        search = (url.searchParams.get("q") || "").slice(0, 150),
        siteId = url.searchParams.get("site");
      const rows = (
        await query(
          `SELECT id,identifier,site_id,body->>'alias' AS alias,body->>'name' AS name FROM registry_records WHERE revision>0 AND ($1::uuid IS NULL OR site_id=$1) AND (identifier ILIKE $2 OR body->>'alias' ILIKE $2 OR body->>'name' ILIKE $2 OR (body->'rights')::text ILIKE $2) ORDER BY identifier LIMIT 100`,
          [siteId ? idSchema.parse(siteId) : null, `%${search}%`],
        )
      ).rows;
      return json(rows);
    }
    const result = await resolveRecord(p[1]);
    if (p.length === 3 && p[2] === "export") {
      const detail = await siteDetail(result.site.id);
      const referenced = new Set<string>();
      for (const record of [
        result.record,
        ...result.history.map((h) => h.body),
      ]) {
        for (const binding of [
          ...record.evidence,
          ...record.rights.map((r: any) => r.evidence),
          ...Object.values(record.geometry?.bindings || {}),
        ]) {
          if (binding && typeof binding === "object" && "sourceId" in binding)
            referenced.add(String(binding.sourceId));
        }
      }
      const provenance = {
        sources: detail.sources.filter((s) => referenced.has(s.id)),
        note: "Original source revisions are immutable. Locators are recorded references; geometry does not establish rights.",
      };
      return new Response(
        JSON.stringify(
          {
            schema: "3d-ulpin-registry-v1",
            ...result,
            provenance,
            classification: result.record.synthetic
              ? "Synthetic demonstration"
              : "Source-supported record",
            limitations: [
              "Prototype identity; technical review does not confer ownership.",
              "Coordinates are local metres in the declared frame.",
            ],
          },
          null,
          2,
        ),
        {
          headers: {
            "Content-Type": "application/json",
            "Content-Disposition": `attachment; filename="${result.record.identifier}.json"`,
          },
        },
      );
    }
    if (p.length === 2) return json(result);
  }
  if (p[0] === "registry-drafts") {
    const id = idSchema.parse(p[1]);
    if (p.length === 2 && method === "GET") return json(await draftDetail(id));
    if (p.length === 2 && method === "PATCH")
      return json(
        await editRegistryDraft(
          id,
          editDraftSchema.parse(await readBody(request)),
        ),
      );
    if (p.length === 3 && p[2] === "review" && method === "POST") {
      const b = z
        .object({
          expectedRevision: z.number().int().positive(),
          expectedSiteRevision: z.number().int().nonnegative(),
        })
        .strict()
        .parse(await readBody(request));
      return json(
        await prepareRegistryReview(
          id,
          b.expectedRevision,
          b.expectedSiteRevision,
        ),
      );
    }
  }
  if (
    p[0] === "registry-reviews" &&
    p.length === 3 &&
    p[2] === "commit" &&
    method === "POST"
  ) {
    const b = z
      .object({ acknowledgement: z.string().max(2000).default("") })
      .strict()
      .parse(await readBody(request));
    return json(
      await commitRegistryReview(idSchema.parse(p[1]), b.acknowledgement),
    );
  }
  return null;
}
