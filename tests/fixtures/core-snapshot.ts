import {geometryFixture} from "./core-geometry";
import {ref} from "./core-identity";
import {buildCoreSnapshot} from "../../packages/contracts/src/spatial/core/snapshot";

export const snapshotRef=(namespace:string,id:string,revision=1)=>({ref:{namespace,id},revision});
export function snapshotFixture() {
  const g=geometryFixture(),world=snapshotRef("world","two-block-fixture");
  const base=g.geometry.representations[0];
  const footprint={...base,ref:{namespace:"representation",id:"footprint"},role:"ground_footprint",geometry:{profile:"planar",geometry:base.geometry.footprint}};
  const unit={...base,ref:{namespace:"representation",id:"unit-plan"},entity:ref("U1"),role:"unit_boundary",sourceParts:[snapshotRef("source_part","unit-part")],geometry:{profile:"planar",geometry:{type:"Polygon",coordinates:[[[0,0],[10,0],[10,4],[0,4],[0,0]]]}}};
  const original=g.sources.assets[0],source=g.sources.sources[0],part=g.sources.parts[0];
  const sources={...g.sources,
    assets:[original,{...original,ref:ref("height-asset","asset"),sha256:"b".repeat(64),mediaType:"text/csv",storage:{state:"registered",blobRef:ref("height-bytes","source_blob")}},
      {...original,ref:ref("unit-asset","asset"),sha256:"c".repeat(64),storage:{state:"registered",blobRef:ref("unit-bytes","source_blob")}}],
    sources:[source,{...source,ref:ref("height-source","source_revision"),family:ref("height-family","source_family"),familyOrdinal:1,profile:"level-schedule",assets:[snapshotRef("asset","height-asset")]},
      {...source,ref:ref("unit-source","source_revision"),family:ref("unit-family","source_family"),familyOrdinal:1,profile:"unit-plan",assets:[snapshotRef("asset","unit-asset")]}],
    parts:[part,{...part,ref:ref("height-part","source_part"),source:snapshotRef("source_revision","height-source"),asset:snapshotRef("asset","height-asset"),locators:[{kind:"rows",range:{start:1,end:2}}]},
      {...part,ref:ref("unit-part","source_part"),source:snapshotRef("source_revision","unit-source"),asset:snapshotRef("asset","unit-asset"),locators:[{kind:"feature",featureId:"U1"}]}],
  };
  const observe=(id:string,entity:string,role:string,sourceParts:unknown[],payload:unknown)=>({ref:ref(id,"observation"),revision:1,entity:ref(entity),world,role,sourceParts,payload,method:"synthetic",access:"operator",validity:{fromMs:0,toMs:2000}});
  const observations=[
    observe("footprint","B1","ground_footprint",footprint.sourceParts,{kind:"geometry",representation:snapshotRef("representation","footprint")}),
    observe("height-six","B1","vertical_interval",[snapshotRef("source_part","height-part")],{kind:"vertical_interval",frame:base.frame,interval:base.geometry.interval}),
    observe("height-nine","B1","vertical_interval",[snapshotRef("source_part","height-part")],{kind:"vertical_interval",frame:base.frame,interval:{...base.geometry.interval,upperMetres:9}}),
    observe("unit","U1","unit_boundary",unit.sourceParts,{kind:"geometry",representation:snapshotRef("representation","unit-plan")}),
  ];
  const resolve=(id:string,entity:string,role:string,candidates:string[],selected:string)=>({ref:ref(id,"resolution"),revision:1,entity:ref(entity),world,role,candidates:candidates.map(id=>snapshotRef("observation",id)),selected:snapshotRef("observation",selected),reason:"Explicit authored fixture selection, not a latest-file rule"});
  return {
    schemaVersion:"ulpin-spatial/2",context:{world,asOfMs:1000,scope:{id:"local-operator",revision:1,ceiling:"operator"}},
    worlds:[{...world,label:"Synthetic two-block composition",state:"synthetic"}],identity:g.identity,frames:g.frames,sources,
    geometry:{representations:[footprint,unit],reportedQuantities:[]},observations,
    resolutions:[resolve("footprint","B1","ground_footprint",["footprint"],"footprint"),resolve("height","B1","vertical_interval",["height-six","height-nine"],"height-six"),resolve("unit","U1","unit_boundary",["unit"],"unit")],
    compositions:[
      {ref:ref("keep-footprint","composition"),revision:1,world,entity:ref("B1"),kind:"passthrough",geometry:snapshotRef("resolution","footprint")},
      {ref:ref("build-exterior","composition"),revision:1,world,entity:ref("B1"),kind:"prism",footprint:snapshotRef("resolution","footprint"),vertical:snapshotRef("resolution","height"),output:{ref:ref("exterior","representation"),revision:1,role:"exterior"}},
      {ref:ref("keep-unit","composition"),revision:1,world,entity:ref("U1"),kind:"passthrough",geometry:snapshotRef("resolution","unit")},
    ],
  };
}

