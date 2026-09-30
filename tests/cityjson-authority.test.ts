import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import type {PoolClient} from 'pg';
import {CITYJSON_VERSION,CityJSONOriginalSchema} from '../packages/contracts/src/usp/cityjson-ingestion';
import {cityjsonSourceTx,cityjsonInput,assertCityJSONJobRow,isCityJSONProtectedSource} from '../packages/server/src/modules/usp/ingestion/cityjson';
import {ingestionBinding} from '../packages/server/src/modules/usp/ingestion/events';
import {fingerprint} from '../packages/server/src/modules/cases/domain';
import {sha256} from '../packages/server/src/infrastructure/storage';

// Memory-only application references and real source bytes. No persisted or
// invented property geometry, official identifier, right or test authority.
test('a present null/malformed CityJSON marker cannot fall through to legacy downloads',()=>{
  assert.equal(isCityJSONProtectedSource({profile:'cityjson-native-v1',inspection:{}}),true);
  for(const marker of [null,false,0,'',{}])
    assert.equal(isCityJSONProtectedSource({profile:'plan-pdf-v1',inspection:{cityjsonOriginal:marker}}),true);
  assert.equal(isCityJSONProtectedSource({profile:'plan-pdf-v1',inspection:{}}),false);
});
test('source and accepted-attempt fences deny concrete context/payload drift',async()=>{
  const previous=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT='cityjson-authority-control';
  try{
    const caseId=randomUUID(),sourceId=randomUUID(),binding=ingestionBinding(caseId);
    const raw=readFileSync(new URL('../fixtures/usp/D1/single-roof/original.json',import.meta.url)),hash=sha256(raw);
    const current={id:caseId,revision:1,archived:false,frame:null,context:null,site_id:null};
    const original=CityJSONOriginalSchema.parse({version:CITYJSON_VERSION,subject:binding.subject,accessSha256:binding.access,
      sha256:hash,bytes:raw.length,receivedAt:new Date().toISOString(),lineageState:'caller_declared',
      lineage:{issuer:null,originalUrl:null,acquiredAt:null,permissionReference:null,geography:null,limitations:[]}});
    const source={id:sourceId,case_id:caseId,family_id:sourceId,revision:1,sha256:hash,bytes:raw.length,
      profile:'cityjson-native-v1',object_key:`sources/${sourceId}/${hash}`,inspection:{cityjsonOriginal:original}};
    const client={query:async(sql:string)=>({rows:sql.includes('FROM cases')?[current]:sql.includes('max(revision)')?[{revision:1}]:[source]})} as unknown as PoolClient;
    const ctx=await cityjsonSourceTx(client,caseId,sourceId),input=cityjsonInput(ctx,randomUUID(),'complete_bounded_source');
    const digest=fingerprint(input),row={id:input.jobId,operation:'cityjson-native',case_id:caseId,source_id:sourceId,
      case_revision:1,payload:input,input_fingerprint:digest,input_sha256:digest,status:'succeeded',logical_state:'succeeded',
      result_ref:{assetId:`cityjson:${input.jobId}`,version:1,sha256:hash},accepted_fence:1,attempt_fence:1,
      attempt_state:'accepted',attempt_input_sha256:digest,completion_sha256:hash};
    assert.doesNotThrow(()=>assertCityJSONJobRow(row,input,true));
    assert.throws(()=>assertCityJSONJobRow({...row,attempt_fence:2},input,true),/accepted CityJSON attempt/);
    assert.throws(()=>assertCityJSONJobRow({...row,payload:{...input,sourceBytes:input.sourceBytes+1}},input,true),/source-bound input/);
    assert.throws(()=>assertCityJSONJobRow({...row,input_sha256:hash},input,true),/source-bound input/);
    source.inspection.cityjsonOriginal={...original,subject:'different-operator'};
    await assert.rejects(cityjsonSourceTx(client,caseId,sourceId),error=>(error as any).status===403);
    source.inspection.cityjsonOriginal={...original,accessSha256:'0'.repeat(64)};
    await assert.rejects(cityjsonSourceTx(client,caseId,sourceId),error=>(error as any).status===403);
    source.inspection.cityjsonOriginal=null as any;
    await assert.rejects(cityjsonSourceTx(client,caseId,sourceId),error=>(error as any).status===403);
    source.inspection.cityjsonOriginal=original;current.archived=true;
    await assert.rejects(cityjsonSourceTx(client,caseId,sourceId),error=>(error as any).status===403);
  }finally{if(previous===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=previous;}
});
