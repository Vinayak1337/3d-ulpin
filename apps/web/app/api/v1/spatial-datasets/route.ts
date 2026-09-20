import {listSpatialDatasets,saveSpatialDataset} from '@/lib/server/spatial-datasets';
import {localRequest,datasetError,readPackageBody} from '@/lib/server/spatial-dataset-http';
export const runtime='nodejs';
export async function GET(request:Request){try{localRequest(request);return Response.json(await listSpatialDatasets(),{headers:{'Cache-Control':'no-store'}});}catch(e){return datasetError(e);}}
export async function POST(request:Request){try{localRequest(request);const name=decodeURIComponent(request.headers.get('x-file-name')??'');const bytes=await readPackageBody(request);return Response.json(await saveSpatialDataset(name,bytes),{status:201,headers:{'Cache-Control':'no-store'}});}catch(e){return datasetError(e);}}
