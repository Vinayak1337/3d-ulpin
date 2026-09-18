import type {CoreEvidenceLink,CoreSourceCatalog} from "../../packages/contracts/src/spatial/core";
import {identityFixture,ref} from "./core-identity";

export const revisionRef=(id:string,namespace:string,revision=1)=>({ref:ref(id,namespace),revision});
export function evidence(id:string,target="B1",part="p1"):CoreEvidenceLink {
  return {ref:ref(id,"evidence_link") as CoreEvidenceLink['ref'],revision:1,target:ref(target),part:revisionRef(part,"source_part") as CoreEvidenceLink['part'],purpose:"context",state:"active",inheritance:{kind:"direct"}};
}
export function sourceFixture():CoreSourceCatalog {
  return {
    datasets:[{ref:{namespace:"dataset",id:"dataset-1"},revision:1,label:"Authored test sources",classification:"synthetic",attribution:"Synthetic fixture",license:null,access:"operator"}],
    assets:[{ref:{namespace:"asset",id:"a1"},revision:1,kind:"original",mediaType:"application/pdf",sha256:'a'.repeat(64),bytes:123,
      storage:{state:"registered",blobRef:{namespace:"source_blob",id:"source-original"}},integrity:"metadata_only",access:"operator",retention:{policy:"preserve_original",legalHold:false},parentAssets:[]}],
    sources:[{ref:{namespace:"source_revision",id:"s1"},revision:1,family:{namespace:"source_family",id:"family-1"},familyOrdinal:3,label:"Private filename",profile:"plan-pdf-v1",method:"synthetic",dataset:{ref:{namespace:"dataset",id:"dataset-1"},revision:1},assets:[{ref:{namespace:"asset",id:"a1"},revision:1}],workflows:[ref("case-1","case")],access:"operator"}],
    parts:[{ref:{namespace:"source_part",id:"p1"},revision:1,source:{ref:{namespace:"source_revision",id:"s1"},revision:1},asset:{ref:{namespace:"asset",id:"a1"},revision:1},locators:[{kind:"page",page:2,region:{x:0.1,y:0.2,width:0.3,height:0.4,unit:"normalized"}},{kind:"verbatim",locator:"Page 2 · retained original locator"}],access:"operator"}],
    links:[evidence("building","B1"),evidence("other-building","B2"),{...evidence("inherited-unit","U1"),inheritance:{kind:"inherited",parentLink:{ref:{namespace:"evidence_link",id:"building"},revision:1},via:["duplex-parent"]}}],
  };
}
export interface SourceConformanceCase {id:string;catalog:unknown;identity:unknown;valid:boolean;code?:string}
export function sourceCases():SourceConformanceCase[] {
  const cases:SourceConformanceCase[]=[{id:"shared-original-and-inherited-context",catalog:sourceFixture(),identity:identityFixture(),valid:true},{id:"zero-document-catalog",catalog:{datasets:[],assets:[],sources:[],parts:[],links:[]},identity:identityFixture(),valid:true}];
  const geometry:any=JSON.parse(JSON.stringify(sourceFixture()));geometry.assets[0].mediaType="application/geo+json; charset=utf-8";geometry.sources[0].profile="geojson";geometry.parts[0].locators=[{kind:"feature",featureId:"0000123"},{kind:"json_pointer",pointer:"/features/0"}];geometry.links[0].purpose="geometry";
  cases.push({id:"geometry-evidence-with-zero-pdfs",catalog:geometry,identity:identityFixture(),valid:true});
  const archived:any=JSON.parse(JSON.stringify(sourceFixture()));
  archived.linkHistory=[JSON.parse(JSON.stringify(archived.links[2])),JSON.parse(JSON.stringify(archived.links[0]))];
  archived.links[2].state="unlinked";archived.links[2].revision=2;
  archived.links[0].state="unlinked";archived.links[0].revision=2;
  cases.push({id:"child-and-parent-unlinked-with-exact-history",catalog:archived,identity:identityFixture(),valid:true});
  const historyChange=(id:string,code:string,mutate:(catalog:any)=>void)=>{
    const catalog=JSON.parse(JSON.stringify(archived));mutate(catalog);
    cases.push({id,catalog,identity:identityFixture(),valid:false,code});
  };
  historyChange("archived-reference-needs-actual-record","STALE_REFERENCE",c=>c.linkHistory=c.linkHistory.filter((l:any)=>l.ref.id!=="building"));
  historyChange("active-child-cannot-inherit-historical-parent","STALE_REFERENCE",c=>c.links[2].state="active");
  historyChange("duplicate-evidence-history","DUPLICATE_RECORD",c=>c.linkHistory.push(c.linkHistory[0]));
  historyChange("history-needs-current-identity","MISSING_REFERENCE",c=>c.linkHistory[0].ref.id="orphan-history");
  historyChange("future-evidence-history","HISTORY_REVISION",c=>c.linkHistory[0].revision=3);
  historyChange("current-revision-is-not-history","HISTORY_REVISION",c=>c.linkHistory[0].revision=2);
  const change=(id:string,code:string,mutate:(catalog:any,identity:any)=>void)=>{const catalog=JSON.parse(JSON.stringify(sourceFixture())),identity=JSON.parse(JSON.stringify(identityFixture()));mutate(catalog,identity);cases.push({id,catalog,identity,valid:false,code});};
  change("duplicate-asset","DUPLICATE_RECORD",c=>c.assets.push(c.assets[0]));
  change("unknown-source-ordinal-not-zero","INVALID_CONTRACT",c=>c.sources[0].familyOrdinal=0);
  change("missing-dataset","MISSING_REFERENCE",c=>c.sources[0].dataset.ref.id="missing");
  change("stale-original-asset","STALE_REFERENCE",c=>c.sources[0].assets[0].revision=2);
  change("original-marked-disposable","ORIGINAL_RETENTION",c=>c.assets[0].retention.policy="managed_derivative");
  change("registered-original-without-hash","ASSET_METADATA",c=>c.assets[0].sha256=null);
  change("unqualified-integrity-claim","INVALID_CONTRACT",c=>c.assets[0].integrity="verified");
  change("asset-parent-cycle","ASSET_CYCLE",c=>{c.assets[0].kind="derived";c.assets[0].parentAssets=[revisionRef("a1","asset")];});
  change("stale-source-part","STALE_REFERENCE",c=>c.parts[0].source.revision=2);
  change("exact-part-without-original-asset","PART_ASSET",c=>c.parts[0].asset=null);
  change("reverse-row-range","LOCATOR_RANGE",c=>c.parts[0].locators=[{kind:"rows",range:{start:3,end:2}}]);
  change("crop-outside-original-page","LOCATOR_REGION",c=>c.parts[0].locators[0].region.width=0.95);
  change("unsafe-json-pointer-escape","INVALID_CONTRACT",c=>c.parts[0].locators=[{kind:"json_pointer",pointer:"/bad~2escape"}]);
  change("duplicate-locator","DUPLICATE_REFERENCE",c=>c.parts[0].locators.push(c.parts[0].locators[0]));
  change("unknown-evidence-target","MISSING_TARGET",c=>c.links[0].target=ref("missing"));
  change("stale-evidence-part","STALE_REFERENCE",c=>c.links[0].part.revision=2);
  change("verbatim-not-exact-geometry","LOCATOR_NOT_QUALIFIED",c=>{c.parts[0].locators=[{kind:"verbatim",locator:"somewhere"}];c.links[0].purpose="geometry";});
  change("root-pointer-not-exact-feature","LOCATOR_NOT_QUALIFIED",c=>{c.parts[0].locators=[{kind:"json_pointer",pointer:""}];c.links[0].purpose="geometry";});
  change("missing-inherited-parent","MISSING_REFERENCE",c=>c.links[2].inheritance.parentLink.ref.id="missing");
  change("stale-inherited-parent","STALE_REFERENCE",c=>c.links[2].inheritance.parentLink.revision=3);
  change("inherited-geometry-is-not-unit-evidence","INHERITANCE_PURPOSE",c=>c.links[2].purpose="geometry");
  change("inheritance-via-service-not-containment","INHERITANCE_PATH",c=>{c.links[2].target=ref("pipe");c.links[2].inheritance.via=["pipe-service"];});
  change("wrong-parent-building","INHERITANCE_PATH",c=>c.links[2].inheritance.parentLink.ref.id="other-building");
  change("inheritance-from-unlinked-parent","INHERITANCE_PARENT",c=>c.links[0].state="unlinked");
  change("duplicate-family-ordinal","SOURCE_ORDINAL",c=>c.sources.push({...c.sources[0],ref:{namespace:"source_revision",id:"second-source"}}));
  change("conflicting-shared-blob-metadata","BLOB_METADATA",c=>c.assets.push({...c.assets[0],ref:{namespace:"asset",id:"second-asset"},sha256:'b'.repeat(64)}));
  return cases;
}
