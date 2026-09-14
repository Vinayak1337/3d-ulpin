import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { CaseDetail, Point2, RegistryDraft, SpatialFeature } from "../packages/contracts/src";
import { settings } from "../apps/web/lib/server/config";
import { pool, query, transaction } from "../apps/web/lib/server/db";
import { createCase, getCase, prepareCase, requestBuild, uploadSource } from "../apps/web/lib/server/domain";
import { ingestJob } from "../apps/web/lib/server/processing";
import { migrateRegistry } from "../apps/web/lib/server/registry-db";
import { bodyOnly, commitRegistryReview, createRegistryDraft, draftDetail, editRegistryDraft, prepareRegistryReview, siteDetail } from "../apps/web/lib/server/registry";
import { importRegistryCase } from "../apps/web/lib/server/registry-seed";
import { removeOrphan } from "../apps/web/lib/server/storage";

// All evidence and geometry in this isolated test are explicitly synthetic.
// Inspection, model construction, and review calculations use the real processor.
const frame = { id: "LOCAL-REIMPORT-TEST", benchmark: "SYNTHETIC-TEST", horizontalUnit: "m", verticalUnit: "m" } as const;
const rect = (x: number, y: number, width: number, height: number): Point2[] => [[x, y], [x + width, y], [x + width, y + height], [x, y + height]];
const features = (revision: number): SpatialFeature[] => [
  { alias: "PA", name: "Synthetic parcel", kind: "parcel", footprint: rect(0, 0, 20, 20) },
  { alias: "A", name: `Synthetic building revision ${revision}`, kind: "building", footprint: rect(1, 1, 8, 8) },
  { alias: "A-101", name: `Synthetic space revision ${revision}`, kind: "unit", footprint: rect(2, 2, 2, 2), levelLabel: "A / Ground", draftLower: 0, draftUpper: revision + 2 },
  ...(revision === 1 ? [{ alias: "A-102", name: "Synthetic omitted space", kind: "unit" as const, footprint: rect(6, 2, 2, 2), levelLabel: "A / Ground", draftLower: 0, draftUpper: 3 }] : []),
];
const createdCaseIds: string[] = [];
let siteId: string | undefined;
let familyId: string | undefined;

