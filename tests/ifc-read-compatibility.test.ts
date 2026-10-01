import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {PROJECTED_VECTOR_PROFILE as p,ProjectedVectorInputSchema,SemanticPreparationSchema,SemanticChunkSchema,
  PrivateMvtCompilerSchema} from '../packages/contracts/src/usp';
import {fingerprint} from '../packages/server/src/modules/cases/domain';
import {sha256} from '../packages/server/src/infrastructure/storage';
import {ingestionBinding} from '../packages/server/src/modules/usp/ingestion/events';
import {projectedParserSha,assertProjectedInput,assertProjectedReadInput,acceptedProjectedTx} from '../packages/server/src/modules/usp/ingestion/projected-vector';
import {sealedPrefixTx,semanticPublisherSha} from '../packages/server/src/modules/usp/ingestion/semantic-chunks';
import {mvtContextTx} from '../packages/server/src/modules/usp/tiles/service';
import {mvtCodeSha,mvtReadCompilerCompatible} from '../packages/server/src/modules/usp/tiles/compiler';
import {sufficiencySourceTx} from '../packages/server/src/modules/usp/ingestion/sufficiency-context';

// Memory protocol metadata only: no geometry bytes, persisted/property records,
// official identities or claimed source predictions. Reconstructed pre-IFC code
// hashes and existing NWIC profile counts are the subjects of these controls.
const publishers=['2fc75b285a9b57fffaebad822497a30c59274b6e7345e44f760470a39f284be1','2410cb1dc2581631c11f3eea1f10bbe79c5d328d457426b7fb60ae550594673a'];
const compilers=['37f9c493f48724bc8d9627718a5781d3a3514e91d2055ab57492041729dbcbfc','9a9790012ba12ed203ecde3660406a307f59b178399f704e8e9d3e5246c83c76'];
const technicalHash=sha256('memory-only integrity control');
function fixture(publisher:string){
  const caseId=randomUUID(),sourceId=randomUUID(),jobId=randomUUID(),binding=ingestionBinding(caseId),parserSha256=projectedParserSha();
  const base={kind:'retained_source',version:p.version,jobId,caseId,caseRevision:1,sourceId,sourceRevision:1,sourceFamilyId:sourceId,
    sha256:p.zipSha256,bytes:p.zipBytes,objectKey:'large-originals/memory-control',parserSha256,accessBinding:binding.access,
    semanticChunks:{version:'nwic-semantic-chunks/1',publisherSha256:publisher}};
  const input=ProjectedVectorInputSchema.parse({...base,inputFingerprint:fingerprint(base)}),current={id:caseId,revision:1,archived:false};
  const transform={sourceCrs:'EPSG:7755',targetCrs:'EPSG:4326',axisOrder:'always_xy',sourceUnit:'metre',targetUnit:'degree',verticalReference:null,
    pyproj:'3.6.1',proj:'9.3.0',shapely:'2.0.7',projDatabaseSha256:technicalHash,definition:'protocol-only',network:false,ballpark:false,grids:[],
    accuracyQualification:'numerical_transform_only_not_survey_accuracy',parserSha256};
  const totals={features:733,positions:3125505,nativeValid:720,nativeInvalid:13,admitted:720,quarantined:13},asset={key:'memory-control',sha256:technicalHash,bytes:1};
  const entries=Array.from({length:733},(_,index)=>({index,start:0,end:1,key:{type:'number',value:index},positions:1,
    disposition:index<720?'admitted':'quarantined',reason:null,nativeBounds:[0,0,0,0],geographicBounds:null,raw:asset,geographic:null}));
  const partitions=Array.from({length:8},(_,i)=>({sequence:i+1,first:i*100,last:Math.min(732,i*100+99),records:Math.min(100,733-i*100),positions:1,referencedBytes:1}));
  const preparation=SemanticPreparationSchema.parse({version:'nwic-semantic-chunks/1',jobId,sourceId,inputFingerprint:input.inputFingerprint,publisherSha256:publisher,
    result:{version:p.version,jobId,sourceId,inputFingerprint:input.inputFingerprint,index:asset,totals,parserSha256,execution:{seconds:0,peakResidentBytes:1,outputBytes:1}},
    index:{version:p.version,namespace:p.namespace,jobId,sourceId,inputFingerprint:input.inputFingerprint,zipSha256:p.zipSha256,memberSha256:p.memberSha256,memberBytes:p.memberBytes,
      transform,totals,numericalRoundTrip:{maximumMetres:0,positions:3125505},entries},partitions});
  const records=entries.map(e=>({featureIndex:e.index,unitId:randomUUID(),key:e.key,disposition:e.disposition,rawSha256:technicalHash,
    geographicSha256:null,nativeGeometrySha256:technicalHash,geographicGeometrySha256:null,recordSha256:technicalHash}));
  const seals:any[]=[];let previous:any=null;
  for(const partition of partitions){
    const through=records.slice(0,partition.last+1),admitted=through.filter(r=>r.disposition==='admitted').length;
    const body=SemanticChunkSchema.parse({version:'nwic-semantic-chunks/1',jobId,caseId,caseRevision:1,sourceId,sourceRevision:1,sourceFamilyId:sourceId,
      sourceSha256:p.zipSha256,inputFingerprint:input.inputFingerprint,accessBinding:binding.access,publisherSha256:publisher,indexSha256:technicalHash,transform,
      partition,previous,attempt:1,fence:1,records:records.slice(partition.first,partition.last+1),coverage:{kind:'committed_partial',sourceAccepted:false,
        throughSequence:partition.sequence,expectedChunks:8,records:through.length,admitted,quarantined:through.length-admitted,positions:partition.sequence,
        expectedRecords:733,remainingRecords:733-through.length,prefixDependencySha256:fingerprint(through)}});
    const hash=sha256(JSON.stringify(body));seals.push({sequence:partition.sequence,sha256:hash,body});previous={sequence:partition.sequence,sha256:hash};
  }
  const source={id:sourceId,case_id:caseId,family_id:sourceId,revision:1,sha256:p.zipSha256,bytes:p.zipBytes,object_key:base.objectKey,profile:'large-original-v1',
    inspection:{largeOriginal:{operatorSubject:binding.subject},projectedVector:{accepted:{jobId,fence:1,index:asset,transform,finalChunk:previous}}}};
  const job={id:jobId,case_id:caseId,source_id:sourceId,status:'succeeded',operation:'projected-vector',payload:input,input_fingerprint:input.inputFingerprint,accepted_fence:1,result_ref:asset};
  const rows=records.map(r=>({feature_index:r.featureIndex,unit_id:r.unitId,native_key:r.key,disposition:r.disposition,raw_ref:asset,geographic_ref:null,
    native_geometry_sha256:r.nativeGeometrySha256,geographic_geometry_sha256:null,record_sha256:r.recordSha256,raw_sha:technicalHash,geo_sha:null,geographic_bounds:null}));
  const query=async(sql:string,args:any[]=[])=>{
    if(sql.includes('FROM cases'))return {rows:[current]};
    if(sql.includes('max(revision)'))return {rows:[{revision:1}]};
    if(sql.includes("inspection->'manualProfile'"))return {rows:[{...source,projected:source.inspection.projectedVector}]};
    if(sql.includes('FROM sources'))return {rows:[source]};
    if(sql.includes('FROM usp_mapping_recipes')||sql.includes('FROM physical_features'))return {rows:[]};
    if(sql.includes('FROM jobs'))return {rows:[job]};
    if(sql.includes('source_semantic_preparations'))return {rows:[{sha256:sha256(JSON.stringify(preparation)),body:preparation}]};
    if(sql.includes('source_semantic_chunks'))return {rows:seals.slice(0,args[2])};
    if(sql.includes('administrative_unit_observations'))return {rows:rows.slice(0,args[2]?partitions[args[2]-1].last+1:733)};
    if(sql.includes('postgis_full_version'))return {rows:[{version:'retained-protocol-PostGIS'}]};
    throw new Error('Unexpected compatibility query: '+sql);
  };
  return {caseId,sourceId,jobId,input,current,source,job,preparation,seals,records,binding,client:{query} as any,ctx:{current,source,access:binding.access},pin:previous};
}

