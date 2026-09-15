/** A repeatable, non-destructive fictional seed through the actual domain pipeline. */
import { seedScenarios } from "./scenarios";
import { readFile, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { query, pool } from "../../apps/web/lib/server/db";
import { migrateAreas } from "../../apps/web/lib/server/area-db";
import {
  ingestArea,
  reviewPackage,
  commitPackage,
  getArea,
  areaContext,
} from "../../apps/web/lib/server/areas";
import type {
  ImportPackage,
  PhysicalFeature,
  SceneAsset,
  CaseDetail,
} from "../../packages/contracts/src";
async function bindAsset(asset: SceneAsset) {
  const bytes = await readFile(
    new URL(`../../apps/web/public${asset.url}`, import.meta.url),
  );
  if (createHash("sha256").update(bytes).digest("hex") !== asset.sha256)
    throw Error(
      `Presentation asset hash does not match the authored specification: ${asset.url}`,
    );
  const existing = (
    await query(
      "SELECT body FROM scene_asset_bindings WHERE feature_id=$1 AND feature_revision=$2",
      [asset.featureId, asset.featureRevision],
    )
  ).rows[0]?.body;
  if (existing) {
    if (
      existing.sha256 !== asset.sha256 ||
      existing.url !== asset.url ||
      JSON.stringify(existing.position) !== JSON.stringify(asset.position) ||
      existing.heading !== asset.heading
    )
      throw Error(
        `An existing presentation binding differs for ${asset.featureId}; preserved for explicit review.`,
      );
    return;
  }
  // Authored assets describe the seed's first geometry revision. A later user
  // edit needs an explicitly reviewed replacement asset, not an automatic rebind.
  if (asset.featureRevision !== 1) {
    console.log(
      `Preserved edited feature ${asset.featureId}; no authored asset attached to revision ${asset.featureRevision}.`,
    );
    return;
  }
  await query(
    "INSERT INTO scene_asset_bindings(feature_id,feature_revision,body) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
    [asset.featureId, asset.featureRevision, asset],
  );
}
const root = new URL("../../fixtures/reference-neighborhood/", import.meta.url);
const spec = JSON.parse(await readFile(new URL("spec.json", root), "utf8")) as {
  name: string;
  landscapeHash: string;
  origin: [number, number];
  benchmark: string;
  buildings: {
    key: string;
    name: string;
    x: number;
    y: number;
    w: number;
    d: number;
    floors: number;
    assetHash: string;
    rooms: {
      alias: string;
      name: string;
      x: number;
      y: number;
      w: number;
      d: number;
    }[];
  }[];
};
const base = process.env.ULPIN_TEST_BASE_URL || "http://127.0.0.1:3000";
const reason =
  "Reviewed against authored fictional Lake View inputs. Demonstration only; no survey, title or approval claim.";
const ring = (x: number, y: number, w: number, d: number) => [
  [x, y],
  [x + w, y],
  [x + w, y + d],
  [x, y + d],
  [x, y],
];
async function api<T = any>(route: string, body?: unknown): Promise<T> {
  const response = await fetch(`${base}/api/v1${route}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw Error(`${route}: ${JSON.stringify(data)}`);
  return data;
}
async function importLayer(
  kind: "building" | "parcel" | "road" | "public_land" | "utility",
  values: {
    key: string;
    name: string;
    x: number;
    y: number;
    w: number;
    d: number;
    floors?: number;
  }[],
  areaId?: string,
) {
  const raw = {
    spatialReference: { wkid: 32643 },
    features: values.map((b) => ({
      attributes: {
        id: b.key,
        name: b.name,
        height: (b.floors || 1) * 3.2,
        floors: b.floors,
      },
      geometry: {
        rings: [
          ring(b.x, b.y, b.w, b.d).map(([x, y]) => [
            x + spec.origin[0],
            y + spec.origin[1],
          ]),
        ],
      },
    })),
  };
  const namespace = `lakeview-demonstration:${kind}`;
  // Committed inputs are retained exactly; reruns do not rebase onto user changes.
  const existing = await query(
    "SELECT body FROM import_packages WHERE body->>'namespace'=$1 AND state='COMMITTED' ORDER BY created_at LIMIT 1",
    [namespace],
  );
  if (existing.rows[0]) return existing.rows[0].body as ImportPackage;
  let pkg = await ingestArea({
    bytes: Buffer.from(JSON.stringify(raw)),
    filename: `fictional-${kind}.json`,
    format: "arcgis",
    namespace,
    name: spec.name,
    worldStatus: "synthetic",
    areaId,
    expectedAreaRevision: areaId ? (await getArea(areaId)).revision : undefined,
    mapping: {
      idField: "id",
      nameField: "name",
      kind,
      heightField: kind === "building" ? "height" : undefined,
      heightUnit: "m",
      floorCountField: kind === "building" ? "floors" : undefined,
      levelReference: spec.benchmark,
      geometryRole:
        kind === "building"
          ? "approved_building_outline"
          : kind === "parcel"
            ? "recorded_parcel"
            : kind === "road"
              ? "public_road_land"
              : kind === "public_land"
                ? "public_land"
                : "physical_utility",
    },
  });
  if (pkg.state === "COMMITTED") return pkg;
  pkg = await reviewPackage(pkg.id, pkg.revision);
  return commitPackage(pkg.id, pkg.revision, reason);
}
async function document(
  pkg: ImportPackage,
  buildingId: string,
  name: string,
  format: string,
  bytes: Uint8Array,
) {
  const form = new FormData();
  form.set("file", new Blob([new Uint8Array(bytes)]), name);
  form.set("format", format);
  form.set("expectedRevision", String(pkg.revision));
  form.set("entityIds", JSON.stringify([buildingId]));
  const r = await fetch(`${base}/api/v1/import-packages/${pkg.id}/documents`, {
    method: "POST",
    body: form,
  });
  const data = await r.json();
  if (!r.ok) throw Error(JSON.stringify(data));
  return data as ImportPackage;
}
const lock = await pool().connect();
try {
  await migrateAreas();
  if (
    !(
      await lock.query(
        "SELECT pg_try_advisory_lock(hashtext('lakeview-demo-seed')) AS ok",
      )
    ).rows[0].ok
  )
    throw Error("The demo seed is already running.");
  const imported = await importLayer("building", spec.buildings);
  const areaId = imported.areaId;
  console.log(`Block ${areaId}: exterior sources recorded`);
  const parcels = await importLayer(
    "parcel",
    spec.buildings.map((b) => ({
      ...b,
      key: `P-${b.key}`,
      name: `Parcel ${b.key}`,
      x: b.x - 3,
      y: b.y - 3,
      w: b.w + 6,
      d: b.d + 6,
    })),
    areaId,
  );
  await importLayer(
    "road",
    [
      { key: "R1", name: "Lake View Road", x: 0, y: 42, w: 140, d: 12 },
      { key: "R2", name: "Park Lane", x: 132, y: 0, w: 10, d: 99 },
    ],
    areaId,
  );
  await importLayer(
    "public_land",
    [{ key: "G1", name: "Garden green", x: 0, y: 90, w: 130, d: 14 }],
    areaId,
  );
  const context = await areaContext(areaId);
  const street = context.features.find(
    (f) => f.sourceKey === "R1" && f.kind === "road",
  )!;
  const origin = (
    await query(
      "SELECT ST_X(p) x,ST_Y(p) y FROM (SELECT ST_Transform(ST_SetSRID(ST_MakePoint($1,$2),32643),4326) p) t",
      spec.origin,
    )
  ).rows[0];
  const landscape: SceneAsset = {
    featureId: street.id,
    featureRevision: street.revision,
    url: "/scene-assets/reference/landscape.glb",
    sha256: spec.landscapeHash,
    frame: `AREA-${areaId}`,
    position: [origin.x, origin.y, 0],
    heading: 90,
    purpose: "presentation",
    provenance: "Authored fictional roads and landscaping; display only.",
  };
  await bindAsset(landscape);

  const result: {
    areaId: string;
    properties: Record<string, { buildingId: string; caseId?: string }>;
  } = { areaId, properties: {} };
  for (const b of spec.buildings) {
    const feature = context.features.find(
      (f) => f.kind === "building" && f.sourceKey === b.key,
    )!;
    if (!feature) throw Error(`Missing ${b.key}`);
    const coordinates =
      feature.geographicGeometry.type === "Polygon"
        ? feature.geographicGeometry.coordinates[0]
        : [];
    const asset: SceneAsset = {
      featureId: feature.id,
      featureRevision: feature.revision,
      url: `/scene-assets/reference/${b.key}.glb`,
      sha256: b.assetHash,
      frame: `AREA-${areaId}`,
      position: [coordinates[0][0], coordinates[0][1], 0],
      heading: 90,
      purpose: "presentation",
      provenance:
        "Authored fictional Lake View specification; facade/roof detail has no measurement authority.",
    };
    await bindAsset(asset);
    const parcel = parcels.features.find((f) => f.sourceKey === `P-${b.key}`)!;
    const association = await query(
      "SELECT id FROM property_associations WHERE from_id=$1 AND to_id=$2 AND relationship='occupies_parcel'",
      [feature.id, parcel.id],
    );
    if (!association.rows.length)
      await api("/property-associations", {
        fromId: feature.id,
        toId: parcel.id,
        relationship: "occupies_parcel",
        status: "confirmed",
        expectedRevision: 0,
        expectedFromRevision: feature.revision,
        expectedToRevision: parcel.revision,
        evidence: [...feature.evidence, ...parcel.evidence],
        reason,
      });
    result.properties[b.key] = { buildingId: feature.id };
    if (!"ABC".includes(b.key)) continue;
    const dossier = await api(`/buildings/${feature.id}/dossier`);
    const prep = await api(`/buildings/${feature.id}/preparation-cases`, {
      expectedRevision: feature.revision,
      requestKey: randomUUID(),
    });
    result.properties[b.key].caseId = prep.caseId;
    if (dossier.records.some((r: { kind: string }) => r.kind === "space")) {
      console.log(`${b.name}: existing reviewed records preserved`);
      continue;
    }
    let pkg = await api<ImportPackage>(`/import-packages/${prep.packageId}`);
    if (pkg.sourceRevisionIds.length > 1) {
      throw Error(
        `${b.name}: unfinished or edited preparation exists; inspect it before resuming seed to avoid overwriting changes.`,
      );
    }
    const local =
      feature.geometry.type === "Polygon"
        ? feature.geometry.coordinates[0]
        : [];
    const x0 = Math.min(...local.map((p) => p[0])),
      y0 = Math.min(...local.map((p) => p[1]));
    let csv =
      "alias,lower,upper,unit,benchmark,label,level,footprint_wkt,frame\n";
    for (let f = 0; f < b.floors; f++)
      for (const room of b.rooms) {
        const wkt =
          "POLYGON ((" +
          ring(x0 + room.x, y0 + room.y, room.w, room.d)
            .map((p) => p.join(" "))
            .join(", ") +
          "))";
        csv += `${b.key}-${f}-${room.alias},${(f * 3.2).toFixed(2)},${((f + 1) * 3.2).toFixed(2)},m,${spec.benchmark},${room.name},${f === 0 ? "Ground" : "Floor " + f},"${wkt}",${prep.placement.targetFrame}\n`;
      }
    pkg = await document(
      pkg,
      feature.id,
      `${b.key}-authored-spaces.csv`,
      "csv",
      Buffer.from(csv),
    );
    for (const name of [
      `${b.key}-floor-plans.pdf`,
      ...Array.from({ length: b.floors }, (_, f) => `${b.key}-floor-${f}.png`),
    ])
      pkg = await document(
        pkg,
        feature.id,
        name,
        name.endsWith(".pdf") ? "pdf" : "png",
        await readFile(new URL(name, root)),
      );
    for (const fact of [...pkg.factCandidates])
      if (!pkg.selectedClaimIds?.includes(fact.id))
        pkg = await api(`/import-packages/${pkg.id}/resolve-fact`, {
          expectedRevision: pkg.revision,
          claimId: fact.id,
          reason,
        });
    await api(`/import-packages/${pkg.id}/placement`, {
      expectedRevision: prep.revision,
      sourceFrame: prep.placement.targetFrame,
      verticalReference: spec.benchmark,
      verticalOffset: 0,
      evidence: pkg.factCandidates[0].evidence,
      reason,
    });
    pkg = await api(`/import-packages/${pkg.id}`);
    await api(`/import-packages/${pkg.id}/prepare-details`, {
      expectedRevision: pkg.revision,
    });
    let detail: any;
    for (let i = 0; i < 180; i++) {
      detail = await api(`/cases/${prep.caseId}`);
      if (detail.model?.revision === detail.case.revision) break;
      if (detail.jobs[0]?.status === "failed")
        throw Error(JSON.stringify(detail.jobs[0]));
      await new Promise((r) => setTimeout(r, 500));
    }
    if (detail.model?.revision !== detail.case.revision)
      throw Error("Worker build timeout");
    if (detail.model.units.length !== b.floors * b.rooms.length)
      throw Error("Unexpected processed space count");
    const review = await api(`/buildings/${feature.id}/detail-review`, {
      expectedRevision: detail.case.revision,
    });
    await api(`/registry-reviews/${review.id}/commit`, {
      acknowledgement: reason,
    });
    console.log(
      `${b.name}: ${detail.model.units.length} computed spaces reviewed and recorded`,
    );
  }
  await seedScenarios(areaId, base);
  const draftCase = (
    await query(
      "SELECT case_id FROM building_preparations WHERE building_id=$1",
      [result.properties.D.buildingId],
    )
  ).rows[0];
  if (draftCase) result.properties.D.caseId = draftCase.case_id;
  const area = await getArea(areaId);
  const latest = await areaContext(areaId);
  if (!latest.latestCheck || latest.latestCheck.stale)
    await api("/area-checks", { areaId, expectedRevision: area.revision });
  await writeFile(
    new URL("installed.json", root),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result));
} finally {
  await lock
    .query("SELECT pg_advisory_unlock(hashtext('lakeview-demo-seed'))")
    .catch(() => {});
  lock.release();
  await pool().end();
}
