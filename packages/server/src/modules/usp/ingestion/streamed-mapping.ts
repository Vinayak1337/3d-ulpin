import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import {MappingDecisionSchema,StreamedMappingAuthorSchema,StreamedPrefixMappingAuthorSchema,AnyStreamedMappingPlanSchema,
  StreamedMappingReceiptSchema,type StreamedMappingPlan,type StreamedMappingReceipt,
  type StreamedProfileGeneration,type StreamedProfilePath} from '@ulpin/contracts/usp';
import {transaction} from '../../../infrastructure/db';
import {AppError,conflict,notFound} from '../../../infrastructure/errors';
import type {Mapping} from '../../areas/areas';
import {fingerprint} from '../../cases/domain';
import {localOperatorSubject} from '../principal';
import {appendCaseIngestionTx} from './events';
import {queueIntakeLargeTx} from './intake-large';
import {compileMapping} from './registry';
import {loadProvisionalStreamedProfileTx,loadSealedStreamedProfileTx} from './streamed-profile';

const uuid=z.string().uuid();
/** The small layout's refusals keep their words; their codes stay the ones a large file's card explains. */
const streamedCodes:Record<string,string>={MAPPING_PATH:'STREAMED_MAPPING_PATH',MAPPING_FIELD:'STREAMED_MAPPING_FIELD',
  MAPPING_IDENTITY:'STREAMED_MAPPING_COVERAGE',MAPPING_NAME:'STREAMED_MAPPING_COVERAGE',
  MAPPING_GEOMETRY:'STREAMED_MAPPING_GEOMETRY',MAPPING_GEOMETRY_KIND:'STREAMED_MAPPING_GEOMETRY',
  MAPPING_CRS:'STREAMED_MAPPING_GEOMETRY'};
type Counts=Omit<StreamedProfilePath,'path'|'unknown'|'outline'>;
/** Every counted feature has a value of one type. */
const complete=(counts:Counts,total:number,type:Counts['types'][number])=>counts.values===total
  &&counts.explicitNull===0&&counts.absent===0&&counts.types.length===1&&counts.types[0]===type;
/** The small layout's identity and name facts over outlines in a file that also holds pins or lines.
 * A profile stored without outline counts states none. */
function outlineFacts({outline}:StreamedProfilePath){
  if(!outline)return {};
  const total=outline.values+outline.explicitNull+outline.absent;
  return {outlineLiteralIdEligible:complete(outline,total,'string'),
    outlineLiteralTextEligible:total>0&&complete(outline,total,'string'),
    outlineIntegerIdEligible:complete(outline,total,'number')&&outline.integers===outline.values};
}
/** A path qualifies when every accepted feature has a value of one type; uniqueness is the mapped worker's. */
function layoutProfile(profile:StreamedProfileGeneration){
  const {sourceCrs,evidence,unit}=profile.reference;
  // An unsealed profile has no receipt yet; no part is cut from it, and the sealed profile states the unit.
  return {geometryTypes:profile.geometryTypes,crs:{value:sourceCrs??'',evidence:evidence??'',unit:unit??'degree'},
    paths:profile.paths.map(path=>({...path,literalIdEligible:complete(path,profile.accepted,'string'),
      literalTextEligible:complete(path,profile.accepted,'string'),
      integerIdEligible:complete(path,profile.accepted,'number')&&path.integers===path.values,...outlineFacts(path)}))};
}
/** Mechanical admission by the small layout's rules. Meaning is publisher-cited or officer-stated;
 * local approval remains required. */
