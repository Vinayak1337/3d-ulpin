/** Read-only upload audit. No rendering or app writes; do not render hostile fixtures. */
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'..');
const code=await readFile(path.join(root,'upload.js'),'utf8');
const {validateScene,readPackage}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const base=JSON.parse(await readFile(path.join(here,'reference-scene.json'),'utf8'));
const results=[];
function test(name,mutate){const d=structuredClone(base);mutate(d);try{validateScene(d);results.push({name,result:'accepted'});}catch(e){results.push({name,result:'rejected',message:e.message});}}
test('baseline',()=>{});
test('missing_metadata_title',d=>delete d.metadata.title);
test('unbounded_floorCount_100_million',d=>{d.objects.find(o=>o.id==='B02').attributes.floorCount=100_000_000;});
test('unknown_utility_elevation',d=>{const g=d.geometries.find(g=>g.objectId==='UT01');g.coordinates=g.coordinates.map(p=>p.slice(0,2));g.baseElevationM=null;});
test('different_untransformed_local_frame',d=>{const other=structuredClone(d.frames[0]);other.id='FRAME-DIFFERENT';other.geographicAnchor.eastingM+=1000;d.frames.push(other);d.geometries.find(g=>g.objectId==='B02').frameId=other.id;});
test('geographic_axis_order_declared_as_local',d=>{d.frames[0].kind='geographic';d.frames[0].axisOrder=['latitude','longitude','up'];});
test('missing_road_geometry',d=>{d.objects.find(o=>o.id==='R01').geometryId=null;d.geometries=d.geometries.filter(g=>g.objectId!=='R01');});
test('malformed_tree_decoration',d=>{d.sceneDecoration.trees={count:45};});
test('self_intersecting_polygon',d=>{d.geometries.find(g=>g.objectId==='B02').coordinates=[[[8,8],[20,20],[8,20],[20,8],[8,8]]];});
test('false_computed_area',d=>{d.geometries.find(g=>g.objectId==='B02').areaM2=900000;});
test('huge_edge_length_with_small_declared_extent',d=>{d.geometries.find(g=>g.objectId==='B02').coordinates=[[[0,0],[1000000000,0],[1000000000,10],[0,10],[0,0]]];});
const zipBytes=await readFile(path.join(here,'neem-reference-dataset.zip'));
try{const r=await readPackage(new File([zipBytes],'baseline.zip'));results.push({name:'baseline_zip',result:'accepted',verifiedFiles:r.verifiedFiles});}catch(e){results.push({name:'baseline_zip',result:'rejected',message:e.message});}
const allowed=new Set(['baseline','baseline_zip','missing_road_geometry']);
for(const result of results)if(result.result!==(allowed.has(result.name)?'accepted':'rejected'))throw new Error('Unexpected upload contract result: '+result.name);
console.log(JSON.stringify(results,null,2));
