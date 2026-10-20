import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import {
  MappingDecisionSchema, MappingPlanSchema, SourceProfileSchema, TabularMappingReceiptSchema,
  AnyAuthorMappingSchema, AnyMappingReceiptSchema, AnyRetainSourceSchema, AnySourceProfileSchema,
  TabularMappingPlanSchema, type AnyMappingReceipt, type StreamedMappingReceipt, type AnySourceProfile, type TabularSourceProfile,
  type SourceProfile, type MappingDestination, type ArchiveMemberLineage,
  MappingReceiptSchema, type MappingPlan, type MappingReceipt,
  STREAMING_VECTOR_LIMITS, TABULAR_LIMITS, TableFromOriginalSchema, streamingReadMs, type TableProfileJob,
} from '@ulpin/contracts/usp';
import type { GisInspection } from '@ulpin/contracts';
import { query, transaction } from '../../../infrastructure/db';
import { AppError, conflict, notFound } from '../../../infrastructure/errors';
import { openObjectStream, putOriginal, readObject, sha256 } from '../../../infrastructure/storage';
import { inspectGisBytes } from '../../cases/gis-inspection';
import { originalAttempt } from '../../cases/original-attempt';
import { fingerprint } from '../../cases/domain';
import { lockSourceCaseDestinationTx } from '../../cases/source-case-lock';
import { areaGeo, getArea, ingestArea } from '../../areas/areas';
import { localOperatorSubject } from '../principal';
import { compileMapping, geojsonInventory, inspectedProfile } from './registry';
import { authoredIntakeDestination, caseScopedDestination, intakeDestination, refuseRetiredFileAreaTx }
  from './intake-destination';
import { assertAreaRowLive } from '../../areas/area-retire';
import { appendCaseIngestionTx } from './events';
import { inspectTabularSource, inspectTabularStream, assertTabularPin } from './tabular-source';
import { validateStreamedTabularRecipe, validateTabularRecipe, officerTabularPlan } from './tabular-recipe';
import { readTabularWindows } from './tabular-stream';
import { isTableSource } from './table-windows';
import { compareWorkspacePins } from './source-pin';

