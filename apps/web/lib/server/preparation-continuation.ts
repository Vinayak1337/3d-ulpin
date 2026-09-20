import type { PoolClient } from "pg";
import type { ImportPackage, PreparationCase, RegistryReview } from "@ulpin/contracts";
import { preparationBuildState, type PreparationReceipt } from "../preparation-continuation";
import { transaction } from "./db";
import { detailFromClient, fingerprint, jobFrom } from "./domain";
import { notFound } from "./errors";

export async function readPreparationBuild(client: PoolClient, packageId: string) {
  const pkg = (await client.query("SELECT body FROM import_packages WHERE id=$1", [packageId])).rows[0]?.body as ImportPackage | undefined;
  const prep = (await client.query("SELECT body FROM building_preparations WHERE package_id=$1", [packageId])).rows[0]?.body as PreparationCase | undefined;
  if (!pkg || !prep) notFound("Open this building’s preparation first.");
  const building = (await client.query("SELECT revision FROM physical_features WHERE id=$1", [prep.buildingId])).rows[0] ?? notFound();
  const row = (await client.query(
    "SELECT payload_hash,result FROM operations WHERE case_id=$1 AND kind='canonical.prepare' AND result->>'packageRevision'=$2 AND operation_key LIKE $3 ORDER BY created_at DESC LIMIT 1",
    [prep.caseId, String(pkg.revision), `${packageId}:%`],
  )).rows[0];
  const receipt: PreparationReceipt | undefined = row && { payloadHash: row.payload_hash, result: row.result };
  const detail = await detailFromClient(client, prep.caseId);
  const currentFingerprint = fingerprint({ frame: detail.case.frame, units: detail.units,
    context: detail.context, caseRevision: detail.case.revision, profile: "prism-v1" });
  // Do not depend on the 30 most recent jobs in the general case response.
  const job = (await client.query("SELECT * FROM jobs WHERE case_id=$1 AND operation='build' AND input_fingerprint=$2 ORDER BY created_at DESC LIMIT 1", [prep.caseId, currentFingerprint])).rows[0];
  detail.jobs = job ? [jobFrom(job)] : [];
  const state = preparationBuildState(pkg, prep, detail, receipt, currentFingerprint, building.revision);
  const preparationFingerprint = fingerprint({ preparation: prep, packageRevision: pkg.revision,
    caseRevision: detail.case.revision, snapshotId: detail.model?.id, featureRevision: building.revision });
  return { state, preparationFingerprint };
}

export async function preparationContinuation(packageId: string) {
  return transaction(async (client) => {
    await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const { state, preparationFingerprint } = await readPreparationBuild(client, packageId);
    if (state.status !== "ready") return state;
    // A previous review is usable only while its draft and neighbours are unchanged.
    // Committed reviews are historical receipts; reopening never records them again.
    const row = (await client.query(
      `SELECT r.body,r.committed,r.acknowledgement FROM registry_reviews r
       JOIN registry_drafts d ON d.id=r.draft_id JOIN registry_sites s ON s.id=d.site_id
       WHERE r.body->>'preparationFingerprint'=$1 AND
         (r.committed OR (d.status='draft' AND d.revision=(r.body->>'draftRevision')::integer
           AND s.revision=(r.body->>'siteRevision')::integer))
       ORDER BY r.committed DESC,r.created_at DESC LIMIT 1`, [preparationFingerprint],
    )).rows[0];
    if (!row) return state;
    const review: RegistryReview = { ...row.body, committed: row.committed, acknowledgement: row.acknowledgement };
    return { ...state, status: row.committed ? "recorded" as const : "reviewed" as const, review };
  });
}
