import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import {
  addUnit,
  applyLevels,
  createCase,
  getCase,
  getSource,
  listCases,
  loadDemoInputs,
  loadDemoLevels,
  prepareCase,
  readDemoFile,
  readRealDemoAsset,
  requestBuild,
  retryJob,
  updateUnit,
  uploadSource,
} from "@/lib/server/domain";
import { AppError } from "@/lib/server/errors";
import { checkStorage, readObject } from "@/lib/server/storage";
import { query } from "@/lib/server/db";
import { settings } from "@/lib/server/config";
import {
  addUnitSchema,
  applyLevelsSchema,
  buildSchema,
  createCaseSchema,
  demoSchema,
  editUnitSchema,
  idSchema,
  prepareSchema,
  profileSchema,
} from "@/lib/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path: string[] }> };
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
async function body(request: Request) {
  try {
    return await request.json();
  } catch {
    throw new AppError(
      400,
      "INVALID_JSON",
      "The request body must be valid JSON.",
    );
  }
}
function localOnly(request: Request) {
  const allowed = (hostname: string) =>
    ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
  if (!allowed(new URL(request.url).hostname))
    throw new AppError(
      403,
      "LOCAL_DEMO_ONLY",
      "This single-operator demonstration is available only on localhost.",
    );
  const origin = request.headers.get("origin");
  if (origin) {
    let valid = false;
    try {
      valid = allowed(new URL(origin).hostname);
    } catch {
      /* Opaque or malformed origins are not local app origins. */
    }
    if (!valid)
      throw new AppError(
        403,
        "ORIGIN_DENIED",
        "This request did not originate from the local workbench.",
      );
  }
}
async function handle(request: Request, context: Context): Promise<Response> {
  const requestId = randomUUID();
  try {
    localOnly(request);
    const { path: p } = await context.params;
    const method = request.method;
    if (
      p[0] === "demo-assets" &&
      p[1] === "real-nyc" &&
      p.length === 3 &&
      method === "GET"
    ) {
      const bytes = await readRealDemoAsset(p[2]);
      return new Response(new Uint8Array(bytes), {
        headers: {
          "Content-Type": p[2].endsWith(".geojson")
            ? "application/geo+json"
            : "application/json",
          "Content-Disposition": `attachment; filename="${p[2]}"`,
          "Cache-Control": "private, max-age=60",
        },
      });
    }
    if (p[0] === "health" && p.length === 1 && method === "GET") {
      const checks = await Promise.allSettled([
        query("SELECT PostGIS_Version()"),
        checkStorage(),
        fetch(`${settings.geoUrl}/internal/ready`, {
          headers: { Authorization: `Bearer ${settings.geoToken}` },
          signal: AbortSignal.timeout(3000),
        }).then(async (r) => {
          if (!r.ok) throw new Error("Processor unavailable");
          return r.json() as Promise<{
            ok: boolean;
            redis: boolean;
            worker: boolean;
          }>;
        }),
      ]);
      const readiness =
        checks[2].status === "fulfilled" ? checks[2].value : null;
      const services = {
        database: checks[0].status === "fulfilled",
        storage: checks[1].status === "fulfilled",
        processor: !!readiness,
        redis: readiness?.redis === true,
        worker: readiness?.worker === true,
      };
      return json({ ok: Object.values(services).every(Boolean), services });
    }
    if (p[0] === "demo-files" && p.length === 3 && method === "GET") {
      const file = await readDemoFile(p[1], p[2]);
      return new Response(new Uint8Array(file.bytes), {
        headers: {
          "Content-Type": file.mime,
          "Content-Disposition": `attachment; filename="${p[2]}"`,
          "Cache-Control": "private, max-age=60",
        },
      });
    }
    if (
      p[0] === "sources" &&
      p.length === 3 &&
      p[2] === "file" &&
      method === "GET"
    ) {
      const source = await getSource(idSchema.parse(p[1]));
      const bytes = await readObject(source.object_key);
      return new Response(new Uint8Array(bytes), {
        headers: {
          "Content-Type": source.mime_type,
          "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(source.name)}`,
          "Cache-Control": "private, max-age=60",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    if (
      p[0] === "jobs" &&
      p.length === 3 &&
      p[2] === "retry" &&
      method === "POST"
    )
      return json(await retryJob(idSchema.parse(p[1])), 202);
    if (p[0] === "cases" && p.length === 1) {
      if (method === "GET") return json(await listCases());
      if (method === "POST") {
        const input = createCaseSchema.parse(await body(request));
        return json(await createCase(input.name, input.description), 201);
      }
    }
    if (p[0] === "cases" && p.length >= 2) {
      const caseId = idSchema.parse(p[1]);
      if (p.length === 2 && method === "GET")
        return json(await getCase(caseId));
      if (p.length === 3 && method === "POST") {
        if (p[2] === "sources") {
          if (
            Number(request.headers.get("content-length") || 0) >
            17 * 1024 * 1024
          )
            throw new AppError(413, "FILE_SIZE", "Choose a file up to 16 MB.");
          const form = await request.formData();
          const file = form.get("file");
          if (!(file instanceof File))
            throw new AppError(400, "MISSING_FILE", "Choose a file to upload.");
          const profile = profileSchema.parse(form.get("profile"));
          const familyId = form.get("familyId")
            ? idSchema.parse(form.get("familyId"))
            : undefined;
          const mime = {
            "parcel-local-json-v1": "application/json",
            "levels-csv-v1": "text/csv",
            "control-csv-v1": "text/csv",
            "plan-png-v1": "image/png",
            "plan-pdf-v1": "application/pdf",
          }[profile];
          return json(
            await uploadSource(caseId, {
              name: file.name,
              bytes: new Uint8Array(await file.arrayBuffer()),
              mimeType: mime,
              profile,
              familyId,
              operationKey: request.headers.get("Idempotency-Key") || undefined,
            }),
            201,
          );
        }
        if (p[2] === "demo-inputs") {
          const { dataset } = demoSchema.parse(await body(request));
          return json(
            await loadDemoInputs(
              caseId,
              dataset,
              request.headers.get("Idempotency-Key") || undefined,
            ),
            201,
          );
        }
        if (p[2] === "demo-levels") {
          const { dataset } = demoSchema.parse(await body(request));
          if (dataset === "real-nyc")
            throw new AppError(
              422,
              "NO_REVISED_SAMPLE",
              "The NYC sample has no revised level schedule or interior floor measurements.",
            );
          return json(await loadDemoLevels(caseId, dataset), 201);
        }
        if (p[2] === "prepare")
          return json(
            await prepareCase(caseId, prepareSchema.parse(await body(request))),
          );
        if (p[2] === "apply-levels")
          return json(
            await applyLevels(
              caseId,
              applyLevelsSchema.parse(await body(request)),
            ),
          );
        if (p[2] === "build")
          return json(
            await requestBuild(
              caseId,
              buildSchema.parse(await body(request)).expectedRevision,
            ),
            202,
          );
        if (p[2] === "units")
          return json(
            await addUnit(caseId, addUnitSchema.parse(await body(request))),
            201,
          );
      }
      if (p.length === 4 && p[2] === "units" && method === "PATCH")
        return json(
          await updateUnit(
            caseId,
            idSchema.parse(p[3]),
            editUnitSchema.parse(await body(request)),
          ),
        );
    }
    throw new AppError(404, "NOT_FOUND", "This operation is not available.");
  } catch (error) {
    if (error instanceof ZodError)
      return json(
        {
          error: {
            code: "INVALID_INPUT",
            message: error.issues
              .map(
                (issue) =>
                  `${issue.path.join(".") || "Input"}: ${issue.message}`,
              )
              .join("; "),
            requestId,
          },
        },
        422,
      );
    if (error instanceof AppError)
      return json(
        {
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
            requestId,
          },
        },
        error.status,
      );
    const pgCode = (error as { code?: string })?.code;
    if (pgCode === "23505")
      return json(
        {
          error: {
            code: "DUPLICATE_RECORD",
            message: "This record already exists. Refresh before retrying.",
            requestId,
          },
        },
        409,
      );
    console.error(
      `API request ${requestId} failed (${error instanceof Error ? error.name : "unknown error"}).`,
    );
    return json(
      {
        error: {
          code: "SERVICE_UNAVAILABLE",
          message:
            "A local service could not complete this operation. Check service health and retry.",
          requestId,
        },
      },
      503,
    );
  }
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
