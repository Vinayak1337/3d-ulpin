import type {PoolClient} from 'pg';
import {RegistryMetadataSchema, type ImportPackage, type RegistryMetadata,
  type RegistryFactEvidence} from '@ulpin/contracts';
import {AppError, conflict} from '../../infrastructure/errors';
import {assertPackageDocumentAuthority,sourceOwnsArea} from '../areas/package-authority';
import {documentAuthorityTx, documentResultFreshnessTx, type DocumentPins} from '../usp/ingestion/document-authority';
import {assertSourceBuildingPackageAuthorityTx, isGeometryFreePackage,
  sourceBuildingOriginalAccessTx} from '../usp/ingestion/source-building-review';
import {ingestionBinding, assertIngestionBinding} from '../usp/ingestion/events';
import {isRetainedMapOriginal} from '../usp/ingestion/retained-map-original';
import {permitsConfirmedRetainedTableSourceTx, permitsDraftedMapSource, permitsReferenceRecordSource,
  permitsReferenceRightSource} from './registry-reference-policy';

const denied=()=>{throw new AppError(403,'REGISTRY_SOURCE_DENIED','This registry source context is unavailable.');};
/** `areaId`, when given, is the area being read, whose site is `siteId`: a source that records that area as its
 * converted layer's own map area (S9.5a) is read there although its batch case keeps the batch area's site. */
async function registrySourceContextTx(client:PoolClient,siteId:string,sourceId:string,areaId?:string) {
  const source=(await client.query(`SELECT s.*,c.site_id source_site_id,c.archived source_archived,
    c.revision case_revision,c.context case_context,c.frame case_frame,a.site_id own_area_site_id
    FROM sources s JOIN cases c ON c.id=s.case_id LEFT JOIN map_areas a ON a.id=$2::uuid
    WHERE s.id=$1`,[sourceId,areaId??null])).rows[0];
  const ownArea=!!areaId&&!!source&&source.own_area_site_id===siteId&&sourceOwnsArea(source,areaId);
  if(!source||(source.source_site_id!==siteId&&!ownArea)||source.source_archived)denied();
  const binding=ingestionBinding(source.case_id);
  const owners=[source.inspection?.actor,source.inspection?.largeOriginal?.operatorSubject,source.inspection?.documentOriginal?.subject];
  if(owners.some(owner=>owner&&owner!==binding.subject))denied();
  const confirmedTable=!isRetainedMapOriginal(source)&&await permitsConfirmedRetainedTableSourceTx(client,source,binding);
  return {source,binding,confirmedTable};
}
async function registrySourceAuthorityTx(client:PoolClient,
  {source,binding,confirmedTable}:Awaited<ReturnType<typeof registrySourceContextTx>>,pins:DocumentPins='current') {
  if(source.profile==='large-original-v1'&&!isRetainedMapOriginal(source)&&!confirmedTable)
    throw new AppError(409,'REGISTRY_SOURCE_UNAVAILABLE','A cited source is not currently available.');
  await documentAuthorityTx(client,source,'snapshot',new Set(),false,pins);
  assertIngestionBinding(binding);
  return {...source,accessSha256:binding.access};
}
/** Citation access only: callers must also check the exact accepted document result.
 * Canonical extraction remains needs_input until ordinary recording evidence is approved. */