export interface SnapshotCase {id:string;input:unknown;valid:boolean;code?:string;representationIds?:string[];reportedIds?:string[];volume?:number;unavailable?:string;temporalCoverage?:string}
export function snapshotCases():SnapshotCase[] {
  const rows:SnapshotCase[]=[];
  const good=(id:string,mutate:(x:any)=>void=()=>{},expected:Partial<SnapshotCase>={})=>{const input=JSON.parse(JSON.stringify(snapshotFixture()));mutate(input);rows.push({id,input,valid:true,representationIds:["exterior","footprint","unit-plan"],volume:480,...expected});};
  const bad=(id:string,code:string,mutate:(x:any)=>void)=>{const input=JSON.parse(JSON.stringify(snapshotFixture()));mutate(input);rows.push({id,input,valid:false,code});};
  good("footprint-schedule-unit-source-composition");
  good("explicit-other-height-not-newest-source",x=>x.resolutions[1].selected=snapshotRef("observation","height-nine"),{volume:720});
  good("failed-height-retains-footprint-and-unit",x=>x.observations[1].payload={kind:"unavailable",reasonCode:"HEIGHT_PARSE_FAILED",reason:"Original retained; failed schedule contribution"},{representationIds:["footprint","unit-plan"],volume:undefined,unavailable:"HEIGHT_PARSE_FAILED"});
  good("missing-height-keeps-valid-2d",x=>x.observations[1].payload.interval=null,{representationIds:["footprint","unit-plan"],volume:undefined,unavailable:"UNKNOWN_VERTICAL_INTERVAL"});
  good("unresolved-selection-not-guessed",x=>x.resolutions[1].selected=null,{representationIds:["footprint","unit-plan"],volume:undefined,unavailable:"UNRESOLVED_SELECTION"});
  good("half-open-validity-rejects-end-bound",x=>x.observations[1].validity.toMs=1000,{representationIds:["footprint","unit-plan"],volume:undefined,unavailable:"OUTSIDE_VALIDITY"});
  good("unknown-validity-is-explicit",x=>x.observations.forEach((o:any)=>o.validity={fromMs:null,toMs:null}),{temporalCoverage:"unknown"});
  good("bounded-validity-is-explicit",()=>{},{temporalCoverage:"bounded"});
  good("zero-source-documents-still-compose",x=>{x.sources={datasets:[],assets:[],sources:[],parts:[],links:[]};x.geometry.representations.forEach((r:any)=>r.sourceParts=[]);x.observations.forEach((o:any)=>o.sourceParts=[]);});
  good("same-label-different-frame-does-not-compose",x=>{x.frames.frames.push({...x.frames.frames[0],ref:ref("other","frame")});x.observations[1].payload.frame=snapshotRef("frame","other");},{representationIds:["footprint","unit-plan"],volume:undefined,unavailable:"FRAME_MISMATCH"});
  good("unplaced-footprint-not-placed-by-height",x=>x.geometry.representations[0].frame=null,{representationIds:["footprint","unit-plan"],volume:undefined,unavailable:"FRAME_UNRESOLVED"});
  const quantities=(x:any)=>{
    const sourcePart=snapshotRef("source_part","p1");
    x.geometry.reportedQuantities=[{ref:ref("gross","reported_quantity"),revision:1,entity:ref("B1"),definition:"gross_floor_area",unit:"m2",amount:{state:"known",value:100},sourcePart},
      {ref:ref("net","reported_quantity"),revision:1,entity:ref("B1"),definition:"net_floor_area",unit:"m2",amount:{state:"known",value:70},sourcePart}];
    for(const q of x.geometry.reportedQuantities){
      const observation={...x.observations[0],ref:ref(q.ref.id,"observation"),role:q.definition,payload:{kind:"reported_quantity",quantity:{ref:q.ref,revision:1}}};
      x.observations.push(observation);
      x.resolutions.push({...x.resolutions[0],ref:ref(q.ref.id,"resolution"),role:q.definition,candidates:[snapshotRef("observation",q.ref.id)],selected:snapshotRef("observation",q.ref.id)});
    }
  };
  good("reported-net-and-gross-remain-independent",quantities,{reportedIds:["gross","net"]});
  good("reported-conflict-preserves-required-known-candidates",x=>{
    quantities(x);const a=x.geometry.reportedQuantities[0];
    const b={...a,ref:ref("gross-other","reported_quantity"),amount:{state:"known",value:120}};
    const c={...a,ref:ref("gross-conflict","reported_quantity"),amount:{state:"conflicting",reason:"Source disagreement",candidates:[{ref:a.ref,revision:1},{ref:b.ref,revision:1}]}};
    x.geometry.reportedQuantities.push(b,c);x.observations[4].payload.quantity={ref:c.ref,revision:1};
  },{reportedIds:["gross-conflict","gross-other","gross","net"].sort()});
  good("other-world-does-not-leak-selected-features",x=>{
    const world=snapshotRef("world","empty-world");x.worlds.push({...world,label:"Separate empty scenario",state:"planned"});x.context.world=world;
  },{representationIds:[],volume:undefined});
  bad("stale-snapshot-world","STALE_REFERENCE",x=>x.context.world.revision=2);
  bad("observation-stale-world","STALE_REFERENCE",x=>x.observations[0].world={...x.observations[0].world,revision:2});
  bad("missing-observation-target","MISSING_TARGET",x=>x.observations[1].entity=ref("missing"));
  bad("stale-representation-observation","STALE_REFERENCE",x=>x.observations[0].payload.representation.revision=2);
  bad("missing-geometry-provenance","OBSERVATION_PROVENANCE",x=>x.observations[0].sourceParts=[]);
  bad("vertical-cannot-use-whole-file-locator","LOCATOR_NOT_QUALIFIED",x=>x.sources.parts[1].locators=[{kind:"whole_asset"}]);
  bad("wrong-observation-role","OBSERVATION_ROLE",x=>x.observations[0].role="roof_projection");
  bad("wrong-vertical-role","OBSERVATION_ROLE",x=>x.observations[1].role="ground_footprint");
  bad("bad-time-range","TIME_RANGE",x=>x.observations[1].validity={fromMs:10,toMs:10});
  bad("synthetic-not-an-observed-world","WORLD_CLASSIFICATION",x=>x.worlds[0].state="observed");
  bad("source-dataset-cannot-be-relabeled-observed","WORLD_CLASSIFICATION",x=>{x.worlds[0].state="observed";x.observations.forEach((o:any)=>o.method="source");x.sources.sources.forEach((s:any)=>s.method="source");});
  bad("public-scope-cannot-read-private-input","ACCESS_SCOPE",x=>x.context.scope.ceiling="public");
  bad("declared-observation-access-cannot-downgrade","ACCESS_DOWNGRADE",x=>x.observations[0].access="public");
  bad("restricted-asset-ancestor-cannot-be-hidden","ACCESS_DOWNGRADE",x=>{
    x.context.scope.ceiling="restricted";
    x.sources.assets.push({...x.sources.assets[0],ref:ref("private-parent","asset"),access:"restricted",storage:{state:"registered",blobRef:ref("private-original","source_blob")}});
    x.sources.assets[0].kind="derived";x.sources.assets[0].retention={...x.sources.assets[0].retention,policy:"managed_derivative"};x.sources.assets[0].parentAssets=[snapshotRef("asset","private-parent")];
  });
  bad("stale-selected-observation","RESOLUTION_SELECTION",x=>x.resolutions[1].selected.revision=2);
  bad("stale-candidate-observation","STALE_REFERENCE",x=>x.resolutions[1].candidates[0].revision=2);
  bad("wrong-entity-resolution","RESOLUTION_SCOPE",x=>x.resolutions[1].entity=ref("U1"));
  bad("duplicate-selection-policy","DUPLICATE_REFERENCE",x=>x.resolutions.push({...x.resolutions[0],ref:ref("other-policy","resolution")}));
  bad("selected-noncandidate","RESOLUTION_SELECTION",x=>x.resolutions[1].selected=snapshotRef("observation","unit"));
  bad("different-world-candidate","RESOLUTION_SCOPE",x=>{const world=snapshotRef("world","other-world");x.worlds.push({...world,label:"Other scenario",state:"synthetic"});x.observations[1].world=world;});
  bad("different-entity-composition","COMPOSITION_SCOPE",x=>x.compositions[1].entity=ref("U1"));
  bad("wrong-composition-source-role","COMPOSITION_ROLE",x=>x.compositions[1].footprint=snapshotRef("resolution","height"));
  bad("output-cannot-overwrite-original-representation","OUTPUT_ID_COLLISION",x=>x.compositions[1].output.ref.id="footprint");
  bad("two-generators-cannot-allocate-one-id","OUTPUT_ID_COLLISION",x=>x.compositions.push({...x.compositions[1],ref:ref("other-generator","composition")}));
  bad("unsupported-composition-cannot-smuggle-code","INVALID_CONTRACT",x=>x.compositions[1].script="return guessed_geometry()");
  bad("unpaired-unicode-is-not-a-portable-signature","SIGNATURE_UNICODE",x=>x.worlds[0].label="\ud800");
  return rows;
}

