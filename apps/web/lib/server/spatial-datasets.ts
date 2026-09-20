import {randomUUID} from 'node:crypto';
import {normalizeReferencePackage} from '../../features/spatial/reference-import/browser';
import {query,transaction} from './db';
import {putOriginal,readObject,sha256} from './storage';
import {originalAttempt} from './original-attempt';
import {ensureSpatialDatasets} from './spatial-dataset-db';
import {AppError,notFound} from './errors';
import type {SavedSpatialDataset} from '../spatial-datasets';
const columns=`id,name,original_name AS "originalName",sha256,digest,revision,classification,building_count AS "buildingCount",floor_count AS "floorCount",source_count AS "sourceCount",created_at AS "createdAt"`;
export async function listSpatialDatasets():Promise<SavedSpatialDataset[]>{
 await ensureSpatialDatasets();return (await query<SavedSpatialDataset>(`SELECT ${columns} FROM spatial_datasets ORDER BY created_at,id`)).rows;
}
export async function getSpatialDataset(id:string){
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))notFound('Dataset not found.');
 await ensureSpatialDatasets();const row=(await query<SavedSpatialDataset>(`SELECT ${columns} FROM spatial_datasets WHERE id=$1`,[id])).rows[0];
 if(!row)notFound('Dataset not found.');return row;
}
export async function readSpatialDatasetOriginal(id:string){
 const dataset=await getSpatialDataset(id);
 const source=(await query('SELECT s.object_key,s.bytes FROM sources s JOIN spatial_datasets d ON d.original_source_id=s.id WHERE d.id=$1',[id])).rows[0];
 const bytes=await readObject(source.object_key);
 if(bytes.length!==Number(source.bytes)||sha256(bytes)!==dataset.sha256)throw new AppError(409,'SOURCE_INTEGRITY','Stored package failed its original fingerprint check.');
 return {dataset,bytes};
}
export async function saveSpatialDataset(name:string,bytes:Uint8Array):Promise<SavedSpatialDataset>{
 if(!name||name.length>180||/[\\/\x00-\x1f]/.test(name))throw new AppError(422,'PACKAGE_NAME','Use a plain ZIP or JSON filename.');
 // Complete validation before creating rows or storing objects; never trust a client snapshot.
 let imported:Awaited<ReturnType<typeof normalizeReferencePackage>>;
 try{imported=await normalizeReferencePackage(name,bytes);}catch{throw new AppError(422,'PACKAGE_INVALID','Package validation failed. Open the import receipt to review its format and source fingerprints.');}
 const scene=imported.render.scene,hash=imported.receipt.originalSha256;
 const sourceByPath=new Map(scene.sources.map(s=>[typeof s.originalUri==='string'?s.originalUri.replace(/^dataset\//,''):undefined,s]));
 const id=randomUUID(),caseId=randomUUID(),packageSourceId=randomUUID();
 await ensureSpatialDatasets();
 return originalAttempt('sources',packageSourceId,remember=>transaction(async client=>{
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`spatial-dataset:${hash}`]);
  const prior=(await client.query<SavedSpatialDataset>(`SELECT ${columns} FROM spatial_datasets WHERE sha256=$1`,[hash])).rows[0];
  if(prior)return prior;
  const frame=scene.frames[0];
  await client.query('INSERT INTO cases(id,name,description,frame) VALUES($1,$2,$3,$4)',[caseId,scene.metadata.title,'Saved fictional spatial dataset. Source assertions require review; no registry publication.',{...frame,horizontalUnit:'m',verticalUnit:'m',benchmark:frame.verticalDatum}]);
  async function store(sourceId:string,path:string,data:Uint8Array,mime:string,inspection:unknown){
   const fileHash=sha256(data),objectKey=`sources/${sourceId}/${fileHash}`;
   remember(objectKey);await putOriginal(objectKey,data,mime);
   await client.query(`INSERT INTO sources(id,case_id,family_id,revision,name,profile,mime_type,bytes,sha256,object_key,status,inspection) VALUES($1,$2,$1,1,$3,'spatial-package-v1',$4,$5,$6,$7,'needs_input',$8)`,[sourceId,caseId,path,mime,data.length,fileHash,objectKey,inspection]);
  }
  await store(packageSourceId,name,bytes,name.endsWith('.zip')?'application/zip':'application/json',{kind:'spatial_package',digest:scene.canonicalSnapshotDigest,worldStatus:'synthetic'});
  const bindings=[];
  for(const [path,data] of imported.receipt.files){
   const source=sourceByPath.get(path)??[...sourceByPath].find(([key])=>key&&path.endsWith('/'+key))?.[1];
   const sourceId=randomUUID();
   await store(sourceId,path,data,source?.mimeType??'application/octet-stream',{kind:'package_member',packageSourceId,canonicalSourceId:source?.id??null,sourceRevision:source?.revision??null,processing:source?.processing??'retained'});
   bindings.push({path,sourceRevisionId:sourceId,canonicalSourceId:source?.id??null,sha256:sha256(data)});
  }
  const result=await client.query<SavedSpatialDataset>(`INSERT INTO spatial_datasets(id,case_id,original_source_id,name,original_name,sha256,digest,classification,building_count,floor_count,source_count,normalized_source,canonical_input,snapshot_manifest,source_bindings,diagnostics) VALUES($1,$2,$3,$4,$5,$6,$7,'synthetic',$8,$9,$10,$11,$12,$13,$14,$15) RETURNING ${columns}`,[id,caseId,packageSourceId,scene.metadata.title,name,hash,scene.canonicalSnapshotDigest,scene.objects.filter(o=>o.type==='building').length,scene.objects.filter(o=>o.type==='floor').length,scene.sources.length,JSON.parse(imported.receipt.normalizedText),imported.canonical.input,imported.canonical.snapshot.manifest,JSON.stringify(bindings),JSON.stringify(imported.canonical.diagnostics)]);
  return result.rows[0];
 }));
}
