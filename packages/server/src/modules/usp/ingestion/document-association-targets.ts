import {RegistryMetadataSchema,type DocumentAssociationTarget} from '@ulpin/contracts';
import type {RequestContext,SnapshotScope,TargetPin} from '@ulpin/contracts/usp';
import {transaction} from '../../../infrastructure/db';
import {AppError,conflict} from '../../../infrastructure/errors';
import {canonical,fingerprint} from '../../cases/domain';
import {registrySourceTx,registryMetadataEvidence} from '../../registry/registry-metadata';
import {assertLocalUsp,readManifest,readSnapshotBody,resolveRegistryTarget,storedRevision} from '../snapshots';

type Row={id:string;site_id:string;kind:string;identifier:string;revision:number;body:Record<string,any>;
  projectIdentity?:{code:string;status:string|null|undefined;location:unknown}|null;project_code?:string|null;
  project_status?:string|null;project_location?:unknown};
const identity=(row:Row,captured=false)=>captured?row.projectIdentity??null:
  row.project_code?{code:row.project_code,status:row.project_status,location:row.project_location}:null;
const shape=(row:Row,captured=false)=>({id:row.id,site:row.site_id,kind:row.kind,identifier:row.identifier,
  revision:storedRevision(row.revision),body:row.body,identity:identity(row,captured)});
/** Captured context remains useful only if its exact visible current record still agrees. */
export function assertCurrentAssociationTarget(captured:Row,current:Row|undefined,pin:TargetPin,scope:SnapshotScope){
  const priorIdentity=identity(captured,true);
  const normalizedCaptured={...captured,projectIdentity:priorIdentity?{
    code:priorIdentity.code,status:priorIdentity.status,location:priorIdentity.location}:null};
  if(!current || current.id!==pin.ref.id || current.site_id!==scope.scopeId ||
    storedRevision(current.revision)!==pin.revision || !['building','floor'].includes(current.kind) ||
    fingerprint(shape(current))!==fingerprint(shape(normalizedCaptured,true)))
    conflict('A selected building/floor context is absent or changed. Refresh its exact snapshot.');
}
function sourceIds(body:Row['body']){
  const refs=[...(body.evidence??[]),...(body.rights??[]).map((right:any)=>right.evidence),
    ...Object.values(body.geometry?.bindings??{})];
  const ids=new Set<string>();
  for(const ref of refs)if(ref && typeof ref.sourceId==='string')ids.add(ref.sourceId);
  if(body.registryMetadata)for(const ref of registryMetadataEvidence(RegistryMetadataSchema.parse(body.registryMetadata)))ids.add(ref.sourceId);
  if(ids.size>256)throw new AppError(413,'DOCUMENT_ASSOCIATION_TARGET_LIMIT','Select a smaller evidence context.');
  return ids;
}
/** Delegates snapshot membership/resolution and source access to existing readers. */
export async function associationTargets(ctx:RequestContext,scope:SnapshotScope|null,pins:readonly TargetPin[]):Promise<DocumentAssociationTarget[]>{
  assertLocalUsp(ctx);if(!scope)return [];
  const manifest=await readManifest(ctx,scope),targets:DocumentAssociationTarget[]=[];
  for(const pin of pins){
    if(manifest.selection.kind==='targets' && !manifest.selection.pins.some(selected=>canonical(selected)===canonical(pin)))
      conflict('A target lies outside the explicit snapshot selection.');
    const resolved=await resolveRegistryTarget(ctx,scope,pin);
    if(resolved.state!=='available')conflict('The exact selected target is unavailable.');
    const target=resolved.data;
    if(target.recordState!=='recorded')conflict('The selected target is not a current recorded building/floor.');
    if(target.kind!=='building' && target.kind!=='floor')
      throw new AppError(422,'DOCUMENT_ASSOCIATION_TARGET_KIND','Select a recorded building or floor.');
    const captured=await readSnapshotBody(ctx,scope,pin) as Row,ids=sourceIds(captured.body);
    await transaction(async client=>{
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      const current=(await client.query(`SELECT r.id,r.site_id,r.kind,r.identifier,r.revision,r.body,
        c.code project_code,c.status project_status,s.location project_location FROM registry_records r
        LEFT JOIN usp_project_codes c ON c.record_id=r.id LEFT JOIN usp_project_identity_state s ON s.record_id=r.id
        WHERE r.id=$1 AND r.site_id=$2`,[pin.ref.id,scope.scopeId])).rows[0] as Row|undefined;
      assertCurrentAssociationTarget(captured,current,pin,scope);
      for(const id of ids)await registrySourceTx(client,scope.scopeId,id);
      assertLocalUsp(ctx);
    });
    const relations=target.relations.filter(relation=>pins.some(selected=>canonical(selected)===canonical(relation.target)));
    targets.push({pin:target.pin,kind:target.kind,label:target.label,identifiers:target.identifiers,
      recordState:target.recordState,relationsWithinSelection:relations,
      relationshipCoverage:Array.isArray(captured.body.links) && relations.length===captured.body.links.length?'complete':'partial',
      sourceEvidence:ids.size?'available':'unavailable',synthetic:typeof captured.body.synthetic==='boolean'?captured.body.synthetic:null});
  }
  assertLocalUsp(ctx);return targets;
}