// Encodings are manually specified; digests were independently computed with hashlib.
export const signatureCases=[
  {id:"null",value:null,expectedEncoding:"z",expectedDigest:"594e519ae499312b29433b7dd8a97ff068defcba9755b6d5d00e84c524d67b06"},
  {id:"one",value:1,expectedEncoding:"n3ff0000000000000",expectedDigest:"73af61a19efb83c5922f1e2d07eceae40f55d2c60d0ffe1664f75e66f8f6c8da"},
  {id:"fraction",value:1.5,expectedEncoding:"n3ff8000000000000",expectedDigest:"673d4b6d67133a213da9eb3a2f2b42b0fa66ddd94c03e59787a1e75b60d26ccf"},
  {id:"record",value:{b:true,a:1},expectedEncoding:"o2:s1:an3ff0000000000000s1:bt",expectedDigest:"064e0488881c8b4ec8f5ec135a8e51f71061cef522f6221458529ac9dab9ffca"},
  {id:"utf8",value:"\u00e9",expectedEncoding:"s2:\u00e9",expectedDigest:"0566c2f70ee0c7b722fdbd0dae5e0e79e0e84ab169d7956b688da7823e471650"},
  {id:"array",value:[null,true,""],expectedEncoding:"a3:zts0:",expectedDigest:"c84ab5a93be130801c54909ccd19f1c71d737315a1550cee0b4a115b6fd687a6"},
  {id:"unicode-keys",value:{"\u{10000}":1,"\ue000":0},expectedEncoding:"o2:s3:\ue000n0000000000000000s4:\u{10000}n3ff0000000000000",expectedDigest:"ad0b977cdfbc27ee6f0972dd99acfdfb326659a0aabb0f592c0eac5bf68b6ce1"},
];
export async function publicationCases(){
  const snapshot=(await buildCoreSnapshot(snapshotFixture())).manifest;
  const candidate={schemaVersion:"ulpin-core-publication/1",state:"candidate",scope:snapshot.context.scope,snapshotDigest:snapshot.inputDigest,geometryDigest:snapshot.geometryDigest,compiler:"qualified-test-compiler/1",assets:[{id:"tile",sha256:"a".repeat(64),bytes:100,mediaType:"model/gltf-binary"}],bindings:[{assetId:"tile",featureId:"building-1",representation:snapshotRef("representation","exterior")}]};
  const cases:{id:string;snapshot:unknown;candidate:unknown;valid:boolean;code?:string}[]=[{id:"candidate-not-activation",snapshot,candidate,valid:true}];
  const bad=(id:string,code:string,change:(c:any)=>void)=>{const copy=JSON.parse(JSON.stringify(candidate));change(copy);cases.push({id,snapshot,candidate:copy,valid:false,code});};
  bad("cannot-self-publish","INVALID_CONTRACT",c=>c.state="active");
  bad("wrong-snapshot-digest","PUBLICATION_SNAPSHOT",c=>c.snapshotDigest="b".repeat(64));
  bad("wrong-geometry-digest","PUBLICATION_SNAPSHOT",c=>c.geometryDigest="b".repeat(64));
  bad("different-scope","ACCESS_SCOPE",c=>c.scope.id="unrelated");
  bad("missing-asset","MISSING_REFERENCE",c=>c.assets=[]);
  bad("stale-feature-revision","STALE_REFERENCE",c=>c.bindings[0].representation.revision=2);
  bad("duplicate-feature","DUPLICATE_REFERENCE",c=>c.bindings.push(c.bindings[0]));
  bad("duplicate-asset","DUPLICATE_REFERENCE",c=>c.assets.push(c.assets[0]));
  return cases;
}
