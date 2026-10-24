import { assertSourceWorkspaceReference } from "../cases/source-workspace-policy";
import { z } from "zod";
import {
  RetainedImagerySchema, type AreaReference, type CoordinateFrame, type ImportPackage,
  type SpatialMlComponent, type SpatialMlItem,
} from "@ulpin/contracts";
import type { PoolClient } from 'pg';
import { geographicMlComponent, projectedGeographicComponents } from './spatial-ml-georeference';
import { transaction } from "../../infrastructure/db";
import { getArea, getPackage, ingestArea } from "../areas/areas";
import { assertPackageDocumentAuthority } from "../areas/package-authority";
import { AppError, conflict } from "../../infrastructure/errors";
import { fingerprint } from "../cases/domain";
import { localOperatorSubject } from '../usp/principal';
import {
  getSpatialMlItemRecord,
  assertSpatialMlSourceCurrent,
  deriveSpatialMlGeometry,
  spatialMlCalibrationSchema,
  assertSpatialMlPackageScope,
} from "./spatial-ml";

export const spatialMlFootprintDraftSchema = z
  .object({
    requestKey: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
    expectedAreaRevision: z.number().int().nonnegative(),
    selections: z
      .array(
        z
          .object({
            componentId: z.string().min(1).max(120),
            subject: z.string().trim().min(1).max(60),
          })
          .strict(),
      )
      .max(100),
    rejected: z.array(z.strictObject({ componentId: z.string().min(1).max(120),
      reason: z.string().trim().min(3).max(2000) })).max(100).optional(),
    reason: z.string().trim().min(3).max(2000).optional(),
    calibration: spatialMlCalibrationSchema.optional(),
    georeference: z.literal('source_geotiff').optional(),
  })
  .strict()
  .refine(input => Boolean(input.calibration) !== Boolean(input.georeference),
    'Choose reviewed controls or the exact source GeoTIFF reference, never both.')
  .refine(input => input.selections.length > 0 || Boolean(input.rejected?.length),
    'Select at least one component to accept or reject.')
  .refine(input => !input.selections.length || !input.rejected?.length || Boolean(input.reason),
    'Describe the accepted candidate selection as well as rejections.');

type DraftInput = z.infer<typeof spatialMlFootprintDraftSchema>;
type DraftResult = { package: ImportPackage | null; receipt: Record<string, unknown> };
type StoredDraft = { request_digest?: string; package_id: string | null; body: Record<string, unknown> };
type DraftContext = {
  item: SpatialMlItem; sourcePackage: ImportPackage;
  part: Awaited<ReturnType<typeof assertSpatialMlSourceCurrent>>;
  area: Awaited<ReturnType<typeof getArea>> & { reference: AreaReference };
  frame: CoordinateFrame; components: SpatialMlComponent[];
  selections: DraftInput['selections']; worldStatus: ImportPackage['features'][number]['worldStatus'];
};

async function georeferencedComponentsTx(
  client: PoolClient, item: SpatialMlItem, pkg: ImportPackage, reference: AreaReference,
): Promise<SpatialMlComponent[]> {
  const imagery = RetainedImagerySchema.parse('imagery' in pkg ? pkg.imagery : undefined);
  const chip = imagery.chips.find(value => value.sourceId === item.sourceRevisionId);
  if (!chip || !item.result || item.state !== 'succeeded') {
    throw new AppError(422, 'ML_GEOREFERENCE_SOURCE', 'Select completed pixels from this exact image workspace.');
  }
  return projectedGeographicComponents(client,
    item.result.components.map(component => geographicMlComponent(item, chip, component)), reference);
}

/** Explicit adapter: local metre proposals -> projected native GIS -> ordinary area review. */
export function projectedMlRings(
  geometry: SpatialMlComponent["geometry"],
  origin: [number, number],
): number[][][] {
  const polygons =
    geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.flatMap((polygon) =>
    polygon.map((ring) => ring.map(([x, y]) => [x + origin[0], y + origin[1]])),
  );
}

async function lockFootprintRequestTx(client: PoolClient, id: string, requestKey: string): Promise<void> {
  // Serialize with placement/recording before holding package or item locks.
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('physical-area-recording',0))");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`ml-footprint:${id}:${requestKey}`]);
}

