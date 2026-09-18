import {z} from "zod";
import {CoreIdSchema,CorePositiveRevisionSchema,CoreSafeIntegerSchema,CoreSha256Schema,coreFail,coreRefKey,coreText,nextCoreRevision,parseCore,type CoreRef} from "./scalars";
import {validateCoreIdentityGraph} from "./identity";
import {indexCoreRecords,requireCoreRevision,uniqueCoreKeys} from "./references";
import {CORE_EVIDENCE_POLICY,CoreLocatorSchema,CoreNormalizedRegionSchema,CoreSourceCatalogSchema,CoreUnlinkEvidenceSchema,type CoreAsset,type CoreEvidenceLink,type CoreLocator,type CoreSourceCatalog} from "./source-schema";

const versionKey=(link:{readonly ref:CoreRef;readonly revision:number})=>`${coreRefKey(link.ref)}@${link.revision}`;
const stable=(value:unknown):string=>JSON.stringify(normalize(value));
function normalize(value:unknown):unknown {
  if(Array.isArray(value))return value.map(normalize);
  if(value&&typeof value==="object")return Object.fromEntries(Object.keys(value).sort().map(k=>[k,normalize((value as Record<string,unknown>)[k])]));
  return value;
}
function validateLocators(locators:readonly CoreLocator[]) {
  uniqueCoreKeys(locators.map(stable),"source locator");
  for(const locator of locators) {
    if((locator.kind==="rows"||locator.kind==="lines")&&locator.range.end<locator.range.start)coreFail("LOCATOR_RANGE","The end of a source range precedes its start");
    const region=locator.kind==="image_region"?locator.region:locator.kind==="page"?locator.region:undefined;
    if(region&&(region.x+region.width>1+CORE_EVIDENCE_POLICY.normalizedTolerance||region.y+region.height>1+CORE_EVIDENCE_POLICY.normalizedTolerance))coreFail("LOCATOR_REGION","Source region lies outside the original image or page");
  }
}
export const isPreciseCoreLocator=(locator:CoreLocator)=>CORE_EVIDENCE_POLICY.preciseLocators.some(kind=>kind===locator.kind)&&(locator.kind!=="json_pointer"||locator.pointer!=="");