async function processOwnJob(jobId: string) {
  const job = (await query("SELECT operation,payload FROM jobs WHERE id=$1", [jobId])).rows[0];
  const response = await fetch(`${settings.geoUrl}/internal/jobs`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.geoToken}` },
    body: JSON.stringify({ jobId, operation: job.operation, input: job.payload }),
  });
  assert.equal(response.status, 200, "Synthetic test job should be accepted by the processor");
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const result = await fetch(`${settings.geoUrl}/internal/jobs/${jobId}`, { headers: { Authorization: `Bearer ${settings.geoToken}` } });
    assert.equal(result.status, 200);
    const payload = await result.json();
    assert.notEqual(payload.status, "failed", payload.error || "Synthetic test processing failed");
    if (payload.status === "succeeded") {
      await ingestJob(jobId, payload.result);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Synthetic test processing timed out");
}

async function buildRevision(caseId: string, revision: number): Promise<CaseDetail> {
  const source = await uploadSource(caseId, {
    name: "synthetic-reimport.json", profile: "parcel-local-json-v1", mimeType: "application/json", familyId,
    bytes: new TextEncoder().encode(JSON.stringify({ profile: "parcel-local-json-v1", frame, features: features(revision) })),
    operationKey: `synthetic-revision-${revision}`,
  });
  familyId = source.familyId;
  const inspection = (await query("SELECT id FROM jobs WHERE source_id=$1 AND operation='inspect'", [source.id])).rows[0];
  await processOwnJob(inspection.id);
  const prepared = await prepareCase(caseId, { spatialSourceId: source.id });
  await assert.rejects(importRegistryCase(siteId ?? null, caseId, prepared.case.revision), /Build the current case/);
  const job = await requestBuild(caseId, prepared.case.revision);
  await processOwnJob(job.id);
  return getCase(caseId);
}

async function record(draft: RegistryDraft) {
  const current = await siteDetail(draft.siteId);
  const review = await prepareRegistryReview(draft.id, draft.revision, current.site.revision);
  assert.equal(review.findings.filter((finding) => finding.severity === "error").length, 0, JSON.stringify(review.findings));
  await commitRegistryReview(review.id, "Synthetic test geometry only; draft heights remain unverified.");
}

try {
  await migrateRegistry();
  const workspace = await createCase(`Synthetic re-import test ${randomUUID()}`, "Isolated automated test; no survey or rights evidence.");
  createdCaseIds.push(workspace.id);
  await query("UPDATE cases SET archived=true WHERE id=$1", [workspace.id]);
  const firstBuild = await buildRevision(workspace.id, 1);
  const firstIds = await Promise.all(Array.from({ length: 3 }, () => importRegistryCase(null, workspace.id, firstBuild.case.revision)));
  assert.equal(new Set(firstIds).size, 1, "Concurrent import retries should reuse one operation");
  let first = await draftDetail(firstIds[0]);
  siteId = first.siteId;
  assert.equal(first.records.length, 5);
  const firstSpace = first.records.find((record) => record.alias === "A-101")!;
  const originalBody = bodyOnly(firstSpace);
  first = await editRegistryDraft(first.id, {
    expectedRevision: first.revision, recordId: firstSpace.id,
    body: { ...originalBody, rights: [{ party: "Synthetic operator claim", type: "ownership_claim", evidence: originalBody.evidence[0] }] },
  });
  assert.equal(await importRegistryCase(siteId, workspace.id, firstBuild.case.revision), first.id, "An edited draft remains the result of its original operation");
  await record(first);
  assert.equal(await importRegistryCase(siteId, workspace.id, firstBuild.case.revision), first.id, "A recorded draft remains the result of its original operation");

  const unrelated = await createRegistryDraft(siteId, undefined, {
    alias: "UNRELATED", name: "Independent synthetic parcel", kind: "parcel", footprint: rect(30, 30, 3, 3),
    links: [], rights: [], evidence: firstSpace.evidence, synthetic: true,
  }, randomUUID());
  createdCaseIds.push(unrelated.caseId);
  await record(unrelated);
  const prior = await siteDetail(siteId);

  const secondBuild = await buildRevision(workspace.id, 2);
  await assert.rejects(importRegistryCase(siteId, workspace.id, firstBuild.case.revision), /Build the current case/);
  const secondId = await importRegistryCase(siteId, workspace.id, secondBuild.case.revision);
  assert.notEqual(secondId, first.id, "A later source build must create a correction draft");
  const second = await draftDetail(secondId);
  assert.equal(await importRegistryCase(siteId, workspace.id, secondBuild.case.revision), secondId);
  assert.equal(second.records.length, 4);
  for (const updated of second.records) {
    const original = first.records.find((record) => record.alias === updated.alias)!;
    assert.equal(updated.id, original.id);
    assert.equal(updated.identifier, original.identifier);
    assert.equal(updated.revision, 1);
  }
  const correctedSpace = second.records.find((record) => record.id === firstSpace.id)!;
  assert.equal(correctedSpace.geometry!.upper, 4);
  assert.equal(correctedSpace.geometry!.id, correctedSpace.id);
  assert.equal(correctedSpace.rights[0].party, "Synthetic operator claim", "Source geometry must not erase independently recorded rights");
  assert.equal(second.records.find((record) => record.alias === "A")!.name, "Synthetic building revision 2");
  assert.equal(secondBuild.sources.length, 2);
  assert.deepEqual(secondBuild.sources.find((source) => source.id === firstBuild.sources[0].id), firstBuild.sources[0], "A later source import must preserve the original source revision");
  assert.deepEqual((await siteDetail(siteId)).records, prior.records, "Creating a correction must leave current records unchanged");
  const operation = (await query("SELECT previous_draft_id,previous_operation_id FROM registry_case_import_operations WHERE draft_id=$1", [secondId])).rows[0];
  assert.equal(operation.previous_draft_id, first.id);
  assert(operation.previous_operation_id);
  await record(second);
  const current = await siteDetail(siteId);
  assert.equal(current.records.length, 6, "Omitted and independently created records must be retained");
  assert.equal(current.records.find((item) => item.alias === "A-102")!.revision, 1);
  assert.deepEqual(current.records.find((item) => item.alias === "UNRELATED"), prior.records.find((item) => item.alias === "UNRELATED"));
  assert.equal((await query("SELECT count(*)::int AS count FROM registry_revisions WHERE record_id=$1", [firstSpace.id])).rows[0].count, 2);
  assert.equal((await draftDetail(first.id)).records.find((item) => item.id === firstSpace.id)!.geometry!.upper, 3);
  console.log("PASS Concurrent retries reuse one draft; source corrections preserve identities, rights, originals, history, and unrelated/omitted records.");

  // Simulate the pre-migration metadata state using only this test's records.
  await transaction(async (client) => {
    await client.query("DELETE FROM registry_case_import_operations WHERE case_id=$1", [workspace.id]);
    await client.query("DELETE FROM registry_case_feature_mappings WHERE case_id=$1", [workspace.id]);
  });
  const legacyBuild = await buildRevision(workspace.id, 3);
  const legacyId = await importRegistryCase(siteId, workspace.id, legacyBuild.case.revision);
  const legacy = await draftDetail(legacyId);
  assert.notEqual(legacy.id, second.id);
  assert.deepEqual(legacy.records.map((item) => item.id).sort(), second.records.map((item) => item.id).sort());
  assert.equal((await query("SELECT previous_draft_id FROM registry_case_import_operations WHERE draft_id=$1", [legacyId])).rows[0].previous_draft_id, second.id);
  assert.equal(await importRegistryCase(siteId, workspace.id, legacyBuild.case.revision), legacy.id);
  assert.equal((await query("SELECT count(*)::int AS count FROM registry_records WHERE site_id=$1", [siteId])).rows[0].count, 6);
  console.log("PASS Legacy drafts adopt unambiguous existing entity IDs into linked, version-aware imports without duplicate allocation.");
} finally {
  // Cleanup is restricted to this run's explicitly synthetic fixtures.
  const sourceKeys = createdCaseIds.length ? (await query("SELECT object_key FROM sources WHERE case_id=ANY($1::uuid[])", [createdCaseIds])).rows.map((row) => row.object_key as string) : [];
  if (createdCaseIds.length) await transaction(async (client) => {
    if (siteId) {
      await client.query("DELETE FROM registry_case_import_operations WHERE site_id=$1", [siteId]);
      await client.query("DELETE FROM registry_case_feature_mappings WHERE site_id=$1", [siteId]);
      await client.query("DELETE FROM registry_reviews WHERE draft_id IN (SELECT id FROM registry_drafts WHERE site_id=$1)", [siteId]);
      await client.query("DELETE FROM registry_drafts WHERE site_id=$1", [siteId]);
      await client.query("DELETE FROM registry_aliases WHERE site_id=$1", [siteId]);
      for (const table of ["registry_links", "registry_rights", "registry_revisions"])
        await client.query(`DELETE FROM ${table} WHERE record_id IN (SELECT id FROM registry_records WHERE site_id=$1)`, [siteId]);
      await client.query("DELETE FROM registry_records WHERE site_id=$1", [siteId]);
    }
    for (const table of ["identity_spaces", "identity_floors", "unit_revisions", "units", "snapshots", "jobs", "operations", "events", "sources"]) {
      const predicate = table === "unit_revisions" ? "unit_id IN (SELECT id FROM units WHERE case_id=ANY($1::uuid[]))" : "case_id=ANY($1::uuid[])";
      await client.query(`DELETE FROM ${table} WHERE ${predicate}`, [createdCaseIds]);
    }
    await client.query("DELETE FROM cases WHERE id=ANY($1::uuid[])", [createdCaseIds]);
    if (siteId) await client.query("DELETE FROM registry_sites WHERE id=$1", [siteId]);
  });
  for (const key of sourceKeys) await removeOrphan(key);
  await pool().end();
}
