import type {PoolClient} from 'pg';
import {
  ConsolidatedRegistryReportSchema, RegistryMetadataSchema, registryReportTextSafe,
  type BuildingDossier, type ConsolidatedRegistryReport, type RegistryRecord,
} from '@ulpin/contracts';
import {pool} from '../../infrastructure/db';
import {AppError, conflict, notFound} from '../../infrastructure/errors';
import {fingerprint} from '../cases/domain';
import {assertPackageDocumentAuthority} from '../areas/package-authority';
import {assertRegistryMetadataTx, registrySourceTx, registryMetadataEvidence} from '../registry/registry-metadata';
import {localRequestContext} from '../usp/principal';
import {selectRegisterScope} from '../../shared/register-scope';
import {registerPdf} from './register-pdf';
import {consolidatedRegisterHtml} from './consolidated-register-html';

type Field=ConsolidatedRegistryReport['building']['name'];
type Row=Record<string,any>;
const unknown=():Field=>({state:'unknown',value:null,sources:[]});
const sourceIds=(evidence:Row[]=[])=>[...new Set(evidence.map(e=>e?.sourceId??e?.sourceRevisionId).filter((id):id is string=>typeof id==='string'))];
function textField(value:unknown,sources:string[]=[]):Field {
  if(typeof value!=='string'||!value.trim())return unknown();
  if(value.length>250||!registryReportTextSafe(value))return {state:'withheld',value:null,sources};
  return {state:'recorded',value,sources};
}
const date=(value:unknown)=>value?new Date(String(value)).toISOString():null;
const limit=()=>{throw new AppError(422,'REGISTRY_REPORT_LIMIT','Select a recorded floor or space to produce a smaller report.');};

/** Same canonical recorded graph as the dossier. This facts reader never projects
 * geometry, calls getArea (which writes), or treats spatial intersection as a link. */
