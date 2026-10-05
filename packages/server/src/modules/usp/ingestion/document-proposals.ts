import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import {DOCUMENT_PROPOSAL_LIMITS as limits,DocumentProposalsSaveSchema,DocumentProposalSnapshotSchema,
  DocumentProposalSnapshotViewSchema,DocumentProposalsHistoryQuerySchema,DocumentProposalsHistorySchema,
  type DocumentProposalSourcePin,type DocumentProposalPacket}
  from '../../../../../contracts/src/usp/document-proposals';
import {DOCUMENT_PAGE_LIMITS,DocumentPagesSchema} from '../../../../../contracts/src/document-pages';
import {transaction} from '../../../infrastructure/db';
import {AppError,conflict,notFound} from '../../../infrastructure/errors';
import {verifyObjectStream} from '../../../infrastructure/storage';
import {fingerprint} from '../../cases/domain';
import {documentSourceTx} from './document-context';
import {assertIngestionBinding} from './events';
import {DocumentPagesService,documentPageAuthorityTx,type DocumentPageAuthority} from './document-pages';

const id=z.uuid().transform(v=>v.toLowerCase()),hash=z.string().regex(/^[a-f0-9]{64}$/);
const snapshotKind='document-proposal-snapshot/1',requestKind='document-proposal-request/1';
const snapshotKey=(key:string)=>`document-proposal-snapshot:${key}`,requestKey=(key:string)=>`document-proposal-request:${key}`;
const storedSchema=z.strictObject({snapshot:DocumentProposalSnapshotSchema,subject:z.string(),accessSha256:hash,
  sourceAuthoritySha256:hash,requestSha256:hash});
type Stored=z.output<typeof storedSchema>;
type Authority={caseId:string;caseRevision:number;contextSha256:string;subject:string;accessSha256:string;source:DocumentPageAuthority};
type Dependencies={transaction:typeof transaction;pages:DocumentPagesService['pages'];
  verify:(a:DocumentPageAuthority,deadline:number)=>Promise<unknown>};
const defaults:Dependencies={transaction,pages:(source,pin)=>new DocumentPagesService().pages(source,pin),
  verify:(a,deadline)=>verifyObjectStream(a.objectKey,a.sourceBytes,a.sourceSha256,Math.max(1,Math.min(30_000,deadline-Date.now())))};
function fail(code:string,message:string):never{throw new AppError(422,code,message);}
function live(deadline:number){if(Date.now()>=deadline)throw new AppError(504,'DOCUMENT_PROPOSALS_DEADLINE','The bounded proposal command timed out. Read or replay the same request key.');}
function bounded(value:unknown,bytes:number){if(Buffer.byteLength(JSON.stringify(value))>bytes)
  throw new AppError(413,'DOCUMENT_PROPOSALS_LIMIT','The complete proposal packet exceeds its limit. No submitted content was truncated.');}
function locatorWarnings(packet:DocumentProposalPacket){
  const entries=[...packet.proposals.map(p=>({entryKind:'proposal' as const,entryId:p.proposalId,locator:p.locator})),
    ...packet.rejected.map(r=>({entryKind:'rejected' as const,entryId:r.entryId,locator:r.locator}))];
  return entries.filter(({locator:{box,selectedRegion:r}})=>box&&r&&(box[0]<r[0]||box[1]<r[1]||box[2]>r[2]||box[3]>r[3]))
    .map(({entryKind,entryId})=>({entryKind,entryId,code:'citation_extends_declared_region' as const,basis:'caller_supplied_coordinates' as const}));
}
function stable(a:Authority){return fingerprint({caseId:a.caseId,context:a.contextSha256,subject:a.subject,access:a.accessSha256,
  source:{id:a.source.sourceId,revision:a.source.sourceRevision,sha256:a.source.sourceSha256,bytes:a.source.sourceBytes,objectKey:a.source.objectKey}});}
