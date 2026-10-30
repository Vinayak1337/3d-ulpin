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
import {runIntakePlanJob} from '../usp/ingestion/intake-plan-worker';
import {runIntakeNativeDerivativeJob} from '../usp/ingestion/intake-native-derivative-worker';
import {runIntakeEvidenceJob} from '../usp/ingestion/intake-evidence-worker';
import {runTableProfileJob} from '../usp/ingestion/table-profile-worker';
import {runIntakeTableGeojsonJob} from '../usp/ingestion/table-geojson-worker';
import {runIntakeRunJob,runNextIntakeRunJob} from '../usp/ingestion/intake-run-worker';
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
  dispatchHeapBudgetMiB,dispatchScratchBudgetMiB,type DispatchJob} from './dispatch-lanes';
const isInference=(operation:string)=>['spatial-inference','dataset-spatial-inference'].includes(operation);
let largeOriginalWorker:Promise<void>|undefined;
const streamingVectorWorkers=new Set<string>();
const chunkMappingWorkers=new Set<string>();
const streamedProfileWorkers=new Set<string>();
let intakeDraftWorker:Promise<void>|undefined;
const intakeLargeWorkers=new Set<string>();
let intakeZipLayersWorker:Promise<void>|undefined;
let intakePageImageWorker:Promise<void>|undefined;
const intakeNativeDerivativeWorkers=new Set<string>();
let intakeEvidenceWorker:Promise<void>|undefined;
let tableProfileWorker:Promise<void>|undefined;
let tableGeojsonWorker:Promise<void>|undefined;
let intakeRunWorker:Promise<void>|undefined;
const intakePrepareWorkers=new Set<string>();
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
let surfaceAdmission:Promise<void>|undefined;
const processorWorkers=new Map<string,Promise<void>>();
const processorReservations=new Set<string>();
let wakeVersion=0;
const wakeListeners=new Set<()=>void>();
function wakeDispatcher(){
  wakeVersion++;
  for(const wake of wakeListeners)wake();
}
const reservations=new DispatchReservations(wakeDispatcher);

/** Observe before a tick, so a completion during the tick cannot be lost before its wait begins. */
export function dispatchWakeVersion(){return wakeVersion;}

/** The operations this process's jobs hold, without ids, for the dispatcher's stall log. */
export function dispatchHeldOperations(){return reservations.heldOperations();}

/** Completion wakes the next selection immediately; the poll remains the fallback for externally queued work. */
export function waitForDispatch(since:number,milliseconds=750):Promise<void>{
  if(since!==wakeVersion)return Promise.resolve();
  return new Promise(resolve=>{
    const finish=()=>{clearTimeout(timer);wakeListeners.delete(finish);resolve();};
    const timer=setTimeout(finish,milliseconds);
    wakeListeners.add(finish);
  });
}
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

async function dispatchProcessorJob(job:QueryResultRow){
  try{
    if(!job.dispatched_at){
      if(job.operation==='spatial-inference'&&!(await admitSpatialMlDispatch(job.id)))return;
      const reply=await geo('/internal/jobs',{method:'POST',body:JSON.stringify({jobId:job.id,
        operation:isInference(job.operation)?'spatial-inference':job.operation,input:job.payload})});
      if(reply.jobId!==job.id)throw new Error('Processor acknowledged a different job.');
      if(job.operation==='projected-vector')await markProjectedRunning(job.id);
      else await transaction(async client=>{
        await client.query(
          `UPDATE jobs SET status=$2,dispatched_at=now(),next_attempt_at=now(),error=NULL
            WHERE id=$1 AND status IN ('queued','running')`,
          [job.id,isInference(job.operation)?'queued':'running']);
        if(job.source_id&&!isInference(job.operation))await client.query(
          "UPDATE sources SET status='processing' WHERE id=$1 AND status='received'",[job.source_id]);
      });
    }
    await readProcessorJob(job);
  }catch(error){
    const message=error instanceof Error?error.message:'Processing service unavailable.';
    const attempts=job.attempts+1;
    if(attempts>=5)await failJob(job.id,message);
    else await query(
      `UPDATE jobs SET attempts=$2,next_attempt_at=now()+interval '2 seconds',error=$3
        WHERE id=$1 AND status IN ('queued','running')`,
      [job.id,attempts,message.slice(0,600)]);
  }
}

