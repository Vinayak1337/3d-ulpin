import {entity,ref} from "./core-identity";
import {sourceFixture} from "./core-sources";
import {frameFixture,frameRef} from "./core-frames";

export const representationRef=(id="exterior",revision=1)=>({ref:{namespace:"representation" as const,id},revision});
export function geometryFixture() {
  const source=sourceFixture();
  return {
    identity:{entities:[entity("B1"),entity("U1","space"),entity("L1","level")],relations:[]},
    sources:{...source,links:[],assets:source.assets.map(a=>({...a,mediaType:"application/geo+json"})),parts:source.parts.map(p=>({...p,locators:[{kind:"feature" as const,featureId:"B1"}]}))},
    frames:{frames:[frameFixture().frames[1]],operations:[]},
    geometry:{representations:[{
      ref:{namespace:"representation" as const,id:"exterior"},revision:1,entity:ref("B1"),frame:frameRef("metric"),role:"exterior" as const,
      sourceParts:[{ref:{namespace:"source_part" as const,id:"p1"},revision:1}],
      geometry:{profile:"prism" as const,footprint:{type:"Polygon" as const,coordinates:[[[0,0],[10,0],[10,8],[0,8],[0,0]]]},interval:{lowerMetres:0,upperMetres:6,reference:{ref:{namespace:"benchmark",id:"target-zero"},revision:1}}},
    }],reportedQuantities:[]},
    request:{representation:representationRef(),definition:"horizontal_area" as const},
  };
}
export interface GeometryCase {id:string;input:unknown;valid:boolean;value?:number|null;reasonCode?:string|null;code?:string;capabilities?:Record<string,boolean>}
export function geometryCases():GeometryCase[] {
  const cases:GeometryCase[]=[];
  const good=(id:string,value:number|null,change:(x:any)=>void=()=>{},reasonCode:string|null=null,capabilities?:Record<string,boolean>)=>{
    const input=JSON.parse(JSON.stringify(geometryFixture()));change(input);cases.push({id,input,valid:true,value,reasonCode,capabilities});
  };
  const bad=(id:string,code:string,change:(x:any)=>void)=>{const input=JSON.parse(JSON.stringify(geometryFixture()));change(input);cases.push({id,input,valid:false,code});};
  const rep=(x:any)=>x.geometry.representations[0];
  good("independent-rectangle-area",80);
  good("existing-revision-zero-is-preserved",80,x=>{rep(x).revision=0;x.request.representation.revision=0;});
  good("independent-six-metre-volume",480,x=>x.request.definition="prism_volume",null,{prism_volume:true,interior_selection:false});
  good("courtyard-subtraction",76,x=>rep(x).geometry.footprint.coordinates.push([[2,2],[4,2],[4,4],[2,4],[2,2]]));
  good("concave-outline",32,x=>rep(x).geometry.footprint.coordinates=[[[0,0],[10,0],[10,2],[2,2],[2,8],[0,8],[0,0]]]);
  good("disjoint-multipart-sum",86,x=>{rep(x).geometry.footprint={type:"MultiPolygon",coordinates:[rep(x).geometry.footprint.coordinates,[[[20,0],[22,0],[22,3],[20,3],[20,0]]]]};});
  good("ring-order-does-not-change-area",80,x=>rep(x).geometry.footprint.coordinates[0].reverse());
  good("far-from-origin-keeps-area",80,x=>rep(x).geometry.footprint.coordinates[0]=rep(x).geometry.footprint.coordinates[0].map((p:number[])=>p.map(n=>n+1e9)));
  good("millimetres-are-normalized-before-area",80,x=>{x.frames.frames[0].horizontalUnit="mm";rep(x).geometry.footprint.coordinates[0]=rep(x).geometry.footprint.coordinates[0].map((p:number[])=>p.map(n=>n*1000));});
  good("feet-are-not-square-metres",7.4322432,x=>x.frames.frames[0].horizontalUnit="ft");
  good("known-zero-volume-is-not-missing",0,x=>{x.request.definition="prism_volume";rep(x).geometry.interval.upperMetres=0;},null,{prism_volume:true,exterior_render:false});
  good("three-four-five-and-three-length",8,x=>{x.request.definition="planar_length";rep(x).role="alignment";rep(x).geometry={profile:"planar",geometry:{type:"LineString",coordinates:[[0,0],[3,4],[6,4]]}};});
  good("unknown-height-does-not-block-area",80,x=>rep(x).geometry.interval=null,null,{horizontal_measurement:true,prism_volume:false});
  good("unknown-height-blocks-volume",null,x=>{rep(x).geometry.interval=null;x.request.definition="prism_volume";},"UNKNOWN_VERTICAL_INTERVAL");
  good("unknown-datum-does-not-block-area",80,x=>{rep(x).geometry.interval=null;x.frames.frames[0].vertical={kind:"unknown",reason:"No datum"};});
  good("unplaced-geometry-remains-previewable",null,x=>{rep(x).frame=null;rep(x).geometry.interval=null;},"ENGINEERING_FRAME_REQUIRED",{local_preview:true,horizontal_measurement:false});
  good("display-is-not-analysis",null,x=>rep(x).role="display_only","NON_ANALYTICAL_ROLE");
  good("unspecified-is-not-analysis",null,x=>rep(x).role="unspecified","NON_ANALYTICAL_ROLE");
  good("roof-outline-does-not-prove-volume",null,x=>{rep(x).role="roof_projection";x.request.definition="prism_volume";},"QUANTITY_GEOMETRY_ROLE");
  good("native-asset-does-not-prove-solid",null,x=>rep(x).geometry={profile:"asset",asset:{ref:{namespace:"asset",id:"a1"},revision:1},format:"native"},"NO_INLINE_GEOMETRY",{prism_volume:false,local_preview:false});
  good("unavailable-is-not-zero",null,x=>{rep(x).geometry={profile:"unavailable",reason:"Registry without geometry"};rep(x).frame=null;},"NO_INLINE_GEOMETRY");
  good("identified-unit-is-selectable",80,x=>{rep(x).entity=ref("U1");rep(x).role="unit_boundary";},null,{interior_selection:true});
  good("exterior-does-not-invent-interiors",80,()=>{},null,{interior_selection:false});
  good("zero-document-geometry",80,x=>{x.sources={datasets:[],assets:[],sources:[],parts:[],links:[]};rep(x).sourceParts=[];});
  good("point-is-not-area",null,x=>rep(x).geometry={profile:"planar",geometry:{type:"Point",coordinates:[0,0]}},"POLYGON_REQUIRED");
  good("overflow-is-not-a-plausible-quantity",null,x=>{rep(x).geometry.footprint.coordinates[0]=rep(x).geometry.footprint.coordinates[0].map((p:number[])=>p.map(n=>n*1e110));rep(x).geometry.interval.upperMetres=1e110;x.request.definition="prism_volume";},"QUANTITY_NUMERIC",{prism_volume:false,exterior_render:false,horizontal_measurement:true});
  bad("unknown-entity","MISSING_TARGET",x=>rep(x).entity=ref("missing"));
  bad("stale-frame","STALE_REFERENCE",x=>rep(x).frame.revision=2);
  bad("stale-part","STALE_REFERENCE",x=>rep(x).sourceParts[0].revision=2);
  bad("vague-source-is-not-geometry-evidence","LOCATOR_NOT_QUALIFIED",x=>x.sources.parts[0].locators=[{kind:"verbatim",locator:"Somewhere in the file"}]);
  bad("duplicate-part","DUPLICATE_REFERENCE",x=>rep(x).sourceParts.push(rep(x).sourceParts[0]));
  bad("duplicate-representation","DUPLICATE_RECORD",x=>x.geometry.representations.push(rep(x)));
  bad("stale-measurement-revision","STALE_REFERENCE",x=>x.request.representation.revision=2);
  bad("planar-Z-cannot-be-dropped","INVALID_CONTRACT",x=>rep(x).geometry.footprint.coordinates[0][0].push(1));
  bad("unclosed-polygon","GEOMETRY_RING",x=>rep(x).geometry.footprint.coordinates[0][4]=[1,1]);
  bad("collinear-polygon","GEOMETRY_DEGENERATE",x=>rep(x).geometry.footprint.coordinates=[[[0,0],[1,0],[2,0],[0,0]]]);
  bad("asymmetric-bow-tie","GEOMETRY_TOPOLOGY",x=>rep(x).geometry.footprint.coordinates=[[[0,0],[10,8],[0,8],[8,0],[0,0]]]);
  bad("hole-outside-shell","GEOMETRY_TOPOLOGY",x=>rep(x).geometry.footprint.coordinates.push([[20,20],[22,20],[22,22],[20,22],[20,20]]));
  bad("overlapping-holes","GEOMETRY_TOPOLOGY",x=>rep(x).geometry.footprint.coordinates.push([[2,2],[6,2],[6,6],[2,6],[2,2]],[[4,4],[8,4],[8,7],[4,7],[4,4]]));
  bad("overlapping-parts","GEOMETRY_TOPOLOGY",x=>{const p=rep(x).geometry.footprint.coordinates;rep(x).geometry.footprint={type:"MultiPolygon",coordinates:[p,p]};});
  bad("reversed-positive-up-bounds","GEOMETRY_INTERVAL",x=>rep(x).geometry.interval.upperMetres=-1);
  bad("prism-without-datum","VERTICAL_UNRESOLVED",x=>x.frames.frames[0].vertical={kind:"unknown",reason:"Absent"});
  bad("wrong-prism-benchmark","VERTICAL_MISMATCH",x=>rep(x).geometry.interval.reference.ref.id="unrelated");
  bad("topology-work-is-bounded","GEOMETRY_BUDGET",x=>{const ring=Array.from({length:1000},(_,i)=>[Math.cos(i*2*Math.PI/1000),Math.sin(i*2*Math.PI/1000)]);ring.push(ring[0]);rep(x).geometry.footprint.coordinates=[ring];});
  const reported=(x:any)=>{x.geometry.reportedQuantities=[{ref:{namespace:"reported_quantity",id:"q1"},revision:1,entity:ref("B1"),definition:"gross_floor_area",unit:"m2",amount:{state:"known",value:100},sourcePart:{ref:{namespace:"source_part",id:"p1"},revision:1}}];};
  good("reported-gross-area-does-not-replace-footprint",80,reported);
  bad("reported-unit-mismatch","QUANTITY_UNIT",x=>{reported(x);x.geometry.reportedQuantities[0].unit="m3";});
  bad("reported-value-negative","INVALID_CONTRACT",x=>{reported(x);x.geometry.reportedQuantities[0].amount.value=-1;});
  const conflict=(x:any)=>{reported(x);const first=x.geometry.reportedQuantities[0],second={...first,ref:{namespace:"reported_quantity",id:"q2"},amount:{state:"known",value:120}};x.geometry.reportedQuantities.push(second,{...first,ref:{namespace:"reported_quantity",id:"q3"},amount:{state:"conflicting",candidates:[{ref:first.ref,revision:1},{ref:second.ref,revision:1}],reason:"Two sources disagree"}});};
  good("reported-disagreement-is-retained-separately",80,conflict);
  bad("conflict-cannot-mix-net-and-gross","QUANTITY_CONFLICT",x=>{conflict(x);x.geometry.reportedQuantities[1].definition="net_floor_area";});
  bad("conflict-cannot-use-stale-value","STALE_REFERENCE",x=>{conflict(x);x.geometry.reportedQuantities[2].amount.candidates[1].revision=2;});
  bad("conflict-cannot-repeat-one-value","DUPLICATE_REFERENCE",x=>{conflict(x);x.geometry.reportedQuantities[2].amount.candidates[1]=x.geometry.reportedQuantities[2].amount.candidates[0];});
  bad("conflict-cannot-reference-itself","QUANTITY_CONFLICT",x=>{conflict(x);x.geometry.reportedQuantities[2].amount.candidates[0]={ref:{namespace:"reported_quantity",id:"q3"},revision:1};});
  bad("equal-quantities-are-not-a-disagreement","QUANTITY_CONFLICT",x=>{conflict(x);x.geometry.reportedQuantities[1].amount.value=100;});
  return cases;
}
