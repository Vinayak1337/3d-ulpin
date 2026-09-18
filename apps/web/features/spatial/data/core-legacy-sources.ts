import {
  CoreSourceRevisionSchema,canonicalCoreText,coreInputDigest,coreRefKey,parseCore,
  projectLegacySourceLocator,projectLegacySourceMetadata,
  type CoreAsset,type CoreEvidenceLink,type CoreLocator,type CoreSourceCatalog,type CoreSourcePart,type CoreSourceRevision,type CoreRef,
  type SourceBinding,type SourceLocator,
} from "@ulpin/contracts";
import type {CoreLegacyDiagnostic,LegacySourceMetadata} from "./core-legacy-types";

const version=<T extends CoreRef>(ref:T)=>({ref,revision:1});
/** One reusable original catalog; no original bytes, private inspection or blob keys. */
export class LegacyCoreSources {
  private readonly assets=new Map<string,CoreAsset>();
  private readonly sources=new Map<string,CoreSourceRevision>();
  private readonly parts=new Map<string,CoreSourcePart>();
  private readonly links=new Map<string,CoreEvidenceLink>();
  private readonly locators=new Map<string,{part:CoreRef;legacy:unknown}>();
  readonly originalReceipts:readonly LegacySourceMetadata[];

  constructor(metadata:readonly LegacySourceMetadata[],private readonly diagnostics:CoreLegacyDiagnostic[]) {
    this.originalReceipts=metadata;
    for(const item of metadata){
      const projected=projectLegacySourceMetadata(item),source=projected.sources[0],asset=projected.assets[0];
      const old=this.sources.get(source.ref.id);
      if(old&&canonicalCoreText(old)!==canonicalCoreText(source))throw new Error("Conflicting immutable source metadata");
      this.sources.set(source.ref.id,source);this.assets.set(asset.ref.id,asset);
    }
  }

  private ensureSource(id:string):CoreSourceRevision {
    const found=this.sources.get(id);if(found)return found;
    const source=parseCore(CoreSourceRevisionSchema,{ref:{namespace:"source_revision",id},revision:1,family:null,familyOrdinal:null,
      label:"Referenced source metadata is unavailable",profile:"legacy-unresolved/1",method:"unknown",dataset:null,assets:[],workflows:[],access:"operator"});
    this.sources.set(id,source);
    this.diagnostics.push({code:"SOURCE_METADATA_UNAVAILABLE",target:source.ref,message:"Original source ID is preserved, but its byte/hash/family metadata is not available in this read."});
    return source;
  }

  async part(sourceId:string,locators:readonly CoreLocator[],legacyLocator:unknown):Promise<CoreSourcePart> {
    const source=this.ensureSource(sourceId),asset=source.assets[0]??null;
    // An unresolved original cannot claim qualified file locators. Preserve their
    // exact spelling as an unqualified association until metadata becomes available.
    const effective:readonly CoreLocator[]=asset?locators:[{kind:"verbatim",locator:canonicalCoreText(legacyLocator)}];
    const digest=await coreInputDigest({source:source.ref,locators:effective,legacyLocator});
    const id=`legacy-part:${digest}`;
    const part:CoreSourcePart={ref:{namespace:"source_part",id},revision:1,source:version(source.ref),asset,locators:effective,access:"operator"};
    this.parts.set(id,part);this.locators.set(id,{part:part.ref,legacy:legacyLocator});return part;
  }

  async locator(value:SourceLocator):Promise<CoreSourcePart> {
    const mapped=projectLegacySourceLocator(value);
    return this.part(value.sourceRevisionId,mapped.locators,value);
  }

  async binding(value:SourceBinding):Promise<CoreSourcePart> {
    return this.part(value.sourceId,[{kind:"verbatim",locator:value.locator}],value);
  }

  async recordElement(record:{id:string;revision:number;siteId:string;synthetic:boolean},elementType:string):Promise<CoreSourcePart> {
    const id=`legacy-model:${elementType}:${record.id}:${record.revision}`,source=parseCore(CoreSourceRevisionSchema,{
      ref:{namespace:"source_revision",id},revision:1,family:{namespace:"source_family",id:`legacy-model:${elementType}:${record.id}`},familyOrdinal:record.revision>0?record.revision:null,
      label:"Existing recorded spatial model",profile:"legacy-registry-record/1",method:record.synthetic?"synthetic":"manual",dataset:null,assets:[],workflows:[{namespace:"registry_site",id:record.siteId}],access:"operator",
    });
    this.sources.set(id,source);
    const part:CoreSourcePart={ref:{namespace:"source_part",id},revision:1,source:version(source.ref),asset:null,
      locators:[{kind:"model_element",elementId:record.id,elementType}],access:"operator"};
    this.parts.set(id,part);return part;
  }

  async link(target:CoreRef,part:CoreSourcePart,purpose:CoreEvidenceLink["purpose"]):Promise<void> {
    const id=`legacy-link:${await coreInputDigest({target,part:version(part.ref),purpose})}`;
    this.links.set(id,{ref:{namespace:"evidence_link",id},revision:1,target,part:version(part.ref),purpose,state:"active",inheritance:{kind:"direct"}});
  }

  catalog():CoreSourceCatalog {
    const order=<T extends {ref:CoreRef}>(items:Iterable<T>):T[]=>[...items].sort((a,b)=>coreRefKey(a.ref)<coreRefKey(b.ref)?-1:1);
    return {datasets:[],assets:order(this.assets.values()),sources:order(this.sources.values()),parts:order(this.parts.values()),links:order(this.links.values())};
  }
  originalLocators(){return [...this.locators.values()].sort((a,b)=>coreRefKey(a.part)<coreRefKey(b.part)?-1:1);}
}