async function readProcessorJob(job:QueryResultRow){
  const result=await geo(`/internal/jobs/${job.id}`);
  if(result.jobId!==job.id)throw new Error('Processor returned a different job.');
  if(result.status==='succeeded')await ingestJob(job.id,result.result);
  else if(result.status==='failed'){
    if(job.operation==='spatial-inference')await failSpatialMlJob(job.id,
      result.error||'Local inference failed. Retry this item after checking its source and model.',result.errorCode);
    else await failJob(job.id,result.error||'Processing failed. Inspect the source and retry.');
  }else if(isInference(job.operation)){
    // Queue residence is not inference execution time.
    if(result.status!=='running')return;
    if(job.operation==='dataset-spatial-inference')await markDatasetMlRunning(job.id);
    else await markSpatialMlRunning(job.id);
    if(job.started_at&&Date.now()-new Date(job.started_at).getTime()>120000){
      const message='Local inference exceeded its two-minute execution limit. '
        +'The original remains available; retry this item.';
      if(job.operation==='spatial-inference')await failSpatialMlJob(job.id,message,'INFERENCE_TIMEOUT');
      else await failJob(job.id,message);
    }
  }else if(Date.now()-new Date(job.created_at).getTime()>120000)
    await failJob(job.id,'Processing exceeded two minutes. Check the worker and retry.');
  if(result.status==='succeeded'||result.status==='failed')wakeDispatcher();
}

/** Surface planning can wait on older batches' locks; one pass runs independently of ready-job dispatch. */
function admitSurfaces(){
  if(surfaceAdmission)return;
  surfaceAdmission=admitIntakeSurfaceParts()
    .catch(keepWorkerError('intake-surface','admission'))
    .finally(()=>{surfaceAdmission=undefined;});
}

