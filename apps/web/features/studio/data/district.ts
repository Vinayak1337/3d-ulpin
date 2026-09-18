import type { Building, District, Finding, Park, Rect, Road, Unit, Utility } from '../types';
import { unitUsableArea } from './floorLayout';

export const STUDIO_DATA_VERSION='reference-neighbourhood/2';
// Explicit authored visualization fixture. Never substitute this for imported geography.
function random(seed:number){let s=seed>>>0;return()=>{s=(Math.imul(1664525,s)+1013904223)>>>0;return s/4294967296;};}
const rng=random(260919),pick=<T,>(a:T[])=>a[Math.floor(rng()*a.length)];
const names=['Aarav Mehta','Kavya Sethi','Rohan Batra','Diya Malhotra','Ishaan Verma','Ananya Rao','Neel Kapoor','Meera Arora','Arjun Sinha','Tara Khanna','Vihaan Joshi','Nisha Anand'];
const colors=['#e2ddd2','#e8e6df','#d2cfbf','#e1d2bc','#d1d8d6','#e6ddd0','#c8c7c0','#efe8d9'];
const horizontal=['South Avenue','5th Main Road','Lake View Road','Garden Street','North Avenue'];
const vertical=['West Avenue','Cedar Lane','Park Lane','Ashoka Lane','East Avenue'];
const roads:Road[]=[],utilities:Utility[]=[],parks:Park[]=[],buildings:Building[]=[];
const blocks:{id:string;x:number;z:number;width:number;depth:number}[]=[];
const spacing=72,extent=288,half=extent/2;
for(let i=0;i<=4;i++){
 const p=-half+i*spacing;
 roads.push({id:`R-H${i}`,name:horizontal[i],x:0,z:p,width:extent+12,depth:12,axis:'x',widthMeters:12});
 roads.push({id:`R-V${i}`,name:vertical[i],x:p,z:0,width:12,depth:extent+12,axis:'z',widthMeters:12});
 utilities.push({id:`WP-H${i}`,kind:'Water',points:[[-half,-2.6,p-3.05],[half,-2.6,p-3.05]],depth:2.6,diameter:300,operator:'Demo Water Network'});
 utilities.push({id:`WP-V${i}`,kind:'Water',points:[[p-3.05,-2.6,-half],[p-3.05,-2.6,half]],depth:2.6,diameter:300,operator:'Demo Water Network'});
 utilities.push({id:`SW-H${i}`,kind:'Sewer',points:[[-half,-3.8,p+2.5],[half,-3.8,p+2.5]],depth:3.8,diameter:600,operator:'Demo Sewer Network'});
 utilities.push({id:`EL-V${i}`,kind:'Electric',points:[[p+4,-1.2,-half],[p+4,-1.2,half]],depth:1.2,diameter:100,operator:'Demo Distribution Grid'});
}
let serial=0;
function addBuilding(x:number,z:number,parcel:Rect,blockId:string,special=false){
 serial++;const id=special?'BLD-0413':`BLD-${String(serial).padStart(4,'0')}`;
 const width=special?16:14+Math.floor(rng()*6),depth=special?18:15+Math.floor(rng()*6);
 const floors=special?5:3+Math.floor(rng()*3),owner=special?'Aarav Mehta':pick(names);
 const use:Building['use']=serial%17===0?'Mixed use':'Residential',units:Unit[]=[];
 for(let floor=0;floor<floors;floor++)for(let u=1;u<=2;u++){
   const tenure:Unit['tenure']=floor===0&&u===1?'Owner occupied':rng()<.14?'Vacant':'Rented';
   const number=floor===0?`G0${u}`:`${floor}0${u}`,bedrooms=width*depth>225?2:1;
   units.push({id:`${id}/F${floor}/U${u}`,number,floor,area:unitUsableArea(width,depth,bedrooms),occupant:tenure==='Vacant'?'Unoccupied':tenure==='Owner occupied'?owner:pick(names),tenure,rent:tenure==='Rented'?(12+Math.floor(rng()*17))*1000:0,leaseStart:'2026-04-01',leaseEnd:'2027-03-31',bedrooms});
 }
 buildings.push({id,ulpin:special?'11007500003527':`110075${String(serial+10000000).padStart(8,'0')}`,parcelId:special?'PAR-REF-D5-14':`PAR-REF-${blockId}-${serial}`,blockId,name:special?'Lake View Residence':`${pick(['Cedar','Parkside','Ashoka','Gulmohar','Garden','Palm','Maple'])} Residence`,address:special?'12, Lake View Road':`${serial*2}, ${horizontal[Math.min(4,Math.max(0,Math.round((z+half)/spacing)))]}, Block ${blockId}`,floors,floorHeight:3.2,height:floors*3.2,use,owner,parcel,color:special?'#dbd2c5':pick(colors),roofColor:pick(['#c4c6bf','#d1cec2','#babeb9','#c9c7bd']),variant:special?3:Math.floor(rng()*4),units,registeredOn:'2025-06-12',surveyNumber:`DEMO/REF2/${blockId}/${serial}`,x,z,width,depth});
}
for(let row=0;row<4;row++)for(let col=0;col<4;col++){
 const cx=(col-1.5)*spacing,cz=(row-1.5)*spacing,blockId=`${String.fromCharCode(65+row)}${col+1}`;
 blocks.push({id:blockId,x:cx,z:cz,width:60,depth:60});
 if(col===2&&row===1){
   parks.push({id:'PARK-REFERENCE',name:'Public Park',x:19,z:-36,width:25,depth:55});
   addBuilding(52,-14,{x:52,z:-18.25,width:22.5,depth:22.5},blockId,true);
   addBuilding(52,-49,{x:52,z:-49,width:28,depth:29},blockId);
   continue;
 }
 for(let iz=0;iz<2;iz++)for(let ix=0;ix<2;ix++){
   const x=cx+(ix?15:-15),z=cz+(iz?15:-15);
   addBuilding(x+(rng()-.5)*1.1,z+(rng()-.5)*1.1,{x,z,width:30,depth:30},blockId);
 }
}
// Put the park in the south-west foreground of the selected property, as in the
// art-direction reference. This transforms the entire authored fixture together;
// it never changes imported data or the relative dimensions used by the checks.
for(const b of buildings){b.z=-b.z||0;b.parcel.z=-b.parcel.z||0;}
for(const item of [...blocks,...parks,...roads])item.z=-item.z||0;
for(const utility of utilities)utility.points=utility.points.map(([x,y,z])=>[x,y,-z||0]);
export const district:District={name:'Lake View Reference Neighbourhood',extent,blocks,buildings,parks,roads,utilities,defaultBuildingId:'BLD-0413',coordinateNote:'Reference-neighbourhood/2: authored synthetic local-metre geometry and fictional records. Approximate display near Delhi is not a surveyed location or issued property identity.'};