export function compileStreamedMapping(plan:StreamedMappingPlan,profile:StreamedProfileGeneration):Mapping{
  const prefix=plan.version==='streamed-prefix-mapping/1';
  if(profile.coverage!==(prefix?'provisional':'sealed')||profile.unknownRemainder!==prefix||profile.accepted===0
    ||plan.profileHash!==profile.generationHash||plan.profileGeneration!==profile.generation
    ||plan.profileJobId!==profile.jobId||plan.rawJobId!==profile.rawJobId
    ||fingerprint(plan.source)!==fingerprint(profile.source))
    conflict('The exact reviewed source profile changed.');
  if(prefix&&(plan.prefix.throughRawChunkIndex!==profile.rawChunkIndex
    ||plan.prefix.rawResultSha256!==profile.rawResultSha256
    ||plan.prefix.recordsSeen!==profile.recordsSeen||plan.prefix.accepted!==profile.accepted))
    conflict('The observed source prefix changed.');
  let mapping:Mapping;
  try{mapping=compileMapping(plan,layoutProfile(profile));}
  catch(error){
    if(error instanceof AppError&&Object.hasOwn(streamedCodes,error.code))
      throw new AppError(error.status,streamedCodes[error.code]!,error.message);
    throw error;
  }
  const geometry=profile.paths.find(item=>item.path==='/features/*/geometry');
  if(!geometry||geometry.values!==profile.accepted||geometry.types.length!==1||geometry.types[0]!=='object')
    throw new AppError(422,'STREAMED_MAPPING_GEOMETRY','Geometry must be the retained complete geometry path.');
  // No global uniqueness claim is made here. The mapped worker reserves keys across chunks.
  return mapping;
}
async function validatePlanTx(client:PoolClient,caseId:string,sourceId:string,profileJobId:string,
  plan:StreamedMappingPlan,mode:'sealed'|'prefix'){
  if((plan.version==='streamed-prefix-mapping/1')!==(mode==='prefix'))
    conflict('The recipe route does not match the reviewed profile scope.');
  if(plan.caseId!==caseId||plan.profileJobId!==profileJobId||plan.source.sourceId!==sourceId)
    conflict('The recipe belongs to another source context.');
  const {input,profile}=await (mode==='prefix'?loadProvisionalStreamedProfileTx:loadSealedStreamedProfileTx)(
    client,profileJobId,plan.profileGeneration,plan.profileHash,plan.rawJobId,caseId,sourceId);
  if(plan.caseRevision!==input.caseRevision)conflict('The source case revision changed.');
  const source=(await client.query('SELECT profile,inspection FROM sources WHERE id=$1 AND case_id=$2 FOR SHARE',
    [sourceId,caseId])).rows[0]??notFound('Retained source not found.');
  assertStreamedIssuerEvidence(plan,source);
  compileStreamedMapping(plan,profile);
  return profile;
}
export function assertStreamedIssuerEvidence(plan:StreamedMappingPlan,source:{profile:string;inspection:any}){
  if(plan.basis==='officer_stated'){
    if(plan.semanticEvidence.length!==0)
      throw new AppError(422,'STREAMED_MAPPING_SEMANTICS','An officer-stated layout carries no publisher citations.');
    return;
  }
  const provenance=source.inspection?.largeOriginal?.provenance;
  if(provenance?.origin==='not_stated')
    throw new AppError(422,'STREAMED_MAPPING_PROVENANCE',
      "This layout cites the publisher, and this file's origin is not stated. State the layout as the officer's own.");
  if(source.profile!=='large-original-v1'||!provenance?.issuer||!provenance?.originalUrl)
    throw new AppError(422,'STREAMED_MAPPING_PROVENANCE','This exact streamed recipe needs retained issuer and original provenance.');
  const sourceHost=new URL(provenance.originalUrl).hostname.toLowerCase();
  if(plan.semanticEvidence.some(item=>item.issuer!==provenance.issuer
    ||new URL(item.evidenceUrl).hostname.toLowerCase()!==sourceHost))
    throw new AppError(422,'STREAMED_MAPPING_SEMANTICS','Cite the retained issuing portal for each reviewed field meaning.');
}
async function operation(client:PoolClient,caseId:string,key:string,digest:string,legacyDigest:string){
  const prior=(await client.query("SELECT payload_hash,result FROM operations WHERE case_id=$1 AND operation_key=$2 AND kind='streamed-mapping'",
    [caseId,key])).rows[0];
  if(prior&&!([digest,legacyDigest].includes(prior.payload_hash)))
    conflict('The streamed recipe request key names different inputs.');
  return prior?StreamedMappingReceiptSchema.parse(prior.result):undefined;
}
async function remember(client:PoolClient,caseId:string,key:string,digest:string,receipt:StreamedMappingReceipt){
  await client.query("INSERT INTO operations(case_id,operation_key,kind,payload_hash,result) VALUES($1,$2,'streamed-mapping',$3,$4)",
    [caseId,key,digest,receipt]);
}
async function save(client:PoolClient,receipt:StreamedMappingReceipt){
  await client.query('UPDATE usp_mapping_recipes SET revision=$2,state=$3,body=$4 WHERE id=$1',
    [receipt.id,receipt.revision,receipt.state,receipt]);
  await client.query('INSERT INTO usp_mapping_recipe_revisions(recipe_id,revision,body) VALUES($1,$2,$3)',
    [receipt.id,receipt.revision,receipt]);
}
export class StreamedMappingService{
  async author(caseValue:string,sourceValue:string,profileJobValue:string,value:unknown,mode:'sealed'|'prefix'='sealed'){
    const caseId=uuid.parse(caseValue),sourceId=uuid.parse(sourceValue),profileJobId=uuid.parse(profileJobValue);
    const input=mode==='prefix'?StreamedPrefixMappingAuthorSchema.parse(value):StreamedMappingAuthorSchema.parse(value);
    const subject=localOperatorSubject();
    const digest=fingerprint({caseId,sourceId,profileJobId,input,subject});
    const legacyDigest=mode==='sealed'?fingerprint({input,subject}):digest;
    const key=`streamed-${mode==='prefix'?'prefix-':''}author:${input.requestKey}`;
    return transaction(async client=>{
      await validatePlanTx(client,caseId,sourceId,profileJobId,input.plan,mode);
      const row=(await client.query('SELECT id,body FROM usp_mapping_recipes WHERE case_id=$1 AND source_id=$2 FOR UPDATE',
        [caseId,sourceId])).rows[0];
      const prior=row?StreamedMappingReceiptSchema.safeParse(row.body):null;
      if(row&&!prior?.success)conflict('A manual recipe already owns this source.');
      const replay=await operation(client,caseId,key,digest,legacyDigest);
      if(replay){
        if(!row||row.id!==replay.id||replay.authoredBy!==subject
          ||replay.revision!==input.expectedRecipeRevision+1
          ||fingerprint(replay.plan)!==fingerprint(input.plan)
          ||replay.planHash!==fingerprint(replay.plan)
          ||(prior?.success?prior.data.planHash:null)!==replay.planHash
          ||(prior?.success?fingerprint(prior.data.plan):null)!==replay.planHash
          ||(prior?.success?prior.data.revision:0)>replay.revision+1)
          conflict('The authored recipe no longer belongs to this exact current source.');
        return replay;
      }
      if((prior?.success?prior.data.revision:0)!==input.expectedRecipeRevision)
        conflict('The exact-source recipe revision changed.');
      const receipt=StreamedMappingReceiptSchema.parse({id:row?.id??randomUUID(),
        revision:input.expectedRecipeRevision+1,state:'proposed',plan:input.plan,
        planHash:fingerprint(input.plan),authoredBy:subject,authoredAt:new Date().toISOString(),approval:null});
      if(row)await save(client,receipt);
      else{
        await client.query("INSERT INTO usp_mapping_recipes(id,case_id,source_id,revision,state,body) VALUES($1,$2,$3,$4,$5,$6)",
          [receipt.id,caseId,sourceId,receipt.revision,receipt.state,receipt]);
        await client.query('INSERT INTO usp_mapping_recipe_revisions(recipe_id,revision,body) VALUES($1,$2,$3)',
          [receipt.id,receipt.revision,receipt]);
      }
      await remember(client,caseId,key,digest,receipt);
      await appendCaseIngestionTx(client,caseId,{kind:'recipe.changed',recipeId:receipt.id,
        recipeRevision:receipt.revision,sourceId,status:'proposed'},subject);
      await queueIntakeLargeTx(client,sourceId);
      return receipt;
    });
  }
  async approve(caseValue:string,sourceValue:string,profileJobValue:string,recipeValue:string,value:unknown,
    mode:'sealed'|'prefix'='sealed'){
    const caseId=uuid.parse(caseValue),sourceId=uuid.parse(sourceValue),profileJobId=uuid.parse(profileJobValue);
    const recipeId=uuid.parse(recipeValue),input=MappingDecisionSchema.parse(value),subject=localOperatorSubject();
    const digest=fingerprint({caseId,sourceId,profileJobId,recipeId,input,subject});
    const legacyDigest=mode==='sealed'?fingerprint({recipeId,input,subject}):digest;
    const key=`streamed-${mode==='prefix'?'prefix-':''}approve:${input.requestKey}`;
    return transaction(async client=>{
      const row=(await client.query('SELECT body FROM usp_mapping_recipes WHERE id=$1 AND case_id=$2 AND source_id=$3',
        [recipeId,caseId,sourceId])).rows[0]??notFound('Streamed mapping recipe not found.');
      const receipt=StreamedMappingReceiptSchema.parse(row.body);
      const plan=AnyStreamedMappingPlanSchema.parse(receipt.plan);
      if(fingerprint(plan)!==receipt.planHash)conflict('The recipe content changed after authoring.');
      await validatePlanTx(client,caseId,sourceId,profileJobId,plan,mode);
      const locked=(await client.query('SELECT body FROM usp_mapping_recipes WHERE id=$1 AND case_id=$2 AND source_id=$3 FOR UPDATE',
        [recipeId,caseId,sourceId])).rows[0]??notFound('Streamed mapping recipe not found.');
      if(fingerprint(locked.body)!==fingerprint(receipt))conflict('The recipe changed during approval.');
      const replay=await operation(client,caseId,key,digest,legacyDigest);
      if(replay){
        if(replay.id!==recipeId||replay.revision!==input.expectedRecipeRevision+1
          ||replay.state!=='approved'||replay.approval?.subject!==subject
          ||fingerprint(replay)!==fingerprint(receipt))
          conflict('The approved recipe no longer belongs to this exact current source.');
        return replay;
      }
      if(receipt.revision!==input.expectedRecipeRevision||receipt.state!=='proposed')
        conflict('Only the current proposed streamed recipe can be approved.');
      const approved=StreamedMappingReceiptSchema.parse({...receipt,revision:receipt.revision+1,state:'approved',
        approval:{subject,at:new Date().toISOString(),planHash:receipt.planHash,
          provenance:'server_configured_local_operator'}});
      await save(client,approved);await remember(client,caseId,key,digest,approved);
      await appendCaseIngestionTx(client,caseId,{kind:'recipe.changed',recipeId:approved.id,
        recipeRevision:approved.revision,sourceId,status:'approved'},subject);
      await queueIntakeLargeTx(client,sourceId);
      return approved;
    });
  }
  async read(caseValue:string,sourceValue:string,profileJobValue:string,recipeValue:string,
    mode:'sealed'|'prefix'='sealed'){
    const caseId=uuid.parse(caseValue),sourceId=uuid.parse(sourceValue),profileJobId=uuid.parse(profileJobValue);
    const recipeId=uuid.parse(recipeValue);localOperatorSubject();
    return transaction(async client=>{
      const row=(await client.query('SELECT body FROM usp_mapping_recipes WHERE id=$1 AND case_id=$2 AND source_id=$3',
        [recipeId,caseId,sourceId])).rows[0]??notFound('Streamed mapping recipe not found.');
      const receipt=StreamedMappingReceiptSchema.parse(row.body);
      if(fingerprint(receipt.plan)!==receipt.planHash)
        conflict('The recipe content changed after authoring.');
      await validatePlanTx(client,caseId,sourceId,profileJobId,receipt.plan,mode);
      return receipt;
    });
  }
}
