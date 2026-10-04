import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import {DOCUMENT_CLAIMS_LIMITS as limits,DOCUMENT_CLAIMS_UNRESOLVED,DocumentClaimsReviewRequestSchema,
  DocumentClaimsReadQuerySchema,DocumentClaimReviewPinSchema,DocumentClaimReviewSnapshotSchema,DocumentClaimReviewSchema,
  type DocumentClaimsReviewRequest,type DocumentClaimSource,type DocumentClaimReviewSnapshot} from '../../../../../contracts/src/usp/document-claims';
import {DOCUMENT_PAGE_LIMITS,DocumentPagesSchema} from '../../../../../contracts/src/document-pages';
import {transaction} from '../../../infrastructure/db';
import {AppError,conflict,notFound} from '../../../infrastructure/errors';
import {fingerprint} from '../../cases/domain';
import {documentCaseTx} from './document-context';
import {assertIngestionBinding} from './events';
import {DocumentPagesService,documentPageAuthorityTx,type DocumentPageAuthority} from './document-pages';

const uuid=z.uuid().transform(value=>value.toLowerCase()),hash=z.string().regex(/^[a-f0-9]{64}$/);
const snapshotKind='document-claim-snapshot/1',requestKind='document-claim-request/1';
const snapshotKey=(id:string,revision:number)=>`document-claim-snapshot:${id}:${revision}`;
const requestKey=(key:string)=>`document-claim-request:${key}`;
const storedSchema=z.strictObject({snapshot:DocumentClaimReviewSnapshotSchema,
  subject:z.string().min(1).max(256),accessSha256:hash,sourceAuthoritySha256:hash});
type Stored=z.output<typeof storedSchema>;
type Authority={caseId:string;caseRevision:number;contextSha256:string;subject:string;accessSha256:string;
  sources:DocumentPageAuthority[]};
type Dependencies={transaction:typeof transaction;pages:DocumentPagesService['pages']};
const defaults:Dependencies={transaction,pages:(id,pin)=>new DocumentPagesService().pages(id,pin)};
function fail(status:number,code:string,message:string):never{throw new AppError(status,code,message);}
function live(deadline:number){if(Date.now()>=deadline)fail(504,'DOCUMENT_CLAIMS_DEADLINE','The bounded source review timed out. Read or replay the exact request key.');}
function bounded(value:unknown,bytes:number,code:string){
  if(Buffer.byteLength(JSON.stringify(value),'utf8')>bytes)fail(413,code,'The complete source review exceeds its byte limit. No text was truncated.');
}
/** Stable original/context authority, independent of extraction status or result availability.
 * Case revisions fence in-flight writes; an unrelated later upload does not replace history. */
function authorityHash(value:Authority){return fingerprint({caseId:value.caseId,context:value.contextSha256,
  subject:value.subject,access:value.accessSha256,sources:value.sources.map(source=>({
    sourceId:source.sourceId,sourceRevision:source.sourceRevision,sourceSha256:source.sourceSha256,
    sourceBytes:source.sourceBytes,objectKey:source.objectKey})).sort((a,b)=>a.sourceId.localeCompare(b.sourceId))});}