test('exact pre-IFC complete/prefix/sufficiency reads preserve stored seals; default admission/compilation stays stale',async()=>{
  const prior=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;process.env.ULPIN_LOCAL_OPERATOR_SUBJECT='ifc-compatibility-control';
  try{for(const publisher of publishers){
    const f=fixture(publisher),saved=JSON.stringify({input:f.input,preparation:f.preparation,seals:f.seals});
    assert.notEqual(publisher,semanticPublisherSha());assertProjectedReadInput(f.ctx,f.input);
    assert.throws(()=>assertProjectedInput(f.ctx,f.input),(e:any)=>e.code==='PROJECTED_CONTEXT_STALE');
    const prefix=await sealedPrefixTx(f.client,f.caseId,f.sourceId,f.jobId,{sequence:1,sha256:f.seals[0].sha256},'immutable_read');assert.equal(prefix.chunk.coverage.records,100);
    assert.equal((await acceptedProjectedTx(f.client,f.caseId,f.sourceId,undefined,'immutable_read')).input.semanticChunks!.publisherSha256,publisher);
    assert.equal((await mvtContextTx(f.client,f.caseId,f.sourceId,f.jobId,false,f.pin,'immutable_read')).observations.length,733);
    await assert.rejects(()=>acceptedProjectedTx(f.client,f.caseId,f.sourceId),(e:any)=>e.code==='PROJECTED_CONTEXT_STALE');
    await assert.rejects(()=>sealedPrefixTx(f.client,f.caseId,f.sourceId,f.jobId,f.pin),(e:any)=>e.code==='PROJECTED_CONTEXT_STALE');
    await assert.rejects(()=>mvtContextTx(f.client,f.caseId,f.sourceId,f.jobId),(e:any)=>e.code==='PROJECTED_CONTEXT_STALE');
    const scope={row:f.current,sources:[f.source],recipes:[],packageBodies:[],packages:[],areas:[],binding:f.binding,context:technicalHash};
    assert.equal((await sufficiencySourceTx(f.client,scope as any,f.sourceId)).projectedAccepted,true);
    assert.equal(JSON.stringify({input:f.input,preparation:f.preparation,seals:f.seals}),saved);
    f.seals[0].body.records[0].recordSha256='0'.repeat(64);await assert.rejects(()=>sealedPrefixTx(f.client,f.caseId,f.sourceId,f.jobId,f.pin,'immutable_read'),(e:any)=>e.status===422);
    f.current.archived=true;await assert.rejects(()=>acceptedProjectedTx(f.client,f.caseId,f.sourceId,undefined,'immutable_read'),(e:any)=>e.status===403);
    const {inputFingerprint:_,...unknownBase}={...f.input,semanticChunks:{...f.input.semanticChunks!,publisherSha256:'0'.repeat(64)}};
    assert.throws(()=>assertProjectedReadInput(f.ctx,{...unknownBase,inputFingerprint:fingerprint(unknownBase)}),(e:any)=>e.code==='PROJECTED_CONTEXT_STALE');
  }}finally{if(prior===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=prior;}
});

test('pre-IFC MVT read compatibility requires exact every non-code pin and installed current code',()=>{
  const base={codeSha256:mvtCodeSha(),policySha256:technicalHash,postgis:'retained-protocol-PostGIS',sourceTransformSha256:technicalHash,
    sourceCrs:'EPSG:4326',targetCrs:'EPSG:3857',axisOrder:'always_xy',verticalReference:null};
  const pin=(changes:any)=>{const v={...base,...changes};return PrivateMvtCompilerSchema.parse({...v,sha256:fingerprint(v)});},current=pin({});
  for(const codeSha256 of compilers){const stored=pin({codeSha256}),before=JSON.stringify(stored);
    for(const prefix of [false,true]){
      assert.equal(mvtReadCompilerCompatible(stored,current,prefix),true);
      assert.equal(mvtReadCompilerCompatible({...stored,sha256:'0'.repeat(64)},current,prefix),false);
      for(const change of [{postgis:'changed'},{policySha256:'0'.repeat(64)},{sourceTransformSha256:'0'.repeat(64)},{codeSha256:'0'.repeat(64)}])
        assert.equal(mvtReadCompilerCompatible(stored,pin(change),prefix),false);
      assert.equal(mvtReadCompilerCompatible(pin({codeSha256:'0'.repeat(64)}),current,prefix),false);
    }
    assert.notEqual(fingerprint(stored),fingerprint(current));assert.equal(JSON.stringify(stored),before);
  }
});