async function storedDraftResultTx(client: PoolClient, prior: StoredDraft): Promise<DraftResult> {
  return { package: prior.package_id ? await getPackage(prior.package_id, client) : null, receipt: prior.body };
}

function footprintWorldStatus(pkg: ImportPackage, entityIds: string[]): DraftContext['worldStatus'] {
  if (pkg.sourceWorkspace) return pkg.sourceWorkspace.worldStatus;
  const entities = pkg.features.filter(feature => entityIds.includes(feature.id));
  if (!entities.length) conflict("This source needs an explicit property or source-workspace association.");
  for (const status of ['synthetic', 'hypothetical', 'planned'] as const) {
    if (entities.some(feature => feature.worldStatus === status)) return status;
  }
  return 'observed';
}

function checkFootprintReference(area: Awaited<ReturnType<typeof getArea>>, frame: CoordinateFrame,
  input: DraftInput): asserts area is DraftContext['area'] {
  if (!area.reference || !/^EPSG:\d+$/.test(area.reference.analysisCrs) || !frame?.id) {
    throw new AppError(422, "ML_AREA_REFERENCE",
      "This area needs a retained projected metre reference before imagery can be placed.");
  }
  if (input.calibration && input.calibration.frame !== frame.id) {
    throw new AppError(422, "ML_AREA_FRAME",
      `Building controls must use this area's named metre frame: ${frame.id}.`);
  }
}

async function footprintContextTx(client: PoolClient, id: string, input: DraftInput): Promise<DraftContext> {
  const initial = await getSpatialMlItemRecord(id, client);
  const sourceRow = (await client.query("SELECT body FROM import_packages WHERE id=$1 FOR SHARE",
    [initial.item.packageId])).rows[0];
  if (sourceRow) await assertPackageDocumentAuthority(client, sourceRow.body);
  const record = await getSpatialMlItemRecord(id, client, true);
  const item = record.item;
  if (item.task !== "building") {
    throw new AppError(422, "ML_TASK", "Only the building extraction profile can create footprint drafts.");
  }
  const sourcePackage = sourceRow?.body as ImportPackage | undefined;
  if (!sourcePackage || sourcePackage.revision !== input.expectedRevision || sourcePackage.state === "COMMITTED") {
    conflict("The source preparation changed. Refresh before creating a footprint draft.");
  }
  const part = await assertSpatialMlSourceCurrent(record, sourcePackage, client);
  const areaRow = (await client.query("SELECT revision FROM map_areas WHERE id=$1 FOR SHARE",
    [sourcePackage.areaId])).rows[0];
  if (!areaRow || areaRow.revision !== input.expectedAreaRevision) {
    conflict("The destination area changed. Refresh before recording a footprint decision.");
  }
  const area = await getArea(sourcePackage.areaId, client);
  const frame = (await client.query("SELECT frame FROM registry_sites WHERE id=$1", [area.siteId])).rows[0]?.frame;
  checkFootprintReference(area, frame, input);
  if (sourcePackage.sourceWorkspace) {
    assertSourceWorkspaceReference(sourcePackage.sourceWorkspace, frame, area.reference);
  }
  const components = input.georeference
    ? await georeferencedComponentsTx(client, item, sourcePackage, area.reference)
    : deriveSpatialMlGeometry(item, input.calibration!);
  const selections = [...input.selections].sort((left, right) => left.componentId.localeCompare(right.componentId));
  return { item, sourcePackage, part, area, frame, components, selections,
    worldStatus: footprintWorldStatus(sourcePackage, part.entityIds) };
}

function checkFootprintComponents(input: DraftInput, components: SpatialMlComponent[]): void {
  const ids = [...input.selections, ...(input.rejected ?? [])].map(entry => entry.componentId);
  if (new Set(ids).size !== ids.length || ids.some(id => !components.some(component => component.id === id))) {
    throw new AppError(422, 'ML_REVIEW_SELECTION', 'Accept or reject each exact retained component at most once.');
  }
  for (const selection of input.selections) {
    const component = components.find(value => value.id === selection.componentId);
    if (!component || !/building/i.test(component.className)) {
      throw new AppError(422, "ML_SELECTION", "Choose building components from this exact retained result.");
    }
  }
}

