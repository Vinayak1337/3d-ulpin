const decoder=new TextDecoder();
const fail=message=>{throw new Error(message)};
export function validateScene(data){
  if(!data||typeof data!=='object'||!Array.isArray(data.objects)||!Array.isArray(data.geometries)||!Array.isArray(data.frames))fail('Choose a normalized scene JSON, not a raw GIS layer or manifest.');
  if(data.objects.length>500||data.geometries.length>1000||data.objects.filter(o=>o.type==='building').length>100)fail('This detailed preview supports up to 500 objects and 100 buildings. Larger datasets need tiled display geometry.');
  if(data.metadata?.classification!=='synthetic')fail('This isolated design preview accepts explicitly synthetic datasets only.');
  if(!Array.isArray(data.metadata.extent)||data.metadata.extent.length!==4||!data.metadata.extent.every(Number.isFinite)||data.metadata.extent[2]<=data.metadata.extent[0]||data.metadata.extent[3]<=data.metadata.extent[1])fail('The scene needs a finite, ordered local extent.');
  if(typeof data.metadata.title!=='string'||!data.metadata.title.trim())fail('The scene needs a title.');
  const ex=data.metadata.extent;if(ex[2]-ex[0]>2000||ex[3]-ex[1]>2000)fail('The detailed preview supports a local extent up to 2 km.');
  if(data.frames.length!==1||data.frames[0].kind!=='local_cartesian'||JSON.stringify(data.frames[0].axisOrder)!==JSON.stringify(['east','north','up']))fail('Normalize every geometry into one local east/north/up metre frame before preview.');
  for(const name of ['relations','sources','sourceRecords','issues','identifierAssertions'])if(data[name]!==undefined&&!Array.isArray(data[name]))fail(`${name} must be an array.`);
  for(const o of data.objects){const n=o.attributes?.floorCount;if(n!=null&&(!Number.isInteger(n)||n<0||n>100))fail('A building floor count must be an integer from 0 to 100.');}
  const decoration=data.sceneDecoration;
  if(decoration!=null&&(typeof decoration!=='object'||Array.isArray(decoration)))fail('Scene decoration must be an object.');
  for(const key of ['trees','cars','parkPaths'])if(decoration?.[key]!=null&&(!Array.isArray(decoration[key])||decoration[key].length>500))fail(`Decoration ${key} must be an array of at most 500 items.`);
  const finitePoint=p=>Array.isArray(p)&&p.length>=2&&p.length<=3&&p.every(Number.isFinite)&&p[0]>=ex[0]-100&&p[0]<=ex[2]+100&&p[1]>=ex[1]-100&&p[1]<=ex[3]+100;
  for(const t of [...(decoration?.trees||[]),...(decoration?.cars||[])]){if(!t||!finitePoint(Array.isArray(t)?t:t.position||t.coordinates||[t.x,t.y]))fail('Decoration positions must be finite and inside the scene.');for(const k of ['heightM','height','radiusM','radius'])if(t[k]!=null&&(!Number.isFinite(t[k])||t[k]<=0||t[k]>40))fail('Decoration dimensions must be between 0 and 40 metres.');for(const k of ['heading','rotation'])if(t[k]!=null&&!Number.isFinite(t[k]))fail('Decoration headings must be finite.');}
  for(const p of decoration?.parkPaths||[])if(!Array.isArray(p.path)||p.path.length<2||p.path.length>100||!p.path.every(finitePoint)||!Number.isFinite(p.widthM)||p.widthM<=0||p.widthM>20)fail('Park paths need finite positions and a usable width.');
  const ids=new Set(),geometries=new Map(),frames=new Map(data.frames.map(f=>[f.id,f]));
  for(const o of data.objects){if(typeof o.id!=='string'||!o.id||ids.has(o.id))fail('Object IDs must be present and unique.');ids.add(o.id)}
  let vertices=0;
  const point=p=>{if(!Array.isArray(p)||p.length<2||p.length>3||!p.every(Number.isFinite))fail('Geometry coordinates must contain finite numbers.');if(!finitePoint(p))fail('Geometry must lie inside the declared local extent.');if(p[2]!=null&&Math.abs(p[2])>10000)fail('Vertical coordinates exceed the preview range.');if(++vertices>50000)fail('The preview vertex limit is 50,000.');};
  for(const g of data.geometries){if(!g.id||geometries.has(g.id)||!ids.has(g.objectId))fail('Geometry IDs or object links are invalid.');const f=frames.get(g.frameId);if(g.verticalDatum!==f?.verticalDatum)fail('Geometry must use the canonical frame vertical benchmark.');if(!f||f.horizontalUnit!=='metre'||f.verticalUnit!=='metre'||!f.verticalDatum)fail('Every geometry needs a named metre frame and vertical benchmark.');if(g.heightM!==null&&(!Number.isFinite(g.heightM)||g.heightM<0||g.heightM>500))fail('Height must be a nonnegative number or explicitly null.');if(g.baseElevationM!==null&&(!Number.isFinite(g.baseElevationM)||Math.abs(g.baseElevationM)>10000))fail('Base elevations must be finite or null.');
    if(g.type==='Polygon'){if(!Array.isArray(g.coordinates)||!g.coordinates.length)fail('A polygon needs an outer ring.');for(const ring of g.coordinates){if(!Array.isArray(ring)||ring.length<4||ring.length>256)fail('Polygon rings need 4–256 vertices in this detailed preview.');ring.forEach(point);if(ring[0][0]!==ring.at(-1)[0]||ring[0][1]!==ring.at(-1)[1])fail('Polygon rings must be closed.')}}
    else if(g.type==='LineString'){if(!Array.isArray(g.coordinates)||g.coordinates.length<2)fail('Lines need at least two points.');g.coordinates.forEach(point)}else if(g.type==='Point')point(g.coordinates);else fail(`Geometry type ${g.type} is not supported by this preview.`);geometries.set(g.id,g);
  }
  const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  for(const g of geometries.values())if(g.type==='Polygon'){
    let area=0;for(const [ri,ring] of g.coordinates.entries()){let signed=0;for(let i=0;i<ring.length-1;i++){signed+=ring[i][0]*ring[i+1][1]-ring[i+1][0]*ring[i][1];for(let j=i+2;j<ring.length-1;j++){if(i===0&&j===ring.length-2)continue;const a=ring[i],b=ring[i+1],c=ring[j],d=ring[j+1];if(cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0)fail('A polygon ring crosses itself.');}}area+=(ri===0?1:-1)*Math.abs(signed/2);}
    if(area<=.001)fail('Polygon area must be positive.');if(g.areaM2!=null&&(!Number.isFinite(g.areaM2)||Math.abs(g.areaM2-area)>Math.max(.02,area*1e-5)))fail('A stored polygon area does not match its coordinates.');
  }
  let displayBudget=0;
  for(const o of data.objects){const g=geometries.get(o.geometryId);if(['building','floor','space'].includes(o.type)&&g?.heightM!=null&&g?.baseElevationM==null)fail('A volumetric object needs its authored base elevation.');if(o.type==='utility'&&g?.type==='LineString'&&g.coordinates.some(p=>p[2]==null)&&g.baseElevationM==null)fail('Utility depth is unknown. Supply authored elevations or leave geometry unavailable.');if(o.type==='building'&&g?.type==='Polygon'){const perimeter=g.coordinates[0].slice(1).reduce((sum,p,i)=>sum+Math.hypot(p[0]-g.coordinates[0][i][0],p[1]-g.coordinates[0][i][1]),0);displayBudget+=perimeter*Math.max(1,o.attributes?.floorCount||1);}}
  if(displayBudget>150000)fail('This dataset exceeds the detailed façade preview budget. Use simplified display geometry.');
  for(const o of data.objects)if(o.geometryId&&(!geometries.has(o.geometryId)||geometries.get(o.geometryId).objectId!==o.id))fail('A property refers to missing or mismatched geometry.');
  const sources=new Set((data.sources||[]).map(s=>s.id)),records=new Set((data.sourceRecords||[]).map(s=>s.id));
  for(const s of data.sourceRecords||[])if(!sources.has(s.sourceId))fail('A source record refers to a missing source.');
  for(const o of data.objects)if((o.sourceRecordIds||[]).some(id=>!records.has(id)))fail('An object refers to missing source evidence.');
  for(const r of data.relations||[])if(!ids.has(r.fromId)||!ids.has(r.toId))fail('A relationship refers to a missing object.');
  if(!data.objects.some(o=>o.type==='building'&&geometries.get(o.geometryId)?.type==='Polygon'))fail('The scene needs at least one building footprint.');
  return data;
}
export async function readPackage(file){
  if(file.size>20*1024*1024)fail('Choose a file smaller than 20 MB.');const buffer=await file.arrayBuffer();
  if(file.name.toLowerCase().endsWith('.json'))return {data:validateScene(JSON.parse(decoder.decode(buffer))),verifiedFiles:0,name:file.name};
  if(!file.name.toLowerCase().endsWith('.zip'))fail('Choose a ZIP package or normalized JSON file.');
  const view=new DataView(buffer);let eocd=-1;for(let i=buffer.byteLength-22;i>=Math.max(0,buffer.byteLength-65557);i--)if(view.getUint32(i,true)===0x06054b50){eocd=i;break}if(eocd<0)fail('This is not a supported ZIP archive.');
  const entries=view.getUint16(eocd+10,true);if(entries>100)fail('The package contains too many files.');let cursor=view.getUint32(eocd+16,true),total=0;const files=new Map();
  for(let i=0;i<entries;i++){
    if(cursor+46>buffer.byteLength||view.getUint32(cursor,true)!==0x02014b50)fail('The ZIP directory is invalid.');const method=view.getUint16(cursor+10,true),flags=view.getUint16(cursor+8,true),compressed=view.getUint32(cursor+20,true),size=view.getUint32(cursor+24,true),nameLength=view.getUint16(cursor+28,true),extra=view.getUint16(cursor+30,true),comment=view.getUint16(cursor+32,true),offset=view.getUint32(cursor+42,true);const name=decoder.decode(new Uint8Array(buffer,cursor+46,nameLength));cursor+=46+nameLength+extra+comment;
    if(name.endsWith('/'))continue;if(name.includes('..')||name.startsWith('/')||name.includes('\\')||files.has(name))fail('The package has an unsafe or duplicate path.');if(flags&1)fail('Encrypted ZIP files are not supported.');if((total+=size)>30*1024*1024)fail('The expanded package is too large.');if(offset+30>buffer.byteLength||view.getUint32(offset,true)!==0x04034b50)fail('The ZIP entry is invalid.');const start=offset+30+view.getUint16(offset+26,true)+view.getUint16(offset+28,true);if(start+compressed>buffer.byteLength)fail('The ZIP entry is truncated.');const input=new Uint8Array(buffer,start,compressed);let bytes;
    if(method===0)bytes=input;else if(method===8){const reader=new Blob([input]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();let actual=0,chunks=[];while(true){const {done,value}=await reader.read();if(done)break;actual+=value.length;if(actual>size||actual>30*1024*1024){await reader.cancel();fail('The archive expands beyond its declared size.')}chunks.push(value)}bytes=new Uint8Array(actual);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length}}else fail('The ZIP uses an unsupported compression method.');if(bytes.length!==size)fail('A ZIP file has an invalid length.');files.set(name,bytes);
  }
  const manifestPath=[...files.keys()].find(p=>/(^|\/)manifest.json$/.test(p));if(!manifestPath)fail('The ZIP needs manifest.json with SHA-256 file hashes.');const prefix=manifestPath.slice(0,-'manifest.json'.length),manifest=JSON.parse(decoder.decode(files.get(manifestPath)));if(!Array.isArray(manifest.files)||!manifest.files.length)fail('The manifest has no files.');
  const declared=new Set();for(const item of manifest.files){if(!item.path||item.path.includes('..')||declared.has(item.path))fail('Invalid manifest file paths.');declared.add(item.path);const bytes=files.get(prefix+item.path);if(!bytes||bytes.length!==item.bytes)fail(`File missing or wrong length: ${item.path}`);const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');if(hash!==item.sha256)fail(`File hash does not match: ${item.path}`)}
  if(!declared.has('normalized.json'))fail('The manifest must include normalized.json.');const data=validateScene(JSON.parse(decoder.decode(files.get(prefix+'normalized.json'))));
  for(const source of data.sources||[]){if(source.representation!=='original_file')continue;const sourceName=source.originalUri?.replace(/^dataset\//,'');const item=manifest.files.find(item=>item.path===sourceName);if(!item||source.originalSha256!==item.sha256||source.byteSize!==item.bytes)fail(`Source revision fingerprint disagrees with packaged bytes: ${source.id}`);}
  return {data,verifiedFiles:declared.size,name:file.name};
}
