import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {RegistryDocumentAmendmentSchema,RegistryDocumentAmendmentReceiptSchema,RegistryDocumentCitationSchema,
  RegistryDocumentCitationsSchema,RegistryDocumentEvidenceSchema,RegistryDocumentReviewContextSchema,
  RegistryNativeDocumentCitationSchema,RegistryOcrDocumentCitationSchema,RegistryIFCCitationSchema,RegistryRegionCitationSchema,
  type RegistryRecord,type RegistryDocumentCitation,type RegistryNativeDocumentCitation,type RegistryOcrDocumentCitation,
  type RegistryDocumentReviewContext,type RegistryIFCCitation,type RegistryRegionCitation,type RegistryDocumentAmendment} from '@ulpin/contracts';
import {DocumentPartSchema,type DocumentInput,type DocumentResult} from '@ulpin/contracts/usp';
import {transaction} from '../../infrastructure/db';
import {AppError,conflict,notFound} from '../../infrastructure/errors';
import {sha256} from '../../infrastructure/storage';
import {fingerprint} from '../cases/domain';
import {localRequestContext} from '../usp/principal';
import {associationDocumentInputTx} from '../usp/ingestion/document-association-authority';
import {readDocumentResult} from '../usp/ingestion/documents';
import {documentPartEligibleForProposal} from '../usp/ingestion/document-model';
import {registrySourceTx,registryDocumentSourceAccessTx,registryMetadataEvidence} from './registry-metadata';
import {RegistryMetadataSchema} from '@ulpin/contracts';
import {registryDocumentCases,registryRegionCases,lockRegistryDocumentCasesTx,assertRegistryDocumentCases} from './registry-document-locks';
import {registryRegionSourceTx,prepareRegistryRegion,regionCitationId,assertRegionCitation,type RegistryRegionPrepared} from './registry-region-evidence';
import {RegistryImageRegionCitationSchema,type RegistryImageRegionCitation} from '../../../../contracts/src/registry-document-evidence';
import {registryImageRegionSourceTx,prepareRegistryImageRegion,imageRegionCitationId,assertImageRegionCitation,
  type RegistryImageRegionPrepared} from './registry-image-region-evidence';
import {resolveFusionCitationsTx,ocrCitationFusionSelection,fusionOcrCitationFields,fusionCitationDocumentPin,citationReadBudget,
  ifcCitationFusionSelection,fusionIFCCitationFields,
  type FusionCitationDependencies} from '../usp/ingestion/source-fusion-citations';
import {fusionSourceProjection} from '../usp/ingestion/source-fusion';
import {readFusionResult,fusionLive} from '../usp/ingestion/source-fusion-authority';
import {registryIFCCitationSourceTx} from './registry-ifc-citation-source';
import {verifyFusionIFCTools} from '../usp/ingestion/source-fusion-ifc-authority';
import {SOURCE_FUSION_LIMITS} from '../../../../contracts/src/source-fusion';
import {ifcIdentityFields,assertIFCIdentityEvidence} from './registry-ifc-identifiers';
import {RegistryDXFCitationSchema,type RegistryDXFCitation,RegistryKMLCitationSchema,type RegistryKMLCitation} from '../../../../contracts/src/registry-document-evidence';
import {registryDXFCitationSourceTx} from './registry-dxf-citation-source';
import {verifyFusionDXFTools} from '../usp/ingestion/source-fusion-dxf-authority';
import {dxfCitationFusionSelection,fusionDXFCitationFields} from '../usp/ingestion/source-fusion-citations';
import {registryKMLCitationSourceTx} from './registry-kml-citation-source';
import {verifyFusionKMLTools} from '../usp/ingestion/source-fusion-kml-authority';
import {kmlCitationFusionSelection,fusionKMLCitationFields} from '../usp/ingestion/source-fusion-citations';
import {RegistryCityGMLCitationSchema,type RegistryCityGMLCitation} from '../../../../contracts/src/registry-document-evidence';
import {registryCityGMLCitationSourceTx} from './registry-citygml-citation-source';
import {verifyFusionCityGMLTools} from '../usp/ingestion/source-fusion-citygml-authority';
import {citygmlCitationFusionSelection,fusionCityGMLCitationFields,fusionCityGMLCitationFragment} from '../usp/ingestion/source-fusion-citations';
import {RegistryGeoParquetCitationSchema,type RegistryGeoParquetCitation} from '../../../../contracts/src/registry-document-evidence';
import {registryGeoParquetCitationSourceTx} from './registry-geoparquet-citation-source';
import {verifyFusionGeoParquetTools} from '../usp/ingestion/source-fusion-geoparquet-authority';
import {geoparquetCitationFusionSelection,fusionGeoParquetCitationFields,fusionGeoParquetCitationFragment} from '../usp/ingestion/source-fusion-citations';
import {RegistryRasterCitationSchema,type RegistryRasterCitation} from '../../../../contracts/src/registry-document-evidence';
import {registryRasterCitationSourceTx} from './registry-raster-citation-source';
import {rasterCitationFusionSelection,fusionRasterCitationFields,fusionRasterCitationFragment} from '../usp/ingestion/source-fusion-citations';
import {RegistryPointCitationSchema,type RegistryPointCitation} from '../../../../contracts/src/registry-document-evidence';
import {registryPointCitationSourceTx} from './registry-point-citation-source';
import {pointCitationFusionSelection,fusionPointCitationFields,fusionPointCitationFragment} from '../usp/ingestion/source-fusion-citations';
import {RegistrySurveyCitationSchema,type RegistrySurveyCitation} from '../../../../contracts/src/registry-document-evidence';
import {surveyCitationFusionSelection,surveyCitationFields,surveyCitationFragment,surveyCitationId} from './registry-survey-reference';
import {RegistryObjCitationSchema,type RegistryObjCitation} from '../../../../contracts/src/registry-document-evidence';
import {registryObjCitationSourceTx} from './registry-obj-citation-source';
import {verifyFusionObjTools} from '../usp/ingestion/source-fusion-obj-authority';
import {objCitationFusionSelection,objCitationFields,objCitationFragment,objCitationId} from './registry-obj-reference';
import {RegistryGltfCitationSchema,type RegistryGltfCitation} from '../../../../contracts/src/registry-document-evidence';
import {registryGltfCitationSourceTx} from './registry-gltf-citation-source';
import {verifyFusionGltfTools} from '../usp/ingestion/source-fusion-gltf-authority';
import {gltfCitationFusionSelection,gltfCitationFields,gltfCitationFragment,gltfCitationId} from './registry-gltf-reference';

export type RegistryDocumentDependencies=FusionCitationDependencies&{result:typeof readDocumentResult;registrySource:typeof registrySourceTx;
  citationSource?:typeof registryDocumentSourceAccessTx;regionSource?:typeof registryRegionSourceTx;
  imageRegionSource?:typeof registryImageRegionSourceTx};
type Dependencies=RegistryDocumentDependencies;
const defaults:Dependencies={source:associationDocumentInputTx,result:readDocumentResult,registrySource:registrySourceTx,
  citationSource:registryDocumentSourceAccessTx};
