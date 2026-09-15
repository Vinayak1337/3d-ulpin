/** Add the complete fictional workflow to Lake View, preserving all existing revisions. */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pool, query, transaction } from "../../apps/web/lib/server/db";
import { migrateAreas } from "../../apps/web/lib/server/area-db";
import {
  listAreas,
  getArea,
  areaContext,
  ingestArea,
  reviewPackage,
  commitPackage,
  attachDocument,
  getPackage,
  runAreaCheck,
} from "../../apps/web/lib/server/areas";
import { openPreparation } from "../../apps/web/lib/server/officer";
import { bindExternalIdentifier } from "../../apps/web/lib/server/area-resolver";
import type { ImportPackage, SceneAsset } from "../../packages/contracts/src";
const root = new URL("../../fixtures/complete-demo/", import.meta.url);
const spec = JSON.parse(await readFile(new URL("spec.json", root), "utf8"));
const reason = spec.notice;
const lock = await pool().connect();
try {
  await migrateAreas();
  if (
    !(
      await lock.query(
        "SELECT pg_try_advisory_lock(hashtext('lakeview-demo-seed')) ok",
      )
    ).rows[0].ok
  )
    throw Error("Another Lake View seed is running.");
  const area = (await listAreas()).find(
    (a) => a.name === "Lake View · demonstration",
  );
  if (!area || area.dataKind !== "demonstration")
    throw Error(
      "Run pnpm demo:seed first. Existing Lake View must be entirely fictional.",
    );
  const packages: ImportPackage[] = [];
  for (const addition of spec.additions) {
    const namespace = `lakeview-complete:${addition.key}`;
    const bytes = await readFile(new URL(addition.key + ".arcgis.json", root));
    const existing = (
      await query(
        "SELECT body FROM import_packages WHERE body->>'namespace'=$1 AND area_id=$2 AND state='COMMITTED' ORDER BY created_at LIMIT 1",
        [namespace, area.id],
      )
    ).rows[0]?.body;
    let pkg: ImportPackage =
      existing ||
      (await ingestArea({
        bytes,
        filename: addition.key + ".arcgis.json",
        format: "arcgis",
        namespace,
        name: area.name,
        areaId: area.id,
        expectedAreaRevision: (await getArea(area.id)).revision,
        worldStatus: "synthetic",
        mapping: {
          idField: "key",
          nameField: "name",
          kind: addition.kind,
          geometryRole: addition.geometryRole,
          heightField: addition.kind === "building" ? "height" : undefined,
          heightUnit: "m",
          levelReference: spec.benchmark,
        },
      }));
    if (pkg.state !== "COMMITTED") {
      pkg = await reviewPackage(pkg.id, pkg.revision);
      pkg = await commitPackage(pkg.id, pkg.revision, reason);
    }
    packages.push(pkg);
  }
  const context = await areaContext(area.id);
  const kiosk = context.features.find(
    (f) => f.datasetNamespace === "lakeview-complete:K1",
  )!;
  const location = (
    await query(
      "SELECT ST_X(p) x,ST_Y(p) y FROM (SELECT ST_Transform(ST_SetSRID(ST_MakePoint($1,$2),32643),4326) p) t",
      [spec.origin[0] + 62, spec.origin[1] + 28],
    )
  ).rows[0];
  const asset: SceneAsset = {
    featureId: kiosk.id,
    featureRevision: 1,
    url: "/scene-assets/complete-demo/kiosk.glb",
    sha256: spec.kioskAssetHash,
    frame: `AREA-${area.id}`,
    position: [location.x, location.y, 0],
    heading: 90,
    purpose: "presentation",
    provenance:
      "Authored fictional kiosk. Decorative facade is separate from the imported analytical footprint.",
  };
  const assetBytes = await readFile(
    new URL("../../apps/web/public" + asset.url, import.meta.url),
  );
  if (createHash("sha256").update(assetBytes).digest("hex") !== asset.sha256)
    throw Error("Kiosk asset hash mismatch");
  const oldAsset = (
    await query(
      "SELECT body FROM scene_asset_bindings WHERE feature_id=$1 AND feature_revision=1",
      [kiosk.id],
    )
  ).rows[0]?.body;
  if (
    oldAsset &&
    JSON.stringify(oldAsset) !==
      JSON.stringify(JSON.parse(JSON.stringify(asset)))
  ) {
    // JSONB key order differs; compare the authored fields without overwriting.
    for (const key of Object.keys(asset))
      if (
        JSON.stringify(oldAsset[key]) !==
        JSON.stringify(asset[key as keyof SceneAsset])
      )
        throw Error("Existing kiosk asset binding differs; preserved.");
  }
  if (kiosk.revision === 1)
    await query(
      "INSERT INTO scene_asset_bindings(feature_id,feature_revision,body) VALUES($1,1,$2) ON CONFLICT DO NOTHING",
      [kiosk.id, asset],
    );
  const preparation = await openPreparation(kiosk.id, kiosk.revision);
  let packet = await getPackage(preparation.packageId);
  for (const [name, format] of [["site-and-identity-schedule.pdf", "pdf"]]) {
    const bytes = await readFile(new URL(name, root));
    const sha = createHash("sha256").update(bytes).digest("hex");
    const exists = (
      await query(
        "SELECT id FROM sources WHERE id=ANY($1::uuid[]) AND sha256=$2",
        [packet.sourceRevisionIds, sha],
      )
    ).rows[0];
    if (!exists)
      packet = await attachDocument(packet.id, packet.revision, {
        bytes,
        name,
        format,
        entityIds: [kiosk.id],
      });
  }
  const identityBytes = await readFile(
    new URL("site-and-identity-schedule.pdf", root),
  );
  const source = (
    await query(
      "SELECT id FROM sources WHERE id=ANY($1::uuid[]) AND sha256=$2",
      [
        packet.sourceRevisionIds,
        createHash("sha256").update(identityBytes).digest("hex"),
      ],
    )
  ).rows[0];
  for (const [index, item] of spec.parcelIds.entries()) {
    const parcel = context.features.find(
      (f) =>
        f.kind === "parcel" &&
        f.sourceKey === item.parcelKey &&
        f.datasetNamespace === "lakeview-demonstration:parcel",
    );
    if (!parcel) throw Error("Original parcel missing: " + item.parcelKey);
    await bindExternalIdentifier({
      featureId: parcel.id,
      expectedRevision: parcel.revision,
      scheme: "demo_ulpin",
      value: item.value,
      issuer: "Lake View fictional training schedule",
      sourceId: source.id,
      locator: `Page 1, parcel schedule: ${item.parcelKey} = ${item.value}`,
    });
  }
  const refreshed = await areaContext(area.id);
  const check =
    refreshed.latestCheck && !refreshed.latestCheck.stale
      ? refreshed.latestCheck
      : await runAreaCheck(area.id, (await getArea(area.id)).revision);
  console.log("Computed check:", check.id);
  // User requested removal of these two exact demo entries. Keep every source and historical URL recoverable.
  await transaction(async (client) => {
    for (const [id, name] of [
      [
        "e4eea7b8-f1f0-4ea0-bd82-29e0c2a740a3",
        "V2 redesign verification · synthetic",
      ],
      [
        "8c61a45e-3ae9-4c7c-95f2-78918f23582a",
        "Synthetic officer UI test · not a real survey",
      ],
    ]) {
      const row = (
        await client.query(
          "SELECT name FROM map_areas WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (!row) continue;
      if (row.name !== name)
        throw Error("Cleanup target was renamed; preserved: " + id);
      const unsafe = (
        await client.query(
          "SELECT id FROM physical_features WHERE area_id=$1 AND revision>0 AND body->>'worldStatus' IS DISTINCT FROM 'synthetic' LIMIT 1",
          [id],
        )
      ).rows[0];
      if (unsafe)
        throw Error("Cleanup target includes non-demo data; preserved: " + id);
      await client.query(
        "UPDATE map_areas SET archived_at=COALESCE(archived_at,now()),archive_reason=COALESCE(archive_reason,$2) WHERE id=$1",
        [
          id,
          "User requested removal of duplicate demos; retained originals and history.",
        ],
      );
    }
  });
  console.log(
    `Complete fictional block: /blocks/${area.id}; original eight properties preserved; two extra demo entries archived.`,
  );
} finally {
  await lock.query("SELECT pg_advisory_unlock(hashtext('lakeview-demo-seed'))");
  lock.release();
  await pool().end();
}
