import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {RegistryDocumentCitationSchema} from '../packages/contracts/src';
import {buildingDossier,relatedRegistryRecords} from '../packages/server/src/modules/officer/officer';
import {resolveAreaIdentifier} from '../packages/server/src/modules/areas/area-resolver';
import {redactDocumentViews} from '../packages/server/src/modules/usp/ingest/redact';
import {publicRegistryBody} from '../packages/server/src/modules/registry/registry-document-evidence';

// Query-only memory controls for actual general read paths. No connections,
// operational records, source associations or geometry qualifications are created.
test('dossier and canonical/standalone resolver responses omit every private citation without changing stored bodies',async()=>{
  const siteId=randomUUID(),areaId=randomUUID(),buildingId=randomUUID(),recordId=randomUUID(),sourceId=randomUUID();
  const hash='a'.repeat(64);
  const citation=RegistryDocumentCitationSchema.parse({version:'registry-document-citation/1',id:hash,
    document:{caseId:randomUUID(),caseRevision:1,sourceId,sourceRevision:1,sourceSha256:hash,jobId:randomUUID(),resultSha256:hash},
    inputSha256:hash,readerSha256:hash,acceptedFence:1,partId:randomUUID(),partSha256:hash,
    locator:{label:'Private technical locator',paragraph:1,characterStart:0,characterEnd:1},
    target:{recordId,revision:1,bodySha256:hash},
    selection:{subject:'Private technical subject',accessSha256:hash,selectedAt:'2026-09-30T00:00:00Z'},
    associationState:'operator_selected',qualification:'not_assessed'});
  const geometry={type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,0]]]};
  const physical={id:buildingId,areaId,revision:1,identifier:'technical-building',kind:'building',
    name:'Technical building',sourceRevisionId:sourceId,evidence:[],geometry,geographicGeometry:geometry};
  const body={alias:'Technical floor',name:'Technical floor',kind:'floor',footprint:[[0,0],[1,0],[1,1]],
    links:[],rights:[],evidence:[],geometry:{lower:0,upper:1,bindings:{}},documentCitations:[citation]};
  const row={id:recordId,site_id:siteId,kind:'floor',identifier:'technical-floor',revision:1,body};
  const parcel={...row,id:randomUUID(),kind:'parcel',identifier:'technical-parcel',body:{...body,kind:'parcel'}};
  const related={...row,id:randomUUID(),kind:'building',identifier:'technical-related',body:{...body,kind:'building'}};
  const stored=[row,parcel,related,physical],saved=structuredClone(stored);
  let mode:'dossier'|'canonical'|'standalone'='dossier';
  const calls:string[]=[];
  const run=async(sql:string,args:any[]=[])=>{
    calls.push(sql);let rows:any[]=[];
    if(['BEGIN','COMMIT','ROLLBACK'].includes(sql)||sql.startsWith('SET TRANSACTION')||sql.includes("set_config('role'")){}
    else if(sql.includes("current_setting('role')"))rows=[{role:'none'}];
    else if(sql.includes('INSERT INTO map_areas')||sql.includes('INSERT INTO external_identifiers')||sql.startsWith('UPDATE external_identifiers')){}
    else if(sql.includes('FROM map_areas a WHERE ($1::boolean'))rows=[{id:areaId,site_id:siteId,name:'Technical area',revision:1,
      reference:{origin:[0,0],analysisCrs:'EPSG:32643'},geographic_extent:[0,0,1,1]}];
    else if(sql.startsWith('SELECT body FROM physical_features WHERE id='))rows=[{body:physical}];
    else if(sql.includes('WITH RECURSIVE related AS'))rows=[row];
    else if(sql.includes('SELECT revision,frame FROM registry_sites'))rows=[{revision:1,frame:{benchmark:'technical-reference'}}];
    else if(sql.includes('jsonb_array_elements'))rows=[{id:recordId,geometry}];
    else if(sql.includes('FROM usp_analytic_geometry'))rows=args[0]==='registry_record'
      ? [{id:recordId,revision:1,body:row.body}] : [{id:buildingId,revision:1,body:physical}];
    else if(sql.includes('SELECT DISTINCT f.* FROM physical_features'))rows=mode==='canonical'
      ? [{id:buildingId,record_id:recordId,area_id:areaId,revision:1,body:physical}] : [];
    else if(sql.includes('SELECT DISTINCT r.* FROM registry_records'))rows=[row];
    else if(sql.includes('SELECT s.*,a.id area_id')){}
    else if(sql.includes('SELECT id FROM map_areas WHERE site_id'))rows=[{id:areaId}];
    else if(sql.includes('l.target_id WHERE l.record_id'))rows=[parcel];
    else if(sql.includes('l.record_id WHERE l.target_id'))rows=[related];
    else if(sql.includes('WITH RECURSIVE parents AS'))rows=[{body:physical,area_id:areaId}];
    else if(sql.includes('FROM property_associations')||sql.includes('FROM building_preparations')||
      sql.includes('FROM import_packages')||sql.includes('FROM area_check_runs')||sql.includes('FROM block_groups')||
      sql.includes('SELECT DISTINCT p.body FROM physical_features')||sql.includes('SELECT p.body FROM physical_features')||
      sql.includes('FROM officer_investigations')||sql.includes('FROM external_identifiers')||
      sql.startsWith('SELECT id,name,sha256,revision,profile,created_at FROM sources')){}
    else throw new Error('Unexpected technical query: '+sql);
    // Return the actual saved objects so mutation or shallow nested redaction is observable.
    return {rows,rowCount:rows.length};
  };
  const globals=globalThis as unknown as {ulpinPool?:unknown},prior=globals.ulpinPool;
  globals.ulpinPool={query:run,connect:async()=>({query:run,release:()=>{}})};
  try{
    const projected=(value:any,original:any)=>assert.deepEqual(value,{...publicRegistryBody(original.body),
      id:original.id,siteId:original.site_id,identifier:original.identifier,revision:original.revision});
    const records=await relatedRegistryRecords(buildingId,1,siteId);
    projected(records[0],row);
    const dossier=redactDocumentViews(await buildingDossier(buildingId));
    projected(dossier.records[0],row);projected(dossier.detailedScene[0].record,row);
    assert.equal(dossier.missing.some(message=>message.includes('canonical geometry qualification is unavailable')),false);
    assert.equal(JSON.stringify(dossier).includes(citation.locator.label),false);
    mode='canonical';
    const canonical=await resolveAreaIdentifier('technical-control');
    assert.equal(canonical.matches.length,1);
    assert.deepEqual(canonical.matches[0].record,{...publicRegistryBody(body),id:recordId,identifier:row.identifier,revision:1});
    mode='standalone';
    const standalone=await resolveAreaIdentifier('technical-control'),match=standalone.matches[0] as any;
    projected(match.record,row);
    assert.deepEqual(match.parentParcels,[{...publicRegistryBody(parcel.body),id:parcel.id,identifier:parcel.identifier}]);
    assert.deepEqual(match.relatedBuildings.find((item:any)=>item.id===related.id),
      {...publicRegistryBody(related.body),id:related.id,identifier:related.identifier});
    for(const response of [records,dossier,canonical,standalone]){
      const json=JSON.stringify(response);
      assert.equal(json.includes('documentCitations'),false);
      assert.equal(json.includes(citation.selection.subject),false);
      assert.equal(json.includes(citation.locator.label),false);
    }
    assert.deepEqual(stored,saved);
    assert.equal(calls.some(sql=>sql.includes('usp_job_')||sql.includes('FROM jobs')),false);
  }finally{if(prior===undefined)delete globals.ulpinPool;else globals.ulpinPool=prior;}
});
