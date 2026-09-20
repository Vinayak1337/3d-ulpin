import {datasetMlOverview,queueDatasetMl,reviewDatasetMl,datasetMlArtifact} from '@/lib/server/dataset-ml';
import {localRequest,datasetError,readPackageBody} from '@/lib/server/spatial-dataset-http';
import {ZodError} from 'zod';
export const runtime='nodejs';
type Context={params:Promise<{id:string}>};
export async function GET(request:Request,{params}:Context){try{localRequest(request);const {id}=await params;const url=new URL(request.url);if(url.searchParams.has('artifact'))return await datasetMlArtifact(id,url.searchParams.get('run')??'',url.searchParams.get('artifact')??'');return Response.json(await datasetMlOverview(id),{headers:{'Cache-Control':'no-store'}});}catch(e){return datasetError(e);}}
export async function POST(request:Request,{params}:Context){try{localRequest(request);const {id}=await params;const body=JSON.parse(new TextDecoder().decode(await readPackageBody(request,100000)));const result=new URL(request.url).searchParams.get('action')==='review'?await reviewDatasetMl(id,body):await queueDatasetMl(id,body);return Response.json(result,{headers:{'Cache-Control':'no-store'}});}catch(e){if(e instanceof ZodError)return Response.json({error:{message:'Choose valid source IDs, pages and review details.'}},{status:422});return datasetError(e);}}
