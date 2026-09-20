import {query,transaction} from './db';
import {ensureSpatialDatasets} from './spatial-dataset-db';
import {assignApplicationIdentifiers,type ApplicationIdentifier} from '../../features/spatial/reference-runtime/application-identifiers';

/** Additive index over retained snapshots. No source geometry or original bytes are edited. */
export async function ensureDatasetIdentifiers(datasetId:string):Promise<ApplicationIdentifier[]> {
 await ensureSpatialDatasets();
 return transaction(async client=>{
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`spatial-identifiers:${datasetId}`]);
  const dataset=(await client.query('SELECT sha256,normalized_source,identifiers_version FROM spatial_datasets WHERE id=$1',[datasetId])).rows[0];
  if(!dataset)throw new Error('Dataset not found.');
  if(dataset.identifiers_version!==1){
   const assignments=await assignApplicationIdentifiers(dataset.normalized_source,dataset.sha256);
   for(const assignment of assignments){
    await client.query('INSERT INTO spatial_dataset_identifiers(dataset_id,object_id,identifier,record) VALUES($1,$2,$3,$4)',[datasetId,assignment.objectId,assignment.identifier,assignment]);
   }
   await client.query('UPDATE spatial_datasets SET identifiers_version=1 WHERE id=$1',[datasetId]);
  }
  return (await client.query<{record:ApplicationIdentifier}>('SELECT record FROM spatial_dataset_identifiers WHERE dataset_id=$1 ORDER BY object_id',[datasetId])).rows.map(r=>r.record);
 });
}
export async function searchDatasetIdentifiers(queryText:string){
 const q=queryText.trim().toLowerCase();if(!q||q.length>150)return [];
 await ensureSpatialDatasets();
 const pending=(await query('SELECT id FROM spatial_datasets WHERE archived_at IS NULL AND identifiers_version IS DISTINCT FROM 1')).rows;
 for(const row of pending)await ensureDatasetIdentifiers(row.id);
 // Literal substring matching, so % and _ in source IDs are not wildcards.
 const rows=(await query<{datasetId:string;datasetName:string;record:ApplicationIdentifier}>(`SELECT d.id AS "datasetId", d.name AS "datasetName", i.record
 FROM spatial_dataset_identifiers i JOIN spatial_datasets d ON d.id=i.dataset_id WHERE d.archived_at IS NULL AND (
 strpos(lower(i.identifier),$1)>0 OR strpos(lower(i.record->>'label'),$1)>0 OR
 EXISTS(SELECT 1 FROM jsonb_array_elements_text(i.record->'aliases') a WHERE strpos(lower(a),$1)>0) OR
 (i.record->>'floorId' IS NULL AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(i.record->'twoDIds') a WHERE strpos(lower(a),$1)>0)))
 ORDER BY (lower(i.identifier)=$1) DESC,d.created_at,i.object_id LIMIT 20`,[q])).rows;
 return rows.map(({datasetId,datasetName,record})=>({...record,datasetId,datasetName:datasetName.split(' · ')[0],href:`/studio/showcase?saved=${encodeURIComponent(datasetId)}&building=${encodeURIComponent(record.buildingId)}${record.floorId?`&floor=${encodeURIComponent(record.floorId)}`:''}`}));
}