/** A current inference component has one immutable source-selection decision across request keys. */
export async function assertUndecidedFootprintComponentsTx(client: PoolClient, item: SpatialMlItem,
  input: DraftInput): Promise<void> {
  const ids = new Set([...input.selections, ...(input.rejected ?? [])].map(entry => entry.componentId));
  const rows = (await client.query<{ body: { jobId: string; decisions?: { componentId: string }[] } }>(
    "SELECT body FROM spatial_ml_footprint_drafts WHERE item_id=$1", [item.id],
  )).rows;
  if (rows.some(({ body }) => body.jobId === item.currentJobId
    && body.decisions?.some(decision => ids.has(decision.componentId)))) {
    throw new AppError(422, 'ML_REVIEW_SELECTION', 'This retained component already has a source-selection decision.');
  }
}

function applicationFingerprint(context: DraftContext, input: DraftInput): string {
  const { item, area, selections, worldStatus } = context;
  return fingerprint({ inference: item.inputFingerprint, raster: item.result!.raster.sha256, selections,
    rejected: input.rejected ?? [], reason: input.reason ?? null,
    calibration: input.calibration ?? null, georeference: input.georeference ?? null,
    areaId: area.id, worldStatus, reference: area.reference });
}

function footprintTarget(context: DraftContext, input: DraftInput) {
  const { area, frame } = context;
  return { areaId: area.id, frame: frame.id, coordinateFrame: frame,
    areaReferenceFingerprint: fingerprint(area.reference), analysisCrs: area.reference.analysisCrs,
    origin: area.reference.origin, expectedRevision: input.expectedAreaRevision };
}

function footprintReceipt(context: DraftContext, input: DraftInput, inputFingerprint: string): Record<string, unknown> {
  const { item, sourcePackage, worldStatus, selections } = context;
  const actor = localOperatorSubject();
  const time = new Date().toISOString();
  const decisions = (input.rejected ?? []).map(rejection => ({ ...rejection, outcome: 'rejected', actor, time }));
  if (input.reason) {
    decisions.unshift(...selections.map(selection => ({ componentId: selection.componentId, outcome: 'accepted',
      reason: input.reason!, actor, time })));
  }
  return { schemaVersion: "spatial-footprint-derivation/1", itemId: item.id, jobId: item.currentJobId,
    inputFingerprint, inferenceFingerprint: item.inputFingerprint,
    originalSourceRevisionId: item.sourceRevisionId, originalSha256: item.sourceSha256,
    originalPartId: item.partId, sourceWorkspace: sourcePackage.sourceWorkspace, worldStatus, page: item.page,
    rasterSha256: item.result!.raster.sha256, model: item.result!.model, inferenceReceipt: item.result!.receipt,
    calibration: input.calibration ?? null, georeference: input.georeference ?? null, selections, decisions,
    reviewScope: 'source_candidate_selection_only; registry recording and analytical qualification remain separate',
    target: footprintTarget(context, input),
    method: input.georeference ? 'deterministic:source-geotiff-pixel-to-area@1'
      : "reviewed pixel-to-metre similarity, then retained area origin addition",
    authority: "Unreviewed model-derived footprint proposals. Height and ownership remain unknown." };
}

async function saveFootprintReceiptTx(client: PoolClient, id: string, input: DraftInput,
  digest: string, packageId: string | null, receipt: Record<string, unknown>): Promise<void> {
  await client.query(
    "INSERT INTO spatial_ml_footprint_drafts(item_id,request_key,request_digest,package_id,body)"
      + " VALUES($1,$2,$3,$4,$5)",
    [id, input.requestKey, digest, packageId, receipt],
  );
}

/** Rejection retains a review receipt only; no import, feature, geometry or item draft list is written. */
export async function recordRejectedFootprintsTx(client: PoolClient, id: string, input: DraftInput,
  digest: string, receipt: Record<string, unknown>): Promise<DraftResult> {
  await saveFootprintReceiptTx(client, id, input, digest, null, receipt);
  return { package: null, receipt };
}

