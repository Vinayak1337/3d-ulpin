import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import {
  MappingDecisionSchema, MappingPlanSchema, SourceProfileSchema, TabularMappingReceiptSchema,
  AnyAuthorMappingSchema, AnyMappingReceiptSchema, AnyRetainSourceSchema, AnySourceProfileSchema,
  TabularMappingPlanSchema, type AnyMappingReceipt, type AnySourceProfile, type TabularSourceProfile,
  type SourceProfile, type MappingDestination,
} from '@ulpin/contracts/usp';
import type { GisInspection } from '@ulpin/contracts';
import { query, transaction } from '../../../infrastructure/db';
import { AppError, conflict, notFound } from '../../../infrastructure/errors';
import { putOriginal, readObject, sha256 } from '../../../infrastructure/storage';
import { inspectGisBytes } from '../../cases/gis-inspection';
import { originalAttempt } from '../../cases/original-attempt';
import { fingerprint } from '../../cases/domain';
import { lockSourceCaseDestinationTx } from '../../cases/source-case-lock';
import { areaGeo, getArea, ingestArea } from '../../areas/areas';
import { localOperatorSubject } from '../principal';
import { compileMapping, geojsonInventory, inspectedProfile } from './registry';
import { appendCaseIngestionTx } from './events';
import { inspectTabularSource, assertTabularPin } from './tabular-source';
import { validateTabularRecipe, officerTabularPlan } from './tabular-recipe';

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
  if (!['geojson-manual-v1','tabular-manual-v1'].includes(row.profile) || !row.inspection?.manualProfile)
    throw new AppError(422,'UNSUPPORTED_PROFILE','Retain a supported original through the manual receipt operation.');
  if(row.inspection.actor!==localOperatorSubject())throw new AppError(403,'SOURCE_OPERATOR','This source belongs to another local context.');
  const latest = (await client.query('SELECT max(revision)::int revision FROM sources WHERE case_id=$1 AND family_id=$2',[caseId,row.family_id])).rows[0].revision;
  if (latest !== row.revision) conflict('This source revision has been superseded; author a recipe for the current original.');
  return row;
}
function profile(row: any, scope: {revision: number; fingerprint: string}): AnySourceProfile {
  const {schemaFingerprint,...fields} = row.inspection.manualProfile;
  return AnySourceProfileSchema.parse({...fields,source:{sourceId:row.id,familyId:row.family_id,sourceRevision:row.revision,sourceSha256:row.sha256,schemaFingerprint},
    caseId:row.case_id,workspaceRevision:scope.revision,workspaceFingerprint:scope.fingerprint});
}
/** Reuse the manual inventory contract after a caller has locked case then source. */
export async function manualProfileForLockedSourceTx(client:PoolClient,caseId:string,caseRevision:number,row:any):Promise<SourceProfile>{
  if(row.case_id!==caseId||row.profile!=='geojson-manual-v1'||!row.inspection?.manualProfile)
    throw new AppError(422,'UNSUPPORTED_PROFILE','This source has no qualified manual GeoJSON inventory.');
  const sources=(await client.query('SELECT id,family_id,revision,sha256 FROM sources WHERE case_id=$1 ORDER BY id',[caseId])).rows;
  return SourceProfileSchema.parse(profile(row,{revision:caseRevision,fingerprint:fingerprint({caseId,revision:caseRevision,sources})}));
}
export async function tabularProfileForLockedSourceTx(client:PoolClient,caseId:string,caseRevision:number,row:any){
  if(row.case_id!==caseId||row.profile!=='tabular-manual-v1')throw new AppError(422,'UNSUPPORTED_PROFILE','No tabular receipt.');
  assertTabularPin(row.inspection.manualProfile.tabular,row);
  const sources=(await client.query('SELECT id,family_id,revision,sha256 FROM sources WHERE case_id=$1 ORDER BY id',[caseId])).rows;
  return profile(row,{revision:caseRevision,fingerprint:fingerprint({caseId,revision:caseRevision,sources})}) as TabularSourceProfile;
}
export {workspace as lockUnassignedSourceCase};
async function validate(client: PoolClient, plan: z.infer<typeof MappingPlanSchema>|z.infer<typeof TabularMappingPlanSchema>, scope: {revision: number; fingerprint: string}) {
  const row = await source(client,plan.caseId,plan.source.sourceId), current = profile(row,scope);
  if (fingerprint(current.source) !== fingerprint(plan.source) || current.workspaceRevision !== plan.workspaceRevision || current.workspaceFingerprint !== plan.workspaceFingerprint)
    conflict('Source bytes, schema, revision or workspace changed; inspect and author a current recipe.');
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
async function destination(client: PoolClient, value: MappingDestination, executing = false) {
  // Match ingestArea's seed-lock -> area-lock order before any lock upgrade.
  if (executing) await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${value.namespace}:${value.name}`]);
  if (value.kind === 'existing_area') {
    await client.query(executing ? 'SELECT id FROM map_areas WHERE id=$1 FOR UPDATE' : 'SELECT id FROM map_areas WHERE id=$1 FOR SHARE',[value.areaId]);
    const area = await getArea(value.areaId,client);
    if (area.revision !== value.expectedAreaRevision || fingerprint(area.reference || null) !== value.referenceFingerprint)
      conflict('The destination revision or reference changed; author a current recipe.');
  } else if ((await client.query('SELECT id FROM map_areas WHERE seed_key=$1',[`${value.namespace}:${value.name}`])).rowCount) {
    conflict('This destination already exists; pin its current area and reference explicitly.');
  }
}
async function save(client: PoolClient, receipt: AnyMappingReceipt) {
  await client.query('UPDATE usp_mapping_recipes SET revision=$2,state=$3,body=$4 WHERE id=$1',[receipt.id,receipt.revision,receipt.state,receipt]);
  await client.query('INSERT INTO usp_mapping_recipe_revisions(recipe_id,revision,body) VALUES($1,$2,$3)',[receipt.id,receipt.revision,receipt]);
}
export class ManualIngestionService {
  async retain(caseIdValue: string, inputValue: unknown, file: {name:string;bytes:Uint8Array}): Promise<AnySourceProfile> {
    const caseId=uuid.parse(caseIdValue), input=AnyRetainSourceSchema.parse(inputValue), actor=localOperatorSubject();
    const profileName=input.format==='geojson'?'geojson-manual-v1':'tabular-manual-v1';
    if (!file.bytes.length || file.bytes.length>16*1024*1024)
      throw new AppError(413,'FILE_SIZE','Choose a nonempty original up to 16 MiB; larger sources require another qualified receipt.');
    const tabular=input.format==='geojson'?null:inspectTabularSource(file.bytes,input.selection);
    if(input.format==='geojson')geojsonInventory(file.bytes);
    const hash=sha256(file.bytes),digest=fingerprint({input,name:file.name,hash,actor}),key=`manual-gis:${input.requestKey}`;
    // Committed receipts/deduplication remain useful even while the processor is unavailable.
    const previous=await transaction(async client=>{
      const scope=await workspace(client,caseId),replay=await operation(client,caseId,key,digest);if(replay)return replay;
      const duplicate=(await client.query('SELECT id FROM sources WHERE case_id=$1 AND sha256=$2 AND profile=$3 ORDER BY revision DESC LIMIT 1',[caseId,hash,profileName])).rows[0];
      if(!duplicate)return undefined;
      const retained=await source(client,caseId,duplicate.id);
      if(tabular)assertTabularPin(tabular.tabular,retained);
      const result=profile(retained,scope);
      await remember(client,caseId,key,digest,result);return result;
    });
    if(previous)return previous;
    // Inspection is the existing bounded GIS reader; no model or new parser authority.
    const inspection=input.format==='geojson'
      ?await inspectGisBytes(file,null,value=>areaGeo<Omit<GisInspection,'suggestedTitle'|'suggestedNamespace'>>('inspect-gis',value)):null;
    const inventory=tabular?{version:'manual-tabular/1',...tabular}:inspectedProfile(file.bytes,inspection!);
    const sourceId=randomUUID(), objectKey=`sources/${sourceId}/${hash}`;
    const mime=input.format==='geojson'?'application/geo+json':input.format==='csv'?'text/csv'
      :'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    return originalAttempt('sources',sourceId,async rememberOriginal=>transaction(async client=>{
      const scope=await workspace(client,caseId);
      const replay=await operation(client,caseId,key,digest); if(replay)return replay;
      const duplicate=(await client.query('SELECT * FROM sources WHERE case_id=$1 AND sha256=$2 AND profile=$3 ORDER BY revision DESC LIMIT 1',[caseId,hash,profileName])).rows[0];
      if(duplicate) {
        if(tabular)assertTabularPin(tabular.tabular,duplicate);
        const result=profile(await source(client,caseId,duplicate.id),scope);
        await remember(client,caseId,key,digest,result);return result;
      }
      if(scope.revision!==input.expectedWorkspaceRevision)conflict('The source workspace changed; refresh before retaining another original.');
      let familyId:string=sourceId,revision=1;
      if(input.familyId){
        const prior=(await client.query('SELECT * FROM sources WHERE case_id=$1 AND family_id=$2 ORDER BY revision DESC LIMIT 1 FOR SHARE',[caseId,input.familyId])).rows[0];
        if(!prior || prior.profile!==profileName || prior.revision!==input.expectedSourceRevision)conflict('The source family changed; refresh before retaining a revision.');
        familyId=input.familyId;revision=prior.revision+1;
      }
      rememberOriginal(objectKey);await putOriginal(objectKey,file.bytes,mime);
      await client.query("INSERT INTO sources(id,case_id,family_id,revision,name,profile,mime_type,bytes,sha256,object_key,status,inspection) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'needs_input',$11)",
        [sourceId,caseId,familyId,revision,file.name,profileName,mime,file.bytes.length,hash,objectKey,
          {profile:profileName,status:'needs_input',issues:[],summary:'Original retained; a pinned recipe requires review.',
            manualProfile:inventory,...(inspection?{gis:inspection}:{}),actor}]);
      await client.query('UPDATE cases SET revision=revision+1,updated_at=now() WHERE id=$1',[caseId]);
      const fresh=await workspace(client,caseId),row=await source(client,caseId,sourceId),result=profile(row,fresh);
      await remember(client,caseId,key,digest,result);
      await appendCaseIngestionTx(client,caseId,{kind:'source.retained',sourceId,sourceRevision:revision,status:'needs_input'},actor);
      return result;
    }));
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
    const caseId=uuid.parse(caseIdValue),sourceId=uuid.parse(sourceIdValue),input=AnyAuthorMappingSchema.parse(value),subject=localOperatorSubject();
    if(input.plan.version==='manual-tabular/1')input.plan=officerTabularPlan(input.plan,subject);
    if(input.plan.caseId!==caseId || input.plan.source.sourceId!==sourceId)throw new AppError(422,'MAPPING_SCOPE','Recipe paths and source pins must name this retained source workspace.');
    const digest=fingerprint({input,subject}),key=`manual-author:${input.requestKey}`;
    return transaction(async client=>{
      await lockSourceCaseDestinationTx(client,caseId);
      const scope=await workspace(client,caseId),replay=await operation(client,caseId,key,digest);if(replay)return replay;
      await validate(client,input.plan,scope);if(input.destination)await destination(client,input.destination);
      const prior=(await client.query('SELECT body FROM usp_mapping_recipes WHERE source_id=$1 FOR UPDATE',[sourceId])).rows[0]?.body as AnyMappingReceipt|undefined;
      if((prior?.revision||0)!==input.expectedRecipeRevision || prior?.state==='executed')conflict('The recipe changed or already executed; refresh before editing.');
      const receipt=AnyMappingReceiptSchema.parse({id:prior?.id||randomUUID(),revision:(prior?.revision||0)+1,state:'proposed',plan:input.plan,destination:input.destination,
        planHash:fingerprint({plan:input.plan,destination:input.destination}),authoredBy:subject,authoredAt:new Date().toISOString(),approval:null,execution:null});
      if(prior)await save(client,receipt);
      else {
        await client.query("INSERT INTO usp_mapping_recipes(id,case_id,source_id,revision,state,body) VALUES($1,$2,$3,$4,$5,$6)",[receipt.id,caseId,sourceId,receipt.revision,receipt.state,receipt]);
        await client.query('INSERT INTO usp_mapping_recipe_revisions(recipe_id,revision,body) VALUES($1,$2,$3)',[receipt.id,receipt.revision,receipt]);
      }
      await remember(client,caseId,key,digest,receipt);
      await appendCaseIngestionTx(client,caseId,{kind:'recipe.changed',recipeId:receipt.id,recipeRevision:receipt.revision,sourceId,status:receipt.state},subject);
      return receipt;
    });
  }
  async read(caseIdValue:string,recipeIdValue:string) {
    const caseId=uuid.parse(caseIdValue),recipeId=uuid.parse(recipeIdValue);localOperatorSubject();
    const rows=(await query('SELECT body FROM usp_mapping_recipe_revisions WHERE recipe_id=$1 AND recipe_id IN(SELECT id FROM usp_mapping_recipes WHERE case_id=$2) ORDER BY revision',[recipeId,caseId])).rows;
    if(!rows.length)notFound('Manual recipe not found.');return rows.map(row=>row.body) as AnyMappingReceipt[];
  }
  async decide(caseIdValue:string,recipeIdValue:string,value:unknown,action:'approve'|'execute'):Promise<AnyMappingReceipt> {
    const caseId=uuid.parse(caseIdValue),recipeId=uuid.parse(recipeIdValue),input=MappingDecisionSchema.parse(value),subject=localOperatorSubject();
    const digest=fingerprint({recipeId,input,subject}),key=`manual-${action}:${input.requestKey}`;
    const receipt=await transaction(async client=>{
      await lockSourceCaseDestinationTx(client,caseId);
      const scope=await workspace(client,caseId),replay=await operation(client,caseId,key,digest);if(replay)return replay;
      const receipt=(await client.query('SELECT body FROM usp_mapping_recipes WHERE id=$1 AND case_id=$2 FOR UPDATE',[recipeId,caseId])).rows[0]?.body as AnyMappingReceipt|undefined;
      if(!receipt)notFound('Manual recipe not found.');
      if(receipt.revision!==input.expectedRecipeRevision)conflict('The recipe changed; refresh before approval or execution.');
      if(receipt.state!==(action==='approve'?'proposed':'approved'))throw new AppError(409,'RECIPE_STATE','Only a current proposed recipe can be approved and only an approved manual recipe can execute once.');
      // Parse again at execution: persisted/model-derived extras never become executable.
      const plan=receipt.plan.version==='manual-tabular/1'
        ?TabularMappingPlanSchema.parse(receipt.plan):MappingPlanSchema.parse(receipt.plan);
      const validated=await validate(client,plan,scope);
      if(receipt.destination)await destination(client,receipt.destination,action==='execute');
      const planHash=fingerprint({plan,destination:receipt.destination});
      if(planHash!==receipt.planHash)conflict('The recipe content changed after authoring.');
      const now=new Date().toISOString();
      if(action==='approve'){
        receipt.approval={subject,at:now,planHash,provenance:'server_configured_local_operator'};receipt.state='approved';
      }else{
        if(!receipt.approval || receipt.approval.planHash!==planHash || receipt.approval.provenance!=='server_configured_local_operator')
          throw new AppError(409,'RECIPE_APPROVAL','The recipe lacks a current server-recorded local approval.');
        if(plan.version==='manual-tabular/1'||!receipt.destination||!validated.mapping)
          throw new AppError(422,'TABULAR_REGISTRY_UNQUALIFIED','Approval permits mapping and learning, not a GIS package or registry write.');
        const dest=receipt.destination;
        const pkg=await ingestArea({bytes:validated.bytes,filename:validated.row.name,format:'geojson',namespace:dest.namespace,name:dest.name,mapping:validated.mapping,
          ...(dest.kind==='existing_area'?{areaId:dest.areaId,expectedAreaRevision:dest.expectedAreaRevision}:{requireNewArea:true}),
          retainedOriginal:{sourceId:validated.row.id,sourceSha256:validated.row.sha256}},client);
        receipt.execution={packageId:pkg.id,sourceRevisionId:validated.row.id,subject,at:now};receipt.state='executed';
      }
      receipt.revision++;await save(client,receipt);await remember(client,caseId,key,digest,receipt);
      await appendCaseIngestionTx(client,caseId,{kind:'recipe.changed',recipeId:receipt.id,recipeRevision:receipt.revision,sourceId:receipt.plan.source.sourceId,status:receipt.state},subject);
      return receipt;
    });
    if(action==='approve'&&receipt.plan.version==='manual-tabular/1'){
      const {queueApprovedTabular}=await import('./chunk-mapping-learning');
      await queueApprovedTabular(TabularMappingReceiptSchema.parse(receipt),input.requestKey);
    }
    return receipt;
  }
}
