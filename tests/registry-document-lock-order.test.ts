import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {readRegistryCityJSONReferencesTx} from '../packages/server/src/modules/registry/cityjson-reference';
import {registryCityJSONAuthorityTx} from '../packages/server/src/modules/registry/cityjson-draft';
import {amendRegistryDocumentCitationsTx,readRegistryDocumentCitationsTx,citationId,documentReviewContext} from '../packages/server/src/modules/registry/registry-document-evidence';
import {commitRegistryReviewTx} from '../packages/server/src/modules/registry/registry';
import {commitProposalTx} from '../packages/server/src/modules/usp/commands';
import {captureRegistrySnapshotTx} from '../packages/server/src/modules/usp/snapshots';
import {localRequestContext} from '../packages/server/src/modules/usp/principal';
import {documentCaseTx} from '../packages/server/src/modules/usp/ingestion/document-context';
import {fingerprint} from '../packages/server/src/modules/cases/domain';

// Adapted from the preserved reviewer lock-order-control.ts. Unchanged retained
// literal results; all SQL/other authority and site associations are technical
// doubles. No PostgreSQL contention, service or operational write is claimed.
const root=process.env.ULPIN_REFERENCE_CONTROL_ROOT??'E:/BhuAayam-data/task-data/';
const available=existsSync(root+'desktop-cityjson-reference-binding/accepted-reference-flow.json');
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return {promise,resolve};};
const stop=new Error('second distinct document case row reached');

