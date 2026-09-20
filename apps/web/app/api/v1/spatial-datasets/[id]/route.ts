import {ensureDatasetIdentifiers} from '@/lib/server/spatial-identifiers';
import {getSpatialDataset,readSpatialDatasetOriginal} from '@/lib/server/spatial-datasets';
import {localRequest,datasetError} from '@/lib/server/spatial-dataset-http';
export const runtime='nodejs';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){try{
 localRequest(request);const {id}=await params;
 if(new URL(request.url).searchParams.get('identifiers')==='1'){await getSpatialDataset(id);return Response.json(await ensureDatasetIdentifiers(id),{headers:{'Cache-Control':'no-store'}});}
 if(new URL(request.url).searchParams.get('original')==='1'){
  const {dataset,bytes}=await readSpatialDatasetOriginal(id);
  return new Response(new Uint8Array(bytes),{headers:{'Content-Type':dataset.originalName.endsWith('.zip')?'application/zip':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(dataset.originalName)}`,'X-Source-SHA256':dataset.sha256}});
 }
 return Response.json(await getSpatialDataset(id),{headers:{'Cache-Control':'no-store'}});
}catch(e){return datasetError(e);}}
