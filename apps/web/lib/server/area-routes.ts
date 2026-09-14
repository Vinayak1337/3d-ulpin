import { z } from "zod";
import { query } from "./db";
import { AppError, notFound } from "./errors";
import {
  SOURCE_CATALOG,
  probeAcquisition,
  acquireSource,
  importAcquisition,
} from "./area-acquisitions";
import {
  listAreas,
  areaContext,
  getPackage,
  ingestArea,
  answerQuestion,
  reviewPackage,
  commitPackage,
  runAreaCheck,
  attachDocument,
  addFact,
  rebasePackage,
  createPackageCorrection,
} from "./areas";
import { resolveAreaIdentifier, bindExternalIdentifier } from "./area-resolver";
import { createAreaScenario } from "./area-scenario";
const uuid = z.string().uuid(),
  revision = z.number().int().nonnegative(),
  str = z.string().trim().min(1).max(150),
  field = z.string().trim().min(1).max(80);
const mapping = z
  .object({
    idField: field,
    nameField: field.optional(),
    kind: z.enum(["building", "parcel", "road", "public_land", "utility"]),
    heightField: field.optional(),
    heightUnit: z.enum(["m", "ft"]).optional(),
    heightMeaning: z.string().trim().min(1).max(500).optional(),
    identifierFields: z.array(field).max(10).optional(),
  })
  .strict();
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
async function body(request: Request) {
  try {
    return await request.json();
  } catch {
    throw new AppError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }
}
async function form(request: Request) {
  if (Number(request.headers.get("content-length") || 0) > 17 * 1024 * 1024)
    throw new AppError(413, "FILE_SIZE", "Choose a file up to 16 MiB.");
  return request.formData();
}
function fieldJson(value: FormDataEntryValue | null, fallback?: unknown) {
  try {
    return value === null ? fallback : JSON.parse(String(value));
  } catch {
    throw new AppError(
      422,
      "INVALID_INPUT",
      "A structured form field is invalid.",
    );
  }
}
export async function areaRoutes(
  request: Request,
  p: string[],
): Promise<Response | null> {
  const method = request.method;
  if (p[0] === "source-catalog" && p.length === 1 && method === "GET")
    return json(SOURCE_CATALOG);
  if (p[0] === "areas" && p.length === 1 && method === "GET")
    return json(await listAreas());
  if (
    p[0] === "areas" &&
    p[2] === "context" &&
    p.length === 3 &&
    method === "GET"
  )
    return json(await areaContext(uuid.parse(p[1])));
  if (
    p[0] === "areas" &&
    p[2] === "scenario" &&
    p.length === 3 &&
    method === "POST"
  ) {
    const input = z
      .object({ expectedRevision: revision, kind: z.enum(["road", "utility"]) })
      .strict()
      .parse(await body(request));
    return json(
      await createAreaScenario(
        uuid.parse(p[1]),
        input.expectedRevision,
        input.kind,
      ),
      201,
    );
  }
  if (p[0] === "resolve" && p.length === 1 && method === "GET")
    return json(
      await resolveAreaIdentifier(
        z
          .string()
          .trim()
          .min(1)
          .max(150)
          .parse(new URL(request.url).searchParams.get("identifier")),
      ),
    );
  if (p[0] === "external-identifiers" && p.length === 1 && method === "POST") {
    const input = z
      .object({
        featureId: uuid.optional(),
        recordId: uuid.optional(),
        scheme: z.enum(["official_ulpin", "source_property_id", "nyc_bin"]),
        value: str,
        issuer: str,
        sourceId: uuid,
        locator: z.string().trim().min(1).max(500),
        expectedRevision: revision,
      })
      .strict()
      .refine(
        (v) => Boolean(v.featureId) !== Boolean(v.recordId),
        "Choose exactly one target.",
      )
      .parse(await body(request));
    return json(await bindExternalIdentifier(input), 201);
  }
  if (p[0] === "acquisitions") {
    if (p[1] === "probe" && p.length === 2 && method === "POST") {
      const input = z
        .object({ sourceId: str })
        .strict()
        .parse(await body(request));
      return json(await probeAcquisition(input.sourceId));
    }
    if (p.length === 1 && method === "POST") {
      const input = z
        .object({
          sourceId: str,
          mode: z.enum(["saved", "refresh"]),
          requestKey: uuid,
        })
        .strict()
        .parse(await body(request));
      return json(
        await acquireSource(input.sourceId, input.mode, input.requestKey),
        201,
      );
    }
    if (p.length === 2 && method === "GET")
      return json(
        (
          await query("SELECT body FROM area_acquisitions WHERE id=$1", [
            uuid.parse(p[1]),
          ])
        ).rows[0]?.body || notFound(),
      );
  }
  if (p[0] === "import-packages") {
    if (p.length === 1 && method === "POST") {
      if (
        request.headers.get("content-type")?.includes("multipart/form-data")
      ) {
        const input = await form(request),
          file = input.get("file");
        if (!(file instanceof File))
          throw new AppError(400, "MISSING_FILE", "Choose a GIS source file.");
        const metadata = z
          .object({
            format: z.enum(["geojson", "arcgis"]),
            namespace: str,
            name: str,
            mapping,
            areaId: uuid.optional(),
            sourceCrs: z
              .string()
              .regex(/^EPSG:\d+$/)
              .optional(),
            expectedAreaRevision: revision.optional(),
            worldStatus: z
              .enum(["observed", "planned", "hypothetical", "synthetic"])
              .optional(),
          })
          .strict()
          .parse({
            format: input.get("format"),
            namespace: input.get("namespace"),
            name: input.get("name"),
            mapping: fieldJson(input.get("mapping")),
            areaId: input.get("areaId") || undefined,
            sourceCrs: input.get("sourceCrs") || undefined,
            expectedAreaRevision: input.has("expectedAreaRevision")
              ? Number(input.get("expectedAreaRevision"))
              : undefined,
            worldStatus: input.get("worldStatus") || undefined,
          });
        return json(
          await ingestArea({
            ...metadata,
            filename: file.name,
            bytes: new Uint8Array(await file.arrayBuffer()),
          }),
          201,
        );
      }
      const input = z
        .object({
          acquisitionId: uuid,
          areaId: uuid.optional(),
          expectedAreaRevision: revision.optional(),
          name: str.optional(),
        })
        .strict()
        .parse(await body(request));
      return json(
        await importAcquisition(
          input.acquisitionId,
          input.areaId,
          input.expectedAreaRevision,
          input.name,
        ),
        201,
      );
    }
    if (p.length === 2 && method === "GET")
      return json(await getPackage(uuid.parse(p[1])));
    if (p.length === 3 && method === "GET" && p[2] === "questions")
      return json((await getPackage(uuid.parse(p[1]))).questions);
    if (p.length === 3 && method === "POST") {
      const id = uuid.parse(p[1]);
      if (p[2] === "correction") {
        const input = z
          .object({ requestKey: uuid })
          .strict()
          .parse(await body(request));
        return json(await createPackageCorrection(id, input.requestKey), 201);
      }
      if (p[2] === "answers") {
        const input = z
          .object({
            expectedRevision: revision,
            questionId: uuid,
            answer: z
              .object({
                choice: z.enum(["keep_2d", "estimate", "select_claim"]),
                value: z.number().finite().positive().max(1000).optional(),
                reason: z.string().trim().min(1).max(2000),
                claimId: uuid.optional(),
              })
              .strict(),
          })
          .strict()
          .parse(await body(request));
        return json(
          await answerQuestion(
            id,
            input.expectedRevision,
            input.questionId,
            input.answer,
          ),
        );
      }
      if (p[2] === "review" || p[2] === "prepare") {
        const input = z
          .object({ expectedRevision: revision })
          .strict()
          .parse(await body(request));
        return json(await reviewPackage(id, input.expectedRevision));
      }
      if (p[2] === "rebase") {
        const input = z
          .object({ expectedRevision: revision })
          .strict()
          .parse(await body(request));
        return json(await rebasePackage(id, input.expectedRevision));
      }
      if (p[2] === "commit") {
        const input = z
          .object({
            expectedRevision: revision,
            acknowledgement: z.string().trim().min(1).max(2000),
          })
          .strict()
          .parse(await body(request));
        return json(
          await commitPackage(
            id,
            input.expectedRevision,
            input.acknowledgement,
          ),
        );
      }
      if (p[2] === "documents") {
        const input = await form(request),
          file = input.get("file");
        if (!(file instanceof File))
          throw new AppError(
            400,
            "MISSING_FILE",
            "Choose a supporting document.",
          );
        return json(
          await attachDocument(
            id,
            revision.parse(Number(input.get("expectedRevision"))),
            {
              bytes: new Uint8Array(await file.arrayBuffer()),
              name: file.name,
              format: z
                .enum(["pdf", "docx", "text", "png", "jpeg"])
                .parse(input.get("format")),
              entityIds: z
                .array(uuid)
                .min(1)
                .max(100)
                .parse(fieldJson(input.get("entityIds"))),
            },
          ),
          201,
        );
      }
      if (p[2] === "facts") {
        const input = z
          .object({
            expectedRevision: revision,
            claim: z
              .object({
                entityId: uuid,
                property: z
                  .string()
                  .regex(/^[a-zA-Z]+\.[a-zA-Z][a-zA-Z0-9.]*$/)
                  .max(100),
                value: z.union([
                  z.string().trim().min(1).max(500),
                  z.number().finite(),
                ]),
                unit: field.optional(),
                referenceFrameId: str.optional(),
                evidence: z
                  .array(
                    z
                      .object({
                        sourceRevisionId: uuid,
                        partId: uuid.optional(),
                        page: z.number().int().positive().optional(),
                        row: z.number().int().positive().optional(),
                        featureId: field.optional(),
                        jsonPointer: z.string().max(500).optional(),
                      })
                      .strict(),
                  )
                  .min(1)
                  .max(20),
              })
              .strict(),
          })
          .strict()
          .parse(await body(request));
        return json(await addFact(id, input.expectedRevision, input.claim));
      }
    }
  }
  if (p[0] === "area-checks") {
    if (p.length === 1 && method === "POST") {
      const input = z
        .object({ areaId: uuid, expectedRevision: revision })
        .strict()
        .parse(await body(request));
      return json(
        await runAreaCheck(input.areaId, input.expectedRevision),
        201,
      );
    }
    if (p.length === 2 && method === "GET")
      return json(
        (
          await query("SELECT body FROM area_check_runs WHERE id=$1", [
            uuid.parse(p[1]),
          ])
        ).rows[0]?.body || notFound(),
      );
  }
  return null;
}