export async function registryDocumentSourceAccessTx(client:PoolClient,siteId:string,sourceId:string,
  areaId?:string) {
  return registrySourceAuthorityTx(client,await registrySourceContextTx(client,siteId,sourceId,areaId));
}
/** The existing private source authority, including copied document lineage. No locks or writes. */
export async function registrySourceTx(client:PoolClient,siteId:string,sourceId:string,pins:DocumentPins='current') {
  const context=await registrySourceContextTx(client,siteId,sourceId),{source}=context;
  const nativeArea=source.status==='inspected'&&source.inspection?.status==='interpreted'&&
    ['geojson-area-v2','gpkg-area-v2','shapefile_zip-area-v2','csv-area-v2'].includes(source.profile);
  if(!['ready','partial'].includes(source.status)&&!nativeArea&&!context.confirmedTable&&
    !permitsDraftedMapSource(source)&&!permitsReferenceRecordSource(source,'record')&&
    !permitsReferenceRightSource(source,'right'))
    throw new AppError(409,'REGISTRY_SOURCE_UNAVAILABLE','A cited source is not currently available.');
  return registrySourceAuthorityTx(client,context,pins);
}
/** Read of a source that a recorded fact already cites; nothing is derived or written. An original pinned by a
 * geometry-free package keeps the original-only authority it was recorded under (as the canonical read does), and
 * every other source keeps the ordinary authority without requiring current document pins. `documentResult` is set
 * only when a document result retained beside the source is no longer current; it is stated, never repaired.
 * Archived, denied and changed originals still refuse with their own codes. No locks or writes. */
export async function registryRecordedSourceTx(client:PoolClient,siteId:string,sourceId:string) {
  const pinned=(await client.query(
    "SELECT 1 FROM import_packages WHERE body->>'geometryFree'='true' AND body->'sourceRevisionIds' ? $1 LIMIT 1",
    [sourceId])).rows.length>0;
  // A retained table has upload/confirmation authority, never document-original authority.
  const pinnedSource=pinned?(await client.query('SELECT * FROM sources WHERE id=$1',[sourceId])).rows[0]:undefined;
  const retainedTable=pinnedSource?.profile==='large-original-v1'&&!isRetainedMapOriginal(pinnedSource);
  const source=pinned&&!retainedTable?await sourceBuildingOriginalAccessTx(client,siteId,sourceId)
    :await registrySourceTx(client,siteId,sourceId,'retained');
  const freshness=await documentResultFreshnessTx(client,source);
  return {...source,documentResult:freshness&&!freshness.current?freshness:undefined};
}
/** Read authority for a package that names a recorded feature: a geometry-free package keeps its original-only
 * pins (as getPackage does); every other package keeps the staged-document authority unchanged. */
export async function assertRecordedPackageTx(client:PoolClient,pkg:ImportPackage) {
  if(isGeometryFreePackage(pkg))await assertSourceBuildingPackageAuthorityTx(client,pkg.id);
  else await assertPackageDocumentAuthority(client,pkg);
}
export function registryMetadataEvidence(metadata:RegistryMetadata):RegistryFactEvidence[] {
  return [...Object.values(metadata.address??{}).flatMap(fact=>fact?.evidence??[]),
    ...(metadata.occupancy?.evidence??[]),...(metadata.occupancy?.people.flatMap(person=>person.evidence)??[])];
}
/** Optional facts travel through the canonical draft, review and commit, never a person store. */
export async function assertRegistryMetadataTx(client:PoolClient,siteId:string,kind:string,metadata?:RegistryMetadata,
  readSource:(client:PoolClient,siteId:string,sourceId:string)=>ReturnType<typeof registrySourceTx>=registrySourceTx) {
  if(!metadata)return;
  const parsed=RegistryMetadataSchema.parse(metadata);
  if(kind==='parcel'&&parsed.occupancy)
    throw new AppError(422,'REGISTRY_OCCUPANCY_SCOPE','Record occupants on an explicitly linked building, floor or space.');
  const sources=new Map<string,Awaited<ReturnType<typeof registrySourceTx>>>();
  for(const evidence of registryMetadataEvidence(parsed)) {
    let source=sources.get(evidence.sourceId);
    if(!source){source=await readSource(client,siteId,evidence.sourceId);sources.set(evidence.sourceId,source);}
    if(source.revision!==evidence.sourceRevision||source.sha256!==evidence.sourceSha256)
      conflict('A registry fact does not match its exact source revision and hash.');
  }
}
