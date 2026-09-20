import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";
import type {
  BuildInput,
  CaseDetail,
  CaseRecord,
  ContextFeature,
  CoordinateFrame,
  EvidenceBindings,
  InspectionResult,
  LevelRow,
  PlanCalibration,
  Point2,
  ProcessingJob,
  SourceProfile,
  SourceRevision,
  SpatialFeature,
  UnitKind,
  UnitSpec,
} from "@ulpin/contracts";
import { query, transaction } from "./db";
import { AppError, conflict, notFound } from "./errors";
import { putOriginal, removeOrphan, sha256 } from "./storage";
import { settings } from "./config";
import { persistIdentity, readIdentity } from "./identities";

type Row = Record<string, any>;
export const defaultFrame: CoordinateFrame = {
  id: "LOCAL-C001",
  horizontalUnit: "m",
  verticalUnit: "m",
  benchmark: "BM-DEMO-A",
};
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
export function fingerprint(value: unknown) {
  return sha256(canonical(value));
}
const iso = (value: Date | string) => new Date(value).toISOString();
export function caseFrom(row: Row): CaseRecord {
  return {
    id: row.id,
    archived: row.archived ?? false,
    siteId: row.site_id || null,
    name: row.name,
    description: row.description,
    frame: row.frame,
    revision: row.revision,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}
export function sourceFrom(row: Row): SourceRevision {
  return {
    id: row.id,
    caseId: row.case_id,
    familyId: row.family_id,
    revision: row.revision,
    name: row.name,
    profile: row.profile,
    mimeType: row.mime_type,
    bytes: Number(row.bytes),
    sha256: row.sha256,
    status: row.status,
    createdAt: iso(row.created_at),
    inspection: row.inspection,
  };
}
export function jobFrom(row: Row): ProcessingJob {
  return {
    id: row.id,
    caseId: row.case_id,
    sourceId: row.source_id,
    operation: row.operation,
    status: row.status,
    createdAt: iso(row.created_at),
    completedAt: row.completed_at ? iso(row.completed_at) : null,
    error: row.error,
    inputFingerprint: row.input_fingerprint,
  };
}
export async function lockCase(client: PoolClient, id: string): Promise<Row> {
  const result = await client.query(
    "SELECT * FROM cases WHERE id=$1 FOR UPDATE",
    [id],
  );
  return result.rows[0] ?? notFound("This case no longer exists.");
}
export async function recordEvent(
  client: PoolClient,
  caseId: string,
  kind: string,
  message: string,
) {
  await client.query(
    "INSERT INTO events(id,case_id,kind,message) VALUES($1,$2,$3,$4)",
    [randomUUID(), caseId, kind, message],
  );
}
async function bumpCase(client: PoolClient, caseId: string) {
  await client.query(
    "UPDATE cases SET revision=revision+1,updated_at=now() WHERE id=$1",
    [caseId],
  );
}
export async function listCases(): Promise<CaseRecord[]> {
  return (await query("SELECT * FROM cases ORDER BY created_at DESC")).rows.map(
    caseFrom,
  );
}
export async function createCase(
  name: string,
  description = "",
): Promise<CaseRecord> {
  const result = await query(
    "INSERT INTO cases(id,name,description,frame) VALUES($1,$2,$3,$4) RETURNING *",
    [randomUUID(), name, description, defaultFrame],
  );
  return caseFrom(result.rows[0]);
}
export async function detailFromClient(
  client: PoolClient,
  id: string,
): Promise<CaseDetail> {
  const result = await client.query("SELECT * FROM cases WHERE id=$1", [id]);
  const row = result.rows[0] ?? notFound();
  // One transaction uses one connection; issue its reads sequentially.
  const sources = await client.query(
    "SELECT * FROM sources WHERE case_id=$1 ORDER BY created_at",
    [id],
  );
  const units = await client.query(
    "SELECT body FROM units WHERE case_id=$1 AND active ORDER BY alias",
    [id],
  );
  const jobs = await client.query(
    "SELECT * FROM jobs WHERE case_id=$1 ORDER BY created_at DESC LIMIT 30",
    [id],
  );
  const snapshots = await client.query(
    "SELECT body FROM snapshots WHERE id=$1",
    [row.current_snapshot_id],
  );
  const events = await client.query(
    "SELECT id,kind,message,created_at FROM events WHERE case_id=$1 ORDER BY created_at DESC LIMIT 60",
    [id],
  );
  return {
    case: caseFrom(row),
    identity: await readIdentity(client, id),
    sources: sources.rows.map(sourceFrom),
    units: units.rows.map((u) => u.body),
    jobs: jobs.rows.map(jobFrom),
    model: snapshots.rows[0]?.body ?? null,
    context: row.context,
    history: events.rows.map((event) => ({
      id: event.id,
      kind: event.kind,
      message: event.message,
      createdAt: iso(event.created_at),
    })),
  };
}
export async function getCase(id: string) {
  return transaction(async (client) => {
    await client.query(
      "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    return detailFromClient(client, id);
  });
}

export async function getSource(id: string) {
  const result = await query("SELECT * FROM sources WHERE id=$1", [id]);
  return result.rows[0] ?? notFound("This source could not be found.");
}
async function usableSource(
  client: PoolClient,
  caseId: string,
  id: string,
  profile: SourceProfile,
): Promise<Row> {
  const result = await client.query(
    "SELECT * FROM sources WHERE id=$1 AND case_id=$2",
    [id, caseId],
  );
  const source =
    result.rows[0] ?? notFound("The source is not part of this case.");
  if (source.profile !== profile)
    throw new AppError(
      422,
      "WRONG_SOURCE_PROFILE",
      `Choose a ${profile} source for this action.`,
    );
  if (!source.inspection || !["ready", "needs_input"].includes(source.status))
    throw new AppError(
      409,
      "SOURCE_NOT_READY",
      "Wait for source inspection, or retry its failed processing job.",
    );
  if (
    (source.inspection as InspectionResult).issues.some(
      (issue) => issue.severity === "error",
    )
  )
    throw new AppError(
      422,
      "SOURCE_HAS_ERRORS",
      "Resolve the inspection errors before using this source.",
    );
  return source;
}
async function operationResult(
  client: PoolClient,
  caseId: string,
  key: string | undefined,
  kind: string,
  hash: string,
) {
  if (!key) return null;
  const result = await client.query(
    "SELECT * FROM operations WHERE case_id=$1 AND operation_key=$2 AND kind=$3",
    [caseId, key, kind],
  );
  const row = result.rows[0];
  if (!row) return null;
  if (row.payload_hash !== hash)
    throw new AppError(
      409,
      "IDEMPOTENCY_CONFLICT",
      "This retry key was already used with different inputs.",
    );
  return row.result;
}
async function saveOperation(
  client: PoolClient,
  caseId: string,
  key: string | undefined,
  kind: string,
  hash: string,
  result: unknown,
) {
  if (key)
    await client.query(
      "INSERT INTO operations(case_id,operation_key,kind,payload_hash,result) VALUES($1,$2,$3,$4,$5)",
      [caseId, key, kind, hash, result],
    );
}

export interface UploadInput {
  name: string;
  bytes: Uint8Array;
  mimeType: string;
  profile: SourceProfile;
  familyId?: string;
  operationKey?: string;
}
export async function uploadSource(
  caseId: string,
  input: UploadInput,
): Promise<SourceRevision> {
  if (input.bytes.length === 0 || input.bytes.length > 16 * 1024 * 1024)
    throw new AppError(
      413,
      "FILE_SIZE",
      "Choose a non-empty file up to 16 MB.",
    );
  const contentHash = sha256(input.bytes);
  const hash = fingerprint({
    name: input.name,
    sha256: contentHash,
    profile: input.profile,
    familyId: input.familyId ?? null,
  });
  let writtenKey: string | undefined;
  try {
    return await transaction(async (client) => {
      await lockCase(client, caseId);
      const existing = await operationResult(
        client,
        caseId,
        input.operationKey,
        "upload",
        hash,
      );
      if (existing) {
        const source = await client.query(
          "SELECT * FROM sources WHERE id=$1 AND case_id=$2",
          [existing.sourceId, caseId],
        );
        return sourceFrom(source.rows[0] ?? notFound());
      }
      const id = randomUUID();
      const familyId = input.familyId || randomUUID();
      if (input.familyId) {
        const family = await client.query(
          "SELECT profile FROM sources WHERE case_id=$1 AND family_id=$2 LIMIT 1",
          [caseId, familyId],
        );
        if (!family.rows[0])
          throw new AppError(
            422,
            "UNKNOWN_SOURCE_FAMILY",
            "Choose an existing source family in this case.",
          );
        if (family.rows[0].profile !== input.profile)
          throw new AppError(
            422,
            "PROFILE_CHANGED",
            "A source revision must keep its source family profile.",
          );
      }
      const revision = Number(
        (
          await client.query(
            "SELECT COALESCE(max(revision),0)+1 AS revision FROM sources WHERE case_id=$1 AND family_id=$2",
            [caseId, familyId],
          )
        ).rows[0].revision,
      );
      const objectKey = `originals/${caseId}/${id}/${contentHash}`;
      await putOriginal(objectKey, input.bytes, input.mimeType);
      writtenKey = objectKey;
      const source = (
        await client.query(
          `INSERT INTO sources(id,case_id,family_id,revision,name,profile,mime_type,bytes,sha256,object_key,status)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'received') RETURNING *`,
          [
            id,
            caseId,
            familyId,
            revision,
            input.name,
            input.profile,
            input.mimeType,
            input.bytes.length,
            contentHash,
            objectKey,
          ],
        )
      ).rows[0];
      const payload = {
        sourceId: id,
        profile: input.profile,
        objectKey,
        sha256: contentHash,
        bytes: input.bytes.length,
      };
      await client.query(
        `INSERT INTO jobs(id,case_id,source_id,operation,input_fingerprint,payload) VALUES($1,$2,$3,'inspect',$4,$5)`,
        [randomUUID(), caseId, id, fingerprint(payload), payload],
      );
      await recordEvent(
        client,
        caseId,
        "source.received",
        `${input.name} r${revision} received and verified; inspection queued.`,
      );
      await saveOperation(client, caseId, input.operationKey, "upload", hash, {
        sourceId: id,
      });
      return sourceFrom(source);
    });
  } catch (error) {
    if (writtenKey) await removeOrphan(writtenKey).catch(() => {});
    throw error;
  }
}

function ringGeoJson(points: Point2[]): string {
  const ring = points.slice();
  if (ring[0][0] !== ring.at(-1)![0] || ring[0][1] !== ring.at(-1)![1])
    ring.push(ring[0]);
  return JSON.stringify({ type: "Polygon", coordinates: [ring] });
}
export async function persistUnit(client: PoolClient, caseId: string, unit: UnitSpec) {
  // Store the same open-ring convention returned by the geometry engine.
  const first = unit.footprint[0],
    last = unit.footprint.at(-1)!;
  if (unit.footprint.length > 3 && first[0] === last[0] && first[1] === last[1])
    unit.footprint = unit.footprint.slice(0, -1);
  const geometry = ringGeoJson(unit.footprint);
  const valid = (
    await client.query(
      `SELECT ST_IsValid(g) AND NOT ST_IsEmpty(g) AND ST_Area(g)>0.00000001 AS valid
    FROM (SELECT ST_SetSRID(ST_GeomFromGeoJSON($1),0) AS g) q`,
      [geometry],
    )
  ).rows[0].valid;
  if (!valid)
    throw new AppError(
      422,
      "INVALID_FOOTPRINT",
      `${unit.alias}: the outline must be a non-intersecting polygon with positive area.`,
    );
  if (unit.lower !== null && unit.upper !== null && unit.lower >= unit.upper)
    throw new AppError(
      422,
      "INVALID_LEVELS",
      `${unit.alias}: upper elevation must exceed lower elevation.`,
    );
  await client.query(
    `INSERT INTO units(id,case_id,alias,revision,body,footprint) VALUES($1,$2,$3,$4,$5,ST_SetSRID(ST_GeomFromGeoJSON($6),0))
    ON CONFLICT(id) DO UPDATE SET revision=EXCLUDED.revision,body=EXCLUDED.body,footprint=EXCLUDED.footprint,active=true,updated_at=now()`,
    [unit.id, caseId, unit.alias, unit.revision, unit, geometry],
  );
  await client.query(
    "INSERT INTO unit_revisions(unit_id,revision,body) VALUES($1,$2,$3)",
    [unit.id, unit.revision, unit],
  );
  await persistIdentity(client, caseId, unit);
}
function supportedRow(
  row: LevelRow | undefined,
  frame: CoordinateFrame,
): row is LevelRow {
  if (!row) return false;
  if (row.unit !== "m" || row.benchmark !== frame.benchmark)
    throw new AppError(
      422,
      "INCOMPATIBLE_REFERENCE",
      `Level row ${row.alias} uses an incompatible unit or benchmark.`,
    );
  return Boolean(row.method.trim());
}
export async function prepareCase(
  caseId: string,
  input: {
    spatialSourceId: string;
    levelSourceId?: string;
    controlSourceId?: string;
  },
): Promise<CaseDetail> {
  await transaction(async (client) => {
    await lockCase(client, caseId);
    const spatial = await usableSource(
      client,
      caseId,
      input.spatialSourceId,
      "parcel-local-json-v1",
    );
    const inspection = spatial.inspection as InspectionResult;
    if (!inspection.frame || !inspection.features?.length)
      throw new AppError(
        422,
        "MISSING_GEOMETRY",
        "The spatial source contains no usable features or frame.",
      );
    const frame = inspection.frame;
    const levels = input.levelSourceId
      ? await usableSource(client, caseId, input.levelSourceId, "levels-csv-v1")
      : null;
    const controls = input.controlSourceId
      ? await usableSource(
          client,
          caseId,
          input.controlSourceId,
          "control-csv-v1",
        )
      : null;
    if (
      controls &&
      (controls.inspection as InspectionResult).controls?.some(
        (p) => p.benchmark !== frame.benchmark,
      )
    )
      throw new AppError(
        422,
        "INCOMPATIBLE_REFERENCE",
        "The control source uses a different local benchmark.",
      );
    const oldRows = await client.query(
      "SELECT id,alias,revision FROM units WHERE case_id=$1",
      [caseId],
    );
    const old = new Map<string, Row>(
      oldRows.rows.map((row) => [row.alias, row]),
    );
    const levelMap = new Map<string, LevelRow>(
      ((levels?.inspection as InspectionResult | undefined)?.levels ?? []).map(
        (row) => [row.alias, row],
      ),
    );
    const context: ContextFeature[] = [];
    await client.query("UPDATE units SET active=false WHERE case_id=$1", [
      caseId,
    ]);
    let count = 0;
    for (const feature of inspection.features) {
      if (feature.kind === "parcel" || feature.kind === "building") {
        context.push({
          alias: feature.alias,
          kind: feature.kind,
          footprint: feature.footprint,
          name: feature.name,
          evidence: {sourceId: spatial.id, locator: `feature ${feature.alias}`},
        });
        continue;
      }
      const level = levelMap.get(feature.alias);
      const support = supportedRow(level, frame);
      const bindings: EvidenceBindings = {
        footprint: {
          sourceId: spatial.id,
          locator: `feature ${feature.alias}`,
        },
        alignment: controls
          ? { sourceId: controls.id, locator: "local control coordinates" }
          : { sourceId: spatial.id, locator: `frame ${frame.id}` },
      };
      if (support && level.lower !== null)
        bindings.lower = { sourceId: levels!.id, locator: level.locator };
      if (support && level.upper !== null)
        bindings.upper = { sourceId: levels!.id, locator: level.locator };
      const previous = old.get(feature.alias);
      const unit: UnitSpec = {
        id: previous?.id ?? randomUUID(),
        alias: feature.alias,
        name: feature.name,
        kind: feature.kind,
        footprint: feature.footprint,
        lower:
          support && level.lower !== null
            ? level.lower
            : (feature.draftLower ?? null),
        upper:
          support && level.upper !== null
            ? level.upper
            : (feature.draftUpper ?? null),
        lowerVerified: support && level.lower !== null,
        upperVerified: support && level.upper !== null,
        bindings,
        revision: (previous?.revision ?? 0) + 1,
        levelLabel: feature.levelLabel ?? "",
      };
      await persistUnit(client, caseId, unit);
      count++;
    }
    if (!count)
      throw new AppError(
        422,
        "NO_UNITS",
        "Add unit footprints to the spatial source before preparing a model.",
      );
    await client.query(
      "UPDATE cases SET frame=$2,context=$3,revision=revision+1,updated_at=now() WHERE id=$1",
      [caseId, frame, JSON.stringify(context)],
    );
    await recordEvent(
      client,
      caseId,
      "units.prepared",
      `${count} candidate spaces prepared from inspected sources. Unverified draft limits remain labelled.`,
    );
  });
  return getCase(caseId);
}

export async function applyLevels(
  caseId: string,
  input: { sourceId: string; expectedRevision: number },
) {
  await transaction(async (client) => {
    const current = await lockCase(client, caseId);
    if (current.revision !== input.expectedRevision) conflict();
    const source = await usableSource(
      client,
      caseId,
      input.sourceId,
      "levels-csv-v1",
    );
    const levelMap = new Map<string, LevelRow>(
      (source.inspection as InspectionResult).levels?.map((row) => [
        row.alias,
        row,
      ]),
    );
    const rows = await client.query(
      "SELECT body FROM units WHERE case_id=$1 AND active",
      [caseId],
    );
    let count = 0;
    for (const { body } of rows.rows) {
      const unit = body as UnitSpec;
      const level = levelMap.get(unit.alias);
      if (!level) continue;
      if (!supportedRow(level, current.frame))
        throw new AppError(
          422,
          "MISSING_METHOD",
          `The level source needs a measurement method for ${unit.alias}.`,
        );
      unit.revision++;
      unit.lower = level.lower ?? unit.lower;
      unit.upper = level.upper ?? unit.upper;
      unit.lowerVerified = level.lower !== null;
      unit.upperVerified = level.upper !== null;
      if (level.lower !== null)
        unit.bindings.lower = { sourceId: source.id, locator: level.locator };
      else delete unit.bindings.lower;
      if (level.upper !== null)
        unit.bindings.upper = { sourceId: source.id, locator: level.locator };
      else delete unit.bindings.upper;
      await persistUnit(client, caseId, unit);
      count++;
    }
    if (!count)
      throw new AppError(
        422,
        "NO_MATCHING_UNITS",
        "The level schedule has no aliases matching the prepared units.",
      );
    await bumpCase(client, caseId);
    await recordEvent(
      client,
      caseId,
      "evidence.applied",
      `${source.name} r${source.revision} explicitly bound to ${count} spaces. Fresh geometry checks required.`,
    );
  });
  return getCase(caseId);
}

export async function updateUnit(
  caseId: string,
  unitId: string,
  input: {
    expectedRevision: number;
    footprint?: Point2[];
    lower?: number;
    upper?: number;
    calibration?: PlanCalibration;
  },
) {
  return transaction(async (client) => {
    await lockCase(client, caseId);
    const row =
      (
        await client.query(
          "SELECT body FROM units WHERE id=$1 AND case_id=$2 AND active",
          [unitId, caseId],
        )
      ).rows[0] ?? notFound();
    const unit = row.body as UnitSpec;
    if (unit.revision !== input.expectedRevision)
      conflict("This unit has a newer revision. Refresh before saving.");
    if (input.footprint) {
      unit.footprint = input.footprint;
      delete unit.bindings.footprint;
    }
    if (input.lower !== undefined && input.lower !== unit.lower) {
      unit.lower = input.lower;
      unit.lowerVerified = false;
      delete unit.bindings.lower;
    }
    if (input.upper !== undefined && input.upper !== unit.upper) {
      unit.upper = input.upper;
      unit.upperVerified = false;
      delete unit.bindings.upper;
    }
    if (input.calibration) {
      await validateCalibration(client, caseId, input.calibration);
      unit.calibration = input.calibration;
      unit.bindings.footprint = {
        sourceId: input.calibration.sourceId,
        locator: `page ${input.calibration.page}, calibrated outline`,
      };
      unit.bindings.alignment = {
        sourceId: input.calibration.sourceId,
        locator: "two-point local calibration",
      };
    }
    unit.revision++;
    await persistUnit(client, caseId, unit);
    await bumpCase(client, caseId);
    await recordEvent(
      client,
      caseId,
      "unit.edited",
      `${unit.alias} saved as revision ${unit.revision}. Rebuild to refresh quantities and checks.`,
    );
    return unit;
  });
}
async function validateCalibration(
  client: PoolClient,
  caseId: string,
  calibration: PlanCalibration,
) {
  const source = (
    await client.query(
      "SELECT profile,status,inspection FROM sources WHERE id=$1 AND case_id=$2",
      [calibration.sourceId, caseId],
    )
  ).rows[0];
  if (!source || !["plan-png-v1", "plan-pdf-v1"].includes(source.profile))
    throw new AppError(
      422,
      "INVALID_PLAN_SOURCE",
      "Calibration must reference a plan in this case.",
    );
  if (
    !["ready", "needs_input"].includes(source.status) ||
    source.inspection?.issues?.some(
      (issue: { severity: string }) => issue.severity === "error",
    )
  )
    throw new AppError(
      422,
      "PLAN_NOT_READY",
      "Wait for valid plan inspection before saving its calibration.",
    );
  const distance = (pair: [Point2, Point2]) =>
    Math.hypot(pair[1][0] - pair[0][0], pair[1][1] - pair[0][1]);
  if (
    distance(calibration.imagePoints) < 1 ||
    distance(calibration.worldPoints) < 0.0001
  )
    throw new AppError(
      422,
      "DEGENERATE_CALIBRATION",
      "Choose two distinct image points and two distinct local control coordinates.",
    );
}
export async function addUnit(
  caseId: string,
  input: {
    alias: string;
    name: string;
    kind: UnitKind;
    footprint: Point2[];
    lower: number;
    upper: number;
    levelLabel?: string;
    calibration?: PlanCalibration;
  },
) {
  return transaction(async (client) => {
    await lockCase(client, caseId);
    if (
      (
        await client.query(
          "SELECT id FROM units WHERE case_id=$1 AND alias=$2",
          [caseId, input.alias],
        )
      ).rowCount
    )
      throw new AppError(409, "ALIAS_EXISTS", "Choose a different unit alias.");
    const bindings: EvidenceBindings = {};
    if (input.calibration) {
      await validateCalibration(client, caseId, input.calibration);
      bindings.footprint = {
        sourceId: input.calibration.sourceId,
        locator: `page ${input.calibration.page}, traced outline`,
      };
      bindings.alignment = {
        sourceId: input.calibration.sourceId,
        locator: "two-point local calibration",
      };
    }
    const unit: UnitSpec = {
      ...input,
      id: randomUUID(),
      revision: 1,
      lowerVerified: false,
      upperVerified: false,
      levelLabel: input.levelLabel ?? "",
      bindings,
    };
    await persistUnit(client, caseId, unit);
    await bumpCase(client, caseId);
    await recordEvent(
      client,
      caseId,
      "unit.created",
      `${unit.alias} created from a manual outline. Entered elevations are unverified.`,
    );
    return unit;
  });
}

export async function requestBuild(caseId: string, expectedRevision: number) {
  return transaction(async (client) => {
    const current = await lockCase(client, caseId);
    if (current.revision !== expectedRevision) conflict();
    const units = (
      await client.query(
        "SELECT body FROM units WHERE case_id=$1 AND active ORDER BY alias",
        [caseId],
      )
    ).rows.map((row) => row.body as UnitSpec);
    if (!units.length)
      throw new AppError(
        422,
        "NO_UNITS",
        "Prepare footprints and levels before building the model.",
      );
    if (units.length > 100)
      throw new AppError(
        422,
        "PROFILE_LIMIT",
        "This demo supports at most 100 spaces per case.",
      );
    const missing = units
      .filter((unit) => unit.lower === null || unit.upper === null)
      .map((unit) => unit.alias);
    if (missing.length)
      throw new AppError(
        422,
        "MISSING_LEVELS",
        `Enter explicit lower and upper limits for ${missing.join(", ")}. Unknown measurements are never guessed.`,
        { unitAliases: missing },
      );
    const hash = fingerprint({
      frame: current.frame,
      units,
      context: current.context,
      caseRevision: current.revision,
      profile: "prism-v1",
    });
    const existing = (
      await client.query(
        "SELECT * FROM jobs WHERE case_id=$1 AND operation='build' AND input_fingerprint=$2 AND status IN ('queued','running','succeeded') ORDER BY created_at DESC LIMIT 1",
        [caseId, hash],
      )
    ).rows[0];
    if (existing) return jobFrom(existing);
    const payload: BuildInput = {
      frame: current.frame,
      units,
      context: current.context,
      inputFingerprint: hash,
    };
    const job = (
      await client.query(
        "INSERT INTO jobs(id,case_id,operation,case_revision,input_fingerprint,payload) VALUES($1,$2,'build',$3,$4,$5) RETURNING *",
        [randomUUID(), caseId, current.revision, hash, payload],
      )
    ).rows[0];
    await recordEvent(
      client,
      caseId,
      "model.queued",
      `Model construction and spatial checks queued for candidate revision ${current.revision}.`,
    );
    return jobFrom(job);
  });
}
export async function retryJob(jobId: string) {
  return transaction(async (client) => {
    const original =
      (await client.query("SELECT * FROM jobs WHERE id=$1", [jobId])).rows[0] ??
      notFound();
    if (original.operation === "spatial-inference")
      throw new AppError(422, "ML_ITEM_RETRY_REQUIRED", "Retry this extraction from its spatial batch item so its source, model and attempt history stay linked.");
    const current = await lockCase(client, original.case_id);
    if (original.status !== "failed")
      throw new AppError(
        409,
        "JOB_NOT_FAILED",
        "Only a failed job can be retried.",
      );
    if (
      original.operation === "build" &&
      original.case_revision !== current.revision
    )
      conflict(
        "Inputs changed since this job. Build the current candidate instead.",
      );
    const existing = (
      await client.query(
        "SELECT * FROM jobs WHERE case_id=$1 AND input_fingerprint=$2 AND status IN ('queued','running') LIMIT 1",
        [original.case_id, original.input_fingerprint],
      )
    ).rows[0];
    if (existing) return jobFrom(existing);
    const next = (
      await client.query(
        "INSERT INTO jobs(id,case_id,source_id,operation,case_revision,input_fingerprint,payload) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
        [
          randomUUID(),
          original.case_id,
          original.source_id,
          original.operation,
          original.case_revision,
          original.input_fingerprint,
          original.payload,
        ],
      )
    ).rows[0];
    if (original.source_id)
      await client.query("UPDATE sources SET status='received' WHERE id=$1", [
        original.source_id,
      ]);
    return jobFrom(next);
  });
}

const demoProfiles: Record<string, { profile: SourceProfile; mime: string }> = {
  "spatial.json": { profile: "parcel-local-json-v1", mime: "application/json" },
  "levels-r1.csv": { profile: "levels-csv-v1", mime: "text/csv" },
  "levels-r2.csv": { profile: "levels-csv-v1", mime: "text/csv" },
  "controls.csv": { profile: "control-csv-v1", mime: "text/csv" },
  "plan.png": { profile: "plan-png-v1", mime: "image/png" },
  "plan.pdf": { profile: "plan-pdf-v1", mime: "application/pdf" },
};
export async function readDemoFile(dataset: string, name: string) {
  if (!["c001", "c002", "real-nyc"].includes(dataset) || !demoProfiles[name])
    notFound();
  if (
    dataset === "real-nyc" &&
    !["spatial.json", "levels-r1.csv"].includes(name)
  )
    notFound();
  return {
    bytes: await readFile(path.join(settings.fixtureRoot, dataset, name)),
    ...demoProfiles[name],
  };
}
export async function loadDemoInputs(
  caseId: string,
  dataset: "c001" | "c002" | "real-nyc",
  operationKey?: string,
) {
  if((await query("SELECT 1 FROM building_preparations WHERE case_id=$1",[caseId])).rowCount)
    throw new AppError(422,"PROPERTY_EVIDENCE_REQUIRED","Add this property's own evidence in its block workspace. Sample datasets belong in a separate demonstration workspace.");
  const sourceIds: string[] = [];
  for (const name of dataset === "real-nyc"
    ? ["spatial.json", "levels-r1.csv"]
    : [
        "spatial.json",
        "levels-r1.csv",
        "controls.csv",
        "plan.png",
        "plan.pdf",
      ]) {
    const file = await readDemoFile(dataset, name);
    const source = await uploadSource(caseId, {
      name,
      bytes: file.bytes,
      mimeType: file.mime,
      profile: file.profile,
      operationKey: `${operationKey || `demo-${dataset}`}:${name}`,
    });
    sourceIds.push(source.id);
  }
  return { sourceIds };
}
export async function readRealDemoAsset(name: string) {
  if (!["original.geojson", "provenance.json"].includes(name)) notFound();
  return readFile(path.join(settings.fixtureRoot, "real-nyc", name));
}
export async function loadDemoLevels(caseId: string, dataset: "c001" | "c002") {
  const existing = (
    await query(
      "SELECT family_id FROM sources WHERE case_id=$1 AND name='levels-r1.csv' AND profile='levels-csv-v1' ORDER BY created_at DESC LIMIT 1",
      [caseId],
    )
  ).rows[0];
  const file = await readDemoFile(dataset, "levels-r2.csv");
  return uploadSource(caseId, {
    name: "levels-r2.csv",
    bytes: file.bytes,
    mimeType: file.mime,
    profile: file.profile,
    familyId: existing?.family_id,
    operationKey: `demo-${dataset}:levels-r2.csv`,
  });
}