function same(before:Authority,after:Authority){
  if(before.subject!==after.subject||before.accessSha256!==after.accessSha256)
    throw new AppError(403,'DOCUMENT_PROPOSALS_ACCESS_CHANGED','The private proposal access context changed.');
  if(fingerprint(before)!==fingerprint(after))conflict('The source case, original or private context changed during this proposal command.');
}
/** Existing case-first lock order, then the complete source family; no I/O here. */
async function captureTx(client:PoolClient,caseId:string,sourceId:string,pin?:DocumentProposalSourcePin,lock=false):Promise<Authority>{
  const ctx=await documentSourceTx(client,caseId,sourceId,lock);
  if(lock)await client.query(`SELECT id FROM sources WHERE case_id=$1
    AND family_id=(SELECT family_id FROM sources WHERE case_id=$1 AND id=$2) ORDER BY id FOR SHARE`,[caseId,sourceId]);
  const source=await documentPageAuthorityTx(client,sourceId,{revision:pin?.sourceRevision??ctx.source.revision,sha256:pin?.sourceSha256??ctx.source.sha256});
  if(source.caseId!==caseId||source.sourceId!==sourceId||source.caseRevision!==ctx.current.revision||
    (pin&&source.sourceBytes!==pin.sourceBytes))conflict('The selected proposal source or original byte count changed.');
  assertIngestionBinding(ctx.binding);
  return {caseId,caseRevision:ctx.current.revision,contextSha256:ctx.context,subject:ctx.binding.subject,
    accessSha256:ctx.binding.access,source};
}
function view(stored:Stored,current:Authority){
  if(stored.subject!==current.subject||stored.accessSha256!==current.accessSha256)
    throw new AppError(403,'DOCUMENT_PROPOSALS_ACCESS_CHANGED','This private proposal snapshot is unavailable under current access.');
  if(stored.snapshot.caseId!==current.caseId||stored.snapshot.source.sourceId!==current.source.sourceId||
    stored.snapshot.source.sourceRevision!==current.source.sourceRevision||stored.snapshot.source.sourceSha256!==current.source.sourceSha256||
    stored.snapshot.source.sourceBytes!==current.source.sourceBytes||stored.snapshot.caseRevision>current.caseRevision||
    stored.sourceAuthoritySha256!==stable(current))conflict('The original or source context changed since this exact proposal snapshot.');
  const response=DocumentProposalSnapshotViewSchema.parse({...stored.snapshot,currentCaseRevision:current.caseRevision,
    snapshotSha256:fingerprint(stored.snapshot)});bounded(response,limits.responseBytes);return response;
}
async function operation(client:PoolClient,caseId:string,key:string,kind:string){
  return (await client.query('SELECT payload_hash,result FROM operations WHERE case_id=$1 AND operation_key=$2 AND kind=$3',[caseId,key,kind])).rows[0];
}
async function load(client:PoolClient,current:Authority,snapshotId:string):Promise<Stored>{
  const row=await operation(client,current.caseId,snapshotKey(snapshotId),snapshotKind);
  if(!row)notFound('The exact provisional proposal snapshot was not found.');
  const parsed=storedSchema.safeParse(row.result);
  if(!parsed.success||fingerprint(parsed.data)!==row.payload_hash||parsed.data.snapshot.snapshotId!==snapshotId||
    parsed.data.snapshot.review.actor!==parsed.data.subject)
    fail('DOCUMENT_PROPOSALS_SNAPSHOT_INTEGRITY','The immutable proposal snapshot failed its integrity check.');
  view(parsed.data,current);return parsed.data;
}
async function replay(client:PoolClient,current:Authority,key:string,digest:string){
  const row=await operation(client,current.caseId,requestKey(key),requestKind);if(!row)return null;
  if(row.payload_hash!==digest)conflict('This request key already names different provisional proposal inputs.');
  const snapshotId=id.safeParse(row.result?.snapshotId);
  if(!snapshotId.success)fail('DOCUMENT_PROPOSALS_SNAPSHOT_INTEGRITY','The saved proposal request receipt is invalid.');
  const stored=await load(client,current,snapshotId.data);
  if(stored.requestSha256!==digest)fail('DOCUMENT_PROPOSALS_SNAPSHOT_INTEGRITY','The request receipt points to a different proposal snapshot.');
  return stored;
}
export class DocumentProposalsService{
  constructor(private readonly dependencies:Dependencies=defaults){}
  private readTx<T>(deadline:number,action:(client:PoolClient)=>Promise<T>){
    live(deadline);return this.dependencies.transaction(action,{deadlineAt:deadline},'repeatable_read_only');
  }
  private async verify(a:Authority,deadline:number){live(deadline);await this.dependencies.verify(a.source,deadline);live(deadline);}
  private async pages(a:Authority,packet:DocumentProposalPacket,deadline:number){
    live(deadline);
    if(deadline-Date.now()<DOCUMENT_PAGE_LIMITS.seconds*1000+1000)
      throw new AppError(504,'DOCUMENT_PROPOSALS_DEADLINE','Not enough time remains for bounded source-page validation.');
    const locators=[...packet.proposals,...packet.rejected].map(p=>p.locator),pages=locators.map(l=>l.page),
      offset=Math.min(...pages)-1,limit=Math.max(...pages)-offset;
    const parsed=DocumentPagesSchema.safeParse(await this.dependencies.pages(a.source.sourceId,
      {revision:String(a.source.sourceRevision),sha256:a.source.sourceSha256,offset:String(offset),limit:String(limit)}));
    if(!parsed.success)fail('DOCUMENT_PROPOSALS_PAGE_INTEGRITY','The page reader returned invalid complete metadata.');
    const result=parsed.data,s=a.source;
    if(result.caseId!==a.caseId||result.caseRevision!==a.caseRevision||result.sourceId!==s.sourceId||
      result.sourceRevision!==s.sourceRevision||result.sourceSha256!==s.sourceSha256||result.sourceBytes!==s.sourceBytes||
      result.revision!==String(s.sourceRevision)||result.offset!==offset||result.limit!==limit||
      result.pages.length!==Math.min(limit,result.pageCount-offset)||result.pages.some((p,i)=>p.page!==offset+i+1))
      fail('DOCUMENT_PROPOSALS_PAGE_INTEGRITY','The complete selected page population differs from the pinned original.');
    for(const locator of locators){const page=result.pages.find(p=>p.page===locator.page);
      if(!page)fail('DOCUMENT_PROPOSALS_PAGE_REQUIRED','A declared citation page does not exist in this original.');
      if(fingerprint(page.frame)!==fingerprint(locator.frame))conflict('The source-local citation frame differs from the current original page.');
    }
  }
  private async disclose(a:Authority,stored:Stored,deadline:number){
    return this.dependencies.transaction(async client=>{
      live(deadline);const current=await captureTx(client,a.caseId,a.source.sourceId,undefined,true);same(a,current);
      const snapshot=await load(client,current,stored.snapshot.snapshotId);
      if(fingerprint(snapshot)!==fingerprint(stored))fail('DOCUMENT_PROPOSALS_SNAPSHOT_INTEGRITY','The saved proposal snapshot changed.');
      const response=view(snapshot,current);same(current,await captureTx(client,a.caseId,a.source.sourceId));live(deadline);return response;
    },{deadlineAt:deadline});
  }
  async history(caseValue:string,sourceValue:string,raw:unknown={}){
    const caseId=id.parse(caseValue),sourceId=id.parse(sourceValue),query=DocumentProposalsHistoryQuerySchema.parse(raw),
      deadline=Date.now()+limits.seconds*1000;
    const before=await this.readTx(deadline,async client=>{const a=await captureTx(client,caseId,sourceId);
      if(query.after)await load(client,a,query.after);return a;});
    await this.verify(before,deadline);
    return this.dependencies.transaction(async client=>{
      live(deadline);const current=await captureTx(client,caseId,sourceId,undefined,true);same(before,current);
      if(query.after)await load(client,current,query.after);
      const prefix='document-proposal-snapshot:',lower=query.after?snapshotKey(query.after):prefix;
      // Keyset range uses the existing (case_id,operation_key,kind) primary key.
      // Only scoped immutable snapshot keys are fetched, including one lookahead.
      const rows=(await client.query(`SELECT operation_key FROM operations WHERE case_id=$1 AND kind=$2
        AND operation_key>$3 AND operation_key<$4 AND result#>>'{snapshot,source,sourceId}'=$5
        ORDER BY operation_key ASC LIMIT $6`,[caseId,snapshotKind,lower,prefix+'g',sourceId,query.limit+1])).rows;
      if(rows.length>query.limit+1)fail('DOCUMENT_PROPOSALS_SNAPSHOT_INTEGRITY','The history reader exceeded its bounded page.');
      const references=[];let previous=lower;
      for(const row of rows){live(deadline);const parsed=id.safeParse(typeof row.operation_key==='string'?row.operation_key.slice(prefix.length):null);
        if(!parsed.success||row.operation_key!==snapshotKey(parsed.data)||row.operation_key<=previous)
          fail('DOCUMENT_PROPOSALS_SNAPSHOT_INTEGRITY','The history contains an invalid or unordered snapshot key.');
        previous=row.operation_key;const stored=await load(client,current,parsed.data),s=stored.snapshot;
        references.push({snapshotId:s.snapshotId,snapshotRevision:s.snapshotRevision,snapshotSha256:fingerprint(s),
          caseRevision:s.caseRevision,review:s.review,method:s.method,provenanceAuthority:s.provenanceAuthority,population:s.population,
          status:s.status,quotationVerification:s.quotationVerification,qualification:s.qualification,learningLabel:s.learningLabel,
          proposalCount:s.packet.proposals.length,rejectedCount:s.packet.rejected.length,conflictCount:s.packet.conflicts.length,
          locatorWarningCount:s.locatorWarnings.length,
          readUrl:`/api/v1/ingestion/cases/${caseId}/sources/${sourceId}/document-proposals/${s.snapshotId}`});
      }
      const page=references.slice(0,query.limit),hasMore=references.length>query.limit;
      const response=DocumentProposalsHistorySchema.parse({version:'source-document-proposals-history/1',caseId,
        currentCaseRevision:current.caseRevision,source:{sourceId,sourceRevision:current.source.sourceRevision,
          sourceSha256:current.source.sourceSha256,sourceBytes:current.source.sourceBytes},order:'snapshot_id_ascending',
        after:query.after??null,limit:query.limit,references:page,hasMore,nextAfter:hasMore?page.at(-1)!.snapshotId:null});
      bounded(response,limits.historyBytes);same(current,await captureTx(client,caseId,sourceId));live(deadline);return response;
    },{deadlineAt:deadline});
  }
  async read(caseValue:string,sourceValue:string,snapshotValue:string){
    const caseId=id.parse(caseValue),sourceId=id.parse(sourceValue),snapshotId=id.parse(snapshotValue),deadline=Date.now()+limits.seconds*1000;
    const before=await this.readTx(deadline,async client=>{const authority=await captureTx(client,caseId,sourceId);
      return {authority,stored:await load(client,authority,snapshotId)};});
    await this.verify(before.authority,deadline);return this.disclose(before.authority,before.stored,deadline);
  }
  async save(caseValue:string,sourceValue:string,raw:unknown){
    const caseId=id.parse(caseValue),sourceId=id.parse(sourceValue),request=DocumentProposalsSaveSchema.parse(raw),deadline=Date.now()+limits.seconds*1000;
    bounded(request,limits.requestBytes);const digest=fingerprint({caseId,sourceId,request});
    const before=await this.readTx(deadline,async client=>{const authority=await captureTx(client,caseId,sourceId,request.source);
      const prior=await replay(client,authority,request.requestKey,digest);
      if(!prior&&authority.caseRevision!==request.expectedCaseRevision)conflict('Pin the current source-case revision.');
      return {authority,prior};});
    await this.verify(before.authority,deadline);
    if(before.prior)return this.disclose(before.authority,before.prior,deadline);
    await this.pages(before.authority,request.packet,deadline);
    const after=await this.readTx(deadline,client=>captureTx(client,caseId,sourceId,request.source));same(before.authority,after);
    const stored=await this.dependencies.transaction(async client=>{
      live(deadline);const current=await captureTx(client,caseId,sourceId,request.source,true);same(after,current);
      const prior=await replay(client,current,request.requestKey,digest);if(prior)return prior;
      const snapshot=DocumentProposalSnapshotSchema.parse({version:'source-document-proposals/1',snapshotId:randomUUID(),snapshotRevision:1,
        caseId,caseRevision:current.caseRevision,source:{sourceId,...request.source},packet:request.packet,locatorWarnings:locatorWarnings(request.packet),
        method:'caller_supplied_provisional',provenanceAuthority:'caller_supplied_unverified',population:'explicit_selection_only',
        status:'needs_review',quotationVerification:'not_machine_verified',canonicalTarget:null,canonicalMatchState:'not_assessed',
        qualification:'not_assessed',learningLabel:false,unresolved:['quote_truth','producer_execution','approval_and_current_revision',
          'canonical_building_floor','height_units_rights_and_placement'],
        review:{actor:current.subject,time:new Date().toISOString(),attribution:'local_process',humanAuthenticated:false,independentGroundTruth:false}});
      const saved:Stored={snapshot,subject:current.subject,accessSha256:current.accessSha256,
        sourceAuthoritySha256:stable(current),requestSha256:digest};view(saved,current);
      await client.query('INSERT INTO operations(case_id,operation_key,kind,payload_hash,result) VALUES($1,$2,$3,$4,$5)',
        [caseId,snapshotKey(snapshot.snapshotId),snapshotKind,fingerprint(saved),saved]);
      await client.query('INSERT INTO operations(case_id,operation_key,kind,payload_hash,result) VALUES($1,$2,$3,$4,$5)',
        [caseId,requestKey(request.requestKey),requestKind,digest,{snapshotId:snapshot.snapshotId}]);
      same(current,await captureTx(client,caseId,sourceId,request.source));live(deadline);return saved;
    },{deadlineAt:deadline});
    return this.disclose(after,stored,deadline);
  }
}