export function validateCoreSourceCatalog(input:unknown,identityInput:unknown):CoreSourceCatalog {
  const catalog=parseCore(CoreSourceCatalogSchema,input),identity=validateCoreIdentityGraph(identityInput);
  const entities=new Set(identity.entities.map(e=>coreRefKey(e.ref))),relations=new Map(identity.relations.map(r=>[r.id,r]));
  const datasets=indexCoreRecords(catalog.datasets,"dataset"),assets=indexCoreRecords(catalog.assets,"asset"),sources=indexCoreRecords(catalog.sources,"source"),parts=indexCoreRecords(catalog.parts,"source part"),links=indexCoreRecords(catalog.links,"evidence link");
  const history=new Map<string,CoreEvidenceLink>();
  for(const entry of catalog.linkHistory??[]) {
    const current=links.get(coreRefKey(entry.ref)),key=versionKey(entry);
    if(!current)coreFail("MISSING_REFERENCE","Evidence history needs a current association record");
    if(entry.revision>=current.revision)coreFail("HISTORY_REVISION","Evidence history must precede the current revision");
    if(history.has(key))coreFail("DUPLICATE_RECORD","Duplicate evidence history revision");
    history.set(key,entry);
  }
  const blobMetadata=new Map<string,string>(),assetParents=new Map<string,string[]>();
  for(const asset of catalog.assets) {
    if(asset.kind==="original"&&asset.retention.policy!=="preserve_original")coreFail("ORIGINAL_RETENTION","Original receipts must not be marked disposable derivatives");
    if(asset.storage.state==="registered") {
      if(asset.sha256===null||asset.bytes===null)coreFail("ASSET_METADATA","Registered original metadata requires explicit bytes and checksum");
      const key=coreRefKey(asset.storage.blobRef),metadata=stable([asset.sha256,asset.bytes,asset.mediaType]);
      if(blobMetadata.has(key)&&blobMetadata.get(key)!==metadata)coreFail("BLOB_METADATA","One immutable blob reference has conflicting metadata");
      blobMetadata.set(key,metadata);
    }
    uniqueCoreKeys(asset.parentAssets.map(versionKey),"asset parent");
    assetParents.set(coreRefKey(asset.ref),asset.parentAssets.map(link=>coreRefKey(requireCoreRevision(assets,link,"asset parent").ref)));
  }
  const complete=new Set<string>();
  for(const root of assets.keys()) {
    const pending:{id:string;leave:boolean}[]=[{id:root,leave:false}],active=new Set<string>();
    while(pending.length){const item=pending.pop()!;if(item.leave){active.delete(item.id);complete.add(item.id);continue;}if(complete.has(item.id))continue;if(active.has(item.id))coreFail("ASSET_CYCLE","Asset ancestry contains a cycle");active.add(item.id);pending.push({id:item.id,leave:true});for(const parent of assetParents.get(item.id)||[])pending.push({id:parent,leave:false});}
  }
  const ordinals:string[]=[];
  for(const source of catalog.sources) {
    if(source.dataset)requireCoreRevision(datasets,source.dataset,"dataset");
    for(const asset of source.assets)requireCoreRevision(assets,asset,"source asset");
    uniqueCoreKeys(source.assets.map(versionKey),"source asset");uniqueCoreKeys(source.workflows.map(coreRefKey),"source workflow");
    if(source.family&&source.familyOrdinal!==null)ordinals.push(`${coreRefKey(source.family)}@${source.familyOrdinal}`);
  }
  if(new Set(ordinals).size!==ordinals.length)coreFail("SOURCE_ORDINAL","A source-family ordinal refers to multiple immutable receipts");
  for(const part of catalog.parts) {
    const source=requireCoreRevision(sources,part.source,"source part's source");
    if(part.asset){requireCoreRevision(assets,part.asset,"part asset");if(!source.assets.some(link=>versionKey(link)===versionKey(part.asset!)))coreFail("PART_ASSET","Part asset does not belong to its source");}
    else if(source.assets.length||part.locators.some(l=>l.kind!=="model_element"&&l.kind!=="verbatim"))coreFail("PART_ASSET","An exact file part must name its original asset");
    validateLocators(part.locators);
  }
  const linkEdges:string[]=[];
  for(const link of [...catalog.links,...(catalog.linkHistory??[])]) {
    const isCurrent=links.get(coreRefKey(link.ref))===link;
    if(!entities.has(coreRefKey(link.target)))coreFail("MISSING_TARGET","Evidence target is missing from the identity graph");
    const part=requireCoreRevision(parts,link.part,"evidence part");
    if(CORE_EVIDENCE_POLICY.exactPurposes.some(p=>p===link.purpose)&&!part.locators.some(isPreciseCoreLocator))coreFail("LOCATOR_NOT_QUALIFIED","This locator does not identify a qualified geometry or level source part");
    if(link.inheritance.kind==="inherited") {
      if(!CORE_EVIDENCE_POLICY.inheritedPurposes.some(p=>p===link.purpose))coreFail("INHERITANCE_PURPOSE","Inherited documents do not establish exact unit geometry or levels");
      const pinned=link.inheritance.parentLink;
      const parent=(!isCurrent||link.state==="unlinked")&&history.has(versionKey(pinned))
        ?history.get(versionKey(pinned))!
        :requireCoreRevision(links,pinned,"parent evidence link");
      if(parent.inheritance.kind!=="direct"||(link.state==="active"&&parent.state!=="active")||versionKey(parent.part)!==versionKey(link.part))coreFail("INHERITANCE_PARENT","Inherited evidence needs a current direct association to the same source part");
      let cursor=coreRefKey(link.target);const visited=new Set([cursor]);
      for(const id of link.inheritance.via) {
        const edge=relations.get(id);
        if(!edge||!CORE_EVIDENCE_POLICY.inheritanceRelations.some(kind=>kind===edge.kind)||coreRefKey(edge.from)!==cursor)coreFail("INHERITANCE_PATH","Evidence inheritance does not follow a qualified containment path");
        cursor=coreRefKey(edge.to);if(visited.has(cursor))coreFail("INHERITANCE_PATH","Evidence inheritance repeats an identity");visited.add(cursor);
      }
      if(cursor!==coreRefKey(parent.target))coreFail("INHERITANCE_PATH","Evidence path does not reach the declared parent association");
    }
    if(isCurrent&&link.state==="active")linkEdges.push(stable([coreRefKey(link.target),versionKey(link.part),link.purpose,link.inheritance]));
  }
  uniqueCoreKeys(linkEdges,"active evidence link");
  return catalog;
}

export function planCoreEvidenceUnlink(input:unknown,identity:unknown,commandInput:unknown) {
  const catalog=validateCoreSourceCatalog(input,identity),command=parseCore(CoreUnlinkEvidenceSchema,commandInput);
  const links=indexCoreRecords(catalog.links,"evidence link"),link=requireCoreRevision(links,command.link,"unlink target");
  if(link.state==="unlinked")return Object.freeze({changed:false,before:command.link,catalog,storageDeletes:Object.freeze([] as never[])});
  if(catalog.links.some(other=>other.state==="active"&&other.inheritance.kind==="inherited"&&coreRefKey(other.inheritance.parentLink.ref)===coreRefKey(link.ref)))coreFail("INHERITANCE_DEPENDENTS","Review inherited dependents before unlinking this parent association");
  const updated:CoreEvidenceLink={...link,revision:nextCoreRevision(link.revision),state:"unlinked"};
  const result=validateCoreSourceCatalog({...catalog,links:catalog.links.map(old=>coreRefKey(old.ref)===coreRefKey(link.ref)?updated:old),linkHistory:[...(catalog.linkHistory??[]),link]},identity);
  return Object.freeze({changed:true,before:command.link,catalog:result,storageDeletes:Object.freeze([] as never[])});
}

