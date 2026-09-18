import {handleStudioSource} from '@/lib/server/studio-sources';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request,context:{params:Promise<{asset:string[]}>}){return handleStudioSource(request,(await context.params).asset);}
