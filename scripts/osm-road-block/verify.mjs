import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const root=process.cwd(),base=process.env.ULPIN_TEST_BASE_URL||'http://127.0.0.1:3000';
const state=JSON.parse(await readFile(resolve(root,'.runtime/uttam-nagar-installed.json'),'utf8'));
const spec=JSON.parse(await readFile(resolve(root,'fixtures/uttam-nagar/demo-plan-spec.json'),'utf8'));
const report={startedAt:new Date().toISOString(),result:'RUNNING',checks:[],areas:{},properties:[]};
const hash=b=>createHash('sha256').update(b).digest('hex');
async function api(path,body){const r=await fetch(base+'/api/v1'+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(90000)});assert(r.ok,path+': '+await r.clone().text());return r.json();}
function pass(message){report.checks.push(message);console.log('PASS',message);}
try{
 report.health=await api('/health');assert.equal(report.health.ok,true);assert.equal(report.health.dataMode,'repository');
 for(const [key,id] of [['real',state.realAreaId],['fictional',state.demoAreaId]]){
  let c=await api(`/areas/${id}/context`);
  if(process.argv.includes('--run-checks')){await api('/area-checks',{areaId:id,expectedRevision:c.area.revision});c=await api(`/areas/${id}/context`);}
  assert.equal(c.features.length,key==='real'?29:34);
  assert.equal(c.latestCheck.status,'completed');assert.equal(c.latestCheck.stale,false,'Check must be current: '+key);
  const ids=new Set(c.features.map(f=>f.id));
  const participants=c.latestCheck.findings.flatMap(f=>f.participants||[]);
  if(key==='real'){
   assert(c.features.every(f=>f.worldStatus==='observed'));
   assert(c.features.filter(f=>f.kind==='building').every(f=>f.height.value===null),'No invented height on reference geometry');
   assert(c.features.filter(f=>f.kind==='road').every(f=>['LineString','MultiLineString'].includes(f.geometry.type)));
   assert(participants.every(f=>['observed','planned'].includes(f.worldStatus)),'Reference check must not consume implicit fictional scenario');
   pass('Real reference retains 20 building outlines, nine road/path centrelines and unknown heights; no fictional check participants');
  }else{
   assert(c.features.every(f=>f.worldStatus==='synthetic'));
   assert(participants.every(f=>ids.has(f.id)),'Fictional block must not consume unrelated real/scenario copies');
   assert.equal(c.parcelIdentifiers.length,3);assert.equal(c.parcelAssociations.length,3);
   const target=c.features.find(f=>f.sourceKey===spec.expected_conflicts.target_key);
   const shed=c.features.find(f=>f.sourceKey==='demo-shed-01');const road=c.features.find(f=>f.sourceKey==='demo-crossing-01');
   const find=(code,b)=>c.latestCheck.findings.find(f=>f.code===code&&f.featureIds.includes(target.id)&&f.featureIds.includes(b.id));
   const a=find('BUILDING_FOOTPRINT_OVERLAP',shed),b=find('BUILDING_ROAD_OVERLAP',road);assert(a&&b);
   assert(Math.abs(a.areaM2-spec.expected_conflicts.shed_overlap_m2)<1e-4,'Computed shed overlap matches independent Shapely result');
   assert(Math.abs(b.areaM2-spec.expected_conflicts.road_overlap_m2)<1e-4,'Computed road overlap matches independent Shapely result');
   report.intendedFindings={building:a,road:b,independentExpected:spec.expected_conflicts};
   pass('Separate fictional block has 34 synthetic features and three parcel links; intended road/shed overlaps agree with independent Shapely geometry');
  }
  report.areas[key]={id,name:c.area.name,features:c.features.length,revision:c.area.revision,checkId:c.latestCheck.id,findings:c.latestCheck.findings.length,codes:Object.fromEntries([...new Set(c.latestCheck.findings.map(f=>f.code))].map(code=>[code,c.latestCheck.findings.filter(f=>f.code===code).length]))};
 }
 const sources=new Map();let floors=0,spaces=0,named=0,common=0;
 for(const property of state.properties){
  const d=await api(`/buildings/${property.buildingId}/dossier`);
  const records=d.records.filter(r=>r.kind==='space');
  assert.equal(records.length,9);assert.equal(d.records.filter(r=>r.kind==='floor').length,3);
  floors+=3;spaces+=records.length;
  for(const r of records){assert.equal(r.synthetic,true);assert.equal(r.rights.length,1);const right=r.rights[0];assert.equal(right.type,'shared_use');assert.match(right.party,/^Fictional/);assert(d.sources.some(s=>s.id===right.evidence.sourceId),'Party evidence must appear in dossier');
   if(r.use==='common')common++;else{named++;assert.match(right.party,/^Fictional: /);}
  }
  for(const s of d.sources)sources.set(s.id,s);
  report.properties.push({buildingId:property.buildingId,name:d.building.name,floors:3,spaces:9,parcelId:d.parcelIdentifiers[0]?.value,parties:records.map(r=>({recordId:r.id,alias:r.alias,party:r.rights[0].party,evidence:r.rights[0].evidence,area:r.geometry.area,lower:r.geometry.lower,upper:r.geometry.upper}))});
 }
 assert.equal(floors,9);assert.equal(spaces,27);assert.equal(named,18);assert.equal(common,9);
 pass('Nine floors, 27 spaces, 18 explicitly fictional residents and nine common shared-use entries are source-linked in actual registry records');
 report.originals=[];
 for(const s of sources.values()){
  const r=await fetch(new URL(s.url,base),{signal:AbortSignal.timeout(30000)});assert.equal(r.status,200,s.name);
  const bytes=Buffer.from(await r.arrayBuffer());assert.equal(hash(bytes),s.sha256,s.name);
  report.originals.push({id:s.id,name:s.name,bytes:bytes.length,sha256:s.sha256});
 }
 pass(`All ${sources.size} distinct scenario dossier originals served by the application with matching SHA-256`);
 const first=state.properties[0];const pdf=await fetch(`${base}/api/v1/buildings/${first.buildingId}/register?format=pdf`,{signal:AbortSignal.timeout(60000)});assert.equal(pdf.status,200);
 const bytes=Buffer.from(await pdf.arrayBuffer());assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
 await writeFile(resolve(root,'.runtime/uttam-nagar-residence-01-register.pdf'),bytes);
 pass('Actual fictional residence register PDF export works');
 const lake=await api('/areas/0ded05d3-b596-46a8-9918-ab1bc0a433be/context');const bronx=await api('/areas/9e77c608-bac7-4d56-9ac7-3032cc49074d/context');
 assert.equal(lake.features.length,22);assert.equal(bronx.features.length,62);
 pass('Existing Lake View and Bronx remain populated, with 22 and 62 features');
 report.result='PASS';
}catch(error){report.result='FAIL';report.error=String(error);console.error(error);process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();await writeFile(resolve(root,'.runtime/uttam-nagar-verification.json'),JSON.stringify(report,null,2));}
