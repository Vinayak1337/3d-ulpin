import { randomUUID } from "node:crypto";
import type { BuildInput, ModelSnapshot } from "@ulpin/contracts";
import { query, transaction } from "./db";
import { settings } from "./config";
import { fingerprint, lockCase, recordEvent } from "./domain";
import { buildResultSchema, inspectionSchema } from "./validation";
import { failSpatialMlJob, ingestSpatialMlJob, markSpatialMlRunning } from "./spatial-ml";

import {failDatasetMl,ingestDatasetMl,markDatasetMlRunning} from './dataset-ml';
const isInference=(operation:string)=>['spatial-inference','dataset-spatial-inference'].includes(operation);

type WorkerReply = {
  jobId: string;
  status: "queued" | "running" | "succeeded" | "failed";
  result?: unknown;
  error?: string;
  errorCode?: string;
};
async function geo(path: string, init: RequestInit = {}): Promise<WorkerReply> {
  const response = await fetch(`${settings.geoUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${settings.geoToken}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok)
    throw new Error(`Processor request failed (${response.status}).`);
  return response.json();
}

async function failJob(id: string, message: string) {
  const operation = (await query("SELECT operation FROM jobs WHERE id=$1", [id])).rows[0]?.operation;
  if (operation === "dataset-spatial-inference") return failDatasetMl(id,message);
  if (operation === "spatial-inference") return failSpatialMlJob(id, message);
  await transaction(async (client) => {
    const job = (await client.query("SELECT * FROM jobs WHERE id=$1", [id]))
      .rows[0];
    if (!job || !["queued", "running"].includes(job.status)) return;
    await lockCase(client, job.case_id);
    await client.query(
      "UPDATE jobs SET status='failed',error=$2,completed_at=now() WHERE id=$1",
      [id, message.slice(0, 600)],
    );
    if (job.source_id)
      await client.query("UPDATE sources SET status='failed' WHERE id=$1", [
        job.source_id,
      ]);
    await recordEvent(
      client,
      job.case_id,
      "processing.failed",
      `${job.operation === "inspect" ? "Source inspection" : "Model build"} failed: ${message.slice(0, 300)}`,
    );
  });
}

export async function ingestJob(id: string, result: unknown) {
  const operation = (await query("SELECT operation FROM jobs WHERE id=$1", [id])).rows[0]?.operation;
  if (operation === "dataset-spatial-inference") return ingestDatasetMl(id,result);
  if (operation === "spatial-inference") return ingestSpatialMlJob(id, result);
  await transaction(async (client) => {
    const job = (await client.query("SELECT * FROM jobs WHERE id=$1", [id]))
      .rows[0];
    if (!job || ["succeeded", "failed", "stale"].includes(job.status)) return;
    const current = await lockCase(client, job.case_id);
    // Recheck after obtaining the same lock used by relevant candidate mutations.
    const latest = (
      await client.query("SELECT status FROM jobs WHERE id=$1", [id])
    ).rows[0];
    if (!["queued", "running"].includes(latest.status)) return;
    if (job.operation === "inspect") {
      const parsed = inspectionSchema.parse(result);
      if (parsed.profile !== job.payload.profile)
        throw new Error("Source inspection returned the wrong input profile.");
      await client.query(
        "UPDATE sources SET status=$2,inspection=$3 WHERE id=$1 AND case_id=$4",
        [job.source_id, parsed.status, parsed, job.case_id],
      );
      await client.query(
        "UPDATE jobs SET status=$2,completed_at=now(),error=$3 WHERE id=$1",
        [
          id,
          parsed.status === "failed" ? "failed" : "succeeded",
          parsed.status === "failed" ? parsed.summary : null,
        ],
      );
      await recordEvent(
        client,
        job.case_id,
        "source.inspected",
        parsed.summary,
      );
      return;
    }
    const parsed = buildResultSchema.parse(result);
    const input = job.payload as BuildInput;
    if (parsed.inputFingerprint !== job.input_fingerprint)
      throw new Error(
        "Processor result does not match the requested input fingerprint.",
      );
    if (
      fingerprint(parsed.frame) !== fingerprint(input.frame) ||
      fingerprint(parsed.context) !== fingerprint(input.context)
    )
      throw new Error(
        "Processor result changed the calculation frame or context.",
      );
    if (parsed.units.length !== input.units.length)
      throw new Error("Processor result has an unexpected unit count.");
    const inputs = new Map(input.units.map((unit) => [unit.id, unit]));
    for (const unit of parsed.units) {
      const { area: _area, height: _height, volume: _volume, ...spec } = unit;
      if (fingerprint(spec) !== fingerprint(inputs.get(unit.id)))
        throw new Error("Processor result changed a candidate specification.");
    }
    const snapshot: ModelSnapshot = {
      ...parsed,
      id: randomUUID(),
      caseId: job.case_id,
      revision: job.case_revision,
      createdAt: new Date().toISOString(),
    };
    const inserted = await client.query(
      `INSERT INTO snapshots(id,case_id,revision,input_fingerprint,body) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(case_id,input_fingerprint) DO NOTHING RETURNING id`,
      [
        snapshot.id,
        job.case_id,
        job.case_revision,
        job.input_fingerprint,
        snapshot,
      ],
    );
    const snapshotId =
      inserted.rows[0]?.id ??
      (
        await client.query(
          "SELECT id FROM snapshots WHERE case_id=$1 AND input_fingerprint=$2",
          [job.case_id, job.input_fingerprint],
        )
      ).rows[0].id;
    const fresh = current.revision === job.case_revision;
    await client.query(
      "UPDATE jobs SET status=$2,completed_at=now(),error=NULL WHERE id=$1",
      [id, fresh ? "succeeded" : "stale"],
    );
    if (fresh)
      await client.query(
        "UPDATE cases SET current_snapshot_id=$2,updated_at=now() WHERE id=$1",
        [job.case_id, snapshotId],
      );
    await recordEvent(
      client,
      job.case_id,
      fresh ? "model.built" : "model.stale",
      fresh
        ? `${parsed.units.length} spaces reconstructed and checked for revision ${job.case_revision}.`
        : `Revision ${job.case_revision} results retained; newer candidate inputs require a fresh build.`,
    );
  });
}

export async function dispatchTick(): Promise<number> {
  const pending = await query(
    "SELECT * FROM jobs WHERE status IN ('queued','running') AND next_attempt_at<=now() ORDER BY created_at LIMIT 12",
  );
  await Promise.all(
    pending.rows.map(async (job) => {
      try {
        if (!job.dispatched_at) {
          const reply = await geo("/internal/jobs", {
            method: "POST",
            body: JSON.stringify({
              jobId: job.id,
              operation: isInference(job.operation)?"spatial-inference":job.operation,
              input: job.payload,
            }),
          });
          if (reply.jobId !== job.id)
            throw new Error("Processor acknowledged a different job.");
          await transaction(async (client) => {
            await client.query(
              "UPDATE jobs SET status=$2,dispatched_at=now(),next_attempt_at=now(),error=NULL WHERE id=$1 AND status IN ('queued','running')",
              [job.id, isInference(job.operation) ? "queued" : "running"],
            );
            if (job.source_id && !isInference(job.operation))
              await client.query(
                "UPDATE sources SET status='processing' WHERE id=$1 AND status='received'",
                [job.source_id],
              );
          });
        }
        const result = await geo(`/internal/jobs/${job.id}`);
        if (result.jobId !== job.id)
          throw new Error("Processor returned a different job.");
        if (result.status === "succeeded")
          await ingestJob(job.id, result.result);
        else if (result.status === "failed") {
          if (job.operation === "spatial-inference") await failSpatialMlJob(job.id, result.error || "Local inference failed. Retry this item after checking its source and model.", result.errorCode);
          else await failJob(job.id, result.error || "Processing failed. Inspect the source and retry.");
        } else if (isInference(job.operation)) {
          // Waiting behind another batch item is not inference execution time.
          if (result.status === "running") {
            if(job.operation==='dataset-spatial-inference')await markDatasetMlRunning(job.id);else await markSpatialMlRunning(job.id);
            if (job.started_at && Date.now() - new Date(job.started_at).getTime() > 120000) {
              const message="Local inference exceeded its two-minute execution limit. The original remains available; retry this item.";
              if(job.operation==='spatial-inference')await failSpatialMlJob(job.id,message,'INFERENCE_TIMEOUT');else await failJob(job.id,message);
            }
          }
        } else if (Date.now() - new Date(job.created_at).getTime() > 120000)
          await failJob(
            job.id,
            "Processing exceeded two minutes. Check the worker and retry.",
          );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Processing service unavailable.";
        const attempts = job.attempts + 1;
        if (attempts >= 5) await failJob(job.id, message);
        else
          await query(
            "UPDATE jobs SET attempts=$2,next_attempt_at=now()+interval '2 seconds',error=$3 WHERE id=$1 AND status IN ('queued','running')",
            [job.id, attempts, message.slice(0, 600)],
          );
      }
    }),
  );
  return pending.rowCount ?? 0;
}
