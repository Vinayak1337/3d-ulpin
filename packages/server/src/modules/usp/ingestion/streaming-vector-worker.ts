import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {STREAMING_VECTOR_LIMITS as limits,TABULAR_LIMITS,AnyStreamingInputSchema,
  StreamingVectorPayloadSchema,StreamingVectorGeometrySummarySchema,StreamingVectorGeometryKindSchema,
  type StreamingVectorGeometrySummary,type AnyStreamingInput,type StreamingVectorRecord} from '@ulpin/contracts/usp';
import {query,transaction} from '../../../infrastructure/db';
import {AppError,conflict} from '../../../infrastructure/errors';
import {putOriginal,readObject,sha256} from '../../../infrastructure/storage';
import {fingerprint} from '../../cases/domain';
import {claimUspJobAttempt,heartbeatUspJobAttempt,assertUspJobAttemptTx,acceptUspJobAttempt,
  recordUspJobFailure,type UspJobAttempt} from '../jobs';
import {appendCaseIngestionTx} from './events';
import {assertStreamingInputTx,lockStreamingRowsTx} from './streaming-vector';
import {readStreamingRaw,readStreamingFeatures,readStreamingTabular,sourceRecord,tabularSourceRecord,
  type SourceFeature} from './streaming-vector-reader';
import {validateStreamingTopology} from './streaming-vector-validation';
import {resolveStreamedReference,streamedSequenceReference,writeSealedMapReceiptTx} from './streamed-map-receipt';
import {queueIntakeLargeTx,writeIntakeLargeReadTx} from './intake-large';
import {AREA_PROCESSOR_OPERATION} from '../../areas/areas';
import {readTableWindows} from './tabular-stream';
import {isWindowedTable,writeTableWindowTx} from './table-windows';
import {queueFinishedTableEvidenceTx} from './intake-evidence';

type Slot={chunkIndex:number;firstFeatureIndex:number;lastFeatureIndex:number|null;records:number;accepted:number;quarantined:number;
  status:'ready'|'quarantined';bytes:number;ref:{key:string;sha256:string;bytes:number}|null;issueCode:string|null;resultSha256:string};

const PROGRESS_MS=2000;

function tabularChunkRows(width:number){
  return Math.max(1,Math.min(TABULAR_LIMITS.chunkRows,Math.floor(TABULAR_LIMITS.columns/width)));
}

/** One whole read counts each set-aside record under its code; every attempt replays from byte zero. */
export function tallySetAside(tally:Record<string,number>,record:StreamingVectorRecord){
  if(record.disposition!=='quarantined')return;
  const code=record.issueCode??'UNSTATED';
  tally[code]=(tally[code]??0)+1;
}

/** Count only the final accepted disposition, after topology and the part's payload budget. */
export function tallyAcceptedGeometry(counts:StreamingVectorGeometrySummary['counts'],record:StreamingVectorRecord){
  if(record.disposition!=='accepted')return;
  const feature=record.feature as {geometry?:{type?:unknown}}|null;
  const kind=StreamingVectorGeometryKindSchema.parse(feature?.geometry?.type);
  counts[kind]=(counts[kind]??0)+1;
}

/** An incomplete attempt-local tally is optional evidence, never a prerequisite for sealing the read. */
export async function writeStreamingGeometrySummaryTx(client:PoolClient,input:AnyStreamingInput,
  counts:StreamingVectorGeometrySummary['counts'],accepted:number){
  const parsed=StreamingVectorGeometrySummarySchema.safeParse({rawJobId:input.jobId,counts});
  if(!parsed.success)return;
  const summary=parsed.data;
  if(Object.values(summary.counts).reduce((total,count)=>total+count,0)!==accepted)return;
  await client.query(`UPDATE sources SET inspection=jsonb_set(COALESCE(inspection,'{}'::jsonb),
    '{streamedGeometrySummary}',$2::jsonb) WHERE id=$1`,[input.sourceId,JSON.stringify(summary)]);
}