async function captureTx(client:PoolClient,buildingId:string,recordId:string|undefined,generatedAt:string) {
  const root=(await client.query(`SELECT f.id,f.identifier,f.revision,f.body,a.id area_id,a.site_id,a.name area_name,
    a.revision area_revision,s.revision site_revision,
    (SELECT created_at FROM physical_feature_revisions WHERE feature_id=f.id AND revision=f.revision) recorded_at
    FROM physical_features f JOIN map_areas a ON a.id=f.area_id JOIN registry_sites s ON s.id=a.site_id
    WHERE f.id=$1 AND f.revision>0 AND f.body->>'kind'='building' AND a.archived_at IS NULL`,[buildingId])).rows[0]??notFound('Building not found.');
  const associations=(await client.query('SELECT * FROM property_associations WHERE from_id=$1 ORDER BY id',[buildingId])).rows;
  const recordRows=(await client.query(`WITH RECURSIVE related AS (
    SELECT r.id FROM registry_records r WHERE r.site_id=$3 AND (r.id=$1 OR r.id IN (
      SELECT a.to_id FROM property_associations a JOIN registry_records t ON t.id=a.to_id
      WHERE a.from_id=$1 AND a.relationship IN ('detailed_record','shared_space') AND a.status='confirmed'
      AND (a.body->>'fromRevision')::int=$2 AND (a.body->>'toRevision')::int=t.revision))
    UNION SELECT l.record_id FROM registry_links l JOIN related x ON l.target_id=x.id
      JOIN registry_records r ON r.id=l.record_id AND r.site_id=$3 WHERE l.kind IN ('within','floor','serves'))
    SELECT r.*,v.created_at recorded_at FROM registry_records r
    LEFT JOIN registry_revisions v ON v.record_id=r.id AND v.revision=r.revision
    WHERE r.id IN (SELECT id FROM related) AND r.revision>0 AND r.site_id=$3 ORDER BY r.kind,r.ordinal LIMIT 2001`,
    [buildingId,root.revision,root.site_id])).rows;
  if(recordRows.length>2000)limit();
  const records=recordRows.map(r=>({...r.body,id:r.id,identifier:r.identifier,siteId:r.site_id,revision:r.revision}) as RegistryRecord);
  const scope=selectRegisterScope({building:{...root.body,id:root.id,identifier:root.identifier},records,detailedScene:[]} as unknown as BuildingDossier,recordId);
  if(!scope)notFound('The selected floor or space is not currently recorded for this building.');
  const selected=new Set(scope.dossier.records.map(r=>r.id));
  const selectedRows=recordRows.filter(r=>selected.has(r.id));
  // Parents provide only relationship context. Their people and unrelated siblings never enter an exact selection.
  const parcelRows=(await client.query(`SELECT p.id,p.identifier,p.revision,p.body,a.body association
    FROM property_associations a JOIN physical_features p ON p.id=a.to_id
    WHERE a.from_id=$1 AND a.relationship='occupies_parcel' AND p.area_id=$2
      AND p.revision>0 AND p.body->>'kind'='parcel' ORDER BY p.id LIMIT 201`,[buildingId,root.area_id])).rows;
  const registryParcelRows=(await client.query(`SELECT DISTINCT p.* FROM registry_records p JOIN registry_links l ON l.target_id=p.id
    WHERE l.record_id=ANY($1::uuid[]) AND l.kind IN ('within','crosses') AND p.kind='parcel'
      AND p.site_id=$2 AND p.revision>0 ORDER BY p.id LIMIT 201`,[scope.dossier.records.map(r=>r.id),root.site_id])).rows;
  if(parcelRows.length+registryParcelRows.length>200)limit();
  const assertions=(await client.query(`SELECT * FROM external_identifiers WHERE scheme='official_ulpin' AND valid_to IS NULL
    AND (feature_id=ANY($1::uuid[]) OR record_id=ANY($2::uuid[])) ORDER BY id LIMIT 601`,
    [parcelRows.map(p=>p.id),registryParcelRows.map(p=>p.id)])).rows;
  if(assertions.length>600)limit();
  const entityIds=[buildingId,...parcelRows.map(p=>p.id)];
  const packages=(await client.query(`SELECT id,revision,state,body FROM import_packages
    WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(body->'features') f WHERE f->>'id'=ANY($1::text[]))
    ORDER BY id LIMIT 31`,[entityIds])).rows;
  if(packages.length>30)limit();
  for(const pkg of packages)await assertPackageDocumentAuthority(client,pkg.body);
  const referenced=new Set<string>();
  const cite=(ids:string[])=>{for(const id of ids)referenced.add(id);return ids;};
  const contextIds=new Set(selected);
  let expanded=true;
  while(expanded){
    expanded=false;
    for(const r of records)if(contextIds.has(r.id))for(const link of r.links)
      if(['within','floor','serves'].includes(link.type)&&!contextIds.has(link.targetId)){
        contextIds.add(link.targetId);expanded=true;
      }
  }
  // Evidence authorizing the selected canonical graph must remain accessible too.
  for(const association of associations)
    if(['detailed_record','shared_space'].includes(association.relationship)&&contextIds.has(association.to_id))
      cite(sourceIds(association.body.evidence));
  const rootSources=cite(sourceIds([...(root.body.evidence??[]),{sourceRevisionId:root.body.sourceRevisionId}]));
  const projectedRecords:ConsolidatedRegistryReport['records']=[];
  for(const row of selectedRows) {
    const r=records.find(record=>record.id===row.id)!;
    const metadata=r.registryMetadata?RegistryMetadataSchema.parse(r.registryMetadata):undefined;
    await assertRegistryMetadataTx(client,root.site_id,r.kind,metadata);
    if(metadata)cite(sourceIds(registryMetadataEvidence(metadata)));
    const evidence=cite(sourceIds(r.evidence));
    const address=Object.fromEntries(['line','locality','district','region','postalCode','country'].map(key=>{
      const fact=metadata?.address?.[key as keyof NonNullable<typeof metadata.address>];
      return [key,fact?{state:fact.state,value:fact.value,sources:cite(sourceIds(fact.evidence))}:unknown()];
    })) as ConsolidatedRegistryReport['records'][number]['address'];
    const occupancy=metadata?.occupancy;
    projectedRecords.push({id:r.id,applicationId:r.identifier,kind:r.kind,revision:r.revision,
      name:textField(r.name,evidence),recordedAt:date(row.recorded_at),links:r.links,address,
      ownershipClaims:r.rights.filter(right=>right.type==='ownership_claim').map(right=>{
        const sources=cite(sourceIds([right.evidence]));return {party:textField(right.party,sources),sources};
      }),
      occupancy:occupancy?{state:occupancy.state,sources:cite(sourceIds(occupancy.evidence)),
        people:occupancy.people.map(person=>({name:textField(person.name,cite(sourceIds(person.evidence))),role:person.role}))}
        :{state:'unknown',sources:[],people:[]}});
  }
  function officialAssertions(id:string,body?:Row) {
    const values=assertions.filter(a=>(a.feature_id??a.record_id)===id).map(a=>{
      const sources=cite(sourceIds([...(Array.isArray(a.evidence)?a.evidence:[a.evidence]),{sourceId:a.source_id}]));
      // An explicitly typed parcel identifier may be numeric; never apply the personal-contact filter to its value.
      const valid=typeof a.normalized_value==='string'&&/^[A-Z0-9-]{1,100}$/i.test(a.normalized_value);
      return {value:valid?{state:'recorded' as const,value:a.normalized_value as string,sources}:unknown(),
        issuer:textField(a.issuer,sources),state:String(a.verification_state).slice(0,250)};
    });
    if(!values.length&&typeof body?.officialUlpin==='string') {
      const sources=cite(sourceIds(body.evidence));
      values.push({value:/^[A-Z0-9-]{1,100}$/i.test(body.officialUlpin)?{state:'recorded',value:body.officialUlpin,sources}:unknown(),
        issuer:unknown(),state:'recorded_unverified'});
    }
    return values;
  }
  const parcels:ConsolidatedRegistryReport['parcels']=[
    ...parcelRows.map(p=>({id:p.id,applicationId:p.identifier,kind:'parcel' as const,revision:p.revision,authority:'physical_feature' as const,
      relationship:'occupies_parcel',associationState:p.association.status==='confirmed'&&
        p.association.fromRevision===root.revision&&p.association.toRevision===p.revision?'confirmed':
        p.association.status==='confirmed'?'stale':p.association.status,
      sources:cite(sourceIds([...(p.body.evidence??[]),...(p.association.evidence??[]),{sourceRevisionId:p.body.sourceRevisionId}])),
      officialAssertions:officialAssertions(p.id)})),
    ...registryParcelRows.map(p=>({id:p.id,applicationId:p.identifier,kind:'parcel' as const,revision:p.revision,authority:'registry_record' as const,
      relationship:[...new Set(scope.dossier.records.flatMap(r=>r.links.filter(l=>l.targetId===p.id).map(l=>l.type)))].sort().join(', '),
      associationState:'recorded_link',sources:cite(sourceIds(p.body.evidence)),officialAssertions:officialAssertions(p.id,p.body)})),
  ];
  if(referenced.size>1000)limit();
  const sources:Row[]=[];
  for(const id of [...referenced].sort())sources.push(await registrySourceTx(client,root.site_id,id));
  const report=ConsolidatedRegistryReportSchema.parse({schemaVersion:'building-registry-summary/1',generatedAt,
    selection:{id:scope.selection.id,kind:scope.selection.kind},
    building:{id:root.id,applicationId:root.identifier,kind:'building',revision:root.revision,
      name:textField(root.body.name,rootSources),areaName:textField(root.area_name),areaRevision:root.area_revision,
      siteRevision:root.site_revision,recordedAt:date(root.recorded_at)},parcels,records:projectedRecords,
    sources:sources.map(s=>({id:s.id,revision:s.revision,sha256:s.sha256,profile:registryReportTextSafe(s.profile)?s.profile:'withheld',receivedAt:date(s.created_at)})),
    omissions:[
      'This report records registry facts and claims. Technical review and physical geometry do not establish ownership or official issuance.',
      'Residents and occupants are included only when explicitly recorded with evidence; ownership claims do not establish residency.',
      'Unknown means no value is recorded here. Absent, null, withheld and conflicting are distinct recorded states.',
      'Application identifiers are separate from official 2D parcel ULPIN assertions. Parcel links are explicit recorded associations; intersection is not used.',
      'Drawings, measurements, analytical findings, original pages, extracted text, contact details and identity numbers are omitted.',
    ]});
  if(Buffer.byteLength(JSON.stringify(report))>1024*1024)limit();
  const context=localRequestContext('consolidated-register');
  return {report,pin:fingerprint({root,associations,selectedRows,parcelRows,registryParcelRows,assertions,packages,sources,
    selection:report.selection,access:{principal:context.principal,accessViewId:context.accessViewId,policyVersion:context.policyVersion}})};
}
async function capture(buildingId:string,recordId:string|undefined,generatedAt:string) {
  const client=await pool().connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout='5s'");
    const result=await captureTx(client,buildingId,recordId,generatedAt);
    await client.query('COMMIT');return result;
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
}
export async function exportConsolidatedRegister(buildingId:string,format:string,recordId?:string):Promise<Response> {
  if(!['json','html','pdf'].includes(format))throw new AppError(422,'REGISTRY_REPORT_FORMAT','The consolidated profile supports json, html and pdf.');
  const generatedAt=new Date().toISOString(),snapshot=await capture(buildingId,recordId,generatedAt);
  let body:BodyInit,mime:string;
  if(format==='json'){body=JSON.stringify(snapshot.report,null,2);mime='application/json';}
  else {
    const html=consolidatedRegisterHtml(snapshot.report);
    if(format==='html'){body=html;mime='text/html; charset=utf-8';}
    else{body=await (await registerPdf(html)).arrayBuffer();mime='application/pdf';}
  }
  // Access, document lineage, facts and membership must still match after rendering.
  const current=await capture(buildingId,recordId,generatedAt);
  if(current.pin!==snapshot.pin)conflict('The registry or its source authority changed during report preparation. Retry.');
  return new Response(body,{headers:{'Content-Type':mime,'Cache-Control':'no-store',
    'Content-Disposition':`attachment; filename="building-${buildingId}-registry.${format}"`,
    'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; sandbox"}});
}
