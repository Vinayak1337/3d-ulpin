import type {CoreFrameCatalog,CorePointTransform} from "../../packages/contracts/src/spatial/core/frame-schema";

export const frameRef=(id:string,revision=1)=>({ref:{namespace:"frame" as const,id},revision});
export const opRef=(id:string,revision=1)=>({ref:{namespace:"transform" as const,id},revision});
const benchmark=(id:string)=>({kind:"benchmark" as const,reference:{ref:{namespace:"benchmark",id},revision:1},label:id});
export function frameFixture():CoreFrameCatalog {
  return {
    frames:[
      {ref:{namespace:"frame",id:"feet"},revision:1,label:"North/east feet, positive down",sourceCrs:null,kind:"engineering",horizontalUnit:"ft",axes:["north","east"],verticalUnit:"ft",verticalDirection:"down",vertical:benchmark("source-zero")},
      {ref:{namespace:"frame",id:"metric"},revision:1,label:"Metre ENU",sourceCrs:null,kind:"engineering",horizontalUnit:"m",axes:["east","north"],verticalUnit:"m",verticalDirection:"up",vertical:benchmark("target-zero")},
      {ref:{namespace:"frame",id:"ecef"},revision:1,label:"WGS84 ECEF",sourceCrs:"EPSG:4978",kind:"geocentric",crs:"EPSG:4978",unit:"m",axes:"X-Y-Z"},
    ],
    operations:[
      {ref:{namespace:"transform",id:"registration"},revision:1,from:frameRef("feet"),to:frameRef("metric"),provenance:"Authored numeric fixture; not a survey",accuracyMetres:null,kind:"local_rigid",rotationDegrees:90,translationMetres:[10,20],sourceDomain:{minEast:-100,minNorth:-100,maxEast:100,maxNorth:100},verticalTie:{kind:"constant_offset",offsetMetres:100}},
      {ref:{namespace:"transform",id:"world"},revision:1,from:frameRef("metric"),to:frameRef("ecef"),provenance:"Authored equatorial benchmark",accuracyMetres:null,kind:"wgs84_enu",sourceDomain:null,benchmark:benchmark("target-zero").reference,origin:{longitude:0,latitude:0,ellipsoidHeightMetres:100}},
    ],
  };
}
export function frameRequest():CorePointTransform {
  return {from:frameRef("feet"),to:frameRef("metric"),point:[10,20,5],steps:[{operation:opRef("registration"),direction:"forward"}]};
}
export interface FrameConformanceCase {id:string;catalog:unknown;request:unknown;valid:boolean;expectedPoint?:readonly number[];tolerance?:number;code?:string}
export function frameCases():FrameConformanceCase[] {
  const cases:FrameConformanceCase[]=[];
  const add=(id:string,expectedPoint:readonly number[]|string,change:(c:any,r:any)=>void=()=>{},tolerance=1e-10)=>{
    const catalog=JSON.parse(JSON.stringify(frameFixture())),request=JSON.parse(JSON.stringify(frameRequest()));change(catalog,request);
    cases.push({id,catalog,request,valid:typeof expectedPoint!=="string",...(typeof expectedPoint==="string"?{code:expectedPoint}:{expectedPoint,tolerance})});
  };
  add("feet-permuted-axes-rotation-vertical-tie",[6.952,26.096,98.476]);
  add("inverse-registration",[10,20,5],(_c,r)=>{r.from=frameRef("metric");r.to=frameRef("feet");r.point=[6.952,26.096,98.476];r.steps[0].direction="inverse";});
  add("horizontal-only-needs-no-vertical-tie",[6.952,26.096],(c,r)=>{c.frames[0].vertical={kind:"unknown",reason:"Not provided"};c.operations[0].verticalTie={kind:"unavailable",reason:"No level tie"};r.point=[10,20];});
  add("same-frame-no-op",[10,20,5],(_c,r)=>{r.to=frameRef("feet");r.steps=[];});
  add("millimetres-to-metres",[1,2,3],(c,r)=>{c.frames[0].horizontalUnit="mm";c.frames[0].verticalUnit="mm";c.frames[0].verticalDirection="up";c.frames[0].axes=["east","north"];c.frames[0].vertical=c.frames[1].vertical;c.operations[0].rotationDegrees=0;c.operations[0].translationMetres=[0,0];c.operations[0].verticalTie={kind:"same_reference"};r.point=[1000,2000,3000];});
  add("legacy-survey-foot-is-not-international-foot",[3.048006096012192,6.096012192024384],(c,r)=>{c.frames[0].horizontalUnit="us_ft";c.frames[0].axes=["east","north"];c.operations[0].rotationDegrees=0;c.operations[0].translationMetres=[0,0];r.point=[10,20];});
  add("west-south-axis-signs",[-3.048,-6.096],(c,r)=>{c.frames[0].axes=["west","south"];c.operations[0].rotationDegrees=0;c.operations[0].translationMetres=[0,0];r.point=[10,20];});
  add("negative-vertical-tie",[6.952,26.096,-11.524],c=>{c.operations[0].verticalTie.offsetMetres=-10;});
  const world=(c:any,r:any)=>{r.from=frameRef("metric");r.to=frameRef("ecef");r.point=[1,2,3];r.steps=[{operation:opRef("world"),direction:"forward"}];};
  add("equatorial-wgs84-basis",[6378240,1,2],world,1e-8);
  add("equatorial-east-90-basis",[-1,6378140,2],(c,r)=>{world(c,r);c.operations[1].origin={longitude:90,latitude:0,ellipsoidHeightMetres:0};},1e-8);
  add("polar-wgs84-basis",[-2,1,6356755.314245179],(c,r)=>{world(c,r);c.operations[1].origin={longitude:0,latitude:90,ellipsoidHeightMetres:0};},1e-8);
  add("inverse-world-basis",[1,2,3],(c,r)=>{world(c,r);r.from=frameRef("ecef");r.to=frameRef("metric");r.point=[6378240,1,2];r.steps[0].direction="inverse";},1e-8);
  add("two-step-independent-world-answer",[6378335.476,6.952,26.096],(_c,r)=>{r.to=frameRef("ecef");r.steps.push({operation:opRef("world"),direction:"forward"});},1e-8);
  add("stale-source-frame","STALE_REFERENCE",c=>{c.operations[0].from.revision=2;});
  add("missing-target-frame","MISSING_REFERENCE",c=>{c.operations[0].to=frameRef("missing");});
  add("duplicate-operation","DUPLICATE_RECORD",c=>c.operations.push(c.operations[0]));
  add("duplicate-frame","DUPLICATE_RECORD",c=>c.frames.push(c.frames[0]));
  add("axes-are-not-two-horizontal-directions","FRAME_AXES",c=>{c.frames[0].axes=["east","west"];});
  add("reversed-source-domain","FRAME_BOUNDS",c=>{c.operations[0].sourceDomain.minEast=101;});
  add("unknown-vertical-cannot-be-fixed-by-offset","VERTICAL_UNRESOLVED",c=>{c.frames[0].vertical={kind:"unknown",reason:"Absent"};});
  add("surface-depth-cannot-be-fixed-by-offset","VERTICAL_UNRESOLVED",c=>{c.frames[0].vertical={kind:"surface_relative",surface:{ref:{namespace:"surface",id:"ground"},revision:1},label:"Depth below terrain"};});
  add("unavailable-vertical-blocks-3d","VERTICAL_UNRESOLVED",c=>{c.operations[0].verticalTie={kind:"unavailable",reason:"No tie"};});
  add("different-benchmarks-not-same-reference","VERTICAL_MISMATCH",c=>{c.operations[0].verticalTie={kind:"same_reference"};});
  add("one-benchmark-cannot-have-two-zeros","VERTICAL_MISMATCH",c=>{c.frames[0].vertical=c.frames[1].vertical;});
  add("ellipsoidal-origin-not-default-zero","INVALID_CONTRACT",c=>{delete c.operations[1].origin.ellipsoidHeightMetres;});
  add("latitude-out-of-bounds","INVALID_CONTRACT",c=>{c.operations[1].origin.latitude=91;});
  add("world-tie-to-wrong-benchmark","VERTICAL_MISMATCH",c=>{c.operations[1].benchmark=benchmark("source-zero").reference;});
  add("world-requires-explicit-z","POINT_DIMENSION",(c,r)=>{world(c,r);r.point=[1,2];});
  add("stale-operation","STALE_REFERENCE",(_c,r)=>{r.steps[0].operation.revision=2;});
  add("disjoint-path","TRANSFORM_PATH",(_c,r)=>{r.steps=[{operation:opRef("world"),direction:"forward"}];});
  add("cyclic-path","TRANSFORM_CYCLE",(_c,r)=>{r.to=frameRef("feet");r.steps.push({operation:opRef("registration"),direction:"inverse"});});
  add("empty-path-cannot-change-frame","TRANSFORM_PATH",(_c,r)=>{r.steps=[];});
  add("outside-forward-domain","OUTSIDE_DOMAIN",(_c,r)=>{r.point=[1000,1000];});
  add("outside-inverse-domain","OUTSIDE_DOMAIN",(_c,r)=>{r.from=frameRef("metric");r.to=frameRef("feet");r.point=[1000,1000];r.steps[0].direction="inverse";});
  add("unqualified-geodetic-profile","TRANSFORM_PROFILE",c=>{const {rotationDegrees,translationMetres,sourceDomain,verticalTie,...base}=c.operations[0];c.operations[0]={...base,kind:"unsupported",profile:"grid-shift",reason:"No qualified grid operation"};});
  add("source-precision-is-not-invented",[6.952,26.096],(_c,r)=>{r.point=[10,20];});
  return cases;
}