/** Sealed reader counts and the receipt remain authoritative even when the advisory tally is incomplete. */
export async function completeStreamingReadTx(client:PoolClient,input:AnyStreamingInput,
  closure:Parameters<typeof writeSealedMapReceiptTx>[2],counts:StreamingVectorGeometrySummary['counts'],
  reference?:Parameters<typeof writeSealedMapReceiptTx>[3]){
  const state=(await client.query('SELECT accepted,quarantined FROM usp_streaming_vector_imports WHERE job_id=$1',
    [input.jobId])).rows[0];
  const status=state.quarantined?'completed_with_rejections':'completed';
  await client.query(`UPDATE usp_streaming_vector_imports SET state=$2,issue_code=NULL,updated_at=now()
    WHERE job_id=$1`,[input.jobId,status]);
  if(input.framing!=='tabular')await writeSealedMapReceiptTx(client,input,closure,reference);
  if(input.framing!=='tabular')await writeStreamingGeometrySummaryTx(client,input,counts,state.accepted);
  return status;
}

/** A single SQL watermark publishes ordered parts; only late-type collections wait for the seal. */
export async function publishStreamingPrefixTx(client:PoolClient,input:AnyStreamingInput,
  holdCollection=input.framing==='feature-collection'){
  while(true){
    const state=(await client.query('SELECT next_publish_index,sealed_chunks FROM usp_streaming_vector_imports WHERE job_id=$1 FOR UPDATE',[input.jobId])).rows[0];
    if(holdCollection&&state.sealed_chunks===null)return;
    const slot=(await client.query('SELECT * FROM usp_streaming_vector_slots WHERE job_id=$1 AND source_revision=$2 AND chunk_index=$3 FOR UPDATE',
      [input.jobId,input.sourceRevision,state.next_publish_index])).rows[0];
    if(!slot||slot.published)break;
    await client.query('UPDATE usp_streaming_vector_slots SET published=true WHERE job_id=$1 AND source_revision=$2 AND chunk_index=$3',
      [input.jobId,input.sourceRevision,state.next_publish_index]);
    await client.query('UPDATE usp_streaming_vector_imports SET next_publish_index=next_publish_index+1,updated_at=now() WHERE job_id=$1',[input.jobId]);
    await appendCaseIngestionTx(client,input.caseId,{kind:'streaming-vector.chunk',sourceId:input.sourceId,
      sourceRevision:input.sourceRevision,jobId:input.jobId,chunkIndex:slot.chunk_index,status:slot.status,
      resultSha256:slot.result_sha256,records:slot.records,sourceComplete:false},input.subject);
  }
}

/** The exact payload bytes one part is stored as; a part over the payload budget is refused. */
export function encodeChunk(input:AnyStreamingInput,index:number,records:StreamingVectorRecord[]){
  const payload=StreamingVectorPayloadSchema.parse({version:limits.version,jobId:input.jobId,sourceId:input.sourceId,
    sourceRevision:input.sourceRevision,sourceSha256:input.sourceSha256,chunkIndex:index,records});
  const bytes=Buffer.from(JSON.stringify(payload));
  if(bytes.length>limits.chunkBytes)throw new AppError(413,'STREAMING_CHUNK_BUDGET','A complete draft chunk exceeds the payload budget.');
  return {bytes,hash:sha256(bytes)};
}

/** Holds one part at a time: it closes at its record count, or before a record would pass the payload budget. */
export class StreamingPartWriter{
  private pending:StreamingVectorRecord[]=[];
  private pendingBytes=0;
  index=0;
  constructor(private readonly write:(index:number,records:StreamingVectorRecord[])=>Promise<void>){}
  /** A record too large for any part is kept as quarantined without its feature. */
  async add(record:StreamingVectorRecord,countLimit:number){
    let recordBytes=Buffer.byteLength(JSON.stringify(record));
    if(recordBytes>limits.chunkBytes-2048){
      record.feature=null;record.disposition='quarantined';record.issueCode='DRAFT_UNIT_BUDGET';
      recordBytes=Buffer.byteLength(JSON.stringify(record));
    }
    const full=this.pending.length>=countLimit||this.pendingBytes+recordBytes+2048>limits.chunkBytes;
    if(this.pending.length&&full)await this.flush();
    this.pending.push(record);this.pendingBytes+=recordBytes;
    if(this.pending.length>=countLimit)await this.flush();
  }
  async flush(){
    if(!this.pending.length)return;
    await this.write(this.index,this.pending);this.index++;this.pending=[];this.pendingBytes=0;
  }
}

