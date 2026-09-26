import type {PoolClient} from 'pg';
import {RegistryMetadataSchema, type RegistryMetadata, type RegistryFactEvidence} from '@ulpin/contracts';
import {AppError, conflict} from '../../infrastructure/errors';
import {documentAuthorityTx} from '../usp/ingestion/document-authority';
import {ingestionBinding, assertIngestionBinding} from '../usp/ingestion/events';
import {permitsReferenceRecordSource, permitsReferenceRightSource} from './registry-reference-policy';

const denied=()=>{throw new AppError(403,'REGISTRY_SOURCE_DENIED','This registry source context is unavailable.');};
/** The existing private source authority, including copied document lineage. No locks or writes. */
export async function registrySourceTx(client:PoolClient,siteId:string,sourceId:string) {
  const source=(await client.query(`SELECT s.*,c.site_id source_site_id,c.archived source_archived,
    c.revision case_revision,c.context case_context,c.frame case_frame
    FROM sources s JOIN cases c ON c.id=s.case_id WHERE s.id=$1`,[sourceId])).rows[0];
  if(!source||source.source_site_id!==siteId||source.source_archived)denied();
  const binding=ingestionBinding(source.case_id);
  const owners=[source.inspection?.actor,source.inspection?.largeOriginal?.operatorSubject,source.inspection?.documentOriginal?.subject];
  if(owners.some(owner=>owner&&owner!==binding.subject))denied();
  const nativeArea=source.status==='inspected'&&source.inspection?.status==='interpreted'&&
    ['geojson-area-v2','gpkg-area-v2','shapefile_zip-area-v2','csv-area-v2'].includes(source.profile);
  if(!['ready','partial'].includes(source.status)&&!nativeArea&&
    !permitsReferenceRecordSource(source,'record')&&!permitsReferenceRightSource(source,'right'))
    throw new AppError(409,'REGISTRY_SOURCE_UNAVAILABLE','A cited source is not currently available.');
  await documentAuthorityTx(client,source);
  assertIngestionBinding(binding);
  return {...source,accessSha256:binding.access};
}
export function registryMetadataEvidence(metadata:RegistryMetadata):RegistryFactEvidence[] {
  return [...Object.values(metadata.address??{}).flatMap(fact=>fact?.evidence??[]),
    ...(metadata.occupancy?.evidence??[]),...(metadata.occupancy?.people.flatMap(person=>person.evidence)??[])];
}
/** Optional facts travel through the canonical draft, review and commit, never a person store. */
export async function assertRegistryMetadataTx(client:PoolClient,siteId:string,kind:string,metadata?:RegistryMetadata) {
  if(!metadata)return;
  const parsed=RegistryMetadataSchema.parse(metadata);
  if(kind==='parcel'&&parsed.occupancy)
    throw new AppError(422,'REGISTRY_OCCUPANCY_SCOPE','Record occupants on an explicitly linked building, floor or space.');
  const sources=new Map<string,Awaited<ReturnType<typeof registrySourceTx>>>();
  for(const evidence of registryMetadataEvidence(parsed)) {
    let source=sources.get(evidence.sourceId);
    if(!source){source=await registrySourceTx(client,siteId,evidence.sourceId);sources.set(evidence.sourceId,source);}
    if(source.revision!==evidence.sourceRevision||source.sha256!==evidence.sourceSha256)
      conflict('A registry fact does not match its exact source revision and hash.');
  }
}
