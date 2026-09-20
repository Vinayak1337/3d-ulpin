import { assertSourceWorkspaceReference } from "./source-workspace-policy";
import { z } from "zod";
import type { ImportPackage, SpatialMlComponent } from "@ulpin/contracts";
import { transaction } from "./db";
import { getArea, getPackage, ingestArea } from "./areas";
import { AppError, conflict } from "./errors";
import { fingerprint } from "./domain";
import {
  getSpatialMlItemRecord,
  assertSpatialMlSourceCurrent,
  deriveSpatialMlGeometry,
  spatialMlCalibrationSchema,
} from "./spatial-ml";

const schema = z
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
      .min(1)
      .max(100),
    calibration: spatialMlCalibrationSchema,
  })
  .strict();

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

export async function createSpatialMlFootprintDraft(
  id: string,
  value: unknown,
): Promise<{ package: ImportPackage; receipt: Record<string, unknown> }> {
  const input = schema.parse(value),
    digest = fingerprint(input);
  const canonicalSelections = [...input.selections].sort((a, b) =>
    a.componentId.localeCompare(b.componentId),
  );
  if (
    new Set(input.selections.map((s) => s.componentId)).size !==
    input.selections.length
  )
    throw new AppError(
      422,
      "ML_SELECTION",
      "Select each building component once.",
    );
  return transaction(async (client) => {
    // Serialize with placement/recording before holding package or item locks.
    // ingestArea participates in this transaction and acquires destination/site locks afterward.
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('physical-area-recording',0))",
    );
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `ml-footprint:${id}:${input.requestKey}`,
    ]);
    const prior = (
      await client.query(
        "SELECT request_digest,package_id,body FROM spatial_ml_footprint_drafts WHERE item_id=$1 AND request_key=$2",
        [id, input.requestKey],
      )
    ).rows[0];
    if (prior) {
      if (prior.request_digest !== digest)
        throw new AppError(
          409,
          "ML_APPLY_KEY",
          "This footprint request key was used for different controls or components.",
        );
      return {
        package: await getPackage(prior.package_id, client),
        receipt: prior.body,
      };
    }
    const initial = await getSpatialMlItemRecord(id, client);
    const sourceRow = (
      await client.query(
        "SELECT body FROM import_packages WHERE id=$1 FOR SHARE",
        [initial.item.packageId],
      )
    ).rows[0];
    const record = await getSpatialMlItemRecord(id, client, true),
      item = record.item;
    if (item.task !== "building")
      throw new AppError(
        422,
        "ML_TASK",
        "Only the building extraction profile can create footprint drafts.",
      );
    const sourcePackage = sourceRow?.body as ImportPackage | undefined;
    if (
      !sourcePackage ||
      sourcePackage.revision !== input.expectedRevision ||
      sourcePackage.state === "COMMITTED"
    )
      conflict(
        "The source preparation changed. Refresh before creating a footprint draft.",
      );
    const part = await assertSpatialMlSourceCurrent(
      record,
      sourcePackage,
      client,
    );
    const area = await getArea(sourcePackage.areaId, client);
    const frame = (
      await client.query("SELECT frame FROM registry_sites WHERE id=$1", [
        area.siteId,
      ])
    ).rows[0]?.frame;
    if (!area.reference || !/^EPSG:\d+$/.test(area.reference.analysisCrs))
      throw new AppError(
        422,
        "ML_AREA_REFERENCE",
        "This area needs a retained projected metre reference before imagery can be placed.",
      );
    if (input.calibration.frame !== frame?.id)
      throw new AppError(
        422,
        "ML_AREA_FRAME",
        `Building controls must use this area's named metre frame: ${frame?.id || "unavailable"}.`,
      );
    const components = deriveSpatialMlGeometry(item, input.calibration);
    const selected = canonicalSelections.map((selection) => {
      const component = components.find((c) => c.id === selection.componentId);
      if (!component || !/building/i.test(component.className))
        throw new AppError(
          422,
          "ML_SELECTION",
          "Choose building components from this exact retained result.",
        );
      return { ...selection, component };
    });
    const originalEntities = sourcePackage.features.filter((f) =>
      part.entityIds.includes(f.id),
    );
    const workspace = sourcePackage.sourceWorkspace;
    if (!originalEntities.length && !workspace)
      conflict("This source needs an explicit property or source-workspace association.");
    if (workspace) assertSourceWorkspaceReference(workspace, frame, area.reference);
    const worldStatus = workspace?.worldStatus || (originalEntities.some(
      (f) => f.worldStatus === "synthetic",
    )
      ? "synthetic"
      : originalEntities.some((f) => f.worldStatus === "hypothetical")
        ? "hypothetical"
        : originalEntities.some((f) => f.worldStatus === "planned")
          ? "planned"
          : "observed");
    const applicationFingerprint = fingerprint({
      inference: item.inputFingerprint,
      raster: item.result!.raster.sha256,
      selections: canonicalSelections,
      calibration: input.calibration,
      areaId: area.id,
      worldStatus,
      reference: area.reference,
    });
    const same = (
      await client.query(
        "SELECT package_id,body FROM spatial_ml_footprint_drafts WHERE item_id=$1 AND body->>'inputFingerprint'=$2 LIMIT 1",
        [id, applicationFingerprint],
      )
    ).rows[0];
    if (same) {
      await client.query(
        "INSERT INTO spatial_ml_footprint_drafts(item_id,request_key,request_digest,package_id,body) VALUES($1,$2,$3,$4,$5)",
        [id, input.requestKey, digest, same.package_id, same.body],
      );
      return { package: await getPackage(same.package_id, client), receipt: same.body };
    }
    const receipt = {
      schemaVersion: "spatial-footprint-derivation/1",
      itemId: id,
      jobId: item.currentJobId,
      inputFingerprint: applicationFingerprint,
      inferenceFingerprint: item.inputFingerprint,
      originalSourceRevisionId: item.sourceRevisionId,
      originalSha256: item.sourceSha256,
      originalPartId: item.partId,
      sourceWorkspace: workspace,
      worldStatus,
      page: item.page,
      rasterSha256: item.result!.raster.sha256,
      model: item.result!.model,
      inferenceReceipt: item.result!.receipt,
      calibration: input.calibration,
      selections: canonicalSelections,
      target: {
        areaId: area.id,
        frame: frame.id,
        coordinateFrame: frame,
        areaReferenceFingerprint: fingerprint(area.reference),
        analysisCrs: area.reference.analysisCrs,
        origin: area.reference.origin,
        expectedRevision: input.expectedAreaRevision,
      },
      method:
        "reviewed pixel-to-metre similarity, then retained area origin addition",
      authority:
        "Unreviewed model-derived footprint proposals. Height and ownership remain unknown.",
    };
    const native = {
      geometryType: "esriGeometryPolygon",
      spatialReference: { wkid: Number(area.reference.analysisCrs.slice(5)) },
      derivedObservation: receipt,
      features: selected.map(({ componentId, subject, component }) => ({
        attributes: {
          source_id: componentId,
          name: subject,
          model_score: component.score,
        },
        geometry: {
          rings: projectedMlRings(component.geometry, area.reference!.origin),
        },
      })),
    };
    const pkg = await ingestArea({
      bytes: new TextEncoder().encode(JSON.stringify(native)),
      filename: `derived-building-proposals-${id}.json`,
      format: "arcgis",
      namespace: `spatial-ml:${id}`,
      name: `Imagery footprint review ${id.slice(0, 8)}`,
      areaId: area.id,
      expectedAreaRevision: input.expectedAreaRevision,
      sourceCrs: area.reference.analysisCrs,
      mapping: {
        kind: "building",
        idField: "source_id",
        nameField: "name",
        geometryRole: "observed_roof_projection",
      },
      worldStatus,
      derivedObservation: {
        sourceRevisionId: item.sourceRevisionId,
        sourceSha256: item.sourceSha256,
        part,
        page: item.page,
        receipt,
      },
    }, client);
    await client.query(
      "INSERT INTO spatial_ml_footprint_drafts(item_id,request_key,request_digest,package_id,body) VALUES($1,$2,$3,$4,$5)",
      [id, input.requestKey, digest, pkg.id, receipt],
    );
    item.footprintDrafts = [
      ...(item.footprintDrafts || []),
      {
        packageId: pkg.id,
        inputFingerprint: applicationFingerprint,
        createdAt: new Date().toISOString(),
      },
    ];
    await client.query(
      "UPDATE spatial_ml_items SET body=$2,updated_at=now() WHERE id=$1",
      [id, item],
    );
    return { package: pkg, receipt };
  });
}