/** The scalar PostGIS check, in source order, with one bounded transaction instead of one per feature. */
async function topologyIssues(records: StreamingVectorRecord[]): Promise<(string | null)[]> {
  if (!records.length) return [];
  try {
    const geometries = records.map(record => (record.feature as { geometry: unknown }).geometry);
    const rows = await transaction(async client => {
      await client.query("SET LOCAL statement_timeout = '2000ms'");
      return (await client.query(`SELECT ST_IsValid(g) AS valid, ST_IsEmpty(g) AS empty,
        ST_Area(g) AS area, ST_Length(g) AS length, ST_Dimension(g) AS dimension, ST_IsValidReason(g) AS reason
        FROM (SELECT ordinal,ST_GeomFromGeoJSON(value::text) AS g
          FROM jsonb_array_elements($1::jsonb) WITH ORDINALITY AS source(value,ordinal)) geometries
        ORDER BY ordinal`, [JSON.stringify(geometries)])).rows;
    });
    if (rows.length !== records.length) throw new Error('The topology result does not cover every submitted geometry.');
    return rows.map(row => {
      const positive = row.dimension === 0 || row.dimension === 1 && Number(row.length) > 0
        || row.dimension === 2 && Number(row.area) > 0;
      if (row.valid && !row.empty && positive) return null;
      return /self-intersection/i.test(String(row.reason)) ? 'SELF_INTERSECTION' : 'INVALID_GEOMETRY';
    });
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    // One malformed geometry must not quarantine its neighbours. A batch timeout keeps the scalar budget.
    if (typeof code !== 'string' || !(code.startsWith('22') || code === 'XX000' || code === '57014')) throw error;
    const issues: (string | null)[] = [];
    for (const record of records) {
      issues.push(await validateStreamingTopology((record.feature as { geometry: unknown }).geometry));
    }
    return issues;
  }
}

/** Batches checks only, never chunk boundaries; the existing part writer still cuts the exact same records. */
export class StreamingTopologyWriter {
  private pending: StreamingVectorRecord[] = [];
  private bytes = 0;
  constructor(private readonly write: (record: StreamingVectorRecord) => Promise<void>) {}
  async add(record: StreamingVectorRecord) {
    const bytes = Buffer.byteLength(JSON.stringify(record));
    if (this.pending.length && this.bytes + bytes > limits.chunkBytes) await this.flush();
    this.pending.push(record);
    this.bytes += bytes;
    if (this.pending.length >= limits.chunkFeatures || this.bytes >= limits.chunkBytes) await this.flush();
  }
  async flush() {
    const accepted = this.pending.filter(record => record.disposition === 'accepted');
    const issues = await topologyIssues(accepted);
    for (const [index, record] of accepted.entries()) {
      const issue = issues[index];
      if (issue) {
        record.disposition = 'quarantined';
        record.issueCode = issue;
        record.feature = null;
      }
    }
    const records = this.pending;
    this.pending = [];
    this.bytes = 0;
    for (const record of records) await this.write(record);
  }
}

async function storeChunk(input:AnyStreamingInput,index:number,records:StreamingVectorRecord[]){
  const {bytes,hash}=encodeChunk(input,index,records),key=`streaming-vectors/${input.jobId}/${index}/${hash}.json`;
  try{await putOriginal(key,bytes,'application/json');}
  catch(error){
    // A restart after object PUT and before SQL acceptance reuses the exact immutable bytes.
    const prior=Buffer.from(await readObject(key).catch(()=>{throw error;}));
    if(prior.length!==bytes.length||sha256(prior)!==hash)throw error;
  }
  const accepted=records.filter(r=>r.disposition==='accepted').length;
  return {chunkIndex:index,firstFeatureIndex:records[0]!.featureIndex,lastFeatureIndex:records.at(-1)!.featureIndex,
    records:records.length,accepted,quarantined:records.length-accepted,status:accepted?'ready':'quarantined',
    bytes:bytes.length,ref:{key,sha256:hash,bytes:bytes.length},issueCode:null,resultSha256:hash} satisfies Slot;
}

