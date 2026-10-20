import { randomUUID } from "node:crypto";
import type { QueryResultRow } from "pg";
import type { BuildInput, ModelSnapshot } from "@ulpin/contracts";
import { query, transaction } from "../../infrastructure/db";
import { settings } from "../../infrastructure/config";
import { AppError } from "../../infrastructure/errors";
import { fingerprint, lockCase, recordEvent } from "./domain";
import { buildResultSchema, inspectionSchema } from "../../infrastructure/validation";
import { failSpatialMlJob, ingestSpatialMlJob, markSpatialMlRunning, admitSpatialMlDispatch } from "../spatial/spatial-ml";

import {failDatasetMl,ingestDatasetMl,markDatasetMlRunning} from '../datasets/dataset-ml';
import {failProjectedJob,ingestProjectedResult,markProjectedRunning} from '../usp/ingestion/projected-publication';
import {runPrivateMvtJob,failPrivateMvtJob} from '../usp/tiles/publication';
import {runDocumentJob} from '../usp/ingestion/document-worker';
import {runLargeOriginalStorageJob} from '../usp/ingestion/large-original';
import {runStreamingVectorJob} from '../usp/ingestion/streaming-vector-worker';
import {runChunkMappingJob} from '../usp/ingestion/chunk-mapping-worker';
import {runStreamedProfileJob} from '../usp/ingestion/streamed-profile-worker';
import {runIntakeDraftJob} from '../usp/ingestion/intake-draft-worker';
import {runIntakeLargeJob} from '../usp/ingestion/intake-large-worker';
import {runIntakeZipLayersJob} from '../usp/ingestion/intake-zip-layers-worker';
import {runIntakePageImageJob} from '../usp/ingestion/intake-page-image-worker';
import {runIntakeNativeDerivativeJob} from '../usp/ingestion/intake-native-derivative-worker';
import {runIntakeEvidenceJob} from '../usp/ingestion/intake-evidence-worker';
import {runTableProfileJob} from '../usp/ingestion/table-profile-worker';
import {runNextIntakeRunJob} from '../usp/ingestion/intake-run-worker';
import {runRasterWindowJob} from '../usp/ingestion/raster-window-worker';
import {runPointBatchJob} from '../usp/ingestion/point-batch-worker';
import {admitIntakeSurfaceParts} from '../usp/ingestion/intake-surface';
import {runIFCJob} from '../usp/ingestion/ifc-worker';
import {runDXFJob} from '../usp/ingestion/dxf-worker';
import {runKMLJob} from '../usp/ingestion/kml-worker';
import {runCityGMLJob} from '../usp/ingestion/citygml-worker';
import {runObjJob} from '../usp/ingestion/obj-worker';
import {runGltfJob} from '../usp/ingestion/gltf-worker';
import {runGeoParquetJob} from '../usp/ingestion/geoparquet-worker';
import {runCityJSONJob} from '../usp/ingestion/cityjson-worker';
import {runCityJSONValidationJob} from '../registry/cityjson-validation-worker';
import type {runPacketPdfJob} from '../usp/packets/pdf-worker';
import {DispatchReservations,dispatchInProcessOperations,dispatchLaneParameters,dispatchMemoryBudgetMiB,
  dispatchScratchBudgetMiB,type DispatchJob} from './dispatch-lanes';
const isInference=(operation:string)=>['spatial-inference','dataset-spatial-inference'].includes(operation);
let largeOriginalWorker:Promise<void>|undefined;
let streamingVectorWorker:Promise<void>|undefined;
let chunkMappingWorker:Promise<void>|undefined;
let streamedProfileWorker:Promise<void>|undefined;
let intakeDraftWorker:Promise<void>|undefined;
let intakeLargeWorker:Promise<void>|undefined;
let intakeZipLayersWorker:Promise<void>|undefined;
let intakePageImageWorker:Promise<void>|undefined;
let intakeNativeDerivativeWorker:Promise<void>|undefined;
let intakeEvidenceWorker:Promise<void>|undefined;
let tableProfileWorker:Promise<void>|undefined;
let intakeRunWorker:Promise<void>|undefined;
let rasterWindowWorker:Promise<void>|undefined;
let ifcWorker:Promise<void>|undefined;
let dxfWorker:Promise<void>|undefined;
let kmlWorker:Promise<void>|undefined;
let citygmlWorker:Promise<void>|undefined;
let objWorker:Promise<void>|undefined;
let gltfWorker:Promise<void>|undefined;
let geoparquetWorker:Promise<void>|undefined;
let cityjsonWorker:Promise<void>|undefined;
let cityjsonValidationWorker:Promise<void>|undefined;
let pointBatchWorker:Promise<void>|undefined;
let packetPdfWorker:Promise<void>|undefined;
const reservations=new DispatchReservations();
/** Keeps the code a background worker's error carries, never its message: messages can carry file content. */
function keepWorkerError(operation:string,jobId:string){
  return (error:unknown)=>{
    const own=typeof error==='object'&&error!==null&&Object.hasOwn(error,'code')?Reflect.get(error,'code'):undefined;
    const code=error instanceof AppError?error.code
      :typeof own==='string'&&/^[A-Z0-9_]{1,40}$/.test(own)?own
      :error instanceof Error?error.name:'unknown';
    console.warn(`The ${operation} worker dispatched from job ${jobId} ended with error code ${code}`);
  };
}

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
  if(operation==='projected-vector')return failProjectedJob(id);
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
  if(operation==='packet-pdf')throw new Error('Queued PDF acceptance requires its registered fenced packet validator.');
  if(operation==='projected-vector')return ingestProjectedResult(id,result);
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

