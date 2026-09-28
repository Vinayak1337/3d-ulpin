/** Install retained NYC source bytes through the same HTTP/SSE transport as an upload. */
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
const profile=JSON.parse(await readFile(new URL('./nyc-profile.json',import.meta.url),'utf8'));
const directory=process.argv[2];
if(!directory)throw new Error('Pass the directory containing the eight NYC profile files.');
const base=process.env.ULPIN_DEMO_BASE??'http://127.0.0.1:3190';
const endpoint=new URL(base);
if(endpoint.protocol!=='http:'||!['127.0.0.1','localhost'].includes(endpoint.hostname))throw new Error('Installation must use the local demo transport.');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const form=new FormData();
form.set('intent','oci-nyc-10013-'+sha(profile.layers.map(x=>x.sha256).sort().join(':')));
for(const layer of profile.layers){const bytes=await readFile(join(directory,layer.name));if(sha(bytes)!==layer.sha256)throw new Error('Original hash mismatch: '+layer.name);form.append('file',new Blob([bytes]),layer.name);}
const response=await fetch(base+'/api/demo/imports',{method:'POST',body:form,signal:AbortSignal.timeout(30_000)});
const job=await response.json();if(!response.ok)throw new Error(job.message??'Import was rejected.');
const abort=new AbortController();const timer=setTimeout(()=>abort.abort(),180_000);
let total=0,batches=0,complete=false;
try{
  const stream=await fetch(`${base}/api/demo/areas/${job.areaId}/events`,{signal:abort.signal});
  if(!stream.ok)throw new Error('SSE did not start.');
  const reader=stream.body.getReader(),decoder=new TextDecoder();let buffer='';
  while(!complete){
    const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});
    let pos;
    while((pos=buffer.indexOf('\n\n'))!==-1){
      const event=buffer.slice(0,pos);buffer=buffer.slice(pos+2);
      const kind=/^event: (.+)$/m.exec(event)?.[1],raw=/^data: (.+)$/m.exec(event)?.[1];if(!raw)continue;
      const data=JSON.parse(raw);
      if(kind==='failed')throw new Error(data.message??'Normalization failed.');
      if(kind==='chunk'){
        batches++;total+=data.features.length;
        const ack=await fetch(`${base}/api/demo/areas/${job.areaId}/ack`,{method:'POST'});if(!ack.ok)throw new Error('Chunk acknowledgement failed.');
      }
      if(kind==='snapshot'){total=data.context?.displayFeatures?.length??0;complete=data.package?.state==='READY_FOR_REVIEW';}
      if(kind==='complete')complete=true;
    }
  }
  await reader.cancel();
}finally{clearTimeout(timer);abort.abort();}
if(!complete||total!==2363)throw new Error(`Incomplete NYC area: ${total} features.`);
const result=await fetch(`${base}/api/demo/areas/${job.areaId}/datasets`);const datasets=await result.json();
if(!result.ok||datasets.sources.length!==8||profile.layers.some(l=>!datasets.sources.some(s=>s.hash===l.sha256)))throw new Error('Installed sources differ from the retained eight-file profile.');
console.log(JSON.stringify({areaId:job.areaId,packageId:job.id,features:total,sources:datasets.sources.length,newBatches:batches,state:'READY_FOR_REVIEW'}));
