import {ZodError} from 'zod';
import {localRequest} from './spatial-core-http';
export function datasetError(error:unknown){
 const e=error as {status?:number;message?:string};
 const status=e.status??(error instanceof SyntaxError||error instanceof ZodError||error instanceof URIError?422:500);
 return Response.json({error:{message:error instanceof ZodError?'Provide valid identifiers and request details.':status<500?e.message:'Unable to access saved datasets. Check the local storage services.'}},{status,headers:{'Cache-Control':'no-store'}});
}
export {localRequest};
export async function readPackageBody(request:Request,max=20*1024*1024){
 const reader=request.body?.getReader();
 if(!reader)throw Object.assign(new Error('Choose a package.'),{status:400});
 const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw Object.assign(new Error(`Request exceeds ${max} bytes.`),{status:413});}chunks.push(value);}}
 finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
