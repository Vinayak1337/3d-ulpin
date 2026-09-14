import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  ingestArea,
  getArea,
  reviewPackage,
  commitPackage,
} from "../apps/web/lib/server/areas";
import { query, pool, transaction } from "../apps/web/lib/server/db";
import {
  removeOrphan,
  readObject,
  sha256,
} from "../apps/web/lib/server/storage";
const run = randomUUID(),
  allocated: string[] = [];
const url =
  (process.env.ULPIN_TEST_BASE_URL ?? "http://127.0.0.1:3000") + "/api/v1";
const encode = (v: unknown) => Buffer.from(JSON.stringify(v));
const rect = (x: number, y: number, w: number, h: number) => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
  [x, y],
];
const raw = (records: { id: string; ring: number[][] }[]) => ({
  spatialReference: { wkid: 32643 },
  features: records.map((f) => ({
    attributes: { id: f.id, height: 9 },
    geometry: { rings: [f.ring.map(([x, y]) => [x + 500000, y + 3100000])] },
  })),
});
async function api(
  path: string,
  value?: any,
  method = value ? "POST" : "GET",
  expected = 200,
) {
  const r = await fetch(url + path, {
    method,
    headers: value ? { "Content-Type": "application/json" } : undefined,
    body: value ? JSON.stringify(value) : undefined,
  });
  const data = await r.json();
  assert.equal(r.status, expected, `${path}: ${JSON.stringify(data)}`);
  return data;
}
async function record(p: any) {
  p = await reviewPackage(p.id, p.revision);
  return commitPackage(
    p.id,
    p.revision,
    "Synthetic regression observations only; no real survey or title claim.",
  );
}
async function input(kind: any, records: any[], areaId?: string) {
  const p = await ingestArea({
    bytes: encode(raw(records)),
    filename: `synthetic-${kind}.json`,
    format: "arcgis",
    namespace: `verify-officer:${run}:${kind}`,
    name: `Officer regression ${run}`,
    worldStatus: "synthetic",
    areaId,
    expectedAreaRevision: areaId ? (await getArea(areaId)).revision : undefined,
    mapping: {
      idField: "id",
      kind,
      heightField: kind === "building" ? "height" : undefined,
      heightUnit: "m",
      geometryRole:
        kind === "building"
          ? "observed_ground_occupation"
          : kind === "parcel"
            ? "recorded_parcel"
            : "public_road_land",
    },
  });
  if (!allocated.includes(p.areaId)) allocated.push(p.areaId);
  return record(p);
}
try {
  const p = await input("building", [
    { id: "A", ring: rect(0, 0, 12, 10) },
    { id: "B", ring: rect(20, 0, 10, 10) },
    { id: "C", ring: rect(40, 0, 10, 10) },
  ]);
  const parcels = await input(
    "parcel",
    [
      { id: "P-A", ring: rect(0, 0, 10, 10) },
      { id: "P-B", ring: rect(20, 0, 10, 10) },
    ],
    p.areaId,
  );
  await input("road", [{ id: "R", ring: rect(10, -5, 6, 20) }], p.areaId);
  const a = p.features[0],
    b = p.features[1];
  const groupInput = {
    areaId: p.areaId,
    name: "Synthetic layout group",
    kind: "layout_block",
    boundary: a.geometry,
    evidence: a.evidence,
    featureIds: [a.id, b.id],
    expectedRevision: (await getArea(p.areaId)).revision,
  };
  const group = await api("/block-groups", groupInput, "POST", 201);
  assert.equal(
    (await api("/block-groups", groupInput, "POST", 201)).id,
    group.id,
    "Group retries preserve one group identity.",
  );
  await api(
    "/block-groups",
    {
      ...groupInput,
      name: "Synthetic development group",
      kind: "development_block",
    },
    "POST",
    201,
  );
  assert.equal(
    (await api(`/buildings/${b.id}/dossier`)).groups.length,
    2,
    "An existing property can join distinct group types without another physical identity.",
  );
  for (const f of p.features) {
    const d = await api(`/buildings/${f.id}/dossier`);
    assert.equal(d.canonicalBuildingId, f.id);
    assert.equal(d.records.length, 0);
    assert(d.missing.length);
    const found = await api(
      `/resolve?identifier=${encodeURIComponent(f.identifier)}`,
    );
    assert.equal(found.status, "matched");
    assert.equal(found.matches[0].feature.id, f.id);
  }
  const association = await api(
    "/property-associations",
    {
      fromId: a.id,
      toId: parcels.features[0].id,
      relationship: "occupies_parcel",
      status: "confirmed",
      expectedRevision: 0,
      expectedFromRevision: a.revision,
      expectedToRevision: parcels.features[0].revision,
      evidence: [...a.evidence, ...parcels.features[0].evidence],
      reason: "Independently authored G01 regression association.",
    },
    "POST",
    201,
  );
  const area = await getArea(p.areaId),
    check = await api(
      "/area-checks",
      { areaId: area.id, expectedRevision: area.revision },
      "POST",
      201,
    );
  assert.equal(check.status, "completed");
  const outside = check.findings.find((f: any) =>
    /OUTSIDE_CONFIRMED_PARCEL/.test(f.code),
  );
  assert(outside, JSON.stringify(check.findings.map((f: any) => f.code)));
  assert(Math.abs(outside.areaM2 - 20) < 1e-4);
  assert(outside.geographicGeometry);
  assert(outside.participants.length >= 2);
  console.log(
    "PASS Three same-property dossiers, exact20m² result, all participants and geographic overlay.",
  );
  const cases = await Promise.all([
    api(
      `/buildings/${a.id}/preparation-cases`,
      { expectedRevision: a.revision, requestKey: randomUUID() },
      "POST",
      201,
    ),
    api(
      `/buildings/${a.id}/preparation-cases`,
      { expectedRevision: a.revision, requestKey: randomUUID() },
      "POST",
      201,
    ),
  ]);
  assert.equal(cases[0].caseId, cases[1].caseId);
  await api(
    `/buildings/${b.id}/preparation-cases`,
    { expectedRevision: b.revision, requestKey: randomUUID() },
    "POST",
    201,
  );
  const previousIds = new Map<string, string[]>();
  for (const [feature, upperLevel] of [
    [a, 3],
    [b, 3],
    [a, 4],
  ] as const) {
    let prep =
      feature.id === a.id && upperLevel === 3
        ? cases[0]
        : await api(
            `/buildings/${feature.id}/preparation-cases`,
            { expectedRevision: feature.revision, requestKey: randomUUID() },
            "POST",
            201,
          );
    let pkg = await api(`/import-packages/${prep.packageId}`);
    const ring = feature.geometry.coordinates[0];
    const xs = ring.map((v: number[]) => v[0]),
      ys = ring.map((v: number[]) => v[1]);
    const r = rect(Math.min(...xs) + 1, Math.min(...ys) + 1, 6, 6);
    // A single-part MultiPolygon must preserve this exact outline when the
    // narrower detailed prism builder derives its simple Polygon input.
    const wkt =
      feature.id === b.id
        ? "MULTIPOLYGON (((" + r.map((v) => v.join(" ")).join(", ") + ")))"
        : "POLYGON ((" + r.map((v) => v.join(" ")).join(", ") + "))";
    const csv =
      "alias,lower,upper,unit,benchmark,label,level,footprint_wkt,frame\n" +
      `UNIT-${feature.sourceKey},0,${upperLevel},m,BM-OFFICER-TEST,Regression room,Ground,"${wkt}",${prep.placement.targetFrame}\n`;
    const form = new FormData();
    form.set(
      "file",
      new Blob([csv], { type: "text/csv" }),
      "synthetic-level-plan.csv",
    );
    form.set("format", "csv");
    form.set("expectedRevision", String(pkg.revision));
    form.set("entityIds", JSON.stringify([feature.id]));
    const response = await fetch(`${url}/import-packages/${pkg.id}/documents`, {
      method: "POST",
      body: form,
    });
    pkg = await response.json();
    assert.equal(response.status, 201, JSON.stringify(pkg));
    assert(
      pkg.factCandidates.some((c: any) => c.property === "space.geometry"),
    );
    if (upperLevel === 4)
      assert(
        !pkg.selectedClaimIds.some((id: string) =>
          pkg.factCandidates.some(
            (c: any) =>
              c.id === id && c.property === "space.upper" && c.value === 3,
          ),
        ),
        "New conflicting native level must reopen its prior selection.",
      );
    for (const fact of [...pkg.factCandidates])
      pkg = await api(`/import-packages/${pkg.id}/resolve-fact`, {
        expectedRevision: pkg.revision,
        claimId: fact.id,
        reason: "Checked exact synthetic CSV row and cell.",
      });
    const evidence = pkg.factCandidates[0].evidence;
    prep = await api(`/import-packages/${pkg.id}/placement`, {
      expectedRevision: prep.revision,
      sourceFrame: prep.placement.targetFrame,
      verticalReference: "BM-OFFICER-TEST",
      verticalOffset: 0,
      evidence,
      reason: "Authored regression coordinate and benchmark contract.",
    });
    pkg = await api(`/import-packages/${pkg.id}`);
    const built = await api(
      `/import-packages/${pkg.id}/prepare-details`,
      { expectedRevision: pkg.revision },
      "POST",
      201,
    );
    const repeated = await api(
      `/import-packages/${pkg.id}/prepare-details`,
      { expectedRevision: pkg.revision },
      "POST",
      201,
    );
    assert.equal(
      repeated.job.id,
      built.job.id,
      "Retry must preserve one prepared build job.",
    );
    let detail: any;
    for (let attempt = 0; attempt < 60; attempt++) {
      detail = await api(`/cases/${prep.caseId}`);
      if (detail.model?.revision === detail.case.revision) break;
      if (detail.jobs[0]?.status === "failed")
        throw Error(detail.jobs[0].error);
      await new Promise((r) => setTimeout(r, 500));
    }
    assert.equal(detail.model?.units.length, 1, JSON.stringify(detail.jobs));
    let review = await api(
      `/buildings/${feature.id}/detail-review`,
      { expectedRevision: detail.case.revision },
      "POST",
      201,
    );
    if (feature.id === a.id && upperLevel === 3) {
      let changed = await api(`/import-packages/${pkg.id}`);
      const extra = new FormData();
      extra.set(
        "file",
        new Blob([
          "Synthetic supplemental record: verify the independent measurement before publication.",
        ]),
        "supplement.txt",
      );
      extra.set("format", "text");
      extra.set("expectedRevision", String(changed.revision));
      extra.set("entityIds", JSON.stringify([feature.id]));
      const attached = await fetch(
        `${url}/import-packages/${pkg.id}/documents`,
        { method: "POST", body: extra },
      );
      assert.equal(attached.status, 201);
      changed = await attached.json();
      await api(
        `/registry-reviews/${review.id}/commit`,
        { acknowledgement: "Must fail because new evidence arrived." },
        "POST",
        409,
      );
      await api(
        `/import-packages/${pkg.id}/prepare-details`,
        { expectedRevision: changed.revision },
        "POST",
        201,
      );
      for (let n = 0; n < 60; n++) {
        detail = await api(`/cases/${prep.caseId}`);
        if (detail.model?.revision === detail.case.revision) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      review = await api(
        `/buildings/${feature.id}/detail-review`,
        { expectedRevision: detail.case.revision },
        "POST",
        201,
      );
    }
    assert(review.records.some((r: any) => r.id === feature.id));
    await api(`/registry-reviews/${review.id}/commit`, {
      acknowledgement:
        "Synthetic fixture review only; source claims checked. No rights conferred.",
    });
    const dossier = await api(`/buildings/${feature.id}/dossier`);
    assert.equal(
      dossier.records.filter((r: any) => r.kind === "space").length,
      1,
    );
    assert(
      dossier.records.every(
        (r: any) =>
          r.id === feature.id ||
          r.links.some((l: any) => l.targetId === feature.id) ||
          r.kind === "floor",
      ),
    );
    assert.equal(
      dossier.detailedScene.filter((r: any) => r.record.kind === "space")
        .length,
      1,
    );
    const ids = dossier.records.map((r: any) => r.id).sort();
    if (previousIds.has(feature.id))
      assert.deepEqual(
        ids,
        previousIds.get(feature.id),
        "A corrected source keeps the same building, floor and space IDs.",
      );
    previousIds.set(feature.id, ids);
    const derivative = (
      await query(
        "SELECT object_key,sha256 FROM sources WHERE case_id=$1 AND profile='canonical-detail-v1' ORDER BY revision DESC LIMIT 1",
        [prep.caseId],
      )
    ).rows[0];
    assert.equal(
      sha256(await readObject(derivative.object_key)),
      derivative.sha256,
      "Derivative manifest must hash its actual stored bytes.",
    );
    const unit = dossier.records.find((r: any) => r.kind === "space");
    assert.equal(unit.geometry.upper, upperLevel);
    const resolved = await api(
      `/resolve?identifier=${encodeURIComponent(unit.identifier)}`,
    );
    assert.equal(resolved.matches[0].feature.id, feature.id);
    if (feature.id === b.id) {
      const ownA = await api(`/buildings/${a.id}/dossier`);
      const shared = ownA.records.find((r: any) => r.kind === "space");
      await api(
        "/property-associations",
        {
          fromId: b.id,
          toId: shared.id,
          relationship: "shared_space",
          status: "confirmed",
          expectedRevision: 0,
          expectedFromRevision: b.revision,
          expectedToRevision: shared.revision,
          evidence: b.evidence,
          reason:
            "Authored test: one evidenced room shared by two buildings; no second physical identity.",
        },
        "POST",
        201,
      );
      const sharedB = await api(`/buildings/${b.id}/dossier`);
      assert.equal(
        sharedB.records.filter((r: any) => r.kind === "space").length,
        2,
      );
      assert(sharedB.records.some((r: any) => r.id === shared.id));
      const search = await api(
        `/resolve?identifier=${encodeURIComponent(shared.identifier)}`,
      );
      assert.equal(
        search.matches.length,
        1,
        "A shared room remains one canonical search result.",
      );
      assert.deepEqual(
        search.matches[0].relatedBuildings.map((r: any) => r.id).sort(),
        [a.id, b.id].sort(),
      );
    }
  }
  const afterSharedRevision = await api(`/buildings/${b.id}/dossier`);
  assert.equal(
    afterSharedRevision.records.filter((r: any) => r.kind === "space").length,
    1,
    "A correction cannot silently update a stale shared-space association.",
  );
  assert(
    afterSharedRevision.missing.some((m: string) =>
      m.includes("linked detailed representation changed"),
    ),
  );
  console.log(
    "PASS Two native CSV plan/level packages → reviewed canonical facts → existing worker build → same reserved building IDs, own floors/units and global unit lookup; concurrent opening does not duplicate cases.",
  );
  const d = await api(`/buildings/${a.id}/dossier`);
  let i = await api(
    "/investigations",
    {
      buildingId: a.id,
      expectedRevision: a.revision,
      requestKey: randomUUID(),
      reference: "OFFICER-REGRESSION",
      classification: "Outside associated parcel",
      checkId: check.id,
      findingIds: [outside.id],
    },
    "POST",
    201,
  );
  i = await api(
    `/investigations/${i.id}/requests`,
    {
      expectedRevision: i.revision,
      question: "Supply the surveyed level reference for the utility.",
    },
    "POST",
    201,
  );
  assert.equal(i.status, "NEEDS_EVIDENCE");
  i = await api(`/investigations/${i.id}/requests/${i.requests[0].id}/answer`, {
    expectedRevision: i.revision,
    response:
      "Synthetic test uses BM-OFFICER-TEST. Real utility evidence remains a separate data requirement.",
    evidence: a.evidence,
  });
  for (const status of ["READY_FOR_REVIEW", "REVIEWED", "CLOSED"])
    i = await api(
      `/investigations/${i.id}`,
      {
        expectedRevision: i.revision,
        status,
        reason: "Independent regression outcome.",
        nextAction: "No official action.",
      },
      "PATCH",
    );
  assert.equal((await api(`/investigations/${i.id}`)).status, "CLOSED");
  for (const format of ["json", "csv", "html"]) {
    const res = await fetch(
      `${url}/investigations/${i.id}/export?format=${format}`,
    );
    assert.equal(res.status, 200);
    const text = await res.text();
    assert(text.includes(a.identifier));
    assert(!text.includes("password"));
    if (format === "json") {
      const exported = JSON.parse(text);
      assert(
        !exported.investigation.registerSnapshot,
        "No raw snapshot bypasses export redaction.",
      );
      assert(
        exported.register.every((r: any) => !("rights" in r)),
        "Unnecessary party claims are omitted from register exports.",
      );
    }
    if (format === "html")
      assert(text.includes("Source-backed detailed section"));
  }
  console.log(
    "PASS Investigation request/response, explicit review transitions, retained snapshot/history and JSON/CSV/print registers.",
  );
  // Association edits invalidate checks without changing source geometry.
  await api(
    "/property-associations",
    {
      fromId: a.id,
      toId: parcels.features[0].id,
      relationship: "occupies_parcel",
      status: "rejected",
      expectedRevision: association.revision,
      expectedFromRevision: a.revision,
      expectedToRevision: parcels.features[0].revision,
      evidence: a.evidence,
      reason: "Regression invalidation.",
    },
    "POST",
    201,
  );
  assert.equal(
    (await api(`/areas/${p.areaId}/context`)).latestCheck.stale,
    true,
  );
  await api(
    "/investigations",
    {
      buildingId: a.id,
      expectedRevision: a.revision,
      reference: "STALE-REJECT",
      classification: "Historical check",
      checkId: check.id,
    },
    "POST",
    409,
  );
  const savedExport = await (
    await fetch(`${url}/investigations/${i.id}/export?format=json`)
  ).json();
  assert.equal(
    savedExport.associations[0].status,
    "confirmed",
    "Export retains the association snapshot investigated, even after current evidence changes.",
  );
  await assert.rejects(
    ingestArea({
      bytes: encode(raw([{ id: "A", ring: rect(0, 0, 12, 10) }])),
      filename: "invalid-promotion.json",
      format: "arcgis",
      namespace: `verify-officer:${run}:building`,
      name: `Officer regression ${run}`,
      worldStatus: "observed",
      areaId: p.areaId,
      expectedAreaRevision: (await getArea(p.areaId)).revision,
      mapping: {
        idField: "id",
        kind: "building",
        geometryRole: "observed_ground_occupation",
      },
    }),
    /synthetic or hypothetical/,
  );
  const status = await api("/ai/status");
  assert(status.provider === "nous");
  console.log(
    "PASS AI route reports actual configuration; no mocked inference asserted.",
  );
} finally {
  const ids = allocated;
  const keys = ids.length
    ? (
        await query(
          "SELECT s.object_key FROM sources s JOIN cases c ON c.id=s.case_id WHERE c.site_id=ANY($1::uuid[])",
          [ids],
        )
      ).rows.map((r) => r.object_key)
    : [];
  if (ids.length)
    await transaction(async (client) => {
      const condition = "ANY($1::uuid[])";
      for (const sql of [
        `DELETE FROM officer_ai_runs WHERE package_id IN (SELECT id FROM import_packages WHERE area_id=${condition})`,
        `DELETE FROM officer_investigation_revisions WHERE investigation_id IN (SELECT id FROM officer_investigations WHERE area_id=${condition})`,
        `DELETE FROM officer_investigations WHERE area_id=${condition}`,
        `DELETE FROM building_preparation_revisions WHERE preparation_id IN (SELECT id FROM building_preparations WHERE building_id IN (SELECT id FROM physical_features WHERE area_id=${condition}))`,
        `DELETE FROM building_preparations WHERE building_id IN (SELECT id FROM physical_features WHERE area_id=${condition})`,
        `DELETE FROM property_association_revisions WHERE association_id IN (SELECT id FROM property_associations WHERE from_id IN (SELECT id FROM physical_features WHERE area_id=${condition}))`,
        `DELETE FROM property_associations WHERE from_id IN (SELECT id FROM physical_features WHERE area_id=${condition})`,
        `DELETE FROM block_group_memberships WHERE group_id IN (SELECT id FROM block_groups WHERE area_id=${condition})`,
        `DELETE FROM block_group_revisions WHERE group_id IN (SELECT id FROM block_groups WHERE area_id=${condition})`,
        `DELETE FROM block_groups WHERE area_id=${condition}`,
        `DELETE FROM registry_reviews WHERE draft_id IN (SELECT id FROM registry_drafts WHERE site_id=${condition})`,
        `DELETE FROM registry_case_import_operations WHERE site_id=${condition}`,
        `DELETE FROM registry_case_feature_mappings WHERE site_id=${condition}`,
        `DELETE FROM registry_drafts WHERE site_id=${condition}`,
        `DELETE FROM registry_aliases WHERE site_id=${condition}`,
        `DELETE FROM registry_links WHERE record_id IN (SELECT id FROM registry_records WHERE site_id=${condition})`,
        `DELETE FROM registry_rights WHERE record_id IN (SELECT id FROM registry_records WHERE site_id=${condition})`,
        `DELETE FROM registry_revisions WHERE record_id IN (SELECT id FROM registry_records WHERE site_id=${condition})`,
        `DELETE FROM external_identifiers WHERE feature_id IN (SELECT id FROM physical_features WHERE area_id=${condition}) OR record_id IN (SELECT id FROM registry_records WHERE site_id=${condition})`,
        `DELETE FROM physical_feature_revisions WHERE feature_id IN (SELECT id FROM physical_features WHERE area_id=${condition})`,
        `DELETE FROM source_feature_links WHERE area_id=${condition}`,
        `DELETE FROM physical_features WHERE area_id=${condition}`,
        `DELETE FROM import_package_revisions WHERE package_id IN (SELECT id FROM import_packages WHERE area_id=${condition})`,
        `DELETE FROM import_packages WHERE area_id=${condition}`,
        `DELETE FROM area_check_runs WHERE area_id=${condition}`,
        `DELETE FROM area_memberships WHERE area_id=${condition}`,
        `DELETE FROM registry_records WHERE site_id=${condition}`,
        ...[
          "identity_spaces",
          "identity_floors",
          "unit_revisions",
          "units",
          "jobs",
          "snapshots",
          "events",
          "operations",
        ].map((t) =>
          t === "unit_revisions"
            ? `DELETE FROM unit_revisions WHERE unit_id IN (SELECT id FROM units WHERE case_id IN (SELECT id FROM cases WHERE site_id=${condition}))`
            : `DELETE FROM ${t} WHERE case_id IN (SELECT id FROM cases WHERE site_id=${condition})`,
        ),
        `DELETE FROM sources WHERE case_id IN (SELECT id FROM cases WHERE site_id=${condition})`,
        `DELETE FROM cases WHERE site_id=${condition}`,
        `DELETE FROM map_areas WHERE id=${condition}`,
        `DELETE FROM registry_sites WHERE id=${condition}`,
      ])
        await client.query(sql, [ids]);
    });
  for (const key of keys) await removeOrphan(key);
  await pool().end();
}