/** `progress` also refreshes a batch row's reading counts from the slot's own transaction. */
async function acceptSlot(input:AnyStreamingInput,attempt:UspJobAttempt,slot:Slot,progress:boolean,
  holdCollection:boolean){
  await transaction(async client=>{
    await assertStreamingInputTx(client,input);await assertUspJobAttemptTx(client,attempt);
    const state=(await client.query('SELECT * FROM usp_streaming_vector_imports WHERE job_id=$1 FOR UPDATE',[input.jobId])).rows[0];
    if(!state||!['queued','running'].includes(state.state)||state.source_revision!==input.sourceRevision||state.input_sha256!==attempt.inputSha256)
      conflict('The streaming import changed before slot acceptance.');
    const prior=(await client.query('SELECT * FROM usp_streaming_vector_slots WHERE job_id=$1 AND source_revision=$2 AND chunk_index=$3',
      [input.jobId,input.sourceRevision,slot.chunkIndex])).rows[0];
    if(prior){
      if(prior.result_sha256!==slot.resultSha256||prior.first_feature_index!==slot.firstFeatureIndex||prior.last_feature_index!==slot.lastFeatureIndex
        ||prior.records!==slot.records||prior.accepted!==slot.accepted||prior.quarantined!==slot.quarantined)
        throw new AppError(422,'STREAMING_REPLAY_MISMATCH','A recovered chunk differs from its accepted source index.');
      return;
    }
    const count=Number((await client.query('SELECT count(*)::int n FROM usp_streaming_vector_slots WHERE job_id=$1',[input.jobId])).rows[0].n);
    if(count!==slot.chunkIndex||count>=limits.chunks)throw new AppError(422,'STREAMING_INDEX','The stable source chunk index cannot be skipped or exceeded.');
    if(state.records!==slot.firstFeatureIndex)throw new AppError(422,'STREAMING_FEATURE_INDEX','The source feature index cannot be skipped.');
    await client.query(`INSERT INTO usp_streaming_vector_slots(job_id,source_revision,chunk_index,status,first_feature_index,last_feature_index,
      records,accepted,quarantined,bytes,object_key,object_sha256,issue_code,result_sha256,attempt,fence)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [input.jobId,input.sourceRevision,slot.chunkIndex,slot.status,slot.firstFeatureIndex,slot.lastFeatureIndex,slot.records,
        slot.accepted,slot.quarantined,slot.bytes,slot.ref?.key??null,slot.ref?.sha256??null,slot.issueCode,slot.resultSha256,attempt.number,attempt.fence]);
    await client.query('UPDATE usp_streaming_vector_imports SET records=records+$2,accepted=accepted+$3,quarantined=quarantined+$4,updated_at=now() WHERE job_id=$1',
      [input.jobId,slot.records,slot.accepted,slot.quarantined]);
    await publishStreamingPrefixTx(client,input,holdCollection);
    if(progress)await writeIntakeLargeReadTx(client,input.sourceId);
  });
}

type ImportRow={records:number;sealed_chunks:number|null;next_publish_index:number};

/** The sealed parts cover the parsed prefix; the separately counted tail is known, not an unknown remainder. */
export async function sealStreamingReadTx(client:PoolClient,input:AnyStreamingInput,
  read:{features:number;linesBeyondLimit?:number},nextIndex:number,holdCollection:boolean){
  const state=(await client.query('SELECT * FROM usp_streaming_vector_imports WHERE job_id=$1 FOR UPDATE',
    [input.jobId])).rows[0];
  if(state.records!==read.features)conflict('The retained prefix does not close at semantic EOF.');
  if(!holdCollection&&state.next_publish_index!==nextIndex)
    conflict('The published prefix does not close at semantic EOF.');
  const beyond=read.linesBeyondLimit??0;
  if(beyond&&input.framing!=='geojson-lines')conflict('Only a line-framed read may retain an unparsed tail.');
  await client.query(`UPDATE usp_streaming_vector_imports SET sealed_chunks=$2,unknown_remainder=false,
    lines_beyond_limit=$3,updated_at=now() WHERE job_id=$1`,[input.jobId,nextIndex,beyond]);
  if(holdCollection)await publishStreamingPrefixTx(client,input,holdCollection);
}
type Marker={index:number;featureIndex:number;attempt:number;fence:number};

/** Before the seal a failure's ordered issue marker closes the published prefix (a stale end writes none). After
 * the seal the sealed prefix stays as the seal left it. Held collections never publish a failure marker. */
export async function endImportTx(client:PoolClient,input:AnyStreamingInput,row:ImportRow,code:string,
  stale:boolean,marker:Marker|null,holdCollection=input.framing==='feature-collection'){
  const sealed=row.sealed_chunks!==null&&row.sealed_chunks===row.next_publish_index;
  if(marker&&!sealed&&!holdCollection){
    if(row.records!==marker.featureIndex)conflict('The terminal source position differs from the committed prefix.');
    const hash=fingerprint({version:limits.version,jobId:input.jobId,sourceRevision:input.sourceRevision,
      chunkIndex:marker.index,code});
    await client.query(`INSERT INTO usp_streaming_vector_slots(job_id,source_revision,chunk_index,status,
      first_feature_index,last_feature_index,records,accepted,quarantined,bytes,issue_code,result_sha256,attempt,fence)
      VALUES($1,$2,$3,'quarantined',$4,NULL,0,0,0,0,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
      [input.jobId,input.sourceRevision,marker.index,marker.featureIndex,code,hash,marker.attempt,marker.fence]);
    await publishStreamingPrefixTx(client,input,holdCollection);
  }
  const status=stale?'stale':'failed';
  await client.query("UPDATE usp_job_metadata SET logical_state='failed',version=version+1 WHERE job_id=$1",
    [input.jobId]);
  await client.query('UPDATE jobs SET status=$2,error=$3,completed_at=now() WHERE id=$1',[input.jobId,status,code]);
  await client.query(`UPDATE usp_streaming_vector_imports SET state=$2,issue_code=$3,unknown_remainder=$4,
    updated_at=now() WHERE job_id=$1`,[input.jobId,status,code,!sealed]);
  if(!stale)await appendCaseIngestionTx(client,input.caseId,{kind:'streaming-vector.changed',sourceId:input.sourceId,
    sourceRevision:input.sourceRevision,jobId:input.jobId,status:'failed'},input.subject);
  await queueIntakeLargeTx(client,input.sourceId);
}

/** Source writers must not upgrade SHARE after taking a job lock: mapping readers take source then raw job. */
export async function assertStreamingPublicationInputTx(client:PoolClient,input:AnyStreamingInput,receipt=true){
  if(input.framing!=='tabular'){
    await client.query('SELECT id FROM cases WHERE id=$1 FOR SHARE',[input.caseId]);
    const mode=receipt?'UPDATE':'NO KEY UPDATE';
    await client.query(`SELECT id FROM sources WHERE case_id=$1 AND id=$2 FOR ${mode}`,
      [input.caseId,input.sourceId]);
  }
  return assertStreamingInputTx(client,input);
}

/** CR1's words for a refused declaration stay beside where its receipt would be, for the officer's row. */
async function keepCrsRefusalTx(client:PoolClient,input:AnyStreamingInput,words:string){
  await client.query(`UPDATE sources SET inspection=jsonb_set(inspection,'{streamedMapRefusal}',$2::jsonb)
    WHERE id=$1 AND profile='large-original-v1'`,[input.sourceId,JSON.stringify({rawJobId:input.jobId,words})]);
}

async function terminal(input:AnyStreamingInput,attempt:UspJobAttempt,code:string,
  nextIndex:number,nextFeatureIndex:number,holdCollection:boolean,stale=false,words:string|null=null){
  await transaction(async client=>{
    if(words)await assertStreamingPublicationInputTx(client,input,false);
    else if(stale)await lockStreamingRowsTx(client,input.caseId,input.sourceId);
    else await assertStreamingInputTx(client,input);
    await assertUspJobAttemptTx(client,attempt);
    const state=(await client.query('SELECT * FROM usp_streaming_vector_imports WHERE job_id=$1 FOR UPDATE',[input.jobId])).rows[0];
    if(!state)conflict('The streaming import state is unavailable.');
    await client.query('UPDATE usp_job_attempts SET state=$3 WHERE job_id=$1 AND number=$2',[input.jobId,attempt.number,'fenced']);
    if(words)await keepCrsRefusalTx(client,input,words);
    await endImportTx(client,input,state,code,stale,stale?null:{index:nextIndex,featureIndex:nextFeatureIndex,
      attempt:attempt.number,fence:attempt.fence},holdCollection);
  });
}

async function retry(input:AnyStreamingInput,attempt:UspJobAttempt,code:string){
  await transaction(async client=>{
    await assertStreamingInputTx(client,input);
    await assertUspJobAttemptTx(client,attempt);
    if(attempt.number>=3){
      // The caller will commit a terminal marker under this still-active fence.
      return;
    }
    await client.query("UPDATE usp_job_attempts SET state='fenced' WHERE job_id=$1 AND number=$2",[input.jobId,attempt.number]);
    await client.query("UPDATE usp_job_metadata SET logical_state='queued',version=version+1 WHERE job_id=$1",[input.jobId]);
    await client.query("UPDATE jobs SET status='queued',next_attempt_at=now()+interval '2 seconds',error=$2 WHERE id=$1",[input.jobId,code]);
    await client.query("UPDATE usp_streaming_vector_imports SET state='queued',issue_code=$2,updated_at=now() WHERE job_id=$1",[input.jobId,code]);
    await appendCaseIngestionTx(client,input.caseId,{kind:'streaming-vector.changed',sourceId:input.sourceId,
      sourceRevision:input.sourceRevision,jobId:input.jobId,status:'queued'},input.subject);
  });
}

/** A file the reader refuses, or a processor without the operation, ends the job at once: the same bytes and the
 * same processor image cannot pass on another attempt. Only a fault that may clear is retried. */
export function streamingFailureKind(error:unknown):'final'|'stale'|'retry'{
  if(!(error instanceof AppError))return 'retry';
  if([413,422].includes(error.status)||error.code===AREA_PROCESSOR_OPERATION)return 'final';
  if([403,404,409].includes(error.status))return 'stale';
  return 'retry';
}

/** A lost fence is refused with the shared conflict code; any other failure to end the job is not hidden. */
export function fencedOut(error:unknown){
  return error instanceof AppError&&error.status===409&&error.code==='STALE_REVISION';
}

/** Dispatcher-owned bounded reader. Replays an accepted prefix from byte zero with exact hashes. */
export async function runStreamingVectorJob(jobId:string){
  const job=(await query("SELECT * FROM jobs WHERE id=$1 AND operation='streaming-vector'",[jobId])).rows[0];
  if(!job||!['queued','running'].includes(job.status))return;
  const input=AnyStreamingInputSchema.parse(job.payload);
  let attempt:UspJobAttempt;
  try{attempt=await claimUspJobAttempt(jobId,`streaming-vector:${randomUUID()}`,client=>assertStreamingInputTx(client,input).then(()=>{}));}
  catch(error){
    const active=(await query("SELECT 1 FROM usp_job_attempts WHERE job_id=$1 AND state='active' AND lease_until>now() LIMIT 1",[jobId])).rowCount;
    if(active)return;
    // Exhausted leases get an ordered issue marker, without claiming a fourth attempt.
    await transaction(async client=>{
      await lockStreamingRowsTx(client,input.caseId,input.sourceId);
      const current=(await client.query("SELECT status FROM jobs WHERE id=$1 AND operation='streaming-vector' FOR UPDATE",[jobId])).rows[0];
      const row=(await client.query('SELECT * FROM usp_streaming_vector_imports WHERE job_id=$1 FOR UPDATE',[jobId])).rows[0];
      if(!row||!['queued','running'].includes(row.state))return;
      const code=error instanceof AppError&&[403,404,409].includes(error.status)?'STREAMING_CONTEXT_STALE':'STREAMING_ATTEMPTS_EXHAUSTED';
      const stale=code==='STREAMING_CONTEXT_STALE';
      const stillActive=(await client.query("SELECT 1 FROM usp_job_attempts WHERE job_id=$1 AND state='active' AND lease_until>now() LIMIT 1",[jobId])).rowCount;
      if(!current||!['queued','running'].includes(current.status)||stillActive)return;
      let marker:Marker|null=null;
      if(!stale){
        await assertStreamingInputTx(client,input);
        const index=Number((await client.query('SELECT count(*)::int n FROM usp_streaming_vector_slots WHERE job_id=$1',[jobId])).rows[0].n);
        const last=(await client.query('SELECT number,fence FROM usp_job_attempts WHERE job_id=$1 ORDER BY number DESC LIMIT 1',[jobId])).rows[0];
        marker={index,featureIndex:row.records,attempt:last.number,fence:last.fence};
      }
      // With no attempt left to reread, only an already-published prefix proves it was not held.
      const holdCollection=input.framing==='feature-collection'&&row.next_publish_index===0;
      await endImportTx(client,input,row,code,stale,marker,holdCollection);
    });
    return;
  }
  const initialPublishIndex=await transaction(async client=>{
    await assertStreamingInputTx(client,input);await assertUspJobAttemptTx(client,attempt);
    await client.query("UPDATE jobs SET dispatched_at=COALESCE(dispatched_at,now()),next_attempt_at=now()+interval '180 seconds' WHERE id=$1",[jobId]);
    const state=(await client.query(`UPDATE usp_streaming_vector_imports SET state='running',issue_code=NULL,
      updated_at=now() WHERE job_id=$1 RETURNING next_publish_index`,[jobId])).rows[0];
    await appendCaseIngestionTx(client,input.caseId,{kind:'streaming-vector.changed',sourceId:input.sourceId,
      sourceRevision:input.sourceRevision,jobId,status:'running'},input.subject);
    return state.next_publish_index as number;
  });
  let nextFeatureIndex=0,lastHeartbeat=Date.now(),lastProgress=0;
  let rawProgress=()=>{},rawSealed=(_end:number)=>{};
  let holdCollection=input.framing==='feature-collection';
  const setAside:Record<string,number>={};
  const geometryCounts:StreamingVectorGeometrySummary['counts']={};
  const pulse=async()=>{if(Date.now()-lastHeartbeat<30000)return;
    await heartbeatUspJobAttempt(attempt,client=>assertStreamingInputTx(client,input).then(()=>{}));lastHeartbeat=Date.now();
    await query("UPDATE jobs SET next_attempt_at=now()+interval '180 seconds' WHERE id=$1 AND status='running'",[jobId]);
  };
  const parts=new StreamingPartWriter(async(index,records)=>{
    await pulse();const slot=await storeChunk(input,index,records);
    if(input.framing!=='tabular')for(const record of records)tallyAcceptedGeometry(geometryCounts,record);
    // At most one tray refresh per interval; the step writes the row again when the reader's state changes.
    const progress=Date.now()-lastProgress>=PROGRESS_MS;if(progress)lastProgress=Date.now();
    await acceptSlot(input,attempt,slot,progress,holdCollection);
    const last=records.at(-1);if(input.framing==='feature-collection'&&last)rawSealed(last.byteEnd);
    if(!holdCollection&&index>=initialPublishIndex)rawProgress();
  });
  const topology=new StreamingTopologyWriter(async record=>{
    await parts.add(record,limits.chunkFeatures);tallySetAside(setAside,record);
  });
  // G13: a window is written by its own transaction; the part index follows the windows so the seal counts them.
  type WindowsInput=Parameters<typeof readTableWindows>;
  const readWindows=async(body:WindowsInput[0],source:WindowsInput[1])=>{
    const read=await readTableWindows(body,source,async(window,headers)=>{
      await pulse();
      await transaction(async client=>{
        await assertStreamingInputTx(client,input);await assertUspJobAttemptTx(client,attempt);
        await writeTableWindowTx(client,input,attempt,window,headers);
      });
      parts.index=window.index+1;nextFeatureIndex=window.rows.at(-1)!.index+1;
      if(window.index>=initialPublishIndex)rawProgress();
    });
    return {features:read.records,metadata:{},bytes:read.bytes,sha256:read.sha256};
  };
  try{
    const etag=(await query('SELECT inspection FROM sources WHERE id=$1',[input.sourceId])).rows[0]?.inspection?.largeOriginal?.objectEtag;
    const result=await readStreamingRaw(input.objectKey,input.sourceBytes,etag,async(body,published,sealed)=>{
      rawProgress=published;rawSealed=sealed;
      const consume=async(item:SourceFeature)=>{
        if(input.framing==='feature-collection')holdCollection=item.collectionTypeBeforeFeatures!==true;
        await pulse();const record=input.framing==='tabular'?tabularSourceRecord(item):sourceRecord(item);
        nextFeatureIndex=item.index+1;
        if(input.framing!=='tabular'){await topology.add(record);return;}
        const width=(item.feature as {headers:string[]}).headers.length;
        await parts.add(record,tabularChunkRows(width));tallySetAside(setAside,record);
      };
      // G13: a large CSV's or workbook's records go to the window table, one row per window; no slot holds them.
      const read=isWindowedTable(input)&&input.framing==='tabular'
        ?await readWindows(body,{selection:input.tabular.selection,bytes:input.sourceBytes})
        :input.framing==='tabular'?await readStreamingTabular(body,input.tabular,consume)
        :await readStreamingFeatures(body,input.framing,consume,limits.features,pulse);
      await topology.flush();
      if(read.bytes!==input.sourceBytes||read.sha256!==input.sourceSha256)
        throw new AppError(422,'STREAMING_SOURCE_INTEGRITY',
          'The retained original differs from its pinned hash or byte count.');
      if(!read.features)throw new AppError(422,'STREAMING_EMPTY_SOURCE','The source contains no complete features.');
      await parts.flush();return read;
    });
    rawProgress=()=>{};
    const nextIndex=parts.index;
    let reference:Awaited<ReturnType<typeof resolveStreamedReference>>|undefined;
    if(input.framing==='feature-collection')reference=await resolveStreamedReference(result.metadata);
    else if(input.framing!=='tabular')reference=streamedSequenceReference();
    await transaction(async client=>{
      await assertStreamingInputTx(client,input);await assertUspJobAttemptTx(client,attempt);
      await sealStreamingReadTx(client,input,result,nextIndex,holdCollection);
    });
    const linesBeyondLimit='linesBeyondLimit' in result?Number(result.linesBeyondLimit):0;
    const manifestHash=fingerprint({version:limits.version,jobId,sourceSha256:input.sourceSha256,
      slots:nextIndex,features:result.features,...(linesBeyondLimit?{linesBeyondLimit}:{})});
    await acceptUspJobAttempt(attempt,{assetId:`streaming-vector:${jobId}`,version:1,sha256:manifestHash},
      async(client,current)=>{
        const state=(await client.query('SELECT * FROM usp_streaming_vector_imports WHERE job_id=$1 FOR UPDATE',[jobId])).rows[0];
        if(current.operation!=='streaming-vector'||state.sealed_chunks!==nextIndex||state.next_publish_index!==nextIndex||state.records!==result.features||state.unknown_remainder)
          conflict('The complete reader manifest is not published.');
        if(state.lines_beyond_limit!==linesBeyondLimit)
          conflict('The retained unread line count differs from the reader manifest.');
      },client=>assertStreamingPublicationInputTx(client,input).then(()=>{}),async client=>{
        const status=await completeStreamingReadTx(client,input,{...result,quarantinedByCode:setAside},
          geometryCounts,reference);
        if(isWindowedTable(input))await queueFinishedTableEvidenceTx(client,input.caseId,jobId);
        await appendCaseIngestionTx(client,input.caseId,{kind:'streaming-vector.changed',sourceId:input.sourceId,
          sourceRevision:input.sourceRevision,jobId,status},input.subject);
        await queueIntakeLargeTx(client,input.sourceId);
      });
  }catch(error){
    rawProgress=()=>{};
    const code=error instanceof AppError?error.code:'STREAMING_WORKER_ERROR';
    const kind=streamingFailureKind(error);
    const words=code==='STREAMING_SOURCE_CRS'?(error as AppError).message:null;
    try{
      await recordUspJobFailure(attempt,code,error);
      if(kind==='final'){
        // Held parts stay private on refusal; type-first, sequence and tabular prefixes keep their publication.
        await topology.flush();await parts.flush();
        await terminal(input,attempt,code,parts.index,nextFeatureIndex,holdCollection,false,words);
      }else if(kind==='stale')
        await terminal(input,attempt,'STREAMING_CONTEXT_STALE',parts.index,nextFeatureIndex,holdCollection,true);
      else if(attempt.number>=3)await terminal(input,attempt,code,parts.index,nextFeatureIndex,holdCollection);
      else await retry(input,attempt,code);
    }catch(failure){
      // A newer fence owns this job; it alone may change durable state.
      if(!fencedOut(failure))throw failure;
    }
  }
}