const citationSource=(dependencies:Dependencies)=>dependencies.citationSource??dependencies.registrySource;
const ifcSource=(dependencies:Dependencies)=>dependencies.ifcSource??registryIFCCitationSourceTx;
const ifcTools=(dependencies:Dependencies)=>dependencies.ifcTools??verifyFusionIFCTools;
const dxfSource=(dependencies:Dependencies)=>dependencies.dxfSource??registryDXFCitationSourceTx;
const dxfTools=(dependencies:Dependencies)=>dependencies.dxfTools??verifyFusionDXFTools;
const kmlSource=(dependencies:Dependencies)=>dependencies.kmlSource??registryKMLCitationSourceTx;
const kmlTools=(dependencies:Dependencies)=>dependencies.kmlTools??verifyFusionKMLTools;
const citygmlSource=(dependencies:Dependencies)=>dependencies.citygmlSource??registryCityGMLCitationSourceTx;
const citygmlTools=(dependencies:Dependencies)=>dependencies.citygmlTools??verifyFusionCityGMLTools;
const objSource=(dependencies:Dependencies)=>dependencies.objSource??registryObjCitationSourceTx;
const objTools=(dependencies:Dependencies)=>dependencies.objTools??verifyFusionObjTools;
const gltfSource=(dependencies:Dependencies)=>dependencies.gltfSource??registryGltfCitationSourceTx;
const gltfTools=(dependencies:Dependencies)=>dependencies.gltfTools??verifyFusionGltfTools;
const geoparquetSource=(dependencies:Dependencies)=>dependencies.geoparquetSource??registryGeoParquetCitationSourceTx;
const geoparquetTools=(dependencies:Dependencies)=>dependencies.geoparquetTools??verifyFusionGeoParquetTools;
const rasterSource=(dependencies:Dependencies)=>dependencies.rasterSource??registryRasterCitationSourceTx;
const pointSource=(dependencies:Dependencies)=>dependencies.pointSource??registryPointCitationSourceTx;
const regionSource=(dependencies:Dependencies)=>dependencies.regionSource??registryRegionSourceTx;
const imageRegionSource=(dependencies:Dependencies)=>dependencies.imageRegionSource??registryImageRegionSourceTx;
async function recheckRegionsTx(client:PoolClient,siteId:string,record:RegistryRecord,dependencies:Dependencies){
  for(const pin of record.documentCitations??[]){
    if(pin.version==='registry-document-region-citation/1')assertRegionCitation(pin,await regionSource(dependencies)(client,siteId,pin.document));
    else if(pin.version==='registry-image-region-citation/1')assertImageRegionCitation(pin,await imageRegionSource(dependencies)(client,siteId,pin.document));
  }
}
const context=()=>localRequestContext(randomUUID());
export function documentReviewContext():RegistryDocumentReviewContext{
  const ctx=context();return RegistryDocumentReviewContextSchema.parse({subject:ctx.principal.subject,
    entitlementVersion:ctx.principal.entitlementVersion,accessViewId:ctx.accessViewId,policyVersion:ctx.policyVersion});
}
export function assertDocumentReviewContext(review:{documentReviewContext?:RegistryDocumentReviewContext;records:RegistryRecord[]}){
  if((review.documentReviewContext||review.records.some(record=>record.documentCitations?.length)) &&
    (!review.documentReviewContext||fingerprint(review.documentReviewContext)!==fingerprint(documentReviewContext())))
    throw new AppError(403,'REGISTRY_DOCUMENT_REVIEW_DENIED','The reviewed document access context is unavailable.');
}
/** General projections hide private citations, native pins and derived geometry. */
export function publicRegistryBody<T extends object>(body:T):T{
  const {documentCitations:_privateCitations,nativeExteriorCandidate:_privateNative,nativeExteriorReferences:_privateReferences,...publicBody}=
    body as T&{documentCitations?:unknown;nativeExteriorCandidate?:unknown;nativeExteriorReferences?:unknown};
  return (Object.hasOwn(body,'nativeExteriorCandidate')?{...publicBody,footprint:[]}:publicBody) as T;
}
export function publicRegistryDraft<T extends {records:RegistryRecord[]}>(draft:T):T{
  return {...draft,records:draft.records.map(publicRegistryBody)};
}
export function publicRegistryReview<T extends {records:RegistryRecord[];before:RegistryRecord[]}>(review:T):T{
  return {...publicRegistryDraft(review),before:review.before.map(publicRegistryBody)};
}
function requireCorrection(record:RegistryRecord){
  if(!['building','floor','space'].includes(record.kind)||!Number.isSafeInteger(record.revision)||record.revision<1)
    throw new AppError(422,'REGISTRY_DOCUMENT_TARGET','Choose an existing recorded building, floor or space correction.');
}
export function assertCitationEdit(old:RegistryRecord,body:{documentCitations?:RegistryDocumentCitation[]}){
  if(body.documentCitations!==undefined && fingerprint(body.documentCitations)!==fingerprint(old.documentCitations??[]))
    throw new AppError(422,'REGISTRY_DOCUMENT_AMENDMENT_REQUIRED','Use the exact document citation amendment operation.');
}
async function currentTargetTx(client:PoolClient,siteId:string,record:RegistryRecord,lock=false,dependencies=defaults){
  requireCorrection(record);
  const row=(await client.query(`SELECT r.id,r.site_id,r.kind,r.revision,r.body,c.status project_status FROM registry_records r
    LEFT JOIN usp_project_codes c ON c.record_id=r.id WHERE r.id=$1 AND r.site_id=$2${lock?' FOR SHARE OF r':''}`,[record.id,siteId])).rows[0];
  if(!row||row.kind!==record.kind||Number(row.revision)!==record.revision||['retired','cancelled_error'].includes(row.project_status))
    conflict('The recorded citation target changed. Start from its exact current correction.');
  const ids=new Set<string>();
  for(const evidence of [...(row.body.evidence??[]),...(row.body.rights??[]).map((right:any)=>right.evidence),
    ...Object.values(row.body.geometry?.bindings??{})] as any[])
    if(evidence?.sourceId)ids.add(evidence.sourceId);
  if(row.body.registryMetadata)for(const evidence of registryMetadataEvidence(RegistryMetadataSchema.parse(row.body.registryMetadata)))
    ids.add(evidence.sourceId);
  if(ids.size>256)throw new AppError(413,'REGISTRY_DOCUMENT_TARGET_LIMIT','Use a smaller recorded evidence context.');
  for(const id of ids)await dependencies.registrySource(client,siteId,id);
  return row;
}
export {currentTargetTx as assertRegistryCurrentCitationTargetTx};
export function literalCitationParts(result:DocumentResult,input:DocumentInput,ids:readonly string[]){
  if(fingerprint(result.input)!==fingerprint(input))conflict('The exact document result input changed.');
  if(result.native.status!=='extracted'||result.native.readerSha256!==input.readerSha256||input.archiveSelection)
    throw new AppError(422,'REGISTRY_DOCUMENT_NATIVE_REQUIRED','Select literal parts from an accepted native document result.');
  const byId=new Map<string,DocumentResult['native']['parts'][number]>();
  for(const raw of result.native.parts){
    const part=DocumentPartSchema.parse(raw);
    if(byId.has(part.id))throw new AppError(422,'REGISTRY_DOCUMENT_PART_INTEGRITY','Native part IDs must be unique.');
    byId.set(part.id,part);
  }
  return ids.map(id=>{
    const part=byId.get(id);
    return eligibleCitationPart(part,input);
  });
}
function eligibleCitationPart(part:DocumentResult['native']['parts'][number]|undefined,input:DocumentInput){
  if(!part||part.sourceId!==input.sourceId||part.sourceRevision!==input.sourceRevision||part.sourceSha256!==input.sourceSha256||
    sha256(part.text)!==part.sha256 || !documentPartEligibleForProposal(part)||!part.text.trim()||/\[redacted/i.test(part.text))
    throw new AppError(422,'REGISTRY_DOCUMENT_PART_SELECTION','Choose exact eligible literal native parts from this result.');
  return part;
}
async function acceptedFenceTx(client:PoolClient,jobId:string){
  const row=(await client.query('SELECT accepted_fence FROM usp_job_metadata WHERE job_id=$1',[jobId])).rows[0];
  const fence=Number(row?.accepted_fence);
  if(!Number.isSafeInteger(fence)||fence<1)conflict('The accepted document attempt is unavailable.');
  return fence;
}
/** Check immutable historical target pins; later record revisions do not rewrite selection history. */
async function historicalTargetTx(client:PoolClient,siteId:string,record:RegistryRecord,pin:RegistryDocumentCitation){
  if(pin.target.recordId!==record.id||pin.target.revision>record.revision)
    conflict('The document citation belongs to another recorded target revision.');
  const row=(await client.query(`SELECT r.site_id,r.kind,c.status project_status,CASE WHEN r.revision=$2 THEN r.body ELSE h.body END body
    FROM registry_records r LEFT JOIN registry_revisions h ON h.record_id=r.id AND h.revision=$2
    LEFT JOIN usp_project_codes c ON c.record_id=r.id
    WHERE r.id=$1`,[record.id,pin.target.revision])).rows[0];
  if(!row||row.site_id!==siteId||row.kind!==record.kind||['retired','cancelled_error'].includes(row.project_status)||
    !row.body||fingerprint(row.body)!==pin.target.bodySha256)
    conflict('The immutable recorded target citation pin changed or is unavailable.');
}
/** Private reads and writes retain aggregate authority locks through the final checks.
 * Read-only review preparation uses its repeatable-read snapshot, then revalidates with locks before persistence. */
export async function assertRegistryDocumentCitationsTx(client:PoolClient,siteId:string,record:RegistryRecord,
  lock=false,dependencies:Dependencies=defaults,protectAggregate=false){
  const citations=RegistryDocumentCitationsSchema.parse(record.documentCitations??[]);
  if(!citations.length)return [];
  requireCorrection(record);
  if(record.kind==='space'&&citations.some(pin=>!['registry-ifc-citation/1','registry-document-region-citation/1'].includes(pin.version)))
    throw new AppError(422,'REGISTRY_DOCUMENT_TARGET','Space corrections support explicit IFC or source-region citations only.');
  const ctx=context(),entries:ReturnType<typeof RegistryDocumentEvidenceSchema.parse>['citations']=[],budget=citationReadBudget();
  const checked:{pin:RegistryNativeDocumentCitation|RegistryOcrDocumentCitation|RegistrySurveyCitation;input:DocumentInput;source:Awaited<ReturnType<Dependencies['registrySource']>>;fence:number}[]=[];
  const checkedRegions:{pin:RegistryRegionCitation;captured:RegistryRegionPrepared['source']}[]=[];
  const checkedImageRegions:{pin:RegistryImageRegionCitation;captured:RegistryImageRegionPrepared['source']}[]=[];
  const checkedIFC:{pin:RegistryIFCCitation;selection:ReturnType<typeof ifcCitationFusionSelection>;
    captured:Awaited<ReturnType<typeof registryIFCCitationSourceTx>>}[]=[];
  const checkedDXF:{selection:ReturnType<typeof dxfCitationFusionSelection>;
    captured:Awaited<ReturnType<typeof registryDXFCitationSourceTx>>}[]=[];
  const checkedKML:{selection:ReturnType<typeof kmlCitationFusionSelection>;
    captured:Awaited<ReturnType<typeof registryKMLCitationSourceTx>>}[]=[];
  const checkedCityGML:{selection:ReturnType<typeof citygmlCitationFusionSelection>;
    captured:Awaited<ReturnType<typeof registryCityGMLCitationSourceTx>>}[]=[];
  const checkedObj:{selection:ReturnType<typeof objCitationFusionSelection>;
    captured:Awaited<ReturnType<typeof registryObjCitationSourceTx>>}[]=[];
  const checkedGltf:{selection:ReturnType<typeof gltfCitationFusionSelection>;
    captured:Awaited<ReturnType<typeof registryGltfCitationSourceTx>>}[]=[];
  const checkedGeoParquet:{selection:ReturnType<typeof geoparquetCitationFusionSelection>;
    captured:Awaited<ReturnType<typeof registryGeoParquetCitationSourceTx>>}[]=[];
  const checkedRaster:{selection:ReturnType<typeof rasterCitationFusionSelection>;
    captured:Awaited<ReturnType<typeof registryRasterCitationSourceTx>>}[]=[];
  const checkedPoint:{selection:ReturnType<typeof pointCitationFusionSelection>;
    captured:Awaited<ReturnType<typeof registryPointCitationSourceTx>>}[]=[];
  const groups=new Map<string,RegistryDocumentCitation[]>();
  for(const pin of citations){
    if(pin.selection.subject!==ctx.principal.subject)
      throw new AppError(403,'REGISTRY_DOCUMENT_DENIED','This document citation is unavailable to the current operator.');
    await historicalTargetTx(client,siteId,record,pin);
    const key=`${pin.version}:${fingerprint(pin.document)}${pin.version==='registry-gltf-node-citation/1'?':'+fingerprint({
      combinedContextSha256:pin.gltf.combinedContextSha256,selectedNodeIndices:pin.gltf.selectedNodeIndices}):pin.version==='registry-obj-polygon-citation/1'?':'+fingerprint({
      combinedContextSha256:pin.obj.combinedContextSha256,selectedPolygonIndices:pin.obj.selectedPolygonIndices}):''}`;
    groups.set(key,[...(groups.get(key)??[]),pin]);
  }
  for(const group of groups.values()){
    const first=group[0];
    if(first.version==='registry-obj-polygon-citation/1'){
      const pins=group.map(pin=>RegistryObjCitationSchema.parse(pin)),selection=objCitationFusionSelection(first);
      if(pins.some(pin=>fingerprint(objCitationFusionSelection(pin))!==fingerprint(selection)))
        conflict('The exact OBJ reference selection pins differ.');
      const captured=await objSource(dependencies)(client,siteId,selection.pin,lock);
      objTools(dependencies)(captured.authority.input,budget);
      const loaded=await (dependencies.fusionResult??readFusionResult)(selection,captured.authority,budget),projected=fusionSourceProjection(selection,loaded);
      if(projected.kind!=='obj'||loaded.kind!=='obj')conflict('The accepted OBJ polygon reference is unavailable.');
      for(const pin of pins){
        const {version:_,id:__,target:___,selection:attribution,associationState:____,qualification:_____,...fields}=pin;
        if(pin.id!==citationId(pin)||attribution.accessSha256!==captured.authority.input.accessSha256||
          fingerprint(fields)!==fingerprint(objCitationFields(projected,pin.obj.polygonIndex,loaded,pin.obj.combinedContextSha256)))
          conflict('The exact OBJ original, artifact, polygon/span, selection, fragment, attempt or access pin changed.');
        entries.push({pin,fragment:objCitationFragment(projected,pin.obj.polygonIndex,loaded)});
      }
      const current=await objSource(dependencies)(client,siteId,selection.pin,lock);
      if(fingerprint(current)!==fingerprint(captured))conflict('The OBJ reference source changed during its private read.');
      checkedObj.push({selection,captured});continue;
    }
    if(first.version==='registry-gltf-node-citation/1'){
      const pins=group.map(pin=>RegistryGltfCitationSchema.parse(pin)),selection=gltfCitationFusionSelection(first);
      if(pins.some(pin=>fingerprint(gltfCitationFusionSelection(pin))!==fingerprint(selection)))
        conflict('The exact glTF reference selection pins differ.');
      const captured=await gltfSource(dependencies)(client,siteId,selection.pin,lock);
      gltfTools(dependencies)(captured.authority.input,budget);
      const loaded=await (dependencies.fusionResult??readFusionResult)(selection,captured.authority,budget),projected=fusionSourceProjection(selection,loaded);
      if(projected.kind!=='gltf'||loaded.kind!=='gltf')conflict('The accepted glTF node reference is unavailable.');
      for(const pin of pins){
        const {version:_,id:__,target:___,selection:attribution,associationState:____,qualification:_____,...fields}=pin;
        if(pin.id!==citationId(pin)||attribution.accessSha256!==captured.authority.input.accessSha256||
          fingerprint(fields)!==fingerprint(gltfCitationFields(projected,pin.gltf.nodeIndex,loaded,pin.gltf.combinedContextSha256)))
          conflict('The exact glTF original, artifact, node, selection, fragment, attempt or access pin changed.');
        entries.push({pin,fragment:gltfCitationFragment(projected,pin.gltf.nodeIndex,loaded)});
      }
      const current=await gltfSource(dependencies)(client,siteId,selection.pin,lock);
      if(fingerprint(current)!==fingerprint(captured))conflict('The glTF reference source changed during its private read.');
      checkedGltf.push({selection,captured});continue;
    }
    if(first.version==='registry-image-region-citation/1'){
      const captured=await imageRegionSource(dependencies)(client,siteId,first.document,lock);
      for(const raw of group){
        const pin=RegistryImageRegionCitationSchema.parse(raw);assertImageRegionCitation(pin,captured);entries.push({pin});
      }
      checkedImageRegions.push({pin:first,captured});continue;
    }
    if(first.version==='registry-document-region-citation/1'){
      const captured=await regionSource(dependencies)(client,siteId,first.document,lock);
      for(const raw of group){
        const pin=RegistryRegionCitationSchema.parse(raw);assertRegionCitation(pin,captured);entries.push({pin});
      }
      checkedRegions.push({pin:first,captured});continue;
    }
    if(first.version==='registry-dxf-citation/1'){
      const pins=group.map(pin=>RegistryDXFCitationSchema.parse(pin)),selection=dxfCitationFusionSelection(first);
      if(pins.some(pin=>fingerprint(dxfCitationFusionSelection(pin).pin)!==fingerprint(selection.pin)))
        conflict('The exact DXF result selection pins differ.');
      selection.entityOrdinals=[...new Set(pins.map(pin=>pin.dxf.entityOrdinal))];
      const captured=await dxfSource(dependencies)(client,siteId,selection.pin,lock);
      dxfTools(dependencies)(captured.authority.input,budget);
      const loaded=await (dependencies.fusionResult??readFusionResult)(selection,captured.authority,budget),projected=fusionSourceProjection(selection,loaded);
      if(projected.kind!=='dxf')conflict('The accepted DXF entity is unavailable.');
      for(const pin of pins){
        const {version:_,id:__,target:___,selection:attribution,associationState:____,qualification:_____,...fields}=pin;
        if(pin.id!==citationId(pin)||attribution.accessSha256!==captured.authority.input.accessSha256||
          fingerprint(fields)!==fingerprint(fusionDXFCitationFields(projected,pin.dxf.entityOrdinal)))
          conflict('The exact DXF artifact, selection, entity, locator, attempt or access pin changed.');
        entries.push({pin,entity:projected.entities.find(entry=>entry.ordinal===pin.dxf.entityOrdinal)!.record});
      }
      const current=await dxfSource(dependencies)(client,siteId,selection.pin,lock);
      if(fingerprint(current)!==fingerprint(captured))conflict('The DXF source changed during its private read.');
      checkedDXF.push({selection,captured});continue;
    }
    if(first.version==='registry-kml-citation/1'){
      const pins=group.map(pin=>RegistryKMLCitationSchema.parse(pin)),selection=kmlCitationFusionSelection(first);
      if(pins.some(pin=>fingerprint(kmlCitationFusionSelection(pin).pin)!==fingerprint(selection.pin)))
        conflict('The exact KML result selection pins differ.');
      selection.featureOrdinals=[...new Set(pins.map(pin=>pin.kml.featureOrdinal))];
      const captured=await kmlSource(dependencies)(client,siteId,selection.pin,lock);
      kmlTools(dependencies)(captured.authority.input,budget);
      const loaded=await (dependencies.fusionResult??readFusionResult)(selection,captured.authority,budget),projected=fusionSourceProjection(selection,loaded);
      if(projected.kind!=='kml')conflict('The accepted KML feature is unavailable.');
      for(const pin of pins){
        const {version:_,id:__,target:___,selection:attribution,associationState:____,qualification:_____,...fields}=pin;
        if(pin.id!==citationId(pin)||attribution.accessSha256!==captured.authority.input.accessSha256||
          fingerprint(fields)!==fingerprint(fusionKMLCitationFields(projected,pin.kml.featureOrdinal)))
          conflict('The exact KML original, member/XML, artifact, feature, locator, attempt or access pin changed.');
        entries.push({pin,feature:projected.features.find(entry=>entry.ordinal===pin.kml.featureOrdinal)!.record});
      }
      const current=await kmlSource(dependencies)(client,siteId,selection.pin,lock);
      if(fingerprint(current)!==fingerprint(captured))conflict('The KML source changed during its private read.');
      checkedKML.push({selection,captured});continue;
    }
    if(first.version==='registry-citygml-citation/1'){
      const pins=group.map(pin=>RegistryCityGMLCitationSchema.parse(pin)),selection=citygmlCitationFusionSelection(first);
      if(pins.some(pin=>fingerprint(citygmlCitationFusionSelection(pin).pin)!==fingerprint(selection.pin)))
        conflict('The exact CityGML result selection pins differ.');
      selection.buildingOrdinals=[...new Set(pins.map(pin=>pin.citygml.buildingOrdinal))];
      const captured=await citygmlSource(dependencies)(client,siteId,selection.pin,lock);
      citygmlTools(dependencies)(captured.authority.input,budget);
      const loaded=await (dependencies.fusionResult??readFusionResult)(selection,captured.authority,budget),projected=fusionSourceProjection(selection,loaded);
      if(projected.kind!=='citygml')conflict('The accepted CityGML building fragment is unavailable.');
      for(const pin of pins){
        const {version:_,id:__,target:___,selection:attribution,associationState:____,qualification:_____,...fields}=pin;
        if(pin.id!==citationId(pin)||attribution.accessSha256!==captured.authority.input.accessSha256||
          fingerprint(fields)!==fingerprint(fusionCityGMLCitationFields(projected,pin.citygml.buildingOrdinal)))
          conflict('The exact CityGML original, artifact, selection, record, fragment, locator, attempt or access pin changed.');
        entries.push({pin,fragment:fusionCityGMLCitationFragment(projected,pin.citygml.buildingOrdinal)});
      }
      const current=await citygmlSource(dependencies)(client,siteId,selection.pin,lock);
      if(fingerprint(current)!==fingerprint(captured))conflict('The CityGML source changed during its private read.');
      checkedCityGML.push({selection,captured});continue;
    }
    if(first.version==='registry-raster-metadata-citation/1'){
      const pins=group.map(pin=>RegistryRasterCitationSchema.parse(pin)),selection=rasterCitationFusionSelection(first);
      if(pins.some(pin=>fingerprint(rasterCitationFusionSelection(pin))!==fingerprint(selection)))
        conflict('The exact raster result, window and metadata selection pins differ.');
      const captured=await rasterSource(dependencies)(client,siteId,selection.pin,lock);
      const loaded=await (dependencies.fusionResult??readFusionResult)(selection,captured.authority,budget),projected=fusionSourceProjection(selection,loaded);
      if(projected.kind!=='raster')conflict('The accepted raster metadata window is unavailable.');
      for(const pin of pins){
        const {version:_,id:__,target:___,selection:attribution,associationState:____,qualification:_____,...fields}=pin;
        if(pin.id!==citationId(pin)||attribution.accessSha256!==captured.authority.input.accessSha256||
          fingerprint(fields)!==fingerprint(fusionRasterCitationFields(projected)))
          conflict('The exact raster metadata, window, receipt reference, attempt, target or access pin changed.');
        entries.push({pin,fragment:fusionRasterCitationFragment(projected)});
      }
      const current=await rasterSource(dependencies)(client,siteId,selection.pin,lock);
      if(fingerprint(current)!==fingerprint(captured))conflict('The raster source or accepted authority changed during its metadata read.');
      checkedRaster.push({selection,captured});continue;
    }
    if(first.version==='registry-point-metadata-citation/1'){
      const pins=group.map(pin=>RegistryPointCitationSchema.parse(pin)),selection=pointCitationFusionSelection(first);
      if(pins.some(pin=>fingerprint(pointCitationFusionSelection(pin))!==fingerprint(selection)))
        conflict('The exact point result, batch and metadata selection pins differ.');
      const captured=await pointSource(dependencies)(client,siteId,selection.pin,lock);
      const loaded=await (dependencies.fusionResult??readFusionResult)(selection,captured.authority,budget),projected=fusionSourceProjection(selection,loaded);
      if(projected.kind!=='point')conflict('The accepted point metadata batch is unavailable.');
      for(const pin of pins){
        const {version:_,id:__,target:___,selection:attribution,associationState:____,qualification:_____,...fields}=pin;
        if(pin.id!==citationId(pin)||attribution.accessSha256!==captured.authority.input.accessSha256||
          fingerprint(fields)!==fingerprint(fusionPointCitationFields(projected)))
          conflict('The exact point metadata, batch, receipt reference, attempt, target or access pin changed.');
        entries.push({pin,fragment:fusionPointCitationFragment(projected)});
      }
      const current=await pointSource(dependencies)(client,siteId,selection.pin,lock);
      if(fingerprint(current)!==fingerprint(captured))conflict('The point source or accepted authority changed during its metadata read.');
      checkedPoint.push({selection,captured});continue;
    }
    if(first.version==='registry-geoparquet-citation/1'){
      const pins=group.map(pin=>RegistryGeoParquetCitationSchema.parse(pin)),selection=geoparquetCitationFusionSelection(first);
      if(pins.some(pin=>fingerprint(geoparquetCitationFusionSelection(pin).pin)!==fingerprint(selection.pin)||
        pin.geoparquet.artifactSha256!==selection.artifactSha256))
        conflict('The exact GeoParquet result and artifact selection pins differ.');
      selection.rowIndices=[...new Set(pins.map(pin=>pin.geoparquet.rowIndex))];
      const captured=await geoparquetSource(dependencies)(client,siteId,selection.pin,lock);
      geoparquetTools(dependencies)(captured.authority.input,budget);
      const loaded=await (dependencies.fusionResult??readFusionResult)(selection,captured.authority,budget),projected=fusionSourceProjection(selection,loaded);
      if(projected.kind!=='geoparquet')conflict('The accepted GeoParquet row is unavailable.');
      for(const pin of pins){
        const {version:_,id:__,target:___,selection:attribution,associationState:____,qualification:_____,...fields}=pin;
        if(pin.id!==citationId(pin)||attribution.accessSha256!==captured.authority.input.accessSha256||
          fingerprint(fields)!==fingerprint(fusionGeoParquetCitationFields(projected,pin.geoparquet.rowIndex)))
          conflict('The exact GeoParquet original, window, parent, row, columns, locator, attempt or access pin changed.');
        entries.push({pin,fragment:fusionGeoParquetCitationFragment(projected,pin.geoparquet.rowIndex)});
      }
      const current=await geoparquetSource(dependencies)(client,siteId,selection.pin,lock);
      if(fingerprint(current)!==fingerprint(captured))conflict('The GeoParquet source or accepted parent changed during its private read.');
      checkedGeoParquet.push({selection,captured});continue;
    }
    if(first.version==='registry-ifc-citation/1'){
      const pins=group.map(pin=>RegistryIFCCitationSchema.parse(pin)),selection=ifcCitationFusionSelection(first);
      if(pins.some(pin=>fingerprint(ifcCitationFusionSelection(pin).pin)!==fingerprint(selection.pin)))
        conflict('The exact IFC result selection pins differ.');
      selection.stepIds=[...new Set(pins.map(pin=>pin.ifc.stepId))];
      const captured=await ifcSource(dependencies)(client,siteId,selection.pin,lock);
      ifcTools(dependencies)(captured.authority.input,budget);
      const loaded=await (dependencies.fusionResult??readFusionResult)(selection,captured.authority,budget),projected=fusionSourceProjection(selection,loaded);
      if(projected.kind!=='ifc')conflict('The accepted IFC record is unavailable.');
      for(const pin of pins){
        const {version:_,id:__,target:___,selection:attribution,associationState:____,qualification:_____,identityAssertion:______,...fields}=pin;
        if(pin.id!==citationId(pin)||attribution.accessSha256!==captured.authority.input.accessSha256||
          fingerprint(fields)!==fingerprint(fusionIFCCitationFields(projected,pin.ifc.stepId)))
          conflict('The exact IFC artifact, record, locator, attempt or access pin changed.');
        const native=projected.entities.find(entry=>entry.record.stepId===pin.ifc.stepId)!.record;
        assertIFCIdentityEvidence(record.kind,pin,native,captured.authority.input.accessSha256);
        entries.push({pin,record:native});
      }
      const current=await ifcSource(dependencies)(client,siteId,selection.pin,lock);
      if(fingerprint(current)!==fingerprint(captured))conflict('The IFC source changed during its private read.');
      checkedIFC.push({pin:first,selection,captured});continue;
    }
    const source=await citationSource(dependencies)(client,siteId,first.document.sourceId);
    const input=await dependencies.source(client,ctx,first.document,undefined,lock),fence=await acceptedFenceTx(client,input.jobId);
    if(source.revision!==input.sourceRevision||source.sha256!==input.sourceSha256)conflict('The site document source pins changed.');
    if(first.version==='registry-document-citation/1'){
      const nativePins=group.map(pin=>RegistryNativeDocumentCitationSchema.parse(pin));
      const result=await dependencies.result(input,first.document.resultSha256);
      const parts=literalCitationParts(result,input,nativePins.map(pin=>pin.partId));
      for(const [index,pin] of nativePins.entries()){
        const part=parts[index];
        if(pin.id!==citationId(pin)||pin.inputSha256!==fingerprint(input)||pin.readerSha256!==input.readerSha256||pin.acceptedFence!==fence||
          pin.selection.accessSha256!==input.accessSha256||pin.partSha256!==part.sha256||fingerprint(pin.locator)!==fingerprint(part.locator))
          conflict('The exact native part, reader, accepted attempt or access pin changed.');
        entries.push({pin,part});
      }
    }else if(first.version==='registry-survey-row-citation/1'){
      const pins=group.map(pin=>RegistrySurveyCitationSchema.parse(pin)),selection=surveyCitationFusionSelection(first);
      if(pins.some(pin=>fingerprint(surveyCitationFusionSelection(pin).pin)!==fingerprint(selection.pin)))
        conflict('The exact survey result selection pins differ.');
      selection.rowOrdinals=[...new Set(pins.map(pin=>pin.survey.row.ordinal))];
      const loaded=await (dependencies.fusionResult??readFusionResult)(selection,{kind:'document',input,acceptedFence:fence},budget);
      const projected=fusionSourceProjection(selection,loaded);
      if(projected.kind!=='survey_report')conflict('The accepted survey reference is unavailable.');
      for(const pin of pins){
        eligibleCitationPart(projected.parts.find(part=>part.id===pin.survey.row.quote.citation.partId),input);
        const {version:_,id:__,target:___,selection:attribution,associationState:____,qualification:_____,...fields}=pin;
        if(pin.id!==citationId(pin)||pin.inputSha256!==fingerprint(input)||pin.readerSha256!==input.readerSha256||pin.acceptedFence!==fence||
          attribution.accessSha256!==input.accessSha256||fingerprint(fields)!==fingerprint(surveyCitationFields(projected,pin.survey.row.ordinal)))
          conflict('The exact survey row, quote, field roles, report, attempt or access pin changed.');
        entries.push({pin,fragment:surveyCitationFragment(projected,pin.survey.row.ordinal)});
      }
    }else if(first.version==='registry-document-ocr-citation/1'){
      const ocrPins=group.map(pin=>RegistryOcrDocumentCitationSchema.parse(pin)),selection=ocrCitationFusionSelection(first);
      // All observations in this result share one exact full input/fence/byte pin.
      if(ocrPins.some(pin=>fingerprint(ocrCitationFusionSelection(pin).pin)!==fingerprint(selection.pin)))
        conflict('The exact OCR result selection pins differ.');
      selection.itemOrdinals=[...new Set(ocrPins.map(pin=>pin.itemOrdinal))];
      const loaded=await (dependencies.fusionResult??readFusionResult)(selection,{kind:'document',input,acceptedFence:fence},budget);
      const projected=fusionSourceProjection(selection,loaded);
      if(projected.kind!=='document_ocr')conflict('The accepted OCR observation is unavailable.');
      for(const pin of ocrPins){
        const {version:_,id:__,target:___,selection:attribution,associationState:____,qualification:_____,...fields}=pin;
        if(pin.id!==citationId(pin)||pin.inputSha256!==fingerprint(input)||pin.readerSha256!==input.readerSha256||pin.acceptedFence!==fence||
          attribution.accessSha256!==input.accessSha256||fingerprint(fields)!==fingerprint(fusionOcrCitationFields(projected,pin.itemOrdinal)))
          conflict('The exact OCR observation, configuration, locator, attempt or access pin changed.');
        entries.push({pin,item:projected.observations.find(item=>item.ordinal===pin.itemOrdinal)!.item});
      }
    }
    await dependencies.source(client,ctx,first.document,input,lock);
    const current=await citationSource(dependencies)(client,siteId,first.document.sourceId);
    if(fingerprint(current)!==fingerprint(source)||await acceptedFenceTx(client,input.jobId)!==fence)
      conflict('The document source or accepted attempt changed during its read.');
    checked.push({pin:first,input,source,fence});
  }
  // Finish every object read before acquiring the complete authority lock set.
  // The canonical helper locks the case (including source-family changes) and
  // exact source/job/accepted-attempt rows until the caller's transaction ends.
  // Use stable ordering for the final aggregate lock acquisition.
  const aggregate=[...checked.map(item=>({input:item.input,
    protect:()=>dependencies.source(client,ctx,item.pin.document,item.input,true),validate:async()=>{
      await dependencies.source(client,ctx,item.pin.document,item.input);
      const current=await citationSource(dependencies)(client,siteId,item.pin.document.sourceId);
      if(fingerprint(current)!==fingerprint(item.source)||await acceptedFenceTx(client,item.input.jobId)!==item.fence)
        conflict('The aggregate document source or accepted attempt changed during its read.');
    }})),...checkedIFC.map(item=>({input:item.captured.authority.input,
    protect:()=>ifcSource(dependencies)(client,siteId,item.selection.pin,true),validate:async()=>{
      const current=await ifcSource(dependencies)(client,siteId,item.selection.pin);
      if(fingerprint(current)!==fingerprint(item.captured))conflict('The aggregate IFC source changed during its private read.');
      ifcTools(dependencies)(current.authority.input,budget);
    }})),...checkedDXF.map(item=>({input:item.captured.authority.input,
    protect:()=>dxfSource(dependencies)(client,siteId,item.selection.pin,true),validate:async()=>{
      const current=await dxfSource(dependencies)(client,siteId,item.selection.pin);
      if(fingerprint(current)!==fingerprint(item.captured))conflict('The aggregate DXF source changed during its private read.');
      dxfTools(dependencies)(current.authority.input,budget);
    }})),...checkedKML.map(item=>({input:item.captured.authority.input,
    protect:()=>kmlSource(dependencies)(client,siteId,item.selection.pin,true),validate:async()=>{
      const current=await kmlSource(dependencies)(client,siteId,item.selection.pin);
      if(fingerprint(current)!==fingerprint(item.captured))conflict('The aggregate KML source changed during its private read.');
      kmlTools(dependencies)(current.authority.input,budget);
    }})),...checkedCityGML.map(item=>({input:item.captured.authority.input,
    protect:()=>citygmlSource(dependencies)(client,siteId,item.selection.pin,true),validate:async()=>{
      const current=await citygmlSource(dependencies)(client,siteId,item.selection.pin);
      if(fingerprint(current)!==fingerprint(item.captured))conflict('The aggregate CityGML source changed during its private read.');
      citygmlTools(dependencies)(current.authority.input,budget);
    }})),...checkedObj.map(item=>({input:item.captured.authority.input,
    protect:()=>objSource(dependencies)(client,siteId,item.selection.pin,true),validate:async()=>{
      const current=await objSource(dependencies)(client,siteId,item.selection.pin);
      if(fingerprint(current)!==fingerprint(item.captured))conflict('The aggregate OBJ reference source changed during its private read.');
      objTools(dependencies)(current.authority.input,budget);
    }})),...checkedGltf.map(item=>({input:item.captured.authority.input,
    protect:()=>gltfSource(dependencies)(client,siteId,item.selection.pin,true),validate:async()=>{
      const current=await gltfSource(dependencies)(client,siteId,item.selection.pin);
      if(fingerprint(current)!==fingerprint(item.captured))conflict('The aggregate glTF reference source changed during its private read.');
      gltfTools(dependencies)(current.authority.input,budget);
    }})),...checkedGeoParquet.map(item=>({input:item.captured.authority.input,
    protect:()=>geoparquetSource(dependencies)(client,siteId,item.selection.pin,true),validate:async()=>{
      const current=await geoparquetSource(dependencies)(client,siteId,item.selection.pin);
      if(fingerprint(current)!==fingerprint(item.captured))conflict('The aggregate GeoParquet source or accepted parent changed during its private read.');
      geoparquetTools(dependencies)(current.authority.input,budget);
    }})),...checkedRaster.map(item=>({input:item.captured.authority.input,
    protect:()=>rasterSource(dependencies)(client,siteId,item.selection.pin,true),validate:async()=>{
      const current=await rasterSource(dependencies)(client,siteId,item.selection.pin);
      if(fingerprint(current)!==fingerprint(item.captured))conflict('The aggregate raster source or accepted authority changed during its metadata read.');
    }})),...checkedPoint.map(item=>({input:item.captured.authority.input,
    protect:()=>pointSource(dependencies)(client,siteId,item.selection.pin,true),validate:async()=>{
      const current=await pointSource(dependencies)(client,siteId,item.selection.pin);
      if(fingerprint(current)!==fingerprint(item.captured))conflict('The aggregate point source or accepted authority changed during its metadata read.');
    }})),...checkedRegions.map(item=>({input:{caseId:item.pin.document.caseId,sourceId:item.pin.document.sourceId},
      protect:()=>regionSource(dependencies)(client,siteId,item.pin.document,true),validate:async()=>{
        const current=await regionSource(dependencies)(client,siteId,item.pin.document);
        if(fingerprint(current)!==fingerprint(item.captured))conflict('The aggregate region source changed during its private read.');
        assertRegionCitation(item.pin,current);
      }})),...checkedImageRegions.map(item=>({input:{caseId:item.pin.document.caseId,sourceId:item.pin.document.sourceId},
      protect:()=>imageRegionSource(dependencies)(client,siteId,item.pin.document,true),validate:async()=>{
        const current=await imageRegionSource(dependencies)(client,siteId,item.pin.document);
        if(fingerprint(current)!==fingerprint(item.captured))conflict('The aggregate image-region source changed during its private read.');
        assertImageRegionCitation(item.pin,current);
      }}))].sort((a,b)=>a.input.caseId.localeCompare(b.input.caseId)||
    a.input.sourceId.localeCompare(b.input.sourceId)||('jobId' in a.input?a.input.jobId:'').localeCompare('jobId' in b.input?b.input.jobId:''));
  if(lock||protectAggregate)
    for(const item of aggregate)await item.protect();
  // Protected callers validate again only after the complete lock set is held:
  // a source can change during lock acquisition or later groups' result I/O.
  for(const item of aggregate)await item.validate();
  if(checkedObj.length||checkedIFC.length||checkedDXF.length||checkedKML.length||checkedCityGML.length||checkedGeoParquet.length||checkedRaster.length||checkedPoint.length||checkedRegions.length||checkedImageRegions.length)for(const pin of citations)await historicalTargetTx(client,siteId,record,pin);
  if(citations.some(pin=>pin.version!=='registry-document-citation/1'))fusionLive(budget);
  return entries;
}
export function citationId(pin:Pick<RegistryNativeDocumentCitation,'document'|'partId'|'target'>|RegistryOcrDocumentCitation|RegistryIFCCitation|RegistryRegionCitation|RegistryImageRegionCitation|RegistryDXFCitation|RegistryKMLCitation|RegistryCityGMLCitation|RegistryGeoParquetCitation|RegistryRasterCitation|RegistryPointCitation|RegistrySurveyCitation|RegistryGltfCitation|RegistryObjCitation){
  if('partId' in pin)return fingerprint({document:pin.document,partId:pin.partId,target:pin.target});
  if(pin.version==='registry-document-region-citation/1')return regionCitationId(pin);
  if(pin.version==='registry-image-region-citation/1')return imageRegionCitationId(pin);
  if(pin.version==='registry-survey-row-citation/1')return surveyCitationId(pin);
  if(pin.version==='registry-gltf-node-citation/1')return gltfCitationId(pin);
  if(pin.version==='registry-obj-polygon-citation/1')return objCitationId(pin);
  if(pin.version==='registry-ifc-citation/1')return fingerprint({version:pin.version,document:pin.document,inputSha256:pin.inputSha256,
    readerSha256:pin.readerSha256,acceptedFence:pin.acceptedFence,resultBytes:pin.resultBytes,ifc:pin.ifc,target:pin.target});
  if(pin.version==='registry-dxf-citation/1')return fingerprint({version:pin.version,document:pin.document,inputSha256:pin.inputSha256,
    readerSha256:pin.readerSha256,acceptedFence:pin.acceptedFence,resultBytes:pin.resultBytes,dxf:pin.dxf,target:pin.target});
  if(pin.version==='registry-kml-citation/1')return fingerprint({version:pin.version,document:pin.document,inputSha256:pin.inputSha256,
    readerSha256:pin.readerSha256,acceptedFence:pin.acceptedFence,resultBytes:pin.resultBytes,kml:pin.kml,target:pin.target});
  if(pin.version==='registry-citygml-citation/1')return fingerprint({version:pin.version,document:pin.document,inputSha256:pin.inputSha256,
    readerSha256:pin.readerSha256,acceptedFence:pin.acceptedFence,resultBytes:pin.resultBytes,citygml:pin.citygml,target:pin.target});
  if(pin.version==='registry-geoparquet-citation/1')return fingerprint({version:pin.version,document:pin.document,inputSha256:pin.inputSha256,
    readerSha256:pin.readerSha256,acceptedFence:pin.acceptedFence,resultBytes:pin.resultBytes,geoparquet:pin.geoparquet,target:pin.target});
  if(pin.version==='registry-raster-metadata-citation/1')return fingerprint({version:pin.version,document:pin.document,inputSha256:pin.inputSha256,
    readerSha256:pin.readerSha256,acceptedFence:pin.acceptedFence,resultBytes:pin.resultBytes,raster:pin.raster,target:pin.target});
  if(pin.version==='registry-point-metadata-citation/1')return fingerprint({version:pin.version,document:pin.document,inputSha256:pin.inputSha256,
    readerSha256:pin.readerSha256,acceptedFence:pin.acceptedFence,resultBytes:pin.resultBytes,point:pin.point,target:pin.target});
  return fingerprint({version:pin.version,document:pin.document,inputSha256:pin.inputSha256,readerSha256:pin.readerSha256,
    acceptedFence:pin.acceptedFence,resultBytes:pin.resultBytes,ocrConfigSha256:pin.ocrConfigSha256,
    itemOrdinal:pin.itemOrdinal,itemSha256:pin.itemSha256,target:pin.target});
}
export function applyCitationAmendment(record:RegistryRecord,added:RegistryDocumentCitation[],remove:readonly string[]){
  const old=RegistryDocumentCitationsSchema.parse(record.documentCitations??[]);
  if(remove.some(id=>!old.some(pin=>pin.id===id)))conflict('A selected citation to remove is absent from this draft.');
  const byId=new Map(old.filter(pin=>!remove.includes(pin.id)).map(pin=>[pin.id,pin]));
  for(const pin of added){
    if(remove.includes(pin.id))throw new AppError(422,'REGISTRY_DOCUMENT_SELECTION','Do not add and remove the same citation.');
    if(!byId.has(pin.id))byId.set(pin.id,pin);
  }
  const documentCitations=RegistryDocumentCitationsSchema.parse([...byId.values()]);
  return {...record,documentCitations};
}
async function lockedDraftTx(client:PoolClient,draftId:string,recordId?:string,lock=false,extra:readonly string[]=[],acquireGates=true,regionExtra:readonly string[]=[]){
  const initial=(await client.query('SELECT site_id,case_id,records FROM registry_drafts WHERE id=$1',[draftId])).rows[0]??notFound();
  const cases=registryDocumentCases(initial.case_id,initial.records,extra);
  const regions=registryRegionCases(initial.records,regionExtra);
  if(acquireGates)await lockRegistryDocumentCasesTx(client,cases,regions);
  if(lock)await client.query('SELECT id FROM registry_sites WHERE id=$1 FOR UPDATE',[initial.site_id]);
  const draft=(await client.query(`SELECT * FROM registry_drafts WHERE id=$1${lock?' FOR UPDATE':''}`,[draftId])).rows[0]??notFound();
  if(draft.site_id!==initial.site_id||draft.case_id!==initial.case_id)conflict('The draft site or workspace changed.');
  assertRegistryDocumentCases(cases,registryDocumentCases(draft.case_id,draft.records,extra));
  assertRegistryDocumentCases(regions,registryRegionCases(draft.records,regionExtra));
  const records=draft.records as RegistryRecord[];
  if(records.length!==1 || (recordId&&records[0].id!==recordId))
    throw new AppError(422,'REGISTRY_DOCUMENT_DRAFT_SCOPE','Amend one existing building, floor or space correction per draft.');
  requireCorrection(records[0]);return {draft,record:records[0]};
}
/** Verified immutable results may be reused within this one locked amendment;
 * every source/access/fence is still checked again through canonical authority. */
function fusionValidationDependencies(fusion:Awaited<ReturnType<typeof resolveFusionCitationsTx>>,dependencies:Dependencies):Dependencies{
  return {...dependencies,result:async(input,hash)=>fusion.documents.get(`${input.jobId}/${hash}`)?.loaded.result??dependencies.result(input,hash),
    fusionResult:async(selection,authority,budget)=>{
      const cached=fusion.documents.get(`${selection.pin.jobId}/${selection.pin.resultSha256}`)??fusion.ifcs.get(`${selection.pin.jobId}/${selection.pin.resultSha256}`)??
        fusion.dxfs.get(`${selection.pin.jobId}/${selection.pin.resultSha256}`)??fusion.kmls.get(`${selection.pin.jobId}/${selection.pin.resultSha256}`)??
        fusion.citygmls.get(`${selection.pin.jobId}/${selection.pin.resultSha256}`)??fusion.objs.get(`${selection.pin.jobId}/${selection.pin.resultSha256}`)??fusion.gltfs.get(`${selection.pin.jobId}/${selection.pin.resultSha256}`)??fusion.geoparquets.get(`${selection.pin.jobId}/${selection.pin.resultSha256}`)??
        fusion.rasters.get(`${selection.pin.jobId}/${selection.pin.resultSha256}`)??fusion.points.get(`${selection.pin.jobId}/${selection.pin.resultSha256}`);
      return cached&&fingerprint(cached.pin)===fingerprint(selection.pin)?cached.loaded:
        (dependencies.fusionResult??readFusionResult)(selection,authority,budget);
    }};
}
/** Existing operations holds only the idempotency receipt; citations live solely in registry_drafts/records/history. */
export type RegistryRegionAmendmentPrepared=RegistryRegionPrepared&{draftSha256:string;targetSha256:string};
export type RegistryImageRegionAmendmentPrepared=RegistryImageRegionPrepared&{draftSha256:string;targetSha256:string};
export async function amendRegistryDocumentCitationsTx(client:PoolClient,draftId:string,raw:unknown,dependencies:Dependencies=defaults,
  prepared?:RegistryRegionAmendmentPrepared|RegistryImageRegionAmendmentPrepared){
  const request=RegistryDocumentAmendmentSchema.parse(raw);
  if(request.addFusion?.selection.sources.some(source=>source.kind==='obj')&&!request.addFusion.objReferences)
    throw new AppError(422,'SOURCE_FUSION_OBJ_CONTEXT_ONLY','OBJ polygons support source context only; citation attachment is unsupported.');
  if(request.addFusion?.selection.sources.some(source=>source.kind==='gltf')&&!request.addFusion.gltfReferences)
    throw new AppError(422,'SOURCE_FUSION_GLTF_CONTEXT_ONLY','glTF nodes support source context only; reviewed citation attachment is unsupported.');
  if(request.addFusion&&Buffer.byteLength(JSON.stringify(request))>32*1024)
    throw new AppError(413,'REGISTRY_DOCUMENT_REQUEST_LIMIT','Select a smaller explicit citation amendment.');
  const {draft,record}=await lockedDraftTx(client,draftId,request.recordId,true,
    request.add?[request.add.document.caseId]:request.addRegion?[request.addRegion.document.caseId]:request.addImageRegion?[request.addImageRegion.document.caseId]:
      request.addFusion?request.addFusion.selection.sources.map(source=>source.pin.caseId):[],true,
    request.addRegion?[request.addRegion.document.caseId]:request.addImageRegion?[request.addImageRegion.document.caseId]:[]);
  if(draft.status!=='draft'||record.revision!==request.expectedRecordRevision)conflict('Use the exact active correction and recorded target revision.');
  const target=await currentTargetTx(client,draft.site_id,record,true,dependencies),ctx=context();
  if(record.kind==='space'&&(request.add||request.addImageRegion||request.addFusion?.selection.sources.some(source=>
    source.kind==='obj'?source.polygonIndices.length:source.kind==='gltf'?source.nodeIndices.length:source.kind==='survey_report'?source.rowOrdinals.length:source.kind==='document'?source.partIds.length:source.kind==='document_ocr'?source.itemOrdinals.length:source.kind==='dxf'?source.entityOrdinals.length:source.kind==='kml'?source.featureOrdinals.length:source.kind==='citygml'?source.buildingOrdinals.length:source.kind==='geoparquet'?source.rowIndices.length:source.kind==='raster'||source.kind==='point')))
    throw new AppError(422,'REGISTRY_DOCUMENT_TARGET','Space corrections support explicit IFC or source-region citations only.');
  const operationKey=`registry-document-citations:${draftId}:${request.requestKey}`;
  const digest=fingerprint({request,subject:ctx.principal.subject,reviewContext:documentReviewContext()});
  const prior=(await client.query("SELECT payload_hash,result FROM operations WHERE case_id=$1 AND operation_key=$2 AND kind='registry-document-citations'",
    [draft.case_id,operationKey])).rows[0];
  if(prior){
    const receipt=RegistryDocumentAmendmentReceiptSchema.parse(prior.result);
    if(prior.payload_hash!==digest||draft.revision!==receipt.draftRevision)conflict('This amendment request or its draft changed.');
    if(request.addFusion){
      for(const selected of request.addFusion.selection.sources){
        if(selected.kind==='ifc')await ifcSource(dependencies)(client,draft.site_id,selected.pin,true);
        else if(selected.kind==='dxf')await dxfSource(dependencies)(client,draft.site_id,selected.pin,true);
        else if(selected.kind==='kml')await kmlSource(dependencies)(client,draft.site_id,selected.pin,true);
        else if(selected.kind==='citygml')await citygmlSource(dependencies)(client,draft.site_id,selected.pin,true);
        else if(selected.kind==='obj')await objSource(dependencies)(client,draft.site_id,selected.pin,true);
        else if(selected.kind==='gltf')await gltfSource(dependencies)(client,draft.site_id,selected.pin,true);
        else if(selected.kind==='geoparquet')await geoparquetSource(dependencies)(client,draft.site_id,selected.pin,true);
        else if(selected.kind==='raster')await rasterSource(dependencies)(client,draft.site_id,selected.pin,true);
        else if(selected.kind==='point')await pointSource(dependencies)(client,draft.site_id,selected.pin,true);
        else if(selected.kind!=='cityjson')await citationSource(dependencies)(client,draft.site_id,selected.pin.sourceId);
      }
      const fusion=await resolveFusionCitationsTx(client,ctx,request.addFusion,dependencies,draft.site_id,true,request.addFusion.gltfReferences===true,request.addFusion.objReferences===true);
      await assertRegistryDocumentCitationsTx(client,draft.site_id,record,true,fusionValidationDependencies(fusion,dependencies));
      await currentTargetTx(client,draft.site_id,record,true,dependencies);await fusion.revalidate();
    }else await assertRegistryDocumentCitationsTx(client,draft.site_id,record,true,dependencies);
    return receipt;
  }
  if(draft.revision!==request.expectedDraftRevision)conflict('The draft changed. Refresh before amending its exact citations.');
  const added:RegistryDocumentCitation[]=[];
  if(request.addImageRegion){
    if(!prepared||prepared.validation.version!=='packet-image-region-local/1'||
      prepared.requestSha256!==fingerprint(request.addImageRegion)||prepared.draftSha256!==fingerprint(draft)||
      prepared.targetSha256!==fingerprint(target.body))conflict('The exact image-region amendment changed after crop validation.');
    const current=await imageRegionSource(dependencies)(client,draft.site_id,request.addImageRegion.document,true);
    if(fingerprint(current)!==fingerprint(prepared.source))conflict('The original image changed after crop validation.');
    const pin=RegistryImageRegionCitationSchema.parse({...request.addImageRegion,version:'registry-image-region-citation/1',id:'0'.repeat(64),
      target:{recordId:record.id,revision:record.revision,bodySha256:fingerprint(target.body)},
      selection:{subject:ctx.principal.subject,accessSha256:current.accessSha256,selectedAt:new Date().toISOString()},
      authoritySha256:current.authority.authoritySha256,validation:prepared.validation,
      applicability:'explicit_officer_inclusion; effective_after_canonical_commit',associationState:'operator_selected',qualification:'not_assessed'});
    pin.id=imageRegionCitationId(pin);assertImageRegionCitation(pin,current);added.push(pin);
  }
  if(request.addRegion){
    if(!prepared||prepared.validation.version!=='packet-region-local/1'||prepared.requestSha256!==fingerprint(request.addRegion)||prepared.draftSha256!==fingerprint(draft)||
      prepared.targetSha256!==fingerprint(target.body))conflict('The exact region amendment changed after crop validation.');
    const current=await regionSource(dependencies)(client,draft.site_id,request.addRegion.document,true);
    if(fingerprint(current)!==fingerprint(prepared.source))conflict('The original source changed after crop validation.');
    const pin=RegistryRegionCitationSchema.parse({...request.addRegion,version:'registry-document-region-citation/1',id:'0'.repeat(64),
      target:{recordId:record.id,revision:record.revision,bodySha256:fingerprint(target.body)},
      selection:{subject:ctx.principal.subject,accessSha256:current.accessSha256,selectedAt:new Date().toISOString()},
      authoritySha256:current.authority.authoritySha256,validation:prepared.validation,
      applicability:'explicit_officer_inclusion; effective_after_canonical_commit',associationState:'operator_selected',qualification:'not_assessed'});
    pin.id=regionCitationId(pin);assertRegionCitation(pin,current);added.push(pin);
  }
  let fusion:Awaited<ReturnType<typeof resolveFusionCitationsTx>>|undefined;
  if(request.addFusion){
    // Deny site-ineligible citation sources before reading their private results.
    for(const selected of request.addFusion.selection.sources){
      if(selected.kind==='ifc')await ifcSource(dependencies)(client,draft.site_id,selected.pin,true);
      else if(selected.kind==='dxf')await dxfSource(dependencies)(client,draft.site_id,selected.pin,true);
      else if(selected.kind==='kml')await kmlSource(dependencies)(client,draft.site_id,selected.pin,true);
      else if(selected.kind==='citygml')await citygmlSource(dependencies)(client,draft.site_id,selected.pin,true);
      else if(selected.kind==='obj')await objSource(dependencies)(client,draft.site_id,selected.pin,true);
      else if(selected.kind==='gltf')await gltfSource(dependencies)(client,draft.site_id,selected.pin,true);
      else if(selected.kind==='geoparquet')await geoparquetSource(dependencies)(client,draft.site_id,selected.pin,true);
      else if(selected.kind==='raster')await rasterSource(dependencies)(client,draft.site_id,selected.pin,true);
      else if(selected.kind==='point')await pointSource(dependencies)(client,draft.site_id,selected.pin,true);
      else if(selected.kind!=='cityjson')await citationSource(dependencies)(client,draft.site_id,selected.pin.sourceId);
    }
    fusion=await resolveFusionCitationsTx(client,ctx,request.addFusion,dependencies,draft.site_id,true,request.addFusion.gltfReferences===true,request.addFusion.objReferences===true);
    const targetPin={recordId:record.id,revision:record.revision,bodySha256:fingerprint(target.body)};
    const attribution=(input:Pick<DocumentInput,'accessSha256'>)=>({subject:ctx.principal.subject,accessSha256:input.accessSha256,selectedAt:new Date().toISOString()});
    for(const source of fusion.context.sources){
      if(source.kind==='obj'){
        if(!request.addFusion.objReferences)throw new AppError(422,'SOURCE_FUSION_OBJ_CONTEXT_ONLY','Select the explicit OBJ source-reference workflow.');
        const input=fusion.objInputs.get(source.pin.sourceId)!,loaded=fusion.objs.get(`${source.pin.jobId}/${source.pin.resultSha256}`)!.loaded;
        for(const polygon of source.polygons){
          const pin=RegistryObjCitationSchema.parse({...objCitationFields(source,polygon.index,loaded,fusion.context.contextSha256),id:'0'.repeat(64),
            version:'registry-obj-polygon-citation/1',target:targetPin,selection:attribution(input),associationState:'operator_selected',qualification:'not_assessed'});
          pin.id=citationId(pin);added.push(pin);
        }
        continue;
      }
      if(source.kind==='gltf'){
        if(!request.addFusion.gltfReferences)throw new AppError(422,'SOURCE_FUSION_GLTF_CONTEXT_ONLY','Select the explicit glTF source-reference workflow.');
        const input=fusion.gltfInputs.get(source.pin.sourceId)!,loaded=fusion.gltfs.get(`${source.pin.jobId}/${source.pin.resultSha256}`)!.loaded;
        for(const node of source.nodes){
          const pin=RegistryGltfCitationSchema.parse({...gltfCitationFields(source,node.index,loaded,fusion.context.contextSha256),id:'0'.repeat(64),
            version:'registry-gltf-node-citation/1',target:targetPin,selection:attribution(input),associationState:'operator_selected',qualification:'not_assessed'});
          pin.id=citationId(pin);added.push(pin);
        }
        continue;
      }
      if(source.kind==='cityjson')continue;
      if(source.kind==='survey_report'){
        const input=fusion.inputs.get(source.pin.sourceId)!;
        for(const entry of source.rows){
          const part=source.parts.find(part=>part.id===entry.row.quote.citation.partId);eligibleCitationPart(part,input);
          const pin=RegistrySurveyCitationSchema.parse({...surveyCitationFields(source,entry.row.ordinal),id:'0'.repeat(64),
            version:'registry-survey-row-citation/1',target:targetPin,selection:attribution(input),
            associationState:'operator_selected',qualification:'not_assessed'});
          pin.id=citationId(pin);added.push(pin);
        }
        continue;
      }
      if(source.kind==='raster'){
        const input=fusion.rasterInputs.get(source.pin.sourceId)!;
        const pin=RegistryRasterCitationSchema.parse({...fusionRasterCitationFields(source),id:'0'.repeat(64),
          version:'registry-raster-metadata-citation/1',target:targetPin,selection:attribution(input),associationState:'operator_selected',qualification:'not_assessed'});
        pin.id=citationId(pin);added.push(pin);continue;
      }
      if(source.kind==='point'){
        const input=fusion.pointInputs.get(source.pin.sourceId)!;
        const pin=RegistryPointCitationSchema.parse({...fusionPointCitationFields(source),id:'0'.repeat(64),
          version:'registry-point-metadata-citation/1',target:targetPin,selection:attribution(input),associationState:'operator_selected',qualification:'not_assessed'});
        pin.id=citationId(pin);added.push(pin);continue;
      }
      if(source.kind==='geoparquet'){
        const input=fusion.geoparquetInputs.get(source.pin.sourceId)!;
        for(const entry of source.rows){
          const pin=RegistryGeoParquetCitationSchema.parse({...fusionGeoParquetCitationFields(source,entry.rowIndex),id:'0'.repeat(64),
            version:'registry-geoparquet-citation/1',target:targetPin,selection:attribution(input),associationState:'operator_selected',qualification:'not_assessed'});
          pin.id=citationId(pin);added.push(pin);
        }
        continue;
      }
      if(source.kind==='citygml'){
        const input=fusion.citygmlInputs.get(source.pin.sourceId)!;
        for(const entry of source.buildings){
          const pin=RegistryCityGMLCitationSchema.parse({...fusionCityGMLCitationFields(source,entry.ordinal),id:'0'.repeat(64),
            version:'registry-citygml-citation/1',target:targetPin,selection:attribution(input),associationState:'operator_selected',qualification:'not_assessed'});
          pin.id=citationId(pin);added.push(pin);
        }
        continue;
      }
      if(source.kind==='kml'){
        const input=fusion.kmlInputs.get(source.pin.sourceId)!;
        for(const entry of source.features){
          const pin=RegistryKMLCitationSchema.parse({...fusionKMLCitationFields(source,entry.ordinal),id:'0'.repeat(64),
            version:'registry-kml-citation/1',target:targetPin,selection:attribution(input),associationState:'operator_selected',qualification:'not_assessed'});
          pin.id=citationId(pin);added.push(pin);
        }
        continue;
      }
      if(source.kind==='dxf'){
        const input=fusion.dxfInputs.get(source.pin.sourceId)!;
        for(const entry of source.entities){
          const pin=RegistryDXFCitationSchema.parse({...fusionDXFCitationFields(source,entry.ordinal),id:'0'.repeat(64),
            version:'registry-dxf-citation/1',target:targetPin,selection:attribution(input),associationState:'operator_selected',qualification:'not_assessed'});
          pin.id=citationId(pin);added.push(pin);
        }
        continue;
      }
      if(source.kind==='ifc'){
        const input=fusion.ifcInputs.get(source.pin.sourceId)!;
        for(const entry of source.entities){
          const pin=RegistryIFCCitationSchema.parse({...fusionIFCCitationFields(source,entry.record.stepId),id:'0'.repeat(64),
            version:'registry-ifc-citation/1',target:targetPin,selection:attribution(input),associationState:'operator_selected',qualification:'not_assessed'});
          pin.id=citationId(pin);added.push(pin);
        }
        continue;
      }
      const input=fusion.inputs.get(source.pin.sourceId)!;
      if(source.kind==='document'){
        if(source.parts.length&&(source.nativeStatus!=='extracted'||input.archiveSelection))
          throw new AppError(422,'REGISTRY_DOCUMENT_NATIVE_REQUIRED','Select eligible literal native document parts.');
        for(const entry of source.parts){
          const part=eligibleCitationPart(entry.part,input),pin={document:fusionCitationDocumentPin(source.pin),partId:part.id,target:targetPin};
          added.push(RegistryNativeDocumentCitationSchema.parse({...pin,id:citationId(pin),version:'registry-document-citation/1',
            inputSha256:source.pin.inputSha256,readerSha256:source.pin.readerSha256,acceptedFence:source.pin.acceptedFence,
            partSha256:part.sha256,locator:part.locator,selection:attribution(input),associationState:'operator_selected',qualification:'not_assessed'}));
        }
      }else for(const observation of source.observations){
        const pin=RegistryOcrDocumentCitationSchema.parse({...fusionOcrCitationFields(source,observation.ordinal),id:'0'.repeat(64),
          version:'registry-document-ocr-citation/1',target:targetPin,selection:attribution(input),associationState:'operator_selected',qualification:'not_assessed'});
        pin.id=citationId(pin);added.push(pin);
      }
    }
  }
  if(request.add){
    const source=await citationSource(dependencies)(client,draft.site_id,request.add.document.sourceId);
    const input=await dependencies.source(client,ctx,request.add.document,undefined,true),fence=await acceptedFenceTx(client,input.jobId);
    if(source.revision!==input.sourceRevision||source.sha256!==input.sourceSha256)conflict('The source-site pins changed.');
    const result=await dependencies.result(input,request.add.document.resultSha256);
    for(const part of literalCitationParts(result,input,request.add.partIds)){
      const targetPin={recordId:record.id,revision:record.revision,bodySha256:fingerprint(target.body)};
      const pin={document:request.add.document,partId:part.id,target:targetPin};
      added.push(RegistryDocumentCitationSchema.parse({...pin,id:citationId(pin),version:'registry-document-citation/1',
        inputSha256:fingerprint(input),readerSha256:input.readerSha256,acceptedFence:fence,partSha256:part.sha256,locator:part.locator,
        selection:{subject:ctx.principal.subject,accessSha256:input.accessSha256,selectedAt:new Date().toISOString()},
        associationState:'operator_selected',qualification:'not_assessed'}));
    }
    await dependencies.source(client,ctx,request.add.document,input,true);
    await citationSource(dependencies)(client,draft.site_id,request.add.document.sourceId);
  }
  // Removal remains useful when the removed source is unavailable; retained/additional citations still require current authority.
  const remove=request.clearAll?(record.documentCitations??[]).map(pin=>pin.id):request.remove;
  let next=applyCitationAmendment(record,added,remove);
  if(request.assertIFCIdentity){
    const entries=await assertRegistryDocumentCitationsTx(client,draft.site_id,next,true,dependencies);
    const entry=entries.find(entry=>entry.pin.id===request.assertIFCIdentity);
    if(!entry||entry.pin.version!=='registry-ifc-citation/1'||!('record' in entry))
      throw new AppError(422,'REGISTRY_IFC_IDENTITY_SELECTION','Confirm an existing exact IFC citation from this correction.');
    const pin=entry.pin;
    if(!pin.identityAssertion){
      const identityAssertion={...ifcIdentityFields(record.kind,entry.record),subject:ctx.principal.subject,
        accessSha256:pin.selection.accessSha256,confirmedAt:new Date().toISOString()};
      next={...next,documentCitations:next.documentCitations!.map(item=>item.id===pin.id?
        RegistryIFCCitationSchema.parse({...pin,identityAssertion}):item)};
    }
  }
  await assertRegistryDocumentCitationsTx(client,draft.site_id,next,true,fusion?fusionValidationDependencies(fusion,dependencies):dependencies);
  await currentTargetTx(client,draft.site_id,record,true,dependencies);
  if(fusion)await fusion.revalidate();
  await recheckRegionsTx(client,draft.site_id,next,dependencies);
  const changed=fingerprint(record.documentCitations??[])!==fingerprint(next.documentCitations??[]);
  if(changed)await client.query('UPDATE registry_drafts SET records=$2,revision=revision+1 WHERE id=$1',[draftId,JSON.stringify([next])]);
  const receipt=RegistryDocumentAmendmentReceiptSchema.parse({draftId,draftRevision:draft.revision+(changed?1:0),
    recordId:record.id,recordRevision:record.revision,changed});
  await client.query("INSERT INTO operations(case_id,operation_key,kind,payload_hash,result) VALUES($1,$2,'registry-document-citations',$3,$4)",
    [draft.case_id,operationKey,digest,receipt]);
  return receipt;
}
/** Read-only preflight; no advisory/row mutation locks and no native execution.
 * An existing receipt is reauthorized by the mutation path without re-rendering. */
export async function registryRegionAmendmentPreflightTx(client:PoolClient,draftId:string,request:RegistryDocumentAmendment,
  dependencies:Dependencies=defaults){
  if(!request.addRegion)return;
  const draft=(await client.query('SELECT * FROM registry_drafts WHERE id=$1',[draftId])).rows[0]??notFound();
  const prior=(await client.query("SELECT payload_hash,result FROM operations WHERE case_id=$1 AND operation_key=$2 AND kind='registry-document-citations'",
    [draft.case_id,`registry-document-citations:${draftId}:${request.requestKey}`])).rows[0];
  if(prior)return;
  const record=(draft.records as RegistryRecord[])[0];
  if(draft.records.length!==1||record?.id!==request.recordId||draft.status!=='draft'||draft.revision!==request.expectedDraftRevision||
    record.revision!==request.expectedRecordRevision)conflict('Use the exact active correction before selecting its region.');
  const target=await currentTargetTx(client,draft.site_id,record,false,dependencies);
  const source=await regionSource(dependencies)(client,draft.site_id,request.addRegion.document);
  return {source,draftSha256:fingerprint(draft),targetSha256:fingerprint(target.body)};
}
/** Image-original preparation is read-only and finishes before any source/target mutation locks. */
export async function registryImageRegionAmendmentPreflightTx(client:PoolClient,draftId:string,request:RegistryDocumentAmendment,
  dependencies:Dependencies=defaults){
  if(!request.addImageRegion)return;
  const draft=(await client.query('SELECT * FROM registry_drafts WHERE id=$1',[draftId])).rows[0]??notFound();
  const prior=(await client.query("SELECT payload_hash,result FROM operations WHERE case_id=$1 AND operation_key=$2 AND kind='registry-document-citations'",
    [draft.case_id,`registry-document-citations:${draftId}:${request.requestKey}`])).rows[0];
  if(prior)return;
  const record=(draft.records as RegistryRecord[])[0];
  if(draft.records.length!==1||record?.id!==request.recordId||draft.status!=='draft'||draft.revision!==request.expectedDraftRevision||
    record.revision!==request.expectedRecordRevision)conflict('Use the exact active correction before selecting its image region.');
  if(record.kind==='space')throw new AppError(422,'REGISTRY_DOCUMENT_TARGET','Image regions support building or floor corrections.');
  const target=await currentTargetTx(client,draft.site_id,record,false,dependencies);
  const source=await imageRegionSource(dependencies)(client,draft.site_id,request.addImageRegion.document);
  return {source,draftSha256:fingerprint(draft),targetSha256:fingerprint(target.body)};
}
export const amendRegistryDocumentCitations=async(draftId:string,raw:unknown)=>{
  const request=RegistryDocumentAmendmentSchema.parse(raw);
  if(request.addFusion?.selection.sources.some(source=>source.kind==='obj')&&!request.addFusion.objReferences)
    throw new AppError(422,'SOURCE_FUSION_OBJ_CONTEXT_ONLY','OBJ polygons support source context only; citation attachment is unsupported.');
  if(request.addFusion?.selection.sources.some(source=>source.kind==='gltf')&&!request.addFusion.gltfReferences)
    throw new AppError(422,'SOURCE_FUSION_GLTF_CONTEXT_ONLY','glTF nodes support source context only; reviewed citation attachment is unsupported.');
  let prepared:RegistryRegionAmendmentPrepared|RegistryImageRegionAmendmentPrepared|undefined;
  if(request.addImageRegion){
    const captured=await transaction(client=>registryImageRegionAmendmentPreflightTx(client,draftId,request),
      {deadlineAt:Date.now()+30_000},'repeatable_read_only');
    if(captured)prepared={...await prepareRegistryImageRegion(request.addImageRegion,captured.source),...captured};
  }else if(request.addRegion){
    const captured=await transaction(client=>registryRegionAmendmentPreflightTx(client,draftId,request),
      {deadlineAt:Date.now()+30_000},'repeatable_read_only');
    if(captured)prepared={...await prepareRegistryRegion(request.addRegion,captured.source),...captured};
  }
  return transaction(client=>amendRegistryDocumentCitationsTx(client,draftId,request,defaults,prepared),
    request.addFusion||request.addRegion||request.addImageRegion||request.assertIFCIdentity?{deadlineAt:Date.now()+30_000}:undefined);
};
export async function readRegistryDocumentCitationsTx(client:PoolClient,draftId:string,dependencies:Dependencies=defaults){
  const {draft,record}=await lockedDraftTx(client,draftId);
  const expected=draft.status==='recorded'?{...record,revision:record.revision+1}:record;
  await currentTargetTx(client,draft.site_id,expected,false,dependencies);
  const citations=await assertRegistryDocumentCitationsTx(client,draft.site_id,record,false,dependencies,true);
  await currentTargetTx(client,draft.site_id,expected,false,dependencies);
  const current=await lockedDraftTx(client,draftId,undefined,false,[],false);
  if(fingerprint(current)!==fingerprint({draft,record}))conflict('The draft changed during its private evidence read.');
  await recheckRegionsTx(client,draft.site_id,record,dependencies);
  const response=RegistryDocumentEvidenceSchema.parse({draftId,draftRevision:draft.revision,recordId:record.id,
    recordRevision:record.revision,citations,associationState:'operator_selected',qualification:'not_assessed'});
  const hasDXF=citations.some(entry=>entry.pin.version==='registry-dxf-citation/1');
  const hasKML=citations.some(entry=>entry.pin.version==='registry-kml-citation/1');
  const hasCityGML=citations.some(entry=>entry.pin.version==='registry-citygml-citation/1');
  const hasGeoParquet=citations.some(entry=>entry.pin.version==='registry-geoparquet-citation/1');
  const hasRaster=citations.some(entry=>entry.pin.version==='registry-raster-metadata-citation/1');
  const hasImageRegion=citations.some(entry=>entry.pin.version==='registry-image-region-citation/1');
  const hasSurvey=citations.some(entry=>entry.pin.version==='registry-survey-row-citation/1');
  const hasObj=citations.some(entry=>entry.pin.version==='registry-obj-polygon-citation/1');
  const hasGltf=citations.some(entry=>entry.pin.version==='registry-gltf-node-citation/1');
  if((hasObj||hasGltf||hasSurvey||hasImageRegion||hasRaster||hasGeoParquet||hasCityGML||hasKML||hasDXF||citations.some(entry=>entry.pin.version==='registry-ifc-citation/1'))&&Buffer.byteLength(JSON.stringify(response))>SOURCE_FUSION_LIMITS.responseBytes-8192)
    throw new AppError(413,hasObj?'REGISTRY_OBJ_RESPONSE_LIMIT':hasGltf?'REGISTRY_GLTF_RESPONSE_LIMIT':hasSurvey?'REGISTRY_SURVEY_RESPONSE_LIMIT':hasImageRegion?'REGISTRY_IMAGE_REGION_RESPONSE_LIMIT':hasRaster?'REGISTRY_RASTER_RESPONSE_LIMIT':hasGeoParquet?'REGISTRY_GEOPARQUET_RESPONSE_LIMIT':hasCityGML?'REGISTRY_CITYGML_RESPONSE_LIMIT':hasKML?'REGISTRY_KML_RESPONSE_LIMIT':hasDXF?'REGISTRY_DXF_RESPONSE_LIMIT':'REGISTRY_IFC_RESPONSE_LIMIT','Select a smaller explicit evidence context.');
  return response;
}
export const readRegistryDocumentCitations=(draftId:string)=>transaction(client=>readRegistryDocumentCitationsTx(client,draftId));