export async function dispatchTick(runners:{packetPdf?:typeof runPacketPdfJob}={}): Promise<number> {
  const pending = await query(
    // G22. Probe-lane jobs first; then each file's oldest job in a lane before any file's second, a file being the
    // job's source or, without one, its case: 211 parts of one point cloud cannot hold back a table, and a lone file
    // still gets up to 12 parallel jobs when nothing else waits.
    `SELECT * FROM (SELECT jobs.*, COALESCE(lanes.lane,'other') AS lane, row_number() OVER (
        PARTITION BY COALESCE(lanes.lane,'other'), COALESCE(jobs.source_id::text,jobs.case_id::text)
        ORDER BY jobs.created_at) AS file_rank
      FROM jobs LEFT JOIN unnest($1::text[],$2::text[]) AS lanes(operation,lane) ON lanes.operation=jobs.operation
      WHERE jobs.status IN ('queued','running') AND jobs.operation NOT LIKE 'usp:%' AND jobs.next_attempt_at<=now()
    ) ranked ORDER BY lane='probe' DESC, file_rank, created_at LIMIT 12`,
    dispatchLaneParameters(),
  );
  // G22. A job sent to the processor holds its lane and memory, for every dispatcher, until it leaves the queue there.
  const elsewhere=(await query<DispatchJob>(
    `SELECT id::text AS id, operation, created_at FROM jobs WHERE operation NOT LIKE 'usp:%'
      AND NOT operation=ANY($1::text[]) AND (status='running' OR (status='queued' AND dispatched_at IS NOT NULL))`,
    [dispatchInProcessOperations()],
  )).rows;
  const refused=reservations.refusedJobIds();
  if(refused.length)reservations.keepRefused((await query<{id:string}>(
    "SELECT id::text AS id FROM jobs WHERE id::text=ANY($1::text[]) AND status IN ('queued','running')",[refused],
  )).rows.map(job=>job.id));
  // A job starts only while its lane has room and its memory and scratch fit; a refused one waits for a later tick.
  const budget=dispatchMemoryBudgetMiB(settings.dispatchMemoryMib),scratch=await dispatchScratchBudgetMiB();
  const now=Date.now();
  const admit=(job:QueryResultRow)=>reservations.admit({id:job.id,operation:job.operation,created_at:job.created_at,
    payload:job.payload},budget,elsewhere,now,scratch);
  // SB1: a kept TIFF or LAZ of a batch admits its next planned part within its reader's own caps, one per file.
  await admitIntakeSurfaceParts().catch(keepWorkerError('intake-surface', 'admission'));
  await Promise.all(
    pending.rows.map(async (job) => {
      if(job.operation==='packet-pdf'){
        if(!packetPdfWorker&&admit(job))packetPdfWorker=(async()=>{
          const run=runners.packetPdf??(await import('../usp/packets/pdf-worker')).runPacketPdfJob;await run(job.id);
        })()
          // Canonical attempt/packet publication owns recovery.
          .catch(keepWorkerError(job.operation,job.id))
          .finally(()=>{packetPdfWorker=undefined;reservations.release(job.id);});
        return;
      }
      if(job.operation==='large-original-storage'){
        // One bounded storage worker per dispatcher process; the SQL upload lease fences peers and restart.
        if(!largeOriginalWorker&&admit(job))largeOriginalWorker=runLargeOriginalStorageJob(job.id)
          // The upload job persists its own bounded retry/failure state.
          .catch(keepWorkerError(job.operation,job.id))
          .finally(()=>{largeOriginalWorker=undefined;reservations.release(job.id);});
        return;
      }
      if(job.operation==='streaming-vector'){
        if(!streamingVectorWorker&&admit(job))streamingVectorWorker=runStreamingVectorJob(job.id)
          // Fenced attempt and durable job state permit replay after restart.
          .catch(keepWorkerError(job.operation,job.id))
          .finally(()=>{streamingVectorWorker=undefined;reservations.release(job.id);});
        return;
      }
      if(job.operation==='raster-window'){
        if(!rasterWindowWorker&&admit(job))rasterWindowWorker=runRasterWindowJob(job.id)
          // The shared attempt fence and durable status own recovery.
          .catch(keepWorkerError(job.operation,job.id))
          .finally(()=>{rasterWindowWorker=undefined;reservations.release(job.id);});
        return;
      }
      if(job.operation==='cityjson-validation'){
        if(!cityjsonValidationWorker&&admit(job))cityjsonValidationWorker=runCityJSONValidationJob(job.id)
          // Canonical fenced validation status owns recovery; retries are explicit.
          .catch(keepWorkerError(job.operation,job.id))
          .finally(()=>{cityjsonValidationWorker=undefined;reservations.release(job.id);});
        return;
      }
      if(job.operation==='ifc-native'){
        if(!ifcWorker&&admit(job))ifcWorker=runIFCJob(job.id)
          // Canonical fenced status owns recovery; native retries are explicit.
          .catch(keepWorkerError(job.operation,job.id))
          .finally(()=>{ifcWorker=undefined;reservations.release(job.id);});
        return;
      }
      if(job.operation==='dxf-native'){
        if(!dxfWorker&&admit(job))dxfWorker=runDXFJob(job.id)
          // Canonical fenced status owns recovery; native retries are explicit.
          .catch(keepWorkerError(job.operation,job.id))
          .finally(()=>{dxfWorker=undefined;reservations.release(job.id);});
        return;
      }
      if(job.operation==='kml-native'){
        if(!kmlWorker&&admit(job))kmlWorker=runKMLJob(job.id)
          // Canonical fenced state owns recovery; member retries are explicit.
          .catch(keepWorkerError(job.operation,job.id))
          .finally(()=>{kmlWorker=undefined;reservations.release(job.id);});
        return;
      }
      if(job.operation==='citygml-native'){
        if(!citygmlWorker&&admit(job))citygmlWorker=runCityGMLJob(job.id)
          // Canonical fenced state owns recovery; native retries are explicit.
          .catch(keepWorkerError(job.operation,job.id))
          .finally(()=>{citygmlWorker=undefined;reservations.release(job.id);});
        return;
      }
      if(job.operation==='obj-native'){
        if(!objWorker&&admit(job))objWorker=runObjJob(job.id)
          // Canonical fenced state owns recovery; native retries are explicit.
          .catch(keepWorkerError(job.operation,job.id))
          .finally(()=>{objWorker=undefined;reservations.release(job.id);});
        return;
      }
      if(job.operation==='gltf-native'){
        if(!gltfWorker&&admit(job))gltfWorker=runGltfJob(job.id)
          // Canonical fenced state owns recovery; native retries are explicit.
          .catch(keepWorkerError(job.operation,job.id))
          .finally(()=>{gltfWorker=undefined;reservations.release(job.id);});
        return;
      }
      if(job.operation==='geoparquet-native'){
        if(!geoparquetWorker&&admit(job))geoparquetWorker=runGeoParquetJob(job.id)
          // Canonical fenced state owns recovery; native retries are explicit.
          .catch(keepWorkerError(job.operation,job.id))
          .finally(()=>{geoparquetWorker=undefined;reservations.release(job.id);});
        return;
      }
      if(job.operation==='cityjson-native'){
        if(!cityjsonWorker&&admit(job))cityjsonWorker=runCityJSONJob(job.id)
          // Canonical fenced job status owns recovery.
          .catch(keepWorkerError(job.operation,job.id))
          .finally(()=>{cityjsonWorker=undefined;reservations.release(job.id);});
        return;
      }
      if(job.operation==='point-batch'){
        if(!pointBatchWorker&&admit(job))pointBatchWorker=runPointBatchJob(job.id)
          // The shared attempt fence and durable status own recovery.
          .catch(keepWorkerError(job.operation,job.id))
          .finally(()=>{pointBatchWorker=undefined;reservations.release(job.id);});
        return;
      }
      if(job.operation==='chunk-mapping'){
        if(!chunkMappingWorker&&admit(job))chunkMappingWorker=runChunkMappingJob(job.id)
          // The shared attempt fence owns retry and durable terminal state.
          .catch(keepWorkerError(job.operation,job.id))
          .finally(()=>{chunkMappingWorker=undefined;reservations.release(job.id);});
        return;
      }
      if(job.operation==='intake-draft'){
        if(!intakeDraftWorker&&admit(job))intakeDraftWorker=runIntakeDraftJob(job.id)
          // The fenced attempt and durable draft state own recovery.
          .catch(keepWorkerError(job.operation,job.id))
          .finally(()=>{intakeDraftWorker=undefined;reservations.release(job.id);});
        return;
      }
      if(job.operation==='intake-large'){
        if(!intakeLargeWorker&&admit(job))intakeLargeWorker=runIntakeLargeJob(job.id)
          // The fenced attempt and the stored step rows own recovery.
          .catch(keepWorkerError(job.operation,job.id))
          .finally(()=>{intakeLargeWorker=undefined;reservations.release(job.id);});
        return;
      }
      if(job.operation==='intake-zip-layers'){
        if(!intakeZipLayersWorker&&admit(job))intakeZipLayersWorker=runIntakeZipLayersJob(job.id)
          // The fenced attempt and the member rows own recovery; a rerun keeps nothing twice.
          .catch(keepWorkerError(job.operation,job.id))
          .finally(()=>{intakeZipLayersWorker=undefined;reservations.release(job.id);});
        return;
      }
      if(job.operation==='intake-page-image'){
        if(!intakePageImageWorker&&admit(job))intakePageImageWorker=runIntakePageImageJob(job.id)
          // The fenced attempt owns retry; a rerun stores the same content-addressed preview.
          .catch(keepWorkerError(job.operation,job.id))
          .finally(()=>{intakePageImageWorker=undefined;reservations.release(job.id);});
        return;
      }
      if(job.operation==='intake-native-derivative'){
        if(!intakeNativeDerivativeWorker&&admit(job))intakeNativeDerivativeWorker=runIntakeNativeDerivativeJob(job.id)
          // The fenced attempt and each child's lineage own recovery; a rerun keeps no layer twice.
          .catch(keepWorkerError(job.operation,job.id))
          .finally(()=>{intakeNativeDerivativeWorker=undefined;reservations.release(job.id);});
        return;
      }
      if(job.operation==='intake-evidence'){
        if(!intakeEvidenceWorker&&admit(job))intakeEvidenceWorker=runIntakeEvidenceJob(job.id)
          // The fenced attempt and the reading's coverage row own recovery; a rerun replaces its candidates.
          .catch(keepWorkerError(job.operation,job.id))
          .finally(()=>{intakeEvidenceWorker=undefined;reservations.release(job.id);});
        return;
      }
      if(job.operation==='table-profile'){
        if(!tableProfileWorker&&admit(job))tableProfileWorker=runTableProfileJob(job.id)
          // The fenced attempt owns retry; the accepting transaction attaches the table receipt once.
          .catch(keepWorkerError(job.operation,job.id))
          .finally(()=>{tableProfileWorker=undefined;reservations.release(job.id);});
        return;
      }
      if(job.operation==='intake-run'){
        // The run picks its own next job, so a target an officer opened goes first.
        if(!intakeRunWorker&&admit(job))intakeRunWorker=runNextIntakeRunJob()
          // The fenced attempt and the stored target state own recovery.
          .catch(keepWorkerError(job.operation,job.id))
          .finally(()=>{intakeRunWorker=undefined;reservations.release(job.id);});
        return;
      }
      if(job.operation==='streamed-profile'){
        if(!streamedProfileWorker&&admit(job))streamedProfileWorker=runStreamedProfileJob(job.id)
          // The shared attempt fence owns retry and durable terminal state.
          .catch(keepWorkerError(job.operation,job.id))
          .finally(()=>{streamedProfileWorker=undefined;reservations.release(job.id);});
        return;
      }
      if(job.operation==='document-extraction'){
        if(!admit(job))return;
        try{await runDocumentJob(job.id);}finally{reservations.release(job.id);}
        return;
      }
      if(job.operation==='private-mvt'){
        if(!admit(job))return;
        // This allowlisted SQL runner owns fencing/recovery and never reaches geo
        // or the generic retry/error mutation below.
        try{await runPrivateMvtJob(job.id);}catch{await failPrivateMvtJob(job.id,'MVT_PROCESSING_FAILED');}
        finally{reservations.release(job.id);}
        return;
      }
      // A dispatched job runs in the processor; this tick only reads its state, which starts nothing.
      const starting=!job.dispatched_at;
      if(starting&&!admit(job))return;
      try {
        if (!job.dispatched_at) {
          if (job.operation === 'spatial-inference' && !(await admitSpatialMlDispatch(job.id))) return;
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
          if(job.operation==='projected-vector')await markProjectedRunning(job.id);
          else await transaction(async (client) => {
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
      } finally {
        if (starting) reservations.release(job.id);
      }
    }),
  );
  return pending.rowCount ?? 0;
}
