import {RegistryMetadataSchema,type DocumentAssociationTarget} from '@ulpin/contracts';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import {UspSnapshotManifestSchema,type RequestContext,type SnapshotScope,type TargetPin} from '@ulpin/contracts/usp';
import {transaction,type DbDeadline} from '../../../infrastructure/db';
import {AppError,conflict} from '../../../infrastructure/errors';
import {canonical,fingerprint} from '../../cases/domain';
import {lockSourceCaseDestinationTx} from '../../cases/source-case-lock';
import {registrySourceTx,registryDocumentSourceAccessTx,registryMetadataEvidence} from '../../registry/registry-metadata';
import {assertLocalUsp,assertSnapshotDocumentsTx,readManifest,readSnapshotBody,resolveRegistryTarget,storedRevision} from '../snapshots';

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
/** Exact raw comparison stays inside this assertion; no captured private body is returned. */
export async function assertAssociationSnapshotTargetTx(client:PoolClient,scope:SnapshotScope,pin:TargetPin,current:Row|undefined){
  const saved=(await client.query(`SELECT body,body_sha256 FROM usp_snapshot_bodies
    WHERE manifest_id=$1 AND namespace='registry_record' AND object_id=$2 AND revision=$3`,
    [scope.manifestId,pin.ref.id,pin.revision])).rows[0];
  if(!saved||fingerprint(saved.body)!==saved.body_sha256)
    conflict('The exact captured target revision is unavailable.');
  assertCurrentAssociationTarget(saved.body as Row,current,pin,scope);
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
      await assertAssociationSnapshotTargetTx(client,scope,pin,current);
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

/** Proposal authority: protect the WHOLE set through the last target/site check.
 * Existing serving readers still build the projection; their sequential reads
 * are not authority until this bounded, caller-owned check has completed.
 * Discovery is unlocked. Acquire every case gate before destination/row locks,
 * then reject drift rather than discovering additional gates under those locks.
 * The transaction ends before the caller can perform provider I/O. */
export async function associationTargetAuthority(ctx:RequestContext,scope:SnapshotScope|null,pins:readonly TargetPin[],
  citationSourceIds:readonly string[],deadline:DbDeadline):Promise<DocumentAssociationTarget[]>{
  assertLocalUsp(ctx);if(!scope)return [];
  const limit=()=>{throw new AppError(413,'DOCUMENT_ASSOCIATION_TARGET_LIMIT','Select a smaller evidence context.');};
  if(pins.length>8||citationSourceIds.length>8)limit();
  const targets=await associationTargets(ctx,scope,pins),manifest=await readManifest(ctx,scope);
  await transaction(async client=>{
    const snapshotSources=(await client.query(`SELECT body,body_sha256 FROM usp_snapshot_bodies
      WHERE manifest_id=$1 AND namespace='source_revision' ORDER BY object_id`,[scope.manifestId])).rows;
    if(snapshotSources.length>2000)limit();
    const ordinary=new Set<string>(),seeds=new Set(citationSourceIds),targetBodies=new Map<string,string>();
    const capturedSources:Record<string,any>[]=[];
    for(const pin of pins){
      const saved=(await client.query(`SELECT body,body_sha256 FROM usp_snapshot_bodies
        WHERE manifest_id=$1 AND namespace='registry_record' AND object_id=$2 AND revision=$3`,
        [scope.manifestId,pin.ref.id,pin.revision])).rows[0];
      if(!saved||fingerprint(saved.body)!==saved.body_sha256)conflict('The exact captured target revision is unavailable.');
      const member=manifest.members.find(member=>canonical(member.pin)===canonical(pin));
      if(!member||member.bodySha256!==saved.body_sha256)conflict('The captured target differs from its manifest.');
      targetBodies.set(pin.ref.id,fingerprint(saved));
      for(const id of sourceIds(saved.body.body)){ordinary.add(id);seeds.add(id);}
    }
    for(const saved of snapshotSources){
      if(fingerprint(saved.body)!==saved.body_sha256)conflict('The exact captured source revision is unavailable.');
      seeds.add(saved.body.id);capturedSources.push(saved.body);
    }
    // Include both retained and current copied-source lineage, as used by the
    // canonical document authority. Bound the union as well as lineage depth.
    const ids=new Set<string>(),sources=new Map<string,Record<string,any>>();
    let pending=[...seeds];
    for(const captured of capturedSources)if(captured.inspection?.copiedFrom?.sourceRevisionId)
      pending.push(captured.inspection.copiedFrom.sourceRevisionId);
    for(let depth=0;pending.length;depth++){
      if(depth>=8)limit();
      const batch=[...new Set(pending.map(id=>z.uuid().parse(id).toLowerCase()))].filter(id=>!ids.has(id)).sort();
      pending=[];for(const id of batch)ids.add(id);if(ids.size>2048)limit();
      if(!batch.length)break;
      const rows=(await client.query('SELECT * FROM sources WHERE id=ANY($1::uuid[]) ORDER BY id',[batch])).rows;
      for(const row of rows){sources.set(row.id,row);
        if(row.inspection?.copiedFrom?.sourceRevisionId)pending.push(row.inspection.copiedFrom.sourceRevisionId);}
    }
    const cases=[...new Set([...sources.values()].map(row=>z.uuid().parse(row.case_id).toLowerCase()))].sort();
    for(const caseId of cases)await lockSourceCaseDestinationTx(client,caseId);
    // SHARE blocks archive/context updates and source-family writers' UPDATE
    // locks, but remains compatible with snapshot capture's source-order SHARE.
    await client.query('SELECT id FROM cases WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE',[cases]);
    // Protect the destination before records, matching canonical recording.
    await client.query('SELECT id FROM registry_sites WHERE id=$1 FOR SHARE',[scope.scopeId]);
    const recordIds=pins.map(pin=>pin.ref.id).sort();
    await client.query('SELECT id FROM registry_records WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE',[recordIds]);
    // Identity writers lock the record even when its optional identity row is
    // absent. Read joined identities only AFTER these protections are held.
    await client.query('SELECT record_id FROM usp_project_codes WHERE record_id=ANY($1::uuid[]) ORDER BY record_id FOR SHARE',[recordIds]);
    await client.query('SELECT record_id FROM usp_project_identity_state WHERE record_id=ANY($1::uuid[]) ORDER BY record_id FOR SHARE',[recordIds]);
    const lockedManifest=(await client.query(`SELECT body FROM usp_snapshots
      WHERE id=$1 AND scope_id=$2 AND digest=$3 FOR SHARE`,[scope.manifestId,scope.scopeId,scope.snapshotDigest])).rows[0];
    if(!lockedManifest||fingerprint(UspSnapshotManifestSchema.parse(lockedManifest.body))!==fingerprint(manifest))
      conflict('The exact snapshot manifest changed.');
    const lockedSnapshots=(await client.query(`SELECT body,body_sha256 FROM usp_snapshot_bodies
      WHERE manifest_id=$1 AND namespace='source_revision' ORDER BY object_id FOR SHARE`,[scope.manifestId])).rows;
    if(fingerprint(lockedSnapshots)!==fingerprint(snapshotSources))conflict('The captured source population changed.');
    const lockedSources=(await client.query('SELECT * FROM sources WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE',
      [[...ids].sort()])).rows;
    if(fingerprint(lockedSources)!==fingerprint([...sources.values()].sort((a,b)=>a.id.localeCompare(b.id))))
      conflict('The evidence-source authority changed. Refresh the selection.');
    // Protect every accepted job consulted by snapshot/ordinary/citation lineage
    // authority, including a retained snapshot's distinct historical receipt.
    const jobs=[...new Set([...capturedSources,...lockedSources].flatMap(row=>
      row.inspection?.documentAccepted?.jobId?[z.uuid().parse(row.inspection.documentAccepted.jobId).toLowerCase()]:[]))].sort();
    if(jobs.length){
      await client.query('SELECT id FROM jobs WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE',[jobs]);
      await client.query('SELECT job_id FROM usp_job_metadata WHERE job_id=ANY($1::uuid[]) ORDER BY job_id FOR SHARE',[jobs]);
      await client.query('SELECT job_id FROM usp_job_attempts WHERE job_id=ANY($1::uuid[]) ORDER BY job_id,fence FOR SHARE',[jobs]);
    }
    for(const pin of [...pins].sort((a,b)=>a.ref.id.localeCompare(b.ref.id))){
      const locked=(await client.query(`SELECT body,body_sha256 FROM usp_snapshot_bodies WHERE manifest_id=$1
        AND namespace='registry_record' AND object_id=$2 AND revision=$3 FOR SHARE`,[scope.manifestId,pin.ref.id,pin.revision]));
      if(fingerprint(locked.rows[0])!==targetBodies.get(pin.ref.id))conflict('The captured target body changed.');
      const current=(await client.query(`SELECT r.id,r.site_id,r.kind,r.identifier,r.revision,r.body,
        c.code project_code,c.status project_status,s.location project_location FROM registry_records r
        LEFT JOIN usp_project_codes c ON c.record_id=r.id LEFT JOIN usp_project_identity_state s ON s.record_id=r.id
        WHERE r.id=$1 AND r.site_id=$2 FOR SHARE OF r`,[pin.ref.id,scope.scopeId])).rows[0];
      await assertAssociationSnapshotTargetTx(client,scope,pin,current);
    }
    await assertSnapshotDocumentsTx(client,ctx,scope);
    for(const id of [...ordinary].sort())await registrySourceTx(client,scope.scopeId,id);
    for(const id of [...new Set(citationSourceIds)].sort())await registryDocumentSourceAccessTx(client,scope.scopeId,id);
    assertLocalUsp(ctx);
    if(manifest.accessViewId!==ctx.accessViewId||manifest.policyVersion!==ctx.policyVersion)
      throw new AppError(403,'USP_ACCESS_CHANGED','Access changed. Refresh the selection.');
  },deadline);
  assertLocalUsp(ctx);return targets;
}