function nativeFootprintDraft(context: DraftContext, receipt: Record<string, unknown>) {
  const { components, selections, area } = context;
  return { geometryType: "esriGeometryPolygon", spatialReference: { wkid: Number(area.reference.analysisCrs.slice(5)) },
    derivedObservation: receipt, features: selections.map(({ componentId, subject }) => {
      const component = components.find(value => value.id === componentId)!;
      return { attributes: { source_id: componentId, name: subject, model_score: component.score },
        geometry: { rings: projectedMlRings(component.geometry, area.reference.origin) } };
    }) };
}

async function createAcceptedFootprintsTx(client: PoolClient, context: DraftContext, input: DraftInput,
  digest: string, receipt: Record<string, unknown>): Promise<DraftResult> {
  const { item, area, part, worldStatus } = context;
  const bytes = new TextEncoder().encode(JSON.stringify(nativeFootprintDraft(context, receipt)));
  const pkg = await ingestArea({ bytes,
    filename: `derived-building-proposals-${item.id}.json`, format: "arcgis", namespace: `spatial-ml:${item.id}`,
    name: `Imagery footprint review ${item.id.slice(0, 8)}`, areaId: area.id,
    expectedAreaRevision: input.expectedAreaRevision, sourceCrs: area.reference.analysisCrs,
    mapping: { kind: "building", idField: "source_id", nameField: "name", geometryRole: "observed_roof_projection" },
    worldStatus, derivedObservation: { sourceRevisionId: item.sourceRevisionId,
      sourceSha256: item.sourceSha256, part, page: item.page, receipt },
  }, client);
  await saveFootprintReceiptTx(client, item.id, input, digest, pkg.id, receipt);
  item.footprintDrafts = [...(item.footprintDrafts || []), {
    packageId: pkg.id, inputFingerprint: receipt.inputFingerprint as string, createdAt: new Date().toISOString(),
  }];
  await client.query("UPDATE spatial_ml_items SET body=$2,updated_at=now() WHERE id=$1", [item.id, item]);
  return { package: pkg, receipt };
}

async function footprintDecisionTx(client: PoolClient, id: string,
  input: DraftInput, digest: string): Promise<DraftResult> {
  await lockFootprintRequestTx(client, id, input.requestKey);
  const prior = (await client.query<StoredDraft>(
    "SELECT request_digest,package_id,body FROM spatial_ml_footprint_drafts WHERE item_id=$1 AND request_key=$2",
    [id, input.requestKey],
  )).rows[0];
  if (prior) {
    if (prior.request_digest !== digest) {
      throw new AppError(409, "ML_APPLY_KEY",
        "This footprint request key was used for different controls or components.");
    }
    return storedDraftResultTx(client, prior);
  }
  const context = await footprintContextTx(client, id, input);
  checkFootprintComponents(input, context.components);
  const inputFingerprint = applicationFingerprint(context, input);
  const same = (await client.query<StoredDraft>(
    "SELECT package_id,body FROM spatial_ml_footprint_drafts WHERE item_id=$1 AND body->>'inputFingerprint'=$2 LIMIT 1",
    [id, inputFingerprint],
  )).rows[0];
  if (same) {
    await saveFootprintReceiptTx(client, id, input, digest, same.package_id, same.body);
    return storedDraftResultTx(client, same);
  }
  await assertUndecidedFootprintComponentsTx(client, context.item, input);
  const receipt = footprintReceipt(context, input, inputFingerprint);
  if (!input.selections.length) return recordRejectedFootprintsTx(client, id, input, digest, receipt);
  return createAcceptedFootprintsTx(client, context, input, digest, receipt);
}

export async function createSpatialMlFootprintDraft(id: string, value: unknown): Promise<DraftResult> {
  assertSpatialMlPackageScope((await getSpatialMlItemRecord(id)).item);
  const input = spatialMlFootprintDraftSchema.parse(value);
  const digest = fingerprint(input);
  if (new Set(input.selections.map(selection => selection.componentId)).size !== input.selections.length) {
    throw new AppError(422, "ML_SELECTION", "Select each building component once.");
  }
  return transaction(client => footprintDecisionTx(client, id, input, digest));
}
