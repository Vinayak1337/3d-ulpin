import {searchDatasetIdentifiers} from '@/lib/server/spatial-identifiers';
import {localRequest,datasetError} from '@/lib/server/spatial-dataset-http';
export const runtime='nodejs';
export async function GET(request:Request){try{localRequest(request);return Response.json({matches:await searchDatasetIdentifiers(new URL(request.url).searchParams.get('q')??'')},{headers:{'Cache-Control':'no-store'}});}catch(e){return datasetError(e);}}