const uuid = z.string().uuid();
async function workspace(client: PoolClient, caseId: string) {
  const row = (await client.query('SELECT id,revision FROM cases WHERE id=$1 FOR UPDATE', [caseId])).rows[0];
  if (!row) notFound('Source workspace not found.');
  if ((await client.query('SELECT case_id FROM registry_case_feature_mappings WHERE case_id=$1', [caseId])).rowCount
    || (await client.query('SELECT id FROM import_packages WHERE case_id=$1', [caseId])).rowCount)
    conflict('This source case is now associated with a package or property; reopen its current context.');
  const sources = (await client.query('SELECT id,family_id,revision,sha256 FROM sources WHERE case_id=$1 ORDER BY id', [caseId])).rows;
  return {revision: row.revision as number, fingerprint: fingerprint({caseId, revision: row.revision, sources})};
}
async function operation(client: PoolClient, caseId: string, key: string, digest: string) {
  const prior = (await client.query("SELECT payload_hash,result FROM operations WHERE case_id=$1 AND operation_key=$2 AND kind='manual-mapping'", [caseId,key])).rows[0];
  if (prior && prior.payload_hash !== digest) conflict('This request key already names different manual mapping inputs.');
  return prior?.result;
}
async function remember(client: PoolClient, caseId: string, key: string, digest: string, result: unknown) {
  await client.query("INSERT INTO operations(case_id,operation_key,kind,payload_hash,result) VALUES($1,$2,'manual-mapping',$3,$4)", [caseId,key,digest,result]);
}
async function source(client: PoolClient, caseId: string, sourceId: string) {
  const row = (await client.query('SELECT * FROM sources WHERE id=$1 AND case_id=$2 FOR SHARE', [sourceId,caseId])).rows[0];
  if (!row) notFound('Retained source not found in this workspace.');
  if (!['geojson-manual-v1','tabular-manual-v1'].includes(row.profile) && !isTableSource(row)
    || !row.inspection?.manualProfile)
    throw new AppError(422,'UNSUPPORTED_PROFILE','Retain a supported original through the manual receipt operation.');
  if(row.inspection.actor!==localOperatorSubject()){
    throw new AppError(403,'SOURCE_OPERATOR','This source belongs to another local context.');
  }
  const latest = (await client.query('SELECT max(revision)::int revision FROM sources WHERE case_id=$1 AND family_id=$2',[caseId,row.family_id])).rows[0].revision;
  if (latest !== row.revision) conflict('This source revision has been superseded; author a recipe for the current original.');
  return row;
}
function profile(row: any, scope: {revision: number; fingerprint: string}): AnySourceProfile {
  const {schemaFingerprint,...fields} = row.inspection.manualProfile;
  return AnySourceProfileSchema.parse({...fields,source:{sourceId:row.id,familyId:row.family_id,
    sourceRevision:row.revision,sourceSha256:row.sha256,schemaFingerprint},
    caseId:row.case_id,workspaceRevision:scope.revision,workspaceFingerprint:scope.fingerprint});
}
/** Reuse the manual inventory contract after a caller has locked case then source. */
export async function manualProfileForLockedSourceTx(client:PoolClient,caseId:string,caseRevision:number,row:any):Promise<SourceProfile>{
  if(row.case_id!==caseId||row.profile!=='geojson-manual-v1'||!row.inspection?.manualProfile)
    throw new AppError(422,'UNSUPPORTED_PROFILE','This source has no qualified manual GeoJSON inventory.');
  const sources=(await client.query('SELECT id,family_id,revision,sha256 FROM sources WHERE case_id=$1 ORDER BY id',[caseId])).rows;
  const scope={revision:caseRevision,fingerprint:fingerprint({caseId,revision:caseRevision,sources})};
  return SourceProfileSchema.parse(profile(row,scope));
}
export async function tabularProfileForLockedSourceTx(
  client: PoolClient, caseId: string, caseRevision: number, row: any,
) {
  if (row.case_id !== caseId || !isTableSource(row)) {
    throw new AppError(422, 'UNSUPPORTED_PROFILE', 'No tabular receipt.');
  }
  assertTabularPin(row.inspection.manualProfile.tabular, row);
  const sql = 'SELECT id,family_id,revision,sha256 FROM sources WHERE case_id=$1 ORDER BY id';
  const sources = (await client.query(sql, [caseId])).rows;
  const scope = { revision: caseRevision, fingerprint: fingerprint({ caseId, revision: caseRevision, sources }) };
  return profile(row, scope) as TabularSourceProfile;
}
export {workspace as lockUnassignedSourceCase};
async function validate(client: PoolClient,
  plan: z.infer<typeof MappingPlanSchema>|z.infer<typeof TabularMappingPlanSchema>,
  scope: {revision: number; fingerprint: string}) {
  const row = await source(client,plan.caseId,plan.source.sourceId), current = profile(row,scope);
  if (fingerprint(current.source) !== fingerprint(plan.source) || !compareWorkspacePins(current, plan).current)
    conflict('Source bytes, schema, revision or workspace changed; inspect and author a current recipe.');
  if (plan.version==='manual-tabular/1' && Number(row.bytes) > TABULAR_LIMITS.bytes) {
    // G13: a streamed table is never read whole here; the raw job checks its bytes and hash on every read.
    if (current.version!=='manual-tabular/1') conflict('The recipe and receipt formats differ.');
    assertTabularPin(plan.tabular,row);
    validateStreamedTabularRecipe(plan,current,await firstWindow(row));
    return {row,bytes:new Uint8Array(),mapping:undefined};
  }
  const bytes = await readObject(row.object_key);
  if (bytes.length !== Number(row.bytes) || sha256(bytes) !== row.sha256)
    throw new AppError(422,'SOURCE_INTEGRITY','The retained original failed its byte/hash check.');
  if(plan.version==='manual-tabular/1'){
    if(current.version!=='manual-tabular/1')conflict('The recipe and receipt formats differ.');
    assertTabularPin(plan.tabular,row);validateTabularRecipe(plan,current,bytes);
    return {row,bytes,mapping:undefined};
  }
  if(current.version!=='manual-geojson/1')conflict('The recipe and receipt formats differ.');
  return {row,bytes,mapping:compileMapping(plan,current)};
}
/** This file's own namespace: its bytes, or its bytes scoped to the case that received them again. */
const fileNamespace = (namespace: string, sha256: string) =>
  namespace === `file:${sha256}` || namespace.startsWith(`file:${sha256}:case:`);

