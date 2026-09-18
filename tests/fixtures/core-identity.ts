import type {CoreEntity, CoreEntityKind, CoreIdentityGraph, CoreRelation, CoreRef} from "../../packages/contracts/src/spatial/core";

export const ref = (id:string,namespace="physical"):CoreRef => ({namespace,id});
export function entity(id:string,kind:CoreEntityKind="building",namespace="physical"):CoreEntity {
  return {ref:ref(id,namespace),revision:1,kind,label:`Object ${id}`,identifiers:[],memberships:[],lifecycle:{state:"active"}};
}
export function relation(id:string,kind:CoreRelation["kind"],from:CoreRef,to:CoreRef):CoreRelation {
  return {id,revision:1,kind,from,to,note:"Explicit authored fixture relationship"};
}
export function identityFixture():CoreIdentityGraph {
  const b1={...entity("B1"),label:"Same label",identifiers:[{scheme:"source_property_id",issuer:"Fixture issuer",value:"0000123",status:"reported" as const,historical:false}],memberships:[{collection:ref("west","area"),role:"authoring" as const},{collection:ref("east","area"),role:"authoring" as const}]};
  const b2={...entity("B2"),label:"Same label",identifiers:b1.identifiers};
  return {entities:[b1,b2,entity("L1","level"),entity("L2","level"),entity("U1","space"),entity("stairs","space"),entity("P1","parcel"),entity("B1","building","registry"),entity("pipe","utility"),entity("road","road")],relations:[
    relation("level-1","part_of",ref("L1"),ref("B1")),relation("level-2","part_of",ref("L2"),ref("B1")),
    relation("duplex-parent","part_of",ref("U1"),ref("B1")),relation("duplex-lower","occupies_level",ref("U1"),ref("L1")),relation("duplex-upper","occupies_level",ref("U1"),ref("L2")),
    relation("stairs-west","part_of",ref("stairs"),ref("B1")),relation("stairs-east","part_of",ref("stairs"),ref("B2")),
    relation("parcel-link","associated_parcel",ref("B1"),ref("P1")),relation("physical-record","recorded_by",ref("B1"),ref("B1","registry")),
    relation("pipe-service","serves",ref("pipe"),ref("B1")),relation("pipe-crossing","crosses",ref("pipe"),ref("road")),
  ]};
}
export function splitFixture():CoreIdentityGraph {
  return {entities:[{...entity("P0","parcel"),revision:2,lifecycle:{state:"retired",mode:"split",changeId:"split-1",replacedBy:[ref("P1"),ref("P2")],reason:"Explicit identity split, no geometry inferred"}},entity("P1","parcel"),entity("P2","parcel")],relations:[
    {...relation("split-1:a","split_from",ref("P1"),ref("P0")),changeId:"split-1"},
    {...relation("split-1:b","split_from",ref("P2"),ref("P0")),changeId:"split-1"},
  ]};
}
export function mergeFixture():CoreIdentityGraph {
  return {entities:[...['P1','P2'].map(id=>({...entity(id,"parcel"),revision:2,lifecycle:{state:"retired" as const,mode:"merge" as const,changeId:"merge-1",replacedBy:[ref("P3")],reason:"Explicit identity merge"}})),entity("P3","parcel")],relations:[
    {...relation("merge-1:a","merged_from",ref("P3"),ref("P1")),changeId:"merge-1"},
    {...relation("merge-1:b","merged_from",ref("P3"),ref("P2")),changeId:"merge-1"},
  ]};
}
export interface IdentityConformanceCase {id:string;value:unknown;valid:boolean;code?:string}
export function identityCases():IdentityConformanceCase[] {
  const cases:IdentityConformanceCase[]=[{id:"empty-catalog",value:{entities:[],relations:[]},valid:true},{id:"duplex-shared-stairs-and-namespaces",value:identityFixture(),valid:true},{id:"explicit-split-history",value:splitFixture(),valid:true},{id:"explicit-merge-history",value:mergeFixture(),valid:true}];
  const change=(id:string,code:string,mutate:(value:any)=>void,base:()=>unknown=identityFixture)=>{const value=JSON.parse(JSON.stringify(base()));mutate(value);cases.push({id,value,valid:false,code});};
  change("duplicate-reference","DUPLICATE_ENTITY",g=>g.entities.push(g.entities[0]));
  change("duplicate-membership","DUPLICATE_MEMBERSHIP",g=>g.entities[0].memberships.push(g.entities[0].memberships[0]));
  change("duplicate-identifier-assertion","DUPLICATE_IDENTIFIER",g=>g.entities[0].identifiers.push({...g.entities[0].identifiers[0],historical:true}));
  change("parcel-identifier-on-building","IDENTIFIER_SCOPE",g=>g.entities[0].identifiers[0].scheme="official_ulpin");
  change("numeric-external-identifier","INVALID_CONTRACT",g=>g.entities[0].identifiers[0].value=123);
  change("fractional-revision","INVALID_CONTRACT",g=>g.entities[0].revision=1.5);
  change("boolean-revision","INVALID_CONTRACT",g=>g.entities[0].revision=true);
  change("unsafe-integer-revision","INVALID_CONTRACT",g=>g.entities[0].revision=9007199254740992);
  change("unrecognized-kind","INVALID_CONTRACT",g=>g.entities[0].kind="apartment-guessed");
  change("unknown-core-field","INVALID_CONTRACT",g=>g.entities[0].residents=['private']);
  change("control-in-key","INVALID_CONTRACT",g=>g.entities[0].ref.id="B1\n");
  change("missing-relation-endpoint","MISSING_ENDPOINT",g=>g.relations[0].to=ref("absent"));
  change("wrong-relation-kinds","RELATION_KIND",g=>g.relations[0].kind="occupies_level");
  change("same-reference-relation","SELF_RELATION",g=>g.relations[0].to=g.relations[0].from);
  change("duplicate-edge-id","DUPLICATE_RELATION_ID",g=>g.relations[1].id=g.relations[0].id);
  change("duplicate-directed-edge","DUPLICATE_RELATION",g=>g.relations.push({...g.relations[0],id:"duplicate-edge"}));
  change("reverse-crossing-not-new-edge","DUPLICATE_RELATION",g=>g.relations.push(relation("duplicate-crossing","crosses",ref("road"),ref("pipe"))));
  change("recording-in-physical-namespace","RECORD_NAMESPACE",g=>g.relations.find((r:any)=>r.kind==="recorded_by").to=ref("B2"));
  change("non-lineage-change-id","LINEAGE_CHANGE",g=>g.relations[0].changeId="unexpected");
  change("containment-cycle","RELATION_CYCLE",g=>{g.entities=[entity("a","building_part"),entity("b","building_part")];g.relations=[relation("a-b","part_of",ref("a"),ref("b")),relation("b-a","part_of",ref("b"),ref("a"))];});
  change("missing-successor","MISSING_SUCCESSOR",g=>g.entities[0].lifecycle.replacedBy[0]=ref("missing"),splitFixture);
  change("duplicate-successor","DUPLICATE_SUCCESSOR",g=>g.entities[0].lifecycle.replacedBy[1]=ref("P1"),splitFixture);
  change("single-child-split","SUCCESSOR_COUNT",g=>g.entities[0].lifecycle.replacedBy.pop(),splitFixture);
  change("successor-kind-change","INVALID_SUCCESSOR",g=>g.entities[1].kind="building",splitFixture);
  change("lineage-change-mismatch","LINEAGE_CHANGE",g=>g.relations[0].changeId="wrong",splitFixture);
  change("one-source-merge","RETIREMENT_GROUP",g=>{g.entities.splice(1,1);g.relations.splice(1,1);},mergeFixture);
  change("multiple-target-merge","SUCCESSOR_COUNT",g=>g.entities[0].lifecycle.replacedBy.push(ref("P2")),mergeFixture);
  change("reserved-prototype-key","UNSAFE_KEY",g=>Object.defineProperty(g,"__proto__",{value:{polluted:true},enumerable:true}));
  const reordered=identityFixture();cases.push({id:"source-order-independent",value:{entities:[...reordered.entities].reverse(),relations:[...reordered.relations].reverse()},valid:true});
  return cases;
}