export const intersect=(a:Rect,b:Rect):Rect|null=>{
  const l=Math.max(a.x-a.width/2,b.x-b.width/2),r=Math.min(a.x+a.width/2,b.x+b.width/2),t=Math.max(a.z-a.depth/2,b.z-b.depth/2),bt=Math.min(a.z+a.depth/2,b.z+b.depth/2);
  return r>l&&bt>t?{x:(l+r)/2,z:(t+bt)/2,width:r-l,depth:bt-t}:null;
};
const area=(r:Rect|null)=>r?r.width*r.depth:0;
const round=(n:number)=>Math.round(n*100)/100;
export function utilityClearance(b:Rect,u:Utility):number {
  let min=Infinity;
  for(let i=1;i<u.points.length;i++) {
    const a=u.points[i-1],c=u.points[i];
    const dx=Math.max(b.x-b.width/2-Math.max(a[0],c[0]),Math.min(a[0],c[0])-(b.x+b.width/2),0);
    const dz=Math.max(b.z-b.depth/2-Math.max(a[2],c[2]),Math.min(a[2],c[2])-(b.z+b.depth/2),0);
    min=Math.min(min,Math.max(0,Math.hypot(dx,dz)-u.diameter/2000));
  }
  return round(min);
}
export function computeFindings(b:Building):Finding[] {
  const findings:Finding[]=[];
  const outside=round(area(b)-area(intersect(b,b.parcel)));
  if(outside>.01){
    const south=b.z+b.depth/2-(b.parcel.z+b.parcel.depth/2);
    const east=b.x+b.width/2-(b.parcel.x+b.parcel.width/2);
    const geometry=south>0?{x:b.x,z:b.z+b.depth/2-south/2,width:b.width,depth:south}:east>0?{x:b.x+b.width/2-east/2,z:b.z,width:east,depth:b.depth}:undefined;
    findings.push({id:`${b.id}-parcel`,buildingId:b.id,type:'Parcel',title:'Outside parcel boundary',value:outside,unit:'m²',severity:'critical',description:'Footprint area minus its intersection with the recorded demo parcel. Geometry-derived; not a legal determination.',geometry});
  }
  for(const road of roads){const geometry=intersect(b,road);if(geometry) findings.push({id:`${b.id}-${road.id}`,buildingId:b.id,type:'Road',title:`Road overlap · ${road.name}`,value:round(area(geometry)),unit:'m²',severity:'critical',description:`The building footprint intersects the ${road.widthMeters} m synthetic road corridor.`,geometry});}
  const water=utilities.filter(u=>u.kind==='Water').map(u=>({u,gap:utilityClearance(b,u)})).sort((a,c)=>a.gap-c.gap)[0];
  if(water.gap<2) findings.push({id:`${b.id}-utility`,buildingId:b.id,type:'Utility',title:'Water pipeline clearance',value:water.gap,unit:'m',severity:'warning',description:`Horizontal footprint-to-pipe-surface distance is ${water.gap} m; below the 2 m DEMO threshold. Pipe centre depth ${water.u.depth} m. This threshold is not a municipal regulation.`});
  return findings;
}
export const allFindings=buildings.flatMap(computeFindings);
export const getBuilding=(id:string)=>buildings.find(b=>b.id===id||b.ulpin===id)||buildings.find(b=>b.id===district.defaultBuildingId)!;
function coordinates(r:Rect){const p=(x:number,z:number)=>[77.05+x/(111320*Math.cos(28.62*Math.PI/180)),28.62-z/111320];return [[p(r.x-r.width/2,r.z-r.depth/2),p(r.x-r.width/2,r.z+r.depth/2),p(r.x+r.width/2,r.z+r.depth/2),p(r.x+r.width/2,r.z-r.depth/2),p(r.x-r.width/2,r.z-r.depth/2)]];}
export function exportGeoJSON(layer:'parcels'|'buildings'='parcels'){
 return {type:'FeatureCollection',name:`SYNTHETIC_Lake_View_${layer}`,properties:{synthetic:true,disclaimer:district.coordinateNote,notOfficialULPIN:true,geometryRole:layer==='parcels'?'authored_parcel':'authored_building_footprint'},features:buildings.map(b=>({type:'Feature',id:layer==='parcels'?b.parcelId:b.id,geometry:{type:'Polygon',coordinates:coordinates(layer==='parcels'?b.parcel:b)},properties:{synthetic:true,ulpin_demo:b.ulpin,building_id:b.id,parcel_id:b.parcelId,owner_fictional:b.owner,floors:b.floors,height_m:b.height,parcel_area_m2:area(b.parcel),footprint_m2:area(b)}}))};
}
