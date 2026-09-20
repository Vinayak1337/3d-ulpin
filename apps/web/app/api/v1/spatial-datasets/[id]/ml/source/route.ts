import {attachDatasetMlSource} from '@/lib/server/dataset-ml';
import {localRequest,datasetError,readPackageBody} from '@/lib/server/spatial-dataset-http';
export const runtime='nodejs';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 try{localRequest(request);const {id}=await params;const name=decodeURIComponent(request.headers.get('X-File-Name')??'');const bytes=await readPackageBody(request,16*1024*1024);return Response.json(await attachDatasetMlSource(id,name,bytes,request.headers.get('X-Request-Key')??''),{status:201});}catch(e){return datasetError(e);}
}