/** Geometry-safe index only; these declarations do not replace server authorization. */
export function corePublicSourceIndex(input:unknown,identity:unknown) {
  const catalog=validateCoreSourceCatalog(input,identity),datasets=indexCoreRecords(catalog.datasets,"dataset"),assets=indexCoreRecords(catalog.assets,"asset");
  return Object.freeze(catalog.sources.filter(source=>source.access==="public"&&(!source.dataset||requireCoreRevision(datasets,source.dataset,"dataset").access==="public")&&source.assets.every(link=>requireCoreRevision(assets,link,"asset").access==="public"))
    .map(source=>Object.freeze({ref:source.ref,revision:source.revision})).sort((a,b)=>coreRefKey(a.ref)<coreRefKey(b.ref)?-1:coreRefKey(a.ref)>coreRefKey(b.ref)?1:0));
}

const LegacySourceMetadataSchema=z.strictObject({id:CoreIdSchema,caseId:CoreIdSchema,familyId:CoreIdSchema,revision:CorePositiveRevisionSchema,name:coreText(512),profile:CoreIdSchema,mimeType:coreText(255),bytes:CoreSafeIntegerSchema,sha256:CoreSha256Schema});
/** Metadata projection from an existing source DTO, not a new upload/inspection. */
export function projectLegacySourceMetadata(input:unknown):CoreSourceCatalog {
  if(!input||typeof input!=="object"||Array.isArray(input)||![Object.prototype,null].includes(Object.getPrototypeOf(input)))coreFail("NON_JSON","Legacy source metadata must be a plain record");
  const selected:Record<string,unknown>={};
  for(const key of Object.keys(LegacySourceMetadataSchema.shape)) {
    const property=Object.getOwnPropertyDescriptor(input,key);
    if(!property||!("value" in property))coreFail("INVALID_CONTRACT","Legacy source metadata is incomplete or uses accessors");
    selected[key]=property.value;
  }
  const source=parseCore(LegacySourceMetadataSchema,selected);
  const asset:CoreAsset={ref:{namespace:"asset",id:source.id},revision:1,kind:"original",mediaType:source.mimeType,sha256:source.sha256,bytes:source.bytes,storage:{state:"registered",blobRef:{namespace:"source_blob",id:source.id}},integrity:"metadata_only",access:"operator",retention:{policy:"preserve_original",legalHold:null},parentAssets:[]};
  return validateCoreSourceCatalog({datasets:[],assets:[asset],sources:[{ref:{namespace:"source_revision",id:source.id},revision:1,family:{namespace:"source_family",id:source.familyId},familyOrdinal:source.revision,label:source.name,profile:source.profile,method:"source",dataset:null,assets:[{ref:asset.ref,revision:1}],workflows:[{namespace:"case",id:source.caseId}],access:"operator"}],parts:[],links:[]},{entities:[],relations:[]});
}

const LegacyLocatorSchema=z.strictObject({sourceRevisionId:CoreIdSchema,page:CorePositiveRevisionSchema.optional(),row:CorePositiveRevisionSchema.optional(),partId:CoreIdSchema.optional(),featureId:coreText(512).optional(),jsonPointer:z.string().max(4096).optional(),region:CoreNormalizedRegionSchema.optional()});
export function projectLegacySourceLocator(input:unknown) {
  const source=parseCore(LegacyLocatorSchema,input),locators:CoreLocator[]=[];
  if(source.featureId!==undefined)locators.push({kind:"feature",featureId:source.featureId});
  if(source.jsonPointer!==undefined)locators.push(parseCore(CoreLocatorSchema,{kind:"json_pointer",pointer:source.jsonPointer}));
  if(source.page!==undefined)locators.push({kind:"page",page:source.page,...(source.region?{region:source.region}:{})});
  else if(source.region)locators.push({kind:"image_region",region:source.region});
  if(source.row!==undefined)locators.push({kind:"rows",range:{start:source.row,end:source.row}});
  if(!locators.length)locators.push({kind:"whole_asset"});
  validateLocators(locators);
  return Object.freeze({sourceRef:Object.freeze({namespace:"source_revision" as const,id:source.sourceRevisionId}),legacyPartId:source.partId??null,locators:Object.freeze(locators)});
}
