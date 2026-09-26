import {query} from '../../infrastructure/db';
import {readObject,sha256} from '../../infrastructure/storage';
import {ensureSpatialDatasets} from './spatial-dataset-db';
import {AppError,notFound} from '../../infrastructure/errors';
import {sourceProvenance,type SavedSpatialDataset} from '../../shared/spatial-datasets';
const columns=`id,name,original_name AS "originalName",sha256,digest,revision,classification,building_count AS "buildingCount",floor_count AS "floorCount",source_count AS "sourceCount",created_at AS "createdAt"`;
type SpatialDatasetRow=Omit<SavedSpatialDataset,'provenance'>;
const withProvenance=(row:SpatialDatasetRow):SavedSpatialDataset=>({...row,provenance:sourceProvenance(row.classification,true)});
export async function listSpatialDatasets():Promise<SavedSpatialDataset[]>{
 await ensureSpatialDatasets();return (await query<SpatialDatasetRow>(`SELECT ${columns} FROM spatial_datasets WHERE archived_at IS NULL ORDER BY created_at,id`)).rows.map(withProvenance);
}
export async function getSpatialDataset(id:string){
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))notFound('Dataset not found.');
 await ensureSpatialDatasets();const row=(await query<SpatialDatasetRow>(`SELECT ${columns} FROM spatial_datasets WHERE id=$1`,[id])).rows[0];
 if(!row)notFound('Dataset not found.');return withProvenance(row);
}
export async function readSpatialDatasetOriginal(id:string){
 const dataset=await getSpatialDataset(id);
 const source=(await query('SELECT s.object_key,s.bytes FROM sources s JOIN spatial_datasets d ON d.original_source_id=s.id WHERE d.id=$1',[id])).rows[0];
 const bytes=await readObject(source.object_key);
 if(bytes.length!==Number(source.bytes)||sha256(bytes)!==dataset.sha256)throw new AppError(409,'SOURCE_INTEGRITY','Stored package failed its original fingerprint check.');
 return {dataset,bytes};
}
/** The former writer always classified intake as synthetic; neither native nor compatibility transport may create new rows through it. */
export async function saveSpatialDataset(_name:string,_bytes:Uint8Array):Promise<SavedSpatialDataset>{
 throw new AppError(410,'RETIRED_SYNTHETIC_INTAKE','Synthetic-only saved dataset intake is retired. Use the existing official or provenance-backed import-package workflow; historical saved datasets and originals remain readable.');
}

/** Remove only from active directories; preserve originals and historical links. */
export async function archiveSpatialDataset(id:string){
 await getSpatialDataset(id);
 await query('UPDATE spatial_datasets SET archived_at=coalesce(archived_at,now()) WHERE id=$1',[id]);
}