test('reference/citation gates serialize the reproduced inversion; stale aggregates and USP replay retain their boundaries',
  {skip:!available},async()=>{
  const json=(path:string)=>JSON.parse(readFileSync(root+path,'utf8'));
  const flow=json('desktop-cityjson-reference-binding/accepted-reference-flow.json');
  const manifest=json('desktop-cityjson-reference-binding/accepted-enrollment-manifest.json');
  const native=json('desktop-cityjson-validation-runtime/after-journey.json');
  const docs=manifest.enrollments.map((e:any)=>({e,result:JSON.parse(readFileSync(e.resultPrivateCopy,'utf8'))}))
    .sort((a:any,b:any)=>a.e.caseId.localeCompare(b.e.caseId));
  const [d1,d2]=docs;
  const prior=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=d1.result.input.subject;
  const reference=(d:any)=>flow.read.references.find((r:any)=>r.pin.document.caseId===d.e.caseId).pin;
  function fixture(){
    const draft=structuredClone(native.registry.drafts[0]),site=structuredClone(native.registry.sites[0]);
    draft.revision=flow.read.draftRevision;
    draft.records[0].nativeExteriorReferences=flow.read.references.map((r:any)=>r.pin);
    const technicalSite=randomUUID(),technicalRecord=randomUUID(),technicalDraft=randomUUID();
    const body={alias:'Lock control',name:'Lock control',kind:'building',footprint:[],links:[],rights:[],evidence:[],synthetic:false};
    const target={recordId:technicalRecord,revision:1,bodySha256:fingerprint(body)};
    const citation=(d:any)=>{
      const selected=reference(d),identity={document:selected.document,partId:selected.partId,target};
      return {...identity,id:citationId(identity),version:'registry-document-citation/1',inputSha256:selected.inputSha256,
        readerSha256:selected.readerSha256,acceptedFence:selected.acceptedFence,partSha256:selected.partSha256,
        locator:selected.locator,selection:selected.selection,associationState:'operator_selected',qualification:'not_assessed'};
    };
    const recordedDraft={id:technicalDraft,site_id:technicalSite,case_id:randomUUID(),status:'draft',revision:1,
      records:[{...body,id:technicalRecord,siteId:technicalSite,revision:1,documentCitations:[citation(d1)]}]};
    const request={requestKey:randomUUID(),expectedDraftRevision:1,recordId:technicalRecord,expectedRecordRevision:1,
      add:{document:reference(d2).document,partIds:[d2.e.selectedParts[0].id]},remove:[]};
    return {draft,site,body,recordedDraft,request,citation,technicalSite,technicalRecord};
  }
  try{
    for(const mode of ['amend','stale-amend','read'] as const){
      const f=fixture();if(mode==='read')f.recordedDraft.records[0].documentCitations.push(f.citation(d2));
      const reached=deferred(),resume=deferred(),waiting=deferred();
      const gates=new Map<string,{owner:string;released:ReturnType<typeof deferred>}>();
      const events:{owner:string;sql:string;args:any[]}[]=[],caseOrder=new Map<string,string[]>();
      const changedCase=randomUUID();
      function client(owner:string):any{return {query:async(sql:string,args:any[]=[])=>{
        events.push({owner,sql,args});assert(!/^(INSERT|UPDATE|DELETE)/.test(sql),'No control mutation');
        if(sql.includes('pg_advisory_xact_lock')){
          const key=args[0];
          while(gates.has(key)&&gates.get(key)!.owner!==owner){waiting.resolve();await gates.get(key)!.released.promise;}
          if(!gates.has(key))gates.set(key,{owner,released:deferred()});return {rows:[]};
        }
        if(sql.includes('FROM cases')&&sql.includes('FOR UPDATE')){
          const order=caseOrder.get(owner)??[];if(!order.includes(args[0]))order.push(args[0]);caseOrder.set(owner,order);
          if(owner==='native'&&order.length===1){reached.resolve();await resume.promise;}
          if(order.length===2)throw stop;
          return {rows:[{id:args[0],revision:1,archived:false,frame:null,context:null,site_id:null}]};
        }
        if(sql.includes('FROM registry_drafts'))return {rows:[structuredClone(owner==='native'?f.draft:f.recordedDraft)]};
        if(sql.includes('FROM registry_sites'))return {rows:[owner==='native'?structuredClone(f.site):{id:f.technicalSite}]};
        if(sql.includes('FROM registry_records'))return {rows:[{id:f.technicalRecord,site_id:f.technicalSite,kind:'building',revision:1,body:f.body}]};
        if(sql.includes('FROM operations'))return {rows:[]};
        if(sql.includes('SELECT accepted_fence'))return {rows:[{accepted_fence:1}]};
        throw new Error('Unexpected SQL: '+sql);
      }};}
      const document=async(c:any,_ctx:any,pin:any)=>{
        await documentCaseTx(c,pin.caseId,true);return docs.find((d:any)=>d.e.caseId===pin.caseId).result.input;
      };
      const result=async(input:any)=>structuredClone(docs.find((d:any)=>d.e.jobId===input.jobId).result);
      const dependencies={source:document as any,result,registrySource:async(_c:any,siteId:string,sourceId:string)=>{
        assert.equal(siteId,f.technicalSite);const d=docs.find((v:any)=>v.e.sourceId===sourceId);assert(d);
        return {revision:d.result.input.sourceRevision,sha256:d.result.input.sourceSha256} as any;
      }};
      async function run(owner:string,work:()=>Promise<unknown>){
        try{await work();assert.fail('Expected controlled stop');}catch(error){
          if(mode==='stale-amend'&&owner==='citation')assert.equal((error as any).status,409);else assert.equal(error,stop);
        }finally{for(const [key,value] of gates)if(value.owner===owner){gates.delete(key);value.released.resolve();}}
      }
      const candidate=f.draft.records[0].nativeExteriorCandidate;
      const a=run('native',()=>readRegistryCityJSONReferencesTx(client('native'),f.draft.id,{
        native:(c:any,id:string)=>registryCityJSONAuthorityTx(c,id,async()=>({input:candidate.input,job:{accepted_fence:candidate.acceptedFence}}) as any),
        document:document as any,result}));
      await reached.promise;
      const b=run('citation',()=>mode==='read'?readRegistryDocumentCitationsTx(client('citation'),f.recordedDraft.id,dependencies):
        amendRegistryDocumentCitationsTx(client('citation'),f.recordedDraft.id,f.request,dependencies));
      await waiting.promise;
      assert.equal(caseOrder.has('citation'),false);
      assert(!events.some(e=>e.owner==='citation'&&/FOR (UPDATE|SHARE)/.test(e.sql)));
      if(mode==='stale-amend')f.recordedDraft.records[0].documentCitations[0].document={...reference(d1).document,caseId:changedCase};
      resume.resolve();await Promise.all([a,b]);
      assert.deepEqual(caseOrder.get('native'),[d1.e.caseId,d2.e.caseId]);
      if(mode==='stale-amend'){
        assert.equal(caseOrder.has('citation'),false);
        assert(!events.some(e=>e.args[0]===`registry-import:${changedCase}`));
      }else{
        // Row inversion is safe because shared gates serialize the transactions.
        assert.deepEqual(caseOrder.get('citation'),mode==='amend'?[d2.e.caseId,d1.e.caseId]:[d1.e.caseId,d2.e.caseId]);
        for(const owner of ['native','citation']){
          const shared=events.filter(e=>e.owner===owner&&e.sql.includes('pg_advisory_xact_lock')&&
            [d1.e.caseId,d2.e.caseId].some(id=>e.args[0]===`registry-import:${id}`)).map(e=>e.args[0]);
          assert.deepEqual([...new Set(shared)],[d1.e.caseId,d2.e.caseId].map(id=>`registry-import:${id}`));
        }
      }
    }

    // Current neighbouring records participate in commit's complete lookup,
    // including the USP caller; a new case after waiting is never locked late.
    for(const mode of ['direct-stale','usp-stale','direct-replay-after-wait']){
      const f=fixture(),reviewId=randomUUID(),changedCase=randomUUID(),queries:{sql:string;args:any[]}[]=[];
      const replayStop=new Error('concurrent commit reached its replay authority check');
      const neighbour={id:randomUUID(),site_id:f.technicalSite,kind:'building',revision:1,
        body:{...f.body,documentCitations:[f.citation(d2)]}};
      const review={id:reviewId,draftId:f.recordedDraft.id,draftRevision:1,siteRevision:1,records:f.recordedDraft.records,
        before:[],findings:[],inputFingerprint:'a'.repeat(64),documentReviewContext:documentReviewContext()};
      let manifest:any,registryWrites=0,committed=false;
      const client:any={query:async(sql:string,args:any[]=[])=>{
        queries.push({sql,args});
        if(/^(UPDATE|INSERT|DELETE) registry_/.test(sql))registryWrites++;
        if(sql.includes('pg_advisory_xact_lock'))return {rows:[]};
        if(sql.includes('FROM usp_command_receipts'))return {rows:[]};
        if(sql.includes('FROM usp_snapshots'))return {rows:[{body:manifest}]};
        if(sql.startsWith('INSERT INTO usp_snapshot'))return {rows:[]};
        if(sql.includes('FROM registry_reviews'))return {rows:[{draft_id:f.recordedDraft.id,body:structuredClone(review),committed}]};
        if(sql.includes('FROM registry_drafts'))return {rows:[structuredClone(f.recordedDraft)]};
        if(sql.includes('FROM registry_sites')){
          if(sql.includes('FOR UPDATE')){
            if(mode==='direct-replay-after-wait'){committed=true;f.recordedDraft.status='recorded';}
            else neighbour.body.documentCitations[0].document={...reference(d2).document,caseId:changedCase};
          }
          return {rows:[{id:f.technicalSite,revision:1,frame:{id:'technical-control',benchmark:'technical-control',horizontalUnit:'m'}}]};
        }
        if(['usp_project_lineage','registry_aliases','physical_features','FROM sources','usp_geometry_qualifications'].some(v=>sql.includes(v)))return {rows:[]};
        if(sql.includes('CASE WHEN r.revision')&&mode==='direct-replay-after-wait')throw replayStop;
        if(sql.includes('FROM registry_records'))return {rows:[structuredClone(neighbour)]};
        throw new Error('Unexpected commit SQL: '+sql);
      }};
      if(mode==='usp-stale'){
        const ctx=localRequestContext(randomUUID());manifest=await captureRegistrySnapshotTx(client,ctx,f.technicalSite,{kind:'site'});
        queries.length=0;
        await assert.rejects(()=>commitProposalTx(client,ctx,{kind:'registry',proposalId:f.recordedDraft.id,reviewId,
          scope:manifest.scope,guard:{mode:'update',requestKey:randomUUID(),expectedManifestId:manifest.id,expectedVersion:1},acknowledgement:''}),
          (error:any)=>error.status===409&&error.message.includes('case set changed'));
      }else if(mode==='direct-replay-after-wait')await assert.rejects(()=>commitRegistryReviewTx(client,reviewId,''),error=>error===replayStop);
      else await assert.rejects(()=>commitRegistryReviewTx(client,reviewId,''),
        (error:any)=>error.status===409&&error.message.includes('case set changed'));
      const caseGates=queries.filter(q=>q.args[0]?.startsWith?.('registry-import:'));
      assert.deepEqual(caseGates.map(q=>q.args[0]),[f.recordedDraft.case_id,d1.e.caseId,d2.e.caseId].sort().map(id=>`registry-import:${id}`));
      const firstRecording=queries.findIndex(q=>q.sql.includes('physical-area-recording'));
      assert(queries.indexOf(caseGates.at(-1)!)<firstRecording);
      assert(!queries.some(q=>q.sql.includes('FROM cases')&&/FOR (UPDATE|SHARE)/.test(q.sql)));
      assert(!queries.some(q=>q.args[0]===`registry-import:${changedCase}`));assert.equal(registryWrites,0);
    }

    // Actual USP replay/conflict requires no draft/review/snapshot lookup.
    const ctx=localRequestContext(randomUUID()),scope={kind:'snapshot',scopeId:randomUUID(),world:{namespace:'world',id:'technical-replay'},
      manifestId:randomUUID(),snapshotDigest:'a'.repeat(64),stage:'recorded'};
    const command={kind:'registry',proposalId:randomUUID(),reviewId:randomUUID(),scope,
      guard:{mode:'update',requestKey:randomUUID(),expectedManifestId:scope.manifestId,expectedVersion:1},acknowledgement:''};
    const receipt={receiptId:randomUUID(),operation:'commit_registry',requestKey:command.guard.requestKey,commandSha256:fingerprint(command),
      proposalId:command.proposalId,reviewId:command.reviewId,before:[],after:[],snapshot:scope,
      event:{streamId:'technical-replay',sequence:'1'},committedAt:'2026-10-01T00:00:00Z'};
    let storedHash=fingerprint(command);
    const client:any={query:async(sql:string)=>{
      if(sql.includes('FROM usp_command_receipts'))return {rows:[{command_sha256:storedHash,body:receipt}]};
      assert(sql.includes('pg_advisory_xact_lock'));return {rows:[]};
    }};
    assert.deepEqual(await commitProposalTx(client,ctx,command as any),receipt);
    storedHash='b'.repeat(64);await assert.rejects(()=>commitProposalTx(client,ctx,command as any),(error:any)=>error.status===409);
  }finally{if(prior===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=prior;}
});
