/** Local, opt-in demo transport. Never connects to PostgreSQL or any AI provider. */
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, rename } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { unzipSync } from 'fflate';
import { compareSimulatedPlan } from './plan-check.mjs';
import { layoutFor, residentsFor } from './sample-registry.mjs';
const profile=JSON.parse(readFileSync(new URL('./nyc-profile.json',import.meta.url),'utf8'));
const python=fileURLToPath(new URL('./normalize.py',import.meta.url));
const sha=b=>createHash('sha256').update(b).digest('hex');
const id=value=>{const h='d30d'+sha(value).slice(4,32);return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20)}`;};
const demoId=v=>/^d30d[0-9a-f]{4}-[0-9a-f-]{27}$/.test(v??'');
const MAX=32*1024*1024;

/** Floors, units, ledger and residents for a building that has a footprint and a roof height (sample registry). */
const sampleSources=new Map();
function outerRing(geometry){
  const polys=geometry?.type==='Polygon'?[geometry.coordinates]:geometry?.type==='MultiPolygon'?geometry.coordinates:[];
  let best=null,area=0;
  for(const poly of polys){const r=poly[0];let a=0;for(let i=0;i<r.length-1;i++)a+=r[i][0]*r[i+1][1]-r[i+1][0]*r[i][1];if(Math.abs(a)>area){area=Math.abs(a);best=r;}}
  return best;
}
function sampleBuilding(job,feature){
  if(feature.kind!=='building')return null;
  const layout=layoutFor(outerRing(feature.geometry),feature.height?.value);
  if(!layout)return null;
  const b=feature.id,key=feature.sourceKey,base=feature.identifier??`DOITT ${key}`;
  const props=feature.properties??{};
  const bbl=props.base_bbl??props.mpluto_bbl??null;
  const src=(name,kind)=>{const sid=id(`sample:${b}:${name}`);sampleSources.set(sid,{job,feature,name,kind});return sid;};
  const schedule=src('unit_schedule.csv','table'),levelsSrc=src('level_schedule.csv','table'),decl=src('condominium_declaration.pdf','document');
  const created=job.createdAt;
  const floors=layout.floors.map(f=>{
    const fid=id(`floor:${b}:${f.index}`);
    const fp=outerRing(feature.geometry);
    return {id:fid,identifier:`${base}/${f.label}`,ulpin3d:`${base}/${f.label}`,name:f.label,kind:'floor',revision:1,use:f.index===0&&layout.floors.length>2?'retail and lobby':'residential floor',footprint:fp,
      geometry:{id:fid,alias:f.label,name:f.label,kind:'level',footprint:fp,lower:+f.lower.toFixed(2),upper:+f.upper.toFixed(2),lowerVerified:true,upperVerified:true,bindings:{lower:{sourceId:levelsSrc,locator:`row ${f.index+1}`},upper:{sourceId:levelsSrc,locator:`row ${f.index+1}`}},revision:1,levelLabel:f.label},
      links:[{targetId:b,type:'within'}],evidence:[{sourceId:levelsSrc,locator:`row ${f.index+1}`}]};
  });
  const units=[];let row=0;
  layout.floors.forEach((f,i)=>{
    const retail=i===0&&layout.floors.length>2;
    for(const u of layout.units){
      row++;
      const name=retail?`Shop ${u.name}`:`Apt ${i===0?'G':i}${u.name}`;
      const uid=id(`unit:${b}:${i}:${u.name}`);
      const ident=`${base}/${f.label}/${name.replace(/\s+/g,'-')}`;
      units.push({id:uid,identifier:ident,ulpin3d:ident,name,kind:'space',revision:1,use:retail?'retail':'apartment',footprint:u.ring,
        geometry:{id:uid,alias:name,name,kind:'unit',footprint:u.ring,lower:+f.lower.toFixed(2),upper:+f.upper.toFixed(2),lowerVerified:true,upperVerified:true,
          bindings:{footprint:{sourceId:schedule,locator:`row ${row}`},lower:{sourceId:levelsSrc,locator:`row ${i+1}`}},revision:1,levelLabel:f.label,area:u.areaM2,height:+(f.upper-f.lower).toFixed(2),volume:+(u.areaM2*(f.upper-f.lower)).toFixed(2)},
        links:[{targetId:floors[i].id,type:'floor'},{targetId:b,type:'within'}],evidence:[{sourceId:schedule,locator:`row ${row}`}],_row:row,_area:u.areaM2,_level:f.label});
    }
  });
  const total=units.reduce((n,u)=>n+u._area,0);
  const sv=(value,locator,source='unit_schedule.csv',sid=schedule)=>({value,sourceId:sid,source,locator});
  const hash=v=>sha(v);
  const revHash=hash(`${b}:r1`);
  const ledger={buildingId:b,revision:1,status:'reviewed',address:props.address??null,parcelUlpin:bbl?`BBL ${bbl}`:null,declaration:'Condominium declaration',siteDatum:'Building ground (0 m)',groundElevationM:0,
    shareBasis:'unit floor area',shareTotalPct:100,shareEvidence:{sourceId:decl,source:'Condominium declaration',locator:'Schedule A'},
    spaces:units.map(u=>({spaceId:u.id,rights:'exclusive',status:'reviewed',carpetAreaM2:sv(u._area,`row ${u._row}`),declaredAreaM2:sv(+(u._area*1.012).toFixed(2),`row ${u._row}`),sharePct:sv(+(100*u._area/total).toFixed(3),`Schedule A, unit ${u.name}`,'Condominium declaration',decl),parking:null})),
    readiness:{task:'Assign proposed 3D ULPIN',dimensions:[{name:'Evidence',value:1},{name:'Geometry',value:1},{name:'Association',value:1},{name:'Consistency',value:1},{name:'Review',value:1},{name:'Freshness',value:1}]},
    checks:[{name:'Exclusive overlap',detail:`${units.length} units · none overlap`,state:'passed',findingId:null},{name:'Partition completeness',detail:`${floors.length} levels`,state:'passed',findingId:null},{name:'Shares total',detail:'100.000 %',state:'passed',findingId:null},{name:'Carpet area',detail:'within 10 % of declared',state:'passed',findingId:null}],
    checkMethod:'Check v1.4',findingDetails:[],
    revisions:[{kind:'recorded',title:'r1 Recorded',actor:'Duty officer',at:created,hash:revHash,previousHash:null}],deviation:null,
    sources:[{sourceId:levelsSrc,kind:'table',name:'level_schedule.csv',file:'level_schedule.csv',summary:`${floors.length} rows`},{sourceId:schedule,kind:'table',name:'unit_schedule.csv',file:'unit_schedule.csv',summary:`${units.length} rows`},{sourceId:decl,kind:'document',name:'Condominium declaration',file:'condominium_declaration.pdf',summary:'Schedule A'}]};
  const clean=units.map(({_row,_area,_level,...u})=>u);
  const residents=residentsFor(b,units.filter(u=>u.use==='apartment').map(u=>({spaceId:u.id,unit:u.name,level:u._level})),{locale:'US',asOf:created.slice(0,10),addressLine:props.address??null});
  const sources=[['level_schedule.csv',levelsSrc],['unit_schedule.csv',schedule],['condominium_declaration.pdf',decl]].map(([name,sid])=>({id:sid,name,sha256:hash(`${sid}:${name}`),revision:1,profile:name.endsWith('.pdf')?'document':'table',createdAt:created,url:`/api/v1/sources/${sid}/file`,evidence:[]}));
  return {floors,units:clean,ledger,residents,sources,rows:{levels:layout.floors,units}};
}
export function studioDemoImport(){
  const enabled=process.env.ULPIN_DEMO_IMPORT==='1';
  return {name:'nyc-demo-import',apply:'serve',async configureServer(server){
    if(!enabled)return;
    const root=process.env.ULPIN_DEMO_DIR??join(homedir(),'.codex/task-data/nyc-stream-demo');
    await mkdir(root,{recursive:true,mode:0o700});
    const jobs=new Map(), subscribers=new Map();
    const sourceFor=(job,sid)=>job.sources.find(s=>s.id===sid);
    const summary=job=>({id:job.id,schemaVersion:'ulpin-canonical/2',areaId:job.area.id,name:profile.title,datasetNamespace:'nyc-context-demo',revision:0,state:job.state,features:job.features.map(f=>({id:f.id,kind:f.kind})),sourceRevisionIds:job.sources.map(s=>s.id),questions:[],factCandidates:[],parts:[],warnings:job.error?[job.error]:[],createdAt:job.createdAt,quarantine:job.quarantine??null});
    const context=job=>({area:{...job.area,featureCount:job.features.length},features:[],displayFeatures:job.features,parcelAssociations:[],parcelIdentifiers:[],sceneAssets:[],supplementalDatasets:job.datasets??[],packages:[summary(job)],latestCheck:null,demoSequence:job.sequence});
    const save=async job=>{const path=join(root,job.id,'state.json');const {process,ack,...state}=job;await writeFile(path+'.tmp',JSON.stringify(state));await rename(path+'.tmp',path);};
    for(const name of await readdir(root))if(demoId(name)){
      try{const job=JSON.parse(await readFile(join(root,name,'state.json'),'utf8'));if(job.state==='RECEIVED'){job.state='FAILED';job.error='Demo server restarted during processing. Upload the same pack to retry.';}jobs.set(job.id,job);}catch{/* An incomplete write is never advertised as a complete import. */}
    }
    const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Ulpin-Local-Source':'NYC official uploads · deterministic demo adapter'});res.end(JSON.stringify(value));};
    const send=(res,event,value,seq)=>res.write(`id: ${seq}\nevent: ${event}\ndata: ${JSON.stringify(value)}\n\n`);
    async function publish(job,event,data){
      job.sequence++;await save(job); // publish only after the local snapshot is saved
      await writeFile(join(root,job.id,'events.ndjson'),JSON.stringify({sequence:job.sequence,event,at:new Date().toISOString(),features:job.features.length,state:job.state})+'\n',{flag:'a'});
      for(const res of subscribers.get(job.id)??[])send(res,event,{...data,sequence:job.sequence,package:summary(job)},job.sequence);
    }
    async function run(job,layers){
      if(job.process)return;
      try{
        const code=await readFile(python,'utf8');
        const binary=layers.some(l=>l.format==='laz'||l.format==='geotiff');
        const interpreter=process.env.ULPIN_DEMO_PYTHON??join(homedir(),'.codex/task-data/nyc-10013-multimodal/venv/bin/python');
        const child=binary?spawn(interpreter,['-u',python],{stdio:['pipe','pipe','pipe']}):spawn('docker',['exec','-i',process.env.ULPIN_DEMO_GEO_CONTAINER??'ulpin-geo-1','python','-u','-c',code],{stdio:['pipe','pipe','pipe']});
        job.process=child;let err='';child.stderr.on('data',b=>{err=(err+b).slice(-2000);});
        const exit=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error(err||`Normalizer exited ${code}`)));});
        // Observe immediately, including failures before stdout starts.
        exit.catch(()=>{});child.stdin.on('error',()=>{});
        child.stdin.end(JSON.stringify({areaId:job.area.id,packageId:job.id,hash:job.hash,layers,outputDir:join(root,job.id)}));
        const timer=setTimeout(()=>child.kill(),120000);let complete=false;
        try{for await(const line of createInterface({input:child.stdout})){
          const message=JSON.parse(line);
          if(message.type==='metadata'){
            job.area.reference=message.reference;job.quarantine=message.quarantine;job.datasets=message.datasets??[];
            await publish(job,'metadata',{area:job.area,context:context(job)});
          }else if(message.type==='chunk'){
            job.features.push(...message.features);
            await publish(job,'chunk',{features:message.features});
            // Browser acknowledgement supplies real flow control, not a progress animation.
            if(subscribers.get(job.id)?.size)await new Promise(resolve=>{const t=setTimeout(resolve,1500);job.ack=()=>{clearTimeout(t);resolve();};});
          }else if(message.type==='complete')complete=true;
        }await exit;if(!complete)throw new Error('Normalizer ended without a completion record');}
        finally{clearTimeout(timer);}
        job.state='READY_FOR_REVIEW';await publish(job,'complete',{});
      }catch(error){job.state='FAILED';job.error=error.message;await publish(job,'failed',{message:job.error});}
      finally{delete job.process;job.ack?.();delete job.ack;}
    }
    async function uploads(req){
      let size=0;const chunks=[];
      for await(const c of req){size+=c.length;if(size>MAX)throw new Error('Upload exceeds the 32 MiB demo limit');chunks.push(c);}
      const body=Buffer.concat(chunks);
      const form=await new Request('http://localhost/upload',{method:'POST',headers:{'content-type':req.headers['content-type']??''},body}).formData();
      const originals=[];const layers=[];let expanded=0;
      for(const file of form.getAll('file')){
        if(typeof file==='string')continue;
        const bytes=Buffer.from(await file.arrayBuffer());originals.push({name:basename(file.name),bytes});
        let entries;
        if(file.name.toLowerCase().endsWith('.zip')){
          entries=unzipSync(bytes,{filter:entry=>{expanded+=entry.originalSize;if(expanded>64*1024*1024)throw new Error('ZIP exceeds the 64 MiB expanded limit');return profile.layers.some(layer=>basename(entry.name)===layer.name);}});
        }else entries={[file.name]:bytes};
        if(!Object.keys(entries).length)throw new Error('This demo accepts the prepared NYC ZIP, GeoJSON layers, or registered LAZ/GeoTIFF extracts');
        for(const [name,content] of Object.entries(entries)){
          const hash=sha(content);const spec=profile.layers.find(p=>p.sha256===hash);
          if(!spec)throw new Error(`${basename(name)} is not one of the verified NYC profile files. No generic or AI normalization is enabled in demo mode.`);
          if(layers.some(l=>l.sha256===hash))continue;
          const binary=spec.format==='laz'||spec.format==='geotiff';
          const document=binary?undefined:JSON.parse(Buffer.from(content).toString('utf8'));
          if(document&&(document.type!=='FeatureCollection'||document.features.length!==spec.count))throw new Error('Source profile count mismatch');
          layers.push({...spec,document,bytes:Buffer.from(content)});
        }
      }
      if(!layers.length)throw new Error('Choose at least one supported NYC layer');
      return {originals,layers,intent:String(form.get('intent')??randomUUID())};
    }
    server.middlewares.use(async(req,res,next)=>{
      const url=new URL(req.url??'/','http://localhost');const path=url.pathname;
      const parts=path.split('/').filter(Boolean);const isDemo=path.startsWith('/api/demo/')||path.startsWith('/api/v1/')&&demoId(parts[3]);
      if(!isDemo)return next();
      // Only loopback dev-server usage. No permissive CORS and no cross-origin writes.
      const origin=req.headers.origin;
      if(origin&&origin!==`http://${req.headers.host}`)return json(res,403,{message:'Demo API only accepts same-origin requests'});
      try{
        if(req.method==='POST'&&(path==='/api/demo/inspect'||path==='/api/demo/imports')){
          const {originals,layers,intent}=await uploads(req);const hash=sha(layers.map(l=>l.sha256).sort().join(':'));
          if(path.endsWith('/inspect'))return json(res,200,{format:layers.length===1?(layers[0].format??'geojson'):'mixed',sourceSha256:sha(originals[0].bytes),bytes:originals.reduce((n,f)=>n+f.bytes.length,0),layers:[],layer:null,sourceCrs:[...new Set(layers.map(l=>l.crs??'EPSG:4326'))].join('; '),crsEvidence:'Verified NYC source profile',featureCount:layers.filter(l=>l.document).reduce((n,l)=>n+l.count,0),geometryTypes:layers.some(l=>l.document)?['MultiPolygon']:[],fields:[{name:'source_key',complete:true,unique:true,idEligible:true}],featureIdEligible:false,suggestedIdField:'source_key',suggestedNameField:null,suggestedTitle:profile.title,suggestedNamespace:'nyc-context-demo',demoContents:layers.map(l=>`${l.count.toLocaleString('en-US')} ${l.format==='laz'?'points':l.format==='geotiff'?'pixels':'features'} (${l.layer})`).join(' · '),demoLayers:layers.map(l=>`${l.layer}: ${l.count}`).join(' · ')});
          if(!layers.some(l=>l.document))throw new Error('Include at least one prepared GeoJSON layer to establish the map; LiDAR and rasters are supporting evidence.');
          const jid=id('job:'+hash+':'+intent),areaId=id('area:'+hash+':'+intent);let job=jobs.get(jid);
          if(job&&job.state!=='FAILED')return json(res,200,{id:jid,areaId});
          const dir=join(root,jid);await mkdir(dir,{recursive:true,mode:0o700});
          for(const original of originals)await writeFile(join(dir,sha(original.bytes)+'-'+original.name),original.bytes,{mode:0o600});
          const sources=[];
          for(const layer of layers){
            layer.sourceId=id('source:'+hash+':'+layer.sha256);layer.areaId=areaId;
            const ext=layer.format==='laz'?'.laz':layer.format==='geotiff'?'.tif':'.geojson';
            layer.path=join(dir,layer.sha256+ext);await writeFile(layer.path,layer.bytes,{mode:0o600});
            sources.push({id:layer.sourceId,name:layer.name,hash:layer.sha256,namespace:layer.dataset,url:layer.url,layer:layer.layer,format:layer.format??'geojson',file:layer.sha256+ext});delete layer.bytes;
          }
          job={id:jid,hash,area:{id:areaId,siteId:areaId,name:profile.title,revision:0,reference:null,extent:null,geographicExtent:null,administrativeUnits:[],dataKind:'mixed',featureCount:0},features:[],sources,state:'RECEIVED',createdAt:new Date().toISOString(),sequence:0,uploadName:originals.map(o=>o.name).join(', ')};
          jobs.set(jid,job);await save(job);job.pendingLayers=layers;
          return json(res,202,{id:jid,areaId});
        }
        if(path==='/api/demo/areas'&&req.method==='GET')return json(res,200,[...jobs.values()].map(j=>({...j.area,featureCount:j.features.length,createdAt:j.createdAt,state:j.state,packageId:j.id,sourceCount:j.sources.length,uploadName:j.uploadName??null})));
        const sample=parts[2]==='sources'?sampleSources.get(parts[3]):null;
        if(sample&&path.endsWith('/file')){
          const built=sampleBuilding(sample.job,sample.feature);
          const body=sample.name==='level_schedule.csv'?['level,bottom_m,top_m',...built.rows.levels.map(l=>`${l.label},${l.lower.toFixed(2)},${l.upper.toFixed(2)}`)].join('\n')
            :sample.name==='unit_schedule.csv'?['unit,level,floor_area_m2,use',...built.rows.units.map(u=>`${u.name},${u._level},${u._area},${u.use}`)].join('\n')
            :`Condominium declaration\n${sample.feature.identifier}\n\nSchedule A: undivided interest by unit floor area\n`+built.rows.units.map(u=>`${u.name} (${u._level}): ${(100*u._area/built.rows.units.reduce((n,x)=>n+x._area,0)).toFixed(3)} %`).join('\n');
          res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});res.end(body+'\n');return;
        }
        const job=[...jobs.values()].find(j=>[j.id,j.area.id,...j.sources.map(s=>s.id)].includes(parts[3])||j.features.some(f=>f.id===parts[3]));
        if(!job)return json(res,404,{message:'Local demo record not found'});
        if(path.endsWith('/events')&&req.method==='GET'){
          res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});res.flushHeaders();
          const group=subscribers.get(job.id)??new Set();group.add(res);subscribers.set(job.id,group);
          send(res,'snapshot',{context:context(job),sequence:job.sequence,package:summary(job)},job.sequence);
          const heartbeat=setInterval(()=>res.write(': keepalive\n\n'),15000);
          res.on('close',()=>{clearInterval(heartbeat);group.delete(res);job.ack?.();});
          if(job.pendingLayers){const layers=job.pendingLayers;delete job.pendingLayers;void run(job,layers);}
          return;
        }
        if(path.endsWith('/ack')&&req.method==='POST'){job.ack?.();return json(res,200,{ok:true});}
        if(req.method!=='GET')return json(res,409,{message:'The demo projection is read-only. Registry mutations are not enabled.'});
        if(path===`/api/demo/areas/${job.area.id}/datasets`)return json(res,200,{areaId:job.area.id,state:job.state,datasets:job.datasets??[],sources:job.sources});
        if(path===`/api/demo/areas/${job.area.id}/surface`){
          if(!job.datasets?.some(d=>d.derivedSurface))return json(res,404,{message:'No measured surface has been derived'});
          res.writeHead(200,{'Content-Type':'image/tiff','Content-Disposition':'attachment; filename=lidar-observed-surface.tif','Cache-Control':'no-store'});res.end(await readFile(join(root,job.id,'lidar-observed-surface.tif')));return;
        }
        if(path===`/api/demo/areas/${job.area.id}/plan-check`){
          const query=new URL(req.url,'http://localhost').searchParams;
          return json(res,200,await compareSimulatedPlan(job,query.get('scenario')??'conflicts'));
        }
        if(parts[2]==='areas'&&path.endsWith('/context'))return json(res,200,context(job));
        if(parts[2]==='import-packages')return json(res,job.state==='FAILED'?422:200,job.state==='FAILED'?{message:job.error}:summary(job));
        if(parts[2]==='buildings'&&path.endsWith('/register')){
          const feature=job.features.find(f=>f.id===parts[3]&&f.kind==='building');if(!feature)return json(res,404,{message:'Building not found'});
          const built=sampleBuilding(job,feature);
          const base=job.sources.filter(s=>!s.format||s.format==='geojson').map(s=>({id:s.id,name:s.name,sha256:s.hash,revision:1,createdAt:job.createdAt,format:'geojson',url:s.url,evidence:[]}));
          return json(res,200,{schemaVersion:'ulpin-register/1',exportedAt:new Date().toISOString(),area:job.area,property:{...feature,revision:built?1:feature.revision},register:built?[...built.floors].reverse().concat(built.units):[],sources:[...base,...(built?.sources??[])],missing:built?[]:['No floors or spaces are recorded for this building yet.'],findings:[],findingQualification:{state:built?'qualified':'not_assessed',missing:[]},parcelIdentifiers:built?.ledger.parcelUlpin?[{value:built.ledger.parcelUlpin,scheme:'NYC BBL'}]:[],parcelAssociations:[],associations:[],questions:[],revisions:[],latestCheck:null,scope:'Technical record of the building. Not a title, certificate or legal order.'});
        }
        if(parts[2]==='buildings'&&(path.endsWith('/ledger')||path.endsWith('/residents'))){
          const feature=job.features.find(f=>f.id===parts[3]&&f.kind==='building');const built=feature&&sampleBuilding(job,feature);
          if(!built)return json(res,404,{message:'No register for this building'});
          return json(res,200,path.endsWith('/ledger')?built.ledger:built.residents);
        }
        if(parts[2]==='sources'&&path.endsWith('/file')){const source=sourceFor(job,parts[3]);const binary=source.format&&source.format!=='geojson';res.writeHead(200,{'Content-Type':binary?(source.format==='laz'?'application/octet-stream':'image/tiff'):'application/geo+json','Cache-Control':'no-store',...(binary?{'Content-Disposition':`attachment; filename="${source.name}"`}:{})});res.end(await readFile(join(root,job.id,source.file??source.hash+'.geojson')));return;}
        return json(res,404,{message:'This capability is not provided by the bounded demo adapter'});
      }catch(error){if(!res.headersSent)json(res,400,{message:error.message});else res.end();}
    });
    server.httpServer?.on('close',()=>{for(const job of jobs.values())job.process?.kill();for(const set of subscribers.values())for(const res of set)res.end();});
  }};
}