function same(before:Authority,after:Authority){
  if(before.subject!==after.subject||before.accessSha256!==after.accessSha256)
    fail(403,'DOCUMENT_CLAIMS_ACCESS_CHANGED','The private source review access changed.');
  if(before.caseRevision!==after.caseRevision||authorityHash(before)!==authorityHash(after))
    conflict('The source case, original or context changed during this review. Refresh the current pins.');
}
function assertStored(stored:Stored,authority:Authority){
  if(stored.subject!==authority.subject||stored.accessSha256!==authority.accessSha256)
    fail(403,'DOCUMENT_CLAIMS_ACCESS_CHANGED','This private source review is unavailable under current access.');
  if(stored.snapshot.caseId!==authority.caseId||stored.sourceAuthoritySha256!==authorityHash(authority))
    conflict('The original or source context changed since this exact source review.');
}
/** Existing lock order: case, then sorted selected source rows; no object/page I/O here. */
export async function documentClaimsAuthorityTx(client:PoolClient,caseId:string,pins:DocumentClaimSource[],lock=false):Promise<Authority>{
  const scope=await documentCaseTx(client,caseId,lock);
  if(lock)await client.query('SELECT id FROM sources WHERE case_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR SHARE',
    [caseId,pins.map(pin=>pin.sourceId)]);
  const sources:DocumentPageAuthority[]=[];
  for(const pin of pins){
    const source=await documentPageAuthorityTx(client,pin.sourceId,{revision:pin.sourceRevision,sha256:pin.sourceSha256});
    if(source.caseId!==caseId)fail(403,'DOCUMENT_CLAIMS_SOURCE_DENIED','Select an original belonging to this source case.');
    if(source.caseRevision!==scope.current.revision)conflict('The source case changed during authority capture.');
    sources.push(source);
  }
  assertIngestionBinding(scope.binding);
  return {caseId,caseRevision:scope.current.revision,contextSha256:scope.context,
    subject:scope.binding.subject,accessSha256:scope.binding.access,sources};
}
async function operation(client:PoolClient,caseId:string,key:string,kind:string){
  return (await client.query('SELECT payload_hash,result FROM operations WHERE case_id=$1 AND operation_key=$2 AND kind=$3',
    [caseId,key,kind])).rows[0];
}
async function load(client:PoolClient,caseId:string,reviewId:string,revision:number):Promise<Stored>{
  const row=await operation(client,caseId,snapshotKey(reviewId,revision),snapshotKind);
  if(!row)notFound('The exact source-review revision was not found.');
  const parsed=storedSchema.safeParse(row.result);
  if(!parsed.success||fingerprint(parsed.data)!==row.payload_hash||parsed.data.snapshot.caseId!==caseId||
    parsed.data.snapshot.reviewId!==reviewId||parsed.data.snapshot.reviewRevision!==revision||
    parsed.data.snapshot.review.actor!==parsed.data.subject)
    fail(422,'DOCUMENT_CLAIMS_SNAPSHOT_INTEGRITY','The immutable source-review snapshot failed its integrity check.');
  return parsed.data;
}
async function priorRequest(client:PoolClient,caseId:string,key:string,digest:string){
  const row=await operation(client,caseId,requestKey(key),requestKind);
  if(!row)return null;
  if(row.payload_hash!==digest)conflict('This request key already names different source-review inputs.');
  const pin=DocumentClaimReviewPinSchema.safeParse(row.result);
  if(!pin.success)fail(422,'DOCUMENT_CLAIMS_SNAPSHOT_INTEGRITY','The source-review receipt is invalid.');
  return load(client,caseId,pin.data.reviewId,pin.data.reviewRevision);
}
async function correction(client:PoolClient,caseId:string,pin:NonNullable<DocumentClaimsReviewRequest['correctionOf']>,authority:Authority){
  const stored=await load(client,caseId,pin.reviewId,pin.reviewRevision);assertStored(stored,authority);
  const latest=Number((await client.query(`SELECT max((result#>>'{snapshot,reviewRevision}')::bigint) revision
    FROM operations WHERE case_id=$1 AND kind=$2 AND operation_key LIKE $3`,
    [caseId,snapshotKind,`document-claim-snapshot:${pin.reviewId}:%`])).rows[0]?.revision);
  if(latest!==pin.reviewRevision)conflict('Correct the latest source-review revision; prior snapshots remain immutable.');
  if(!Number.isSafeInteger(latest+1))conflict('This review has reached the supported revision range.');
  return {reviewId:pin.reviewId,reviewRevision:latest+1};
}
function view(stored:Stored,authority:Authority){
  assertStored(stored,authority);
  const result=DocumentClaimReviewSchema.parse({...stored.snapshot,currentCaseRevision:authority.caseRevision,
    snapshotSha256:fingerprint(stored.snapshot)});
  bounded(result,limits.responseBytes,'DOCUMENT_CLAIMS_RESPONSE_LIMIT');return result;
}
export class DocumentClaimsService{
  constructor(private readonly dependencies:Dependencies=defaults){}
  private async readTx<T>(deadline:number,action:(client:PoolClient)=>Promise<T>){
    live(deadline);return this.dependencies.transaction(action,{deadlineAt:deadline},'repeatable_read_only');
  }
  private async publish(caseId:string,reviewId:string,revision:number,deadline:number){
    const before=await this.readTx(deadline,async client=>{
      const stored=await load(client,caseId,reviewId,revision);
      const authority=await documentClaimsAuthorityTx(client,caseId,stored.snapshot.sources);
      view(stored,authority);return {stored,authority};
    });
    // A separate fresh scope observes revocation/drift after the immutable read.
    const after=await this.readTx(deadline,client=>documentClaimsAuthorityTx(client,caseId,before.stored.snapshot.sources));
    same(before.authority,after);live(deadline);return view(before.stored,after);
  }
  async read(caseValue:string,reviewValue:string,rawQuery:unknown){
    const caseId=uuid.parse(caseValue),reviewId=uuid.parse(reviewValue),query=DocumentClaimsReadQuerySchema.parse(rawQuery);
    return this.publish(caseId,reviewId,query.revision,Date.now()+limits.seconds*1000);
  }
  async review(caseValue:string,raw:unknown){
    const caseId=uuid.parse(caseValue),request=DocumentClaimsReviewRequestSchema.parse(raw),deadline=Date.now()+limits.seconds*1000;
    bounded(request,limits.requestBytes,'DOCUMENT_CLAIMS_REQUEST_LIMIT');
    const digest=fingerprint({caseId,request});
    const before=await this.readTx(deadline,async client=>{
      const authority=await documentClaimsAuthorityTx(client,caseId,request.sources);
      if(authority.caseRevision!==request.expectedCaseRevision)conflict('Pin the current source-case revision.');
      const prior=await priorRequest(client,caseId,request.requestKey,digest);
      if(prior)assertStored(prior,authority);
      else if(request.correctionOf)await correction(client,caseId,request.correctionOf,authority);
      return {authority,prior};
    });
    if(before.prior)return this.publish(caseId,before.prior.snapshot.reviewId,before.prior.snapshot.reviewRevision,deadline);
    const frames=new Map<string,z.output<typeof DocumentPagesSchema>>();
    for(const source of before.authority.sources){
      live(deadline);
      // Reuse the page service's actual cancellation/process/storage bounds. Never
      // begin its 30-second scope without that time remaining in this command.
      if(deadline-Date.now()<DOCUMENT_PAGE_LIMITS.seconds*1000+1000)
        fail(504,'DOCUMENT_CLAIMS_DEADLINE','Not enough time remains for bounded PDF page validation.');
      const selected=request.claims.filter(claim=>claim.sourceId===source.sourceId).map(claim=>claim.locator.page);
      const offset=Math.min(...selected)-1,limit=Math.max(...selected)-offset;
      const parsed=DocumentPagesSchema.safeParse(await this.dependencies.pages(source.sourceId,
        {revision:String(source.sourceRevision),sha256:source.sourceSha256,offset:String(offset),limit:String(limit)}));
      if(!parsed.success)fail(422,'DOCUMENT_CLAIMS_PAGE_INTEGRITY','The private page reader returned invalid metadata.');
      const pages=parsed.data;
      if(pages.caseId!==caseId||pages.caseRevision!==before.authority.caseRevision||pages.sourceId!==source.sourceId||
        pages.sourceRevision!==source.sourceRevision||pages.sourceSha256!==source.sourceSha256||pages.sourceBytes!==source.sourceBytes||
        pages.offset!==offset||pages.limit!==limit||pages.pages.length!==Math.min(limit,pages.pageCount-offset)||
        pages.pages.some((page,i)=>page.page!==offset+i+1))
        fail(422,'DOCUMENT_CLAIMS_PAGE_INTEGRITY','The complete page selection differs from the pinned original.');
      for(const claim of request.claims.filter(claim=>claim.sourceId===source.sourceId)){
        const page=pages.pages.find(page=>page.page===claim.locator.page);
        if(!page)fail(422,'DOCUMENT_CLAIMS_PAGE_REQUIRED','The cited page does not exist in this original.');
        if(claim.locator.region&&fingerprint(claim.locator.region.frame)!==fingerprint(page.frame))
          conflict('The cited region frame differs from the current PDF display page.');
      }
      frames.set(source.sourceId,pages);
    }
    const after=await this.readTx(deadline,client=>documentClaimsAuthorityTx(client,caseId,request.sources));
    same(before.authority,after);
    const saved=await this.dependencies.transaction(async client=>{
      live(deadline);const authority=await documentClaimsAuthorityTx(client,caseId,request.sources,true);same(after,authority);
      const prior=await priorRequest(client,caseId,request.requestKey,digest);
      if(prior){assertStored(prior,authority);return prior.snapshot;}
      const pin=request.correctionOf?await correction(client,caseId,request.correctionOf,authority):{reviewId:randomUUID(),reviewRevision:1};
      const claims=request.claims.map((claim,ordinal)=>({...claim,claimId:randomUUID(),ordinal,
        locator:{...claim.locator,pageFrame:frames.get(claim.sourceId)!.pages.find(page=>page.page===claim.locator.page)!.frame}}));
      const snapshot:DocumentClaimReviewSnapshot=DocumentClaimReviewSnapshotSchema.parse({version:'source-document-review/1',...pin,
        caseId,caseRevision:authority.caseRevision,correctionOf:request.correctionOf??null,
        sources:request.sources.map(source=>({...source,sourceBytes:authority.sources.find(row=>row.sourceId===source.sourceId)!.sourceBytes})),
        claims,conflicts:request.conflicts.map(group=>({conflictId:randomUUID(),claimIds:group.claimOrdinals.map(i=>claims[i].claimId),
          reason:group.reason,state:'unresolved'})),unresolved:[...DOCUMENT_CLAIMS_UNRESOLVED],method:'human_entry',
        quotationVerification:'not_machine_verified',canonicalMatchState:'not_assessed',qualification:'not_assessed',
        review:{actor:authority.subject,time:new Date().toISOString(),reason:request.reviewReason,
          attribution:'local_process',humanAuthenticated:false,independentGroundTruth:false}});
      const stored:Stored={snapshot,subject:authority.subject,accessSha256:authority.accessSha256,sourceAuthoritySha256:authorityHash(authority)};
      view(stored,authority);
      await client.query('INSERT INTO operations(case_id,operation_key,kind,payload_hash,result) VALUES($1,$2,$3,$4,$5)',
        [caseId,snapshotKey(pin.reviewId,pin.reviewRevision),snapshotKind,fingerprint(stored),stored]);
      await client.query('INSERT INTO operations(case_id,operation_key,kind,payload_hash,result) VALUES($1,$2,$3,$4,$5)',
        [caseId,requestKey(request.requestKey),requestKind,digest,pin]);
      same(authority,await documentClaimsAuthorityTx(client,caseId,request.sources));live(deadline);return snapshot;
    },{deadlineAt:deadline});
    return this.publish(caseId,saved.reviewId,saved.reviewRevision,deadline);
  }
}
