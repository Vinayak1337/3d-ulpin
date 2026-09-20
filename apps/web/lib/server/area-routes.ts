import { createSourceCase, receiveCaseDocument } from "./source-cases";
import { createSourceWorkspace, sourceWorkspaceForCase } from "./source-workspaces";
import { z } from "zod";
import { query } from "./db";
import { inspectGisUpload, validateUnmappedGisIdentity } from "./gis-inspection";
import { areaGeo } from "./areas";
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
  copyCaseDocuments,
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
const geometryRole = z.enum([
  "unknown",
  "observed_ground_occupation",
  "observed_roof_projection",
  "approved_building_outline",
  "recorded_parcel",
  "public_road_land",
  "road_surface",
  "public_land",
  "physical_utility",
  "documented_restriction",
]);
const mapping = z
  .object({
    idField: field.optional(),
    nameField: field.optional(),
    kind: z.enum(["building", "parcel", "road", "public_land", "utility"]),
    heightField: field.optional(),
    heightUnit: z.enum(["m", "ft"]).optional(),
    heightMeaning: z.string().trim().min(1).max(500).optional(),
    identifierFields: z.array(field).max(10).optional(),
    geometryRole: geometryRole.optional(),
    geometryRoleField: field.optional(),
    roleValues: z.record(z.string(), geometryRole).optional(),
    levelReference: str.optional(),
    floorCountField: field.optional(),
    approvalStatusField: field.optional(),
    sourceDateField: field.optional(),
    validFromField: field.optional(),
    validToField: field.optional(),
    horizontalUncertaintyField: field.optional(),
    horizontalUncertaintyUnit: z.enum(["m", "ft"]).optional(),
    worldStatusField: field.optional(),
    worldStatusValues: z
      .record(
        z.string(),
        z.enum(["observed", "planned", "hypothetical", "synthetic"]),
      )
      .optional(),
    verticalExtent: z
      .object({
        lowerField: field,
        upperField: field,
        unit: z.enum(["m", "ft"]),
        reference: str,
      })
      .strict()
      .optional(),
    utility: z
      .object({
        assetIdField: field.optional(),
        utilityTypeField: field.optional(),
        operatorField: field.optional(),
        startLevelField: field.optional(),
        endLevelField: field.optional(),
        levelsField: field.optional(),
        levelUnit: z.enum(["m", "ft"]),
        levelMeaning: z.enum([
          "centre",
          "invert",
          "crown",
          "depth_below_ground",
        ]),
        depthTo: z.enum(["centre", "invert", "crown"]).optional(),
        verticalReference: str.nullable(),
        interpolation: z.enum(["per_vertex", "linear_endpoints"]).optional(),
        groundStartField: field.optional(),
        groundEndField: field.optional(),
        groundReference: str.optional(),
        crossSection: z.enum(["circular", "rectangular"]).optional(),
        diameterField: field.optional(),
        widthField: field.optional(),
        heightField: field.optional(),
        dimensionUnit: z.enum(["m", "ft"]),
      })
      .strict()
      .optional(),
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
  if (p[0] === "source-cases" && p.length === 1 && method === "POST") return json(await createSourceCase(await body(request)), 201);
  if (p[0] === "cases" && p.length === 3 && p[2] === "reference-documents" && method === "POST") {
    const input = await form(request), file = input.get("file");
    if (!(file instanceof File)) throw new AppError(400, "MISSING_FILE", "Choose a supporting document.");
    return json(await receiveCaseDocument(uuid.parse(p[1]), {bytes: new Uint8Array(await file.arrayBuffer()),name:file.name,format:z.enum(["pdf","png","jpeg","csv","text","docx"]).parse(input.get("format")),entityIds:[],requestKey:uuid.parse(input.get("requestKey"))}),201);
  }
  if (p[0] === "source-workspaces" && p.length === 1) {
    if (method === "POST") return json(await createSourceWorkspace(await body(request)), 201);
    if (method === "GET") return json(await sourceWorkspaceForCase(uuid.parse(new URL(request.url).searchParams.get("caseId"))));
  }
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
        scheme: z.enum([
          "official_ulpin",
          "demo_ulpin",
          "source_property_id",
          "nyc_bin",
        ]),
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
    if (p.length === 2 && p[1] === "inspect" && method === "POST")
      return json(await inspectGisUpload(request, (input) => areaGeo("inspect-gis", input)));
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
            format: z.enum(["geojson", "arcgis", "gpkg", "shapefile_zip"]),
            layer: z.string().min(1).max(256).optional(),
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
            layer: input.get("layer") || undefined,
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
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (!metadata.mapping.idField)
          await validateUnmappedGisIdentity(metadata.format, bytes, (input) => areaGeo("inspect-gis", input));
        return json(
          await ingestArea({
            ...metadata,
            filename: file.name,
            bytes,
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
      if (p[2] === "copy-case-documents") {
        const input = z
          .object({
            expectedRevision: revision,
            caseId: uuid,
            sourceIds: z
              .array(uuid)
              .min(1)
              .max(20)
              .refine(
                (ids) => new Set(ids).size === ids.length,
                "Choose distinct source revisions.",
              ),
            buildingId: uuid,
            reason: z.string().trim().min(1).max(2000),
          })
          .strict()
          .parse(await body(request));
        return json(await copyCaseDocuments(id, input));
      }
      if (p[2] === "documents" || p[2] === "source-documents") {
        const sourceOnly = p[2] === "source-documents";
        if (sourceOnly && !(await getPackage(id)).sourceWorkspace) throw new AppError(422, "SOURCE_WORKSPACE", "Source-only documents require an explicit source workspace.");
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
              requestKey: sourceOnly && input.get("requestKey") ? uuid.parse(input.get("requestKey")) : undefined,
              format: z
                .enum(["pdf", "docx", "text", "csv", "png", "jpeg"])
                .parse(input.get("format")),
              entityIds: sourceOnly ? [] : z
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