/** The first window of a streamed table, for the recipe's dry run; the rest of the original is not read. */
async function firstWindow(row: any) {
  const object = await openObjectStream(row.object_key, Number(row.bytes), STREAMING_VECTOR_LIMITS.readMs,
    row.inspection?.largeOriginal?.objectEtag);
  let first: { headers: string[]; rows: (string | undefined)[][] } | null = null;
  const enough = new Error('first window read');
  try {
    await readTabularWindows(object.body, async (window, headers) => {
      first = { headers, rows: window.rows.map(item => headers.map((_, column) => item.cells[column])) };
      throw enough;
    });
  } catch (error) { if (error !== enough) throw error; }
  finally { object.body.destroy(); }
  return first!;
}
export async function destination(client: PoolClient, value: MappingDestination, executing = false,
  sourceSha256?: string) {
  // Match ingestArea's seed-lock -> area-lock order before any lock upgrade.
  if (executing) await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${value.namespace}:${value.name}`]);
  if (value.kind === 'existing_area') {
    const row = (await client.query(executing ? 'SELECT id,archived_at FROM map_areas WHERE id=$1 FOR UPDATE'
      : 'SELECT id,archived_at FROM map_areas WHERE id=$1 FOR SHARE', [value.areaId])).rows[0];
    if (row) assertAreaRowLive(row);
    const area = await getArea(value.areaId,client);
    if (area.revision !== value.expectedAreaRevision || fingerprint(area.reference || null) !== value.referenceFingerprint)
      conflict('The destination revision or reference changed; author a current recipe.');
  } else {
    const existing = (await client.query('SELECT id,name,archived_at FROM map_areas WHERE seed_key=$1',
      [`${value.namespace}:${value.name}`])).rows[0];
    if (existing && !existing.archived_at && sourceSha256 && fileNamespace(value.namespace, sourceSha256))
      throw new AppError(409, 'SOURCE_ALREADY_IN_AREA',
        `This file is already the source of the area “${existing.name}”. Open that area; nothing new is prepared from a second copy.`,
        { areaId: existing.id });
    if (existing) conflict('This destination already exists; pin its current area and reference explicitly.');
  }
}
async function save(client: PoolClient, receipt: AnyMappingReceipt) {
  await client.query('UPDATE usp_mapping_recipes SET revision=$2,state=$3,body=$4 WHERE id=$1',[receipt.id,receipt.revision,receipt.state,receipt]);
  await client.query('INSERT INTO usp_mapping_recipe_revisions(recipe_id,revision,body) VALUES($1,$2,$3)',[receipt.id,receipt.revision,receipt]);
}

type Approval = NonNullable<MappingReceipt['approval']>;
/** LC1. The officer's press an approval stands on: the recipe and file it was given for, and the layout it covers. */
export type LayoutApproval = { recipeId: string; sourceId: string; layoutHash: string; approval: Approval };

/** A layout is the plan without its file and workspace pins, at the file's exact column fingerprint. */
export function layoutHash(plan: MappingPlan): string {
  const { source, caseId: _case, workspaceRevision: _revision, workspaceFingerprint: _workspace, ...layout } = plan;
  return fingerprint({ schemaFingerprint: source.schemaFingerprint, layout });
}
const carryKey = (recipeId: string, approval: Approval) => `layout-approval:${recipeId}:${fingerprint(approval)}`;

async function carriedTx(client: PoolClient, caseId: string, recipeId: string, approval: Approval | null)
  : Promise<LayoutApproval | null> {
  if (!approval) return null;
  return (await client.query(`SELECT result FROM operations WHERE case_id=$1 AND operation_key=$2
    AND kind='manual-mapping'`, [caseId, carryKey(recipeId, approval)])).rows[0]?.result ?? null;
}

/** A press holds while its recipe keeps that approval for that layout; authoring again clears it. */
async function pressHeldTx(client: PoolClient, caseId: string, press: LayoutApproval) {
  const body = (await client.query(`SELECT body FROM usp_mapping_recipes WHERE id=$1 AND case_id=$2
    AND state IN ('approved','executed')`, [press.recipeId, caseId])).rows[0]?.body;
  const held = MappingReceiptSchema.safeParse(body);
  return held.success && fingerprint(held.data.approval) === fingerprint(press.approval)
    && layoutHash(held.data.plan) === press.layoutHash;
}

/** The newest held press in this case for exactly this layout; an approval that was carried cites its press. */
export async function layoutApprovalTx(client: PoolClient, plan: MappingPlan, subject: string)
  : Promise<LayoutApproval | null> {
  const rows = (await client.query(`SELECT body FROM usp_mapping_recipes WHERE case_id=$1 AND source_id<>$2
    AND state IN ('approved','executed') AND body->'approval'->>'subject'=$3
    AND body->'plan'->'source'->>'schemaFingerprint'=$4 ORDER BY body->'approval'->>'at' DESC,id DESC LIMIT 50`,
  [plan.caseId, plan.source.sourceId, subject, plan.source.schemaFingerprint])).rows;
  for (const row of rows) {
    const parsed = MappingReceiptSchema.safeParse(row.body);
    if (!parsed.success || !parsed.data.approval || parsed.data.approval.planHash !== parsed.data.planHash) continue;
    const { id, plan: approved, approval } = parsed.data;
    const press = await carriedTx(client, plan.caseId, id, approval)
      ?? { recipeId: id, sourceId: approved.source.sourceId, layoutHash: layoutHash(approved), approval };
    if (press.layoutHash === layoutHash(plan) && await pressHeldTx(client, plan.caseId, press)) return press;
  }
  return null;
}

/** The execute check: a carried approval runs only while its press holds for this exact layout. */
export async function carriedApprovalTx(client: PoolClient, receipt: MappingReceipt)
  : Promise<LayoutApproval | null> {
  const carried = await carriedTx(client, receipt.plan.caseId, receipt.id, receipt.approval);
  if (carried && (carried.layoutHash !== layoutHash(receipt.plan)
    || !await pressHeldTx(client, receipt.plan.caseId, carried)))
    throw new AppError(409, 'RECIPE_APPROVAL',
      'The layout approval this file was drafted with is no longer current; approve this file\'s layout.');
  return carried;
}

/** Records the carried approval beside the recipe; the receipt's approval is the press's, pinned to this plan. */
export async function approveWithTx(client: PoolClient, receipt: MappingReceipt, press: LayoutApproval) {
  const carried: MappingReceipt = { ...receipt, revision: receipt.revision + 1, state: 'approved',
    approval: { ...press.approval, planHash: receipt.planHash } };
  await save(client, carried);
  await client.query(`INSERT INTO operations(case_id,operation_key,kind,payload_hash,result)
    VALUES($1,$2,'manual-mapping',$3,$4)`, [carried.plan.caseId, carryKey(carried.id, carried.approval!),
    fingerprint(press), press]);
  await appendCaseIngestionTx(client, carried.plan.caseId, { kind: 'recipe.changed', recipeId: carried.id,
    recipeRevision: carried.revision, sourceId: carried.plan.source.sourceId, status: carried.state },
  press.approval.subject);
  return carried;
}

/** Only an untouched first proposal is carried; a corrected or refused one waits for its own press. */
export async function carryTx(client: PoolClient, scope: {revision: number; fingerprint: string},
  receipt: MappingReceipt, subject: string): Promise<MappingReceipt> {
  if (receipt.state !== 'proposed' || receipt.revision !== 1) return receipt;
  const plan = MappingPlanSchema.parse(receipt.plan);
  const press = await layoutApprovalTx(client, plan, subject);
  if (!press) return receipt;
  const validated = await validate(client, plan, scope);
  await destination(client, receipt.destination, false, validated.row.sha256);
  if (fingerprint({ plan, destination: receipt.destination }) !== receipt.planHash)
    conflict('The recipe content changed after authoring.');
  const carried = await approveWithTx(client, receipt, press);
  const { queueIntakeDraftTx } = await import('./intake-draft');
  await queueIntakeDraftTx(client, validated.row);
  return carried;
}

/** After a file is drafted, its press carries to the case's resting files of exactly its layout. */
async function carryToRestingTx(client: PoolClient, scope: {revision: number; fingerprint: string},
  drafted: MappingReceipt, subject: string) {
  const { caseId, source: { sourceId, schemaFingerprint } } = drafted.plan;
  const resting = (await client.query(`SELECT s.id FROM sources s JOIN usp_intake_items i
    ON i.source_id=s.id AND i.parent_item_id IS NULL AND i.state IN ('probed','planned')
    WHERE s.case_id=$1 AND s.id<>$2 AND s.profile='geojson-manual-v1'
    AND s.inspection->'manualProfile'->>'schemaFingerprint'=$3 ORDER BY s.id`,
  [caseId, sourceId, schemaFingerprint])).rows;
  for (const { id } of resting) {
    await client.query('SAVEPOINT layout_carry');
    try {
      await carryToFileTx(client, scope, drafted, id, subject);
      await client.query('RELEASE SAVEPOINT layout_carry');
    } catch (error) {
      // A file the layout does not fit, or whose destination changed, asks its own question as before.
      if (!(error instanceof AppError) || error.status >= 500) throw error;
      await client.query('ROLLBACK TO SAVEPOINT layout_carry');
    }
  }
}

async function carryToFileTx(client: PoolClient, scope: {revision: number; fingerprint: string},
  drafted: MappingReceipt, sourceId: string, subject: string) {
  const row = await source(client, drafted.plan.caseId, sourceId);
  const prior = (await client.query('SELECT body FROM usp_mapping_recipes WHERE source_id=$1 FOR UPDATE',
    [sourceId])).rows[0]?.body;
  if (prior) {
    const parsed = MappingReceiptSchema.safeParse(prior);
    if (parsed.success) await carryTx(client, scope, parsed.data, subject);
    return;
  }
  const gis = row.inspection?.gis, current = profile(row, scope);
  if (!gis?.suggestedTitle || !gis?.suggestedNamespace) return;
  const { source: _source, caseId: _case, workspaceRevision: _revision, workspaceFingerprint: _workspace,
    ...layout } = drafted.plan;
  const plan = MappingPlanSchema.safeParse({ ...layout, source: current.source, caseId: current.caseId,
    workspaceRevision: current.workspaceRevision, workspaceFingerprint: current.workspaceFingerprint });
  if (!plan.success) return;
  // The case's area is read in this transaction, where the drafted file has just bound it.
  const area = (await client.query('SELECT a.id FROM cases c JOIN map_areas a ON a.site_id=c.site_id WHERE c.id=$1',
    [drafted.plan.caseId])).rows[0];
  const authored = await authorTx(client, drafted.plan.caseId, sourceId, { requestKey: randomUUID(),
    expectedRecipeRevision: 0, plan: plan.data,
    destination: intakeDestination(gis, area ? await getArea(area.id, client) : null) }, subject);
  await carryTx(client, scope, MappingReceiptSchema.parse(authored), subject);
}

async function authorTx(client: PoolClient, caseId: string, sourceId: string,
  input: z.infer<typeof AnyAuthorMappingSchema>, subject: string): Promise<AnyMappingReceipt> {
  const digest=fingerprint({input,subject}),key=`manual-author:${input.requestKey}`;
  await lockSourceCaseDestinationTx(client,caseId);
  const scope=await workspace(client,caseId),replay=await operation(client,caseId,key,digest);if(replay)return replay;
  const validated=await validate(client,input.plan,scope);
  const actualDestination=await caseScopedDestination(caseId,input.destination===undefined
    ? await authoredIntakeDestination(caseId,validated.row.inspection?.gis) : input.destination,
  async(sql,values)=>(await client.query(sql,values)).rows);
  if(actualDestination)await destination(client,actualDestination,false,validated.row.sha256);
  const priorRow=(await client.query('SELECT body FROM usp_mapping_recipes WHERE source_id=$1 FOR UPDATE',
    [sourceId])).rows[0];
  const prior=priorRow?.body as AnyMappingReceipt|undefined;
  if((prior?.revision||0)!==input.expectedRecipeRevision || prior?.state==='executed')
    conflict('The recipe changed or already executed; refresh before editing.');
  const receipt=AnyMappingReceiptSchema.parse({id:prior?.id||randomUUID(),revision:(prior?.revision||0)+1,
    state:'proposed',plan:input.plan,destination:actualDestination,
    planHash:fingerprint({plan:input.plan,destination:actualDestination}),authoredBy:subject,
    authoredAt:new Date().toISOString(),approval:null,execution:null});
  if(prior)await save(client,receipt);
  else {
    await client.query(`INSERT INTO usp_mapping_recipes(id,case_id,source_id,revision,state,body)
      VALUES($1,$2,$3,$4,$5,$6)`,[receipt.id,caseId,sourceId,receipt.revision,receipt.state,receipt]);
    await client.query('INSERT INTO usp_mapping_recipe_revisions(recipe_id,revision,body) VALUES($1,$2,$3)',
      [receipt.id,receipt.revision,receipt]);
  }
  await remember(client,caseId,key,digest,receipt);
  await appendCaseIngestionTx(client,caseId,{kind:'recipe.changed',recipeId:receipt.id,
    recipeRevision:receipt.revision,sourceId,status:receipt.state},subject);
  if(input.plan.version==='manual-geojson/1'){
    const {queueIntakeDraftTx}=await import('./intake-draft');
    await queueIntakeDraftTx(client,validated.row);
  }
  return receipt;
}
type TableInventory=ReturnType<typeof inspectTabularSource>|Awaited<ReturnType<typeof inspectTabularStream>>;
/** G13: the original kept through the large upload, before it becomes a table; refusals that need no read. */
async function originalTableTx(client:PoolClient,caseId:string,sourceId:string,actor:string,lock:'SHARE'|'UPDATE'){
  const row=(await client.query(`SELECT * FROM sources WHERE id=$1 AND case_id=$2 FOR ${lock}`,
    [sourceId,caseId])).rows[0]??notFound('Retained source not found in this workspace.');
  if(row.profile!=='large-original-v1')throw new AppError(422,'TABLE_ORIGINAL_PROFILE',
    'Only an original kept through the large upload is made a table here.');
  if(row.inspection?.largeOriginal?.operatorSubject!==actor)
    throw new AppError(403,'SOURCE_OPERATOR','This source belongs to another local context.');
  if(row.inspection?.manualProfile)conflict('This original is already a table; open its table page.');
  const latest=(await client.query('SELECT max(revision)::int revision FROM sources WHERE case_id=$1 ' +
    'AND family_id=$2',[caseId,row.family_id])).rows[0].revision;
  if(latest!==row.revision)conflict('This source revision has been superseded.');
  return row;
}
/** TP1: an original of at most 16 MiB is read whole from its object and checked against its byte receipt. */
async function wholeOriginal(row:any):Promise<Uint8Array>{
  const bytes=Number(row.bytes),parts:Buffer[]=[];
  const object=await openObjectStream(row.object_key,bytes,streamingReadMs(bytes),
    row.inspection?.largeOriginal?.objectEtag);
  try{
    for await(const part of object.body)parts.push(Buffer.from(part as Uint8Array));
  }finally{object.body.destroy();}
  const whole=Buffer.concat(parts);
  if(whole.length!==bytes||sha256(whole)!==row.sha256)
    throw new AppError(422,'STREAMING_SOURCE_INTEGRITY','The original differs from its byte receipt.');
  return whole;
}
/** TP1: the accepting step of the whole read and of the stream job: the table receipt on the same source row and
 * the source event. The whole read keeps the workspace revision its request pinned; the job (null) pins only its
 * source, still the latest revision of its family, unchanged and with no table receipt, so other files dropped in
 * the same workspace while it reads do not stop it. */
export async function attachTableTx(client:PoolClient,target:{caseId:string;sourceId:string;actor:string;
  expectedWorkspaceRevision:number|null;read:{sha256:string;revision:number;object_key:string}},
inventory:TableInventory):Promise<AnySourceProfile>{
  const {caseId,sourceId,actor,read}=target,scope=await workspace(client,caseId);
  if(target.expectedWorkspaceRevision!==null&&scope.revision!==target.expectedWorkspaceRevision)
    conflict('The source workspace changed; refresh first.');
  const row=await originalTableTx(client,caseId,sourceId,actor,'UPDATE');
  if(row.sha256!==read.sha256||row.revision!==read.revision||row.object_key!==read.object_key)
    conflict('The original changed while it was read.');
  const tabularProvenance='admission' in inventory.tabular?inventory.tabular.admission:null;
  await client.query('UPDATE sources SET inspection=inspection||$2::jsonb WHERE id=$1',[sourceId,
    JSON.stringify({manualProfile:{version:'manual-tabular/1',...inventory},tabularProvenance,actor})]);
  await client.query('UPDATE cases SET revision=revision+1,updated_at=now() WHERE id=$1',[caseId]);
  const fresh=await workspace(client,caseId),result=profile(await source(client,caseId,sourceId),fresh);
  await appendCaseIngestionTx(client,caseId,{kind:'source.retained',sourceId,sourceRevision:row.revision,
    status:'needs_input'},actor);
  return result;
}
export class ManualIngestionService {
  /** `lineage` is set only by the ZIP layer fan-out: the member's archive pins, kept beside the receipt. */
  async retain(caseIdValue: string, inputValue: unknown, file: {name:string;bytes:Uint8Array},
    lineage?: ArchiveMemberLineage): Promise<AnySourceProfile> {
    const caseId=uuid.parse(caseIdValue), input=AnyRetainSourceSchema.parse(inputValue), actor=localOperatorSubject();
    const profileName=input.format==='geojson'?'geojson-manual-v1':'tabular-manual-v1';
    if (!file.bytes.length || file.bytes.length>16*1024*1024)
      throw new AppError(413,'FILE_SIZE',
        'Choose a nonempty original up to 16 MiB; larger sources require another qualified receipt.');
    const tabular=input.format==='geojson'?null:inspectTabularSource(file.bytes,input.selection,input);
    if(input.format==='geojson')geojsonInventory(file.bytes);
    const hash=sha256(file.bytes),digest=fingerprint({input,name:file.name,hash,actor,...(lineage?{lineage}:{})}),key=`manual-gis:${input.requestKey}`;
    // Committed receipts/deduplication remain useful even while the processor is unavailable.
    const previous=await transaction(async client=>{
      const scope=await workspace(client,caseId),replay=await operation(client,caseId,key,digest);
      if(replay){
        if(tabular)assertTabularPin(tabular.tabular,await source(client,caseId,replay.source.sourceId));
        return replay;
      }
      const duplicateSql='SELECT id FROM sources WHERE case_id=$1 AND sha256=$2 AND profile=$3 '+
        'ORDER BY revision DESC LIMIT 1';
      const duplicate=(await client.query(duplicateSql,[caseId,hash,profileName])).rows[0];
      if(!duplicate)return undefined;
      await refuseRetiredFileAreaTx(client,caseId,hash);
      const retained=await source(client,caseId,duplicate.id);
      if(tabular)assertTabularPin(tabular.tabular,retained);
      const result=profile(retained,scope);
      await remember(client,caseId,key,digest,result);return result;
    });
    if(previous)return previous;
    // Inspection is the existing bounded GIS reader; no model or new parser authority.
    const inspection=input.format==='geojson'
      ?await inspectGisBytes(file,null,
        value=>areaGeo<Omit<GisInspection,'suggestedTitle'|'suggestedNamespace'>>('inspect-gis',value)):null;
    const inventory=tabular?{version:'manual-tabular/1',...tabular}:inspectedProfile(file.bytes,inspection!);
    const sourceId=randomUUID(), objectKey=`sources/${sourceId}/${hash}`;
    const mime=input.format==='geojson'?'application/geo+json':input.format==='csv'?'text/csv'
      :'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    return originalAttempt('sources',sourceId,async rememberOriginal=>transaction(async client=>{
      const scope=await workspace(client,caseId);
      const replay=await operation(client,caseId,key,digest);
      if(replay){
        if(tabular)assertTabularPin(tabular.tabular,await source(client,caseId,replay.source.sourceId));
        return replay;
      }
      const duplicateSql='SELECT * FROM sources WHERE case_id=$1 AND sha256=$2 AND profile=$3 '+
        'ORDER BY revision DESC LIMIT 1';
      const duplicate=(await client.query(duplicateSql,[caseId,hash,profileName])).rows[0];
      if(duplicate) {
        await refuseRetiredFileAreaTx(client,caseId,hash);
        if(tabular)assertTabularPin(tabular.tabular,duplicate);
        const result=profile(await source(client,caseId,duplicate.id),scope);
        await remember(client,caseId,key,digest,result);return result;
      }
      if(scope.revision!==input.expectedWorkspaceRevision)conflict('The source workspace changed; refresh before retaining another original.');
      let familyId:string=sourceId,revision=1;
      if(input.familyId){
        const prior=(await client.query('SELECT * FROM sources WHERE case_id=$1 AND family_id=$2 ORDER BY revision DESC LIMIT 1 FOR SHARE',[caseId,input.familyId])).rows[0];
        if(!prior || prior.profile!==profileName || prior.revision!==input.expectedSourceRevision){
          conflict('The source family changed; refresh before retaining a revision.');
        }
        familyId=input.familyId;revision=prior.revision+1;
      }
      rememberOriginal(objectKey);await putOriginal(objectKey,file.bytes,mime);
      const insertSql='INSERT INTO sources(id,case_id,family_id,revision,name,profile,mime_type,bytes,sha256,'+
        "object_key,status,inspection) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'needs_input',$11)";
      await client.query(insertSql,
        [sourceId,caseId,familyId,revision,file.name,profileName,mime,file.bytes.length,hash,objectKey,
          {profile:profileName,status:'needs_input',issues:[],
            summary:'Original retained; a pinned recipe requires review.',
            manualProfile:inventory,...(inspection?{gis:inspection}:{}),
            ...(tabular&&'admission' in tabular.tabular?{tabularProvenance:tabular.tabular.admission}:{}),
            ...(lineage?{archiveMember:lineage}:{}),actor}]);
      await client.query('UPDATE cases SET revision=revision+1,updated_at=now() WHERE id=$1',[caseId]);
      const fresh=await workspace(client,caseId),row=await source(client,caseId,sourceId),result=profile(row,fresh);
      await remember(client,caseId,key,digest,result);
      await appendCaseIngestionTx(client,caseId,{kind:'source.retained',sourceId,sourceRevision:revision,status:'needs_input'},actor);
      return result;
    }));
  }
  /** G13: an original retained through the large upload becomes a table source. Its row keeps its bytes, object and
   * identity; the table receipt is added beside the upload receipt. TP1: up to 16 MiB, a CSV or workbook is read
   * whole here; a CSV above that is read as a stream by one queued job, and the request answers that job. A replay
   * of the same request answers the same job as it stands. */
  async tableFromOriginal(caseValue:string,sourceValue:string,value:unknown):Promise<AnySourceProfile|TableProfileJob>{
    const caseId=uuid.parse(caseValue),sourceId=uuid.parse(sourceValue),input=TableFromOriginalSchema.parse(value);
    const actor=localOperatorSubject(),digest=fingerprint({input,sourceId,actor});
    const key=`table-original:${input.requestKey}`;
    const {queueTableProfileTx,tableProfileJobTx}=await import('./table-profile-worker');
    type Admitted={job:TableProfileJob}|{profile:AnySourceProfile}|{row:any};
    const admitted=await transaction(async (client):Promise<Admitted>=>{
      const scope=await workspace(client,caseId),replay=await operation(client,caseId,key,digest);
      if(replay)return replay.jobId?{job:await tableProfileJobTx(client,replay.jobId)}:{profile:replay};
      if(scope.revision!==input.expectedWorkspaceRevision)conflict('The source workspace changed; refresh first.');
      const row=await originalTableTx(client,caseId,sourceId,actor,'UPDATE');
      if(Number(row.bytes)<=TABULAR_LIMITS.bytes)return {row};
      if(input.selection.format!=='csv')throw new AppError(413,'TABLE_ORIGINAL_WORKBOOK_SIZE',
        `This workbook is more than ${TABULAR_LIMITS.bytes/1024**2} MiB; a workbook is read up to `+
        `${TABULAR_LIMITS.bytes/1024**2} MiB for now.`);
      const jobId=await queueTableProfileTx(client,row,scope.revision,input,actor);
      await remember(client,caseId,key,digest,{jobId});
      return {job:await tableProfileJobTx(client,jobId)};
    });
    if('job' in admitted)return admitted.job;
    if('profile' in admitted)return admitted.profile;
    const read=admitted.row,inventory=inspectTabularSource(await wholeOriginal(read),input.selection,input);
    return transaction(async client=>{
      await workspace(client,caseId);
      const replay=await operation(client,caseId,key,digest);
      if(replay)return replay as AnySourceProfile;
      const result=await attachTableTx(client,{caseId,sourceId,actor,read,
        expectedWorkspaceRevision:input.expectedWorkspaceRevision},inventory);
      await remember(client,caseId,key,digest,result);
      return result;
    });
  }
  async inspect(caseIdValue:string,sourceIdValue:string):Promise<SourceProfile> {
    return SourceProfileSchema.parse(await this.inspectAny(caseIdValue,sourceIdValue));
  }
  async inspectAny(caseIdValue:string,sourceIdValue:string):Promise<AnySourceProfile> {
    const caseId=uuid.parse(caseIdValue),sourceId=uuid.parse(sourceIdValue);localOperatorSubject();
    return transaction(async client=>{
      const scope=await workspace(client,caseId);
      return profile(await source(client,caseId,sourceId),scope);
    });
  }
  async author(caseIdValue:string,sourceIdValue:string,value:unknown):Promise<AnyMappingReceipt> {
    const caseId=uuid.parse(caseIdValue),sourceId=uuid.parse(sourceIdValue);
    const input=AnyAuthorMappingSchema.parse(value),subject=localOperatorSubject();
    if(input.plan.version==='manual-tabular/1')input.plan=officerTabularPlan(input.plan,subject);
    if(input.plan.caseId!==caseId || input.plan.source.sourceId!==sourceId)throw new AppError(422,'MAPPING_SCOPE','Recipe paths and source pins must name this retained source workspace.');
    return transaction(client=>authorTx(client,caseId,sourceId,input,subject));
  }
  /** LC1. A held press for this file's exact layout in its case approves its untouched proposal; else no change. */
  async carry(caseIdValue:string,recipeIdValue:string):Promise<MappingReceipt> {
    const caseId=uuid.parse(caseIdValue),recipeId=uuid.parse(recipeIdValue),subject=localOperatorSubject();
    return transaction(async client=>{
      await lockSourceCaseDestinationTx(client,caseId);
      const scope=await workspace(client,caseId);
      const body=(await client.query('SELECT body FROM usp_mapping_recipes WHERE id=$1 AND case_id=$2 FOR UPDATE',
        [recipeId,caseId])).rows[0]?.body;
      if(!body)notFound('Manual recipe not found.');
      return carryTx(client,scope,MappingReceiptSchema.parse(body),subject);
    });
  }
  async read(caseIdValue:string,recipeIdValue:string) {
    const caseId=uuid.parse(caseIdValue),recipeId=uuid.parse(recipeIdValue);localOperatorSubject();
    const rows=(await query('SELECT body FROM usp_mapping_recipe_revisions WHERE recipe_id=$1 AND recipe_id IN(SELECT id FROM usp_mapping_recipes WHERE case_id=$2) ORDER BY revision',[recipeId,caseId])).rows;
    if(!rows.length)notFound('Manual recipe not found.');return rows.map(row=>row.body) as (AnyMappingReceipt|StreamedMappingReceipt)[];
  }
  async decide(caseIdValue:string,recipeIdValue:string,value:unknown,action:'approve'|'execute')
    :Promise<AnyMappingReceipt> {
    const caseId=uuid.parse(caseIdValue),recipeId=uuid.parse(recipeIdValue),input=MappingDecisionSchema.parse(value),subject=localOperatorSubject();
    const digest=fingerprint({recipeId,input,subject}),key=`manual-${action}:${input.requestKey}`;
    const receipt=await transaction(async client=>{
      await lockSourceCaseDestinationTx(client,caseId);
      const scope=await workspace(client,caseId),replay=await operation(client,caseId,key,digest);if(replay)return replay;
      const receiptRow=(await client.query('SELECT body FROM usp_mapping_recipes WHERE id=$1 AND case_id=$2 FOR UPDATE',
        [recipeId,caseId])).rows[0];
      const receipt=receiptRow?.body as AnyMappingReceipt|undefined;
      if(!receipt)notFound('Manual recipe not found.');
      if(receipt.revision!==input.expectedRecipeRevision)conflict('The recipe changed; refresh before approval or execution.');
      if(receipt.state!==(action==='approve'?'proposed':'approved'))throw new AppError(409,'RECIPE_STATE','Only a current proposed recipe can be approved and only an approved manual recipe can execute once.');
      // Parse again at execution: persisted/model-derived extras never become executable.
      const plan=receipt.plan.version==='manual-tabular/1'
        ?TabularMappingPlanSchema.parse(receipt.plan):MappingPlanSchema.parse(receipt.plan);
      const validated=await validate(client,plan,scope);
      if(receipt.destination)await destination(client,receipt.destination,action==='execute',validated.row.sha256);
      const planHash=fingerprint({plan,destination:receipt.destination});
      if(planHash!==receipt.planHash)conflict('The recipe content changed after authoring.');
      const now=new Date().toISOString();
      if(action==='approve'){
        receipt.approval={subject,at:now,planHash,provenance:'server_configured_local_operator'};receipt.state='approved';
      }else{
        if(!receipt.approval || receipt.approval.planHash!==planHash || receipt.approval.provenance!=='server_configured_local_operator')
          throw new AppError(409,'RECIPE_APPROVAL','The recipe lacks a current server-recorded local approval.');
        if(plan.version==='manual-tabular/1'||!receipt.destination||!validated.mapping)
          throw new AppError(422,'TABULAR_REGISTRY_UNQUALIFIED',
            'Approval permits mapping and learning, not a GIS package or registry write.');
        const carried=await carriedApprovalTx(client,receipt as MappingReceipt);
        const dest=receipt.destination;
        const pkg=await ingestArea({bytes:validated.bytes,filename:validated.row.name,format:'geojson',namespace:dest.namespace,name:dest.name,mapping:validated.mapping,
          ...(dest.kind==='existing_area'?{areaId:dest.areaId,expectedAreaRevision:dest.expectedAreaRevision}:{requireNewArea:true}),
          retainedOriginal:{sourceId:validated.row.id,sourceSha256:validated.row.sha256}},client);
        receipt.execution={packageId:pkg.id,sourceRevisionId:validated.row.id,subject,at:now};receipt.state='executed';
        // The execution names the approval it relied on: the press's recipe and the file it was given for.
        if(carried)await client.query(`INSERT INTO operations(case_id,operation_key,kind,payload_hash,result)
          VALUES($1,$2,'manual-mapping',$3,$4)`,[caseId,`layout-approval-execution:${receipt.id}`,
          fingerprint(carried),{packageId:pkg.id,...carried}]);
      }
      receipt.revision++;await save(client,receipt);await remember(client,caseId,key,digest,receipt);
      await appendCaseIngestionTx(client,caseId,{kind:'recipe.changed',recipeId:receipt.id,recipeRevision:receipt.revision,sourceId:receipt.plan.source.sourceId,status:receipt.state},subject);
      if(action==='execute')await carryToRestingTx(client,scope,receipt as MappingReceipt,subject);
      if(action==='approve'&&plan.version==='manual-geojson/1'){
        const {queueIntakeDraftTx}=await import('./intake-draft');
        await queueIntakeDraftTx(client,validated.row);
      }
      return receipt;
    });
    if(action==='approve'&&receipt.plan.version==='manual-tabular/1'){
      const {queueApprovedTabular}=await import('./chunk-mapping-learning');
      await queueApprovedTabular(TabularMappingReceiptSchema.parse(receipt),input.requestKey);
    }
    return receipt;
  }
}