export async function dispatchTick(runners:{packetPdf?:typeof runPacketPdfJob;document?:typeof runDocumentJob;
  privateMvt?:typeof runPrivateMvtJob;intakeRun?:typeof runIntakeRunJob;
  intakeRunNext?:typeof runNextIntakeRunJob}={}): Promise<number> {
  // Transfer completed submissions only against a snapshot begun after they settled; an older snapshot may
  // predate their durable running row. Until then the local reservation must continue to count their resources.
  const settled=[...processorReservations].filter(id=>!processorWorkers.has(id));
  const elsewhere=(await query<DispatchJob>(
    `SELECT id::text AS id, operation, created_at FROM jobs WHERE operation NOT LIKE 'usp:%'
      AND NOT operation=ANY($1::text[]) AND (status='running' OR (status='queued' AND dispatched_at IS NOT NULL))`,
    [dispatchInProcessOperations()],
  )).rows;
  for(const id of settled){processorReservations.delete(id);reservations.release(id);}
  const pending = await query(
    // A file's first map part precedes further parts. Large-step handoffs rotate by enqueue time within
    // the batch's wave and layout priority, rather than always returning to its oldest item.
    // A busy item's state keys cannot fill the window. Each lane's oldest ready refusal precedes
    // first-part promotion, so head-of-line admission never waits for an off-window job. A map file's mapping before
    // its first published part precedes table mappings; the window flags what waits for the table lane (S9.5f).
    `WITH ready AS (SELECT jobs.*, COALESCE(lanes.lane,'other') AS lane, row_number() OVER (
        PARTITION BY COALESCE(lanes.lane,'other'), COALESCE(jobs.source_id::text,jobs.case_id::text)
        ORDER BY jobs.id::text=ANY($8::text[]) DESC,jobs.created_at,jobs.id) AS file_rank,
        jobs.operation='intake-large' AND i.item_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM usp_intake_parts part WHERE part.item_id=i.item_id) AS first_part,
        jobs.operation='chunk-mapping' AND i.item_id IS NOT NULL AND i.family IN ('vector','model3d') AND NOT EXISTS (
          SELECT 1 FROM usp_intake_parts part WHERE part.item_id=i.item_id AND part.state='published') AS map_mapping,
        CASE WHEN jobs.operation IN ('intake-large','streaming-vector','streamed-profile','chunk-mapping',
          'table-profile','intake-draft') THEN i.case_id END AS intake_case_id,i.created_at AS item_created_at,
        i.wave AS item_wave,
        COALESCE(i.placement='needs_answer' OR i.plan_ref->>'recipeState'='approved',false) AS item_waiting
      FROM jobs LEFT JOIN unnest($1::text[],$2::text[]) AS lanes(operation,lane) ON lanes.operation=jobs.operation
      LEFT JOIN usp_intake_items i ON i.source_id=jobs.source_id AND i.case_id=jobs.case_id
        AND i.parent_item_id IS NULL
      WHERE jobs.status IN ('queued','running') AND jobs.operation NOT LIKE 'usp:%' AND jobs.next_attempt_at<=now()
        AND NOT jobs.id::text=ANY($3::text[]) AND NOT jobs.operation=ANY($4::text[])
        AND NOT (jobs.operation='intake-large' AND COALESCE(i.item_id::text,'')=ANY($7::text[]))
        AND ((jobs.dispatched_at IS NOT NULL AND NOT jobs.operation=ANY($6::text[]))
          OR NOT COALESCE(lanes.lane,'other')=ANY($5::text[]))
        AND NOT EXISTS (SELECT 1 FROM usp_job_attempts a
          WHERE a.job_id=jobs.id AND a.state='active' AND a.lease_until>now())
    ), fifo AS (SELECT ready.*,row_number() OVER (
        ORDER BY lane='probe' DESC,file_rank,created_at,id) AS fifo_rank FROM ready
        WHERE operation<>'intake-large' OR file_rank=1),
    ranked AS (SELECT fifo.*,min(fifo_rank) OVER (
        PARTITION BY COALESCE(intake_case_id::text,id::text),lane='probe') AS batch_rank,
        id::text=ANY($8::text[]) AND row_number() OVER (
          PARTITION BY lane ORDER BY id::text=ANY($8::text[]) DESC,created_at,id)=1 AS refusal_head FROM fifo)
    SELECT *,bool_or(map_mapping) OVER () AS map_waiting,
      bool_or(lane='table' AND NOT map_mapping) OVER () AS table_waiting
    FROM ranked ORDER BY lane='probe' DESC,refusal_head DESC,
      CASE WHEN refusal_head THEN created_at END,first_part DESC,map_mapping DESC,batch_rank,item_wave,
      item_waiting DESC NULLS LAST,
      CASE WHEN operation='intake-large' THEN created_at ELSE item_created_at END,created_at,id LIMIT 12`,
    [...dispatchLaneParameters(),[...new Set([...reservations.heldJobIds(),...processorWorkers.keys()])],
      [...reservations.unavailableOperations(),...(intakeRunWorker?['intake-run']:[])],
      reservations.unavailableLanes(elsewhere),dispatchInProcessOperations(),reservations.unavailableLargeItems(),
      reservations.refusedJobIds()],
  );
  const refused=reservations.refusedJobIds();
  if(refused.length)reservations.keepRefused((await query<{id:string}>(
    "SELECT id::text AS id FROM jobs WHERE id::text=ANY($1::text[]) AND status IN ('queued','running')",[refused],
  )).rows.map(job=>job.id),pending.rows.map(job=>job.id));
  // A job starts only while its lane has room and its memory and scratch fit; a refused one waits for a later tick.
  const budget=dispatchMemoryBudgetMiB(settings.dispatchMemoryMib),scratch=await dispatchScratchBudgetMiB();
  const now=Date.now();
  reservations.keepTableLaneWaiting(Boolean(pending.rows[0]?.map_waiting),Boolean(pending.rows[0]?.table_waiting));
  const admit=(job:QueryResultRow)=>reservations.admit({id:job.id,operation:job.operation,created_at:job.created_at,
    payload:job.payload,mapMapping:Boolean(job.map_mapping)},budget,elsewhere,now,scratch,dispatchHeapBudgetMiB());
  // Drain preparations before ordered work; its existing priority selector and serial chain remain unchanged.
  const orderedRunWaiting=pending.rows.some(job=>job.operation==='intake-run'&&job.payload?.phase!=='prepare');
  // SB1 keeps its reader caps and one pass at a time, but never delays unrelated selected jobs.
  admitSurfaces();
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
        if(!streamingVectorWorkers.has(job.id)&&admit(job)){
          streamingVectorWorkers.add(job.id);
          void runStreamingVectorJob(job.id)
            // Fenced attempt and durable job state permit replay after restart.
            .catch(keepWorkerError(job.operation,job.id))
            .finally(()=>{streamingVectorWorkers.delete(job.id);reservations.release(job.id);});
        }
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
        if(!chunkMappingWorkers.has(job.id)&&admit(job)){
          chunkMappingWorkers.add(job.id);
          void runChunkMappingJob(job.id)
            // The shared attempt fence owns retry and durable terminal state.
            .catch(keepWorkerError(job.operation,job.id))
            .finally(()=>{chunkMappingWorkers.delete(job.id);reservations.release(job.id);});
        }
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
        if(!intakeLargeWorkers.has(job.id)&&admit(job)){
          intakeLargeWorkers.add(job.id);
          void runIntakeLargeJob(job.id)
            // The fenced attempt and the stored step rows own recovery.
            .catch(keepWorkerError(job.operation,job.id))
            .finally(()=>{intakeLargeWorkers.delete(job.id);reservations.release(job.id);});
        }
        return;
      }
      if(job.operation==='intake-zip-layers'){
        if(!intakeZipLayersWorker&&admit(job))intakeZipLayersWorker=runIntakeZipLayersJob(job.id)
          // The fenced attempt and the member rows own recovery; a rerun keeps nothing twice.
          .catch(keepWorkerError(job.operation,job.id))
          .finally(()=>{intakeZipLayersWorker=undefined;reservations.release(job.id);});
        return;
      }
      if(job.operation==='intake-page-image'||job.operation==='intake-plan'){
        const read=job.operation==='intake-plan'?runIntakePlanJob:runIntakePageImageJob;
        if(!intakePageImageWorker&&admit(job))intakePageImageWorker=read(job.id)
          // The fenced attempt owns retry; a rerun stores the same content-addressed preview.
          .catch(keepWorkerError(job.operation,job.id))
          .finally(()=>{intakePageImageWorker=undefined;reservations.release(job.id);});
        return;
      }
      if(job.operation==='intake-native-derivative'){
        if(!intakeNativeDerivativeWorkers.has(job.id)&&admit(job)){
          intakeNativeDerivativeWorkers.add(job.id);
          void runIntakeNativeDerivativeJob(job.id)
            // The fenced attempt and each child's lineage own recovery; a rerun keeps no layer twice.
            .catch(keepWorkerError(job.operation,job.id))
            .finally(()=>{intakeNativeDerivativeWorkers.delete(job.id);reservations.release(job.id);});
        }
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
      if(job.operation==='intake-table-geojson'){
        if(!tableGeojsonWorker&&admit(job))tableGeojsonWorker=runIntakeTableGeojsonJob(job.id)
          // The fenced attempt and the child's lineage own recovery; a rerun keeps the derivative once.
          .catch(keepWorkerError(job.operation,job.id))
          .finally(()=>{tableGeojsonWorker=undefined;reservations.release(job.id);});
        return;
      }
      if(job.operation==='intake-run'){
        if(job.payload?.phase==='prepare'){
          if(!intakeRunWorker&&!orderedRunWaiting&&!intakePrepareWorkers.has(job.id)&&admit(job)){
            intakePrepareWorkers.add(job.id);
            void (runners.intakeRun??runIntakeRunJob)(job.id)
              .catch(keepWorkerError(job.operation,job.id))
              .finally(()=>{intakePrepareWorkers.delete(job.id);reservations.release(job.id);});
          }
        }else if(!intakeRunWorker&&!intakePrepareWorkers.size&&admit(job)){
          // The run picks its own next job, so a target an officer opened goes first.
          intakeRunWorker=(runners.intakeRunNext??runNextIntakeRunJob)()
            // The fenced attempt and the stored target state own recovery.
            .catch(keepWorkerError(job.operation,job.id))
            .finally(()=>{intakeRunWorker=undefined;reservations.release(job.id);});
        }
        return;
      }
      if(job.operation==='streamed-profile'){
        if(!streamedProfileWorkers.has(job.id)&&admit(job)){
          streamedProfileWorkers.add(job.id);
          void runStreamedProfileJob(job.id)
            // The shared attempt fence owns retry and durable terminal state.
            .catch(keepWorkerError(job.operation,job.id))
            .finally(()=>{streamedProfileWorkers.delete(job.id);reservations.release(job.id);});
        }
        return;
      }
      if(job.operation==='document-extraction'){
        if(!admit(job))return;
        // Lane admission holds memory until completion, without holding the dispatcher tick open for OCR.
        void (runners.document??runDocumentJob)(job.id)
          .catch(keepWorkerError(job.operation,job.id))
          .finally(()=>{reservations.release(job.id);});
        return;
      }
      if(job.operation==='private-mvt'){
        if(!admit(job))return;
        // This allowlisted SQL runner owns fencing/recovery and never reaches geo
        // or the generic retry/error mutation below.
        void (runners.privateMvt??runPrivateMvtJob)(job.id)
          .catch(()=>failPrivateMvtJob(job.id,'MVT_PROCESSING_FAILED'))
          .catch(keepWorkerError(job.operation,job.id))
          .finally(()=>{reservations.release(job.id);});
        return;
      }
      // Transport and result acceptance must not hold the tick open for unrelated ready work.
      if(processorWorkers.has(job.id))return;
      const starting=!job.dispatched_at;
      if(starting&&!admit(job))return;
      if(starting)processorReservations.add(job.id);
      processorWorkers.set(job.id,dispatchProcessorJob(job)
        .catch(keepWorkerError(job.operation,job.id))
        .finally(()=>{
          processorWorkers.delete(job.id);
          if(starting)wakeDispatcher();
        }));
    }),
  );
  return pending.rowCount ?? 0;
}
