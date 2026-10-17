import {z} from 'zod';
import {IFCSummarySchema,type IFCResult} from '@ulpin/contracts/usp';
import {SourceFusionIFCRecordSchema,SourceFusionIFCMetadataSchema,SourceFusionLiteralObjectSchema,SourceFusionLiteralJsonSchema,
  type SourceFusionContext,type SourceFusionSelection,type SourceFusionJsonValue} from '../../../../../contracts/src/source-fusion';
import {AppError} from '../../../infrastructure/errors';
import {fingerprint} from '../../cases/domain';

const fail=()=>{throw new AppError(422,'SOURCE_FUSION_SELECTION','The requested accepted IFC metadata selection is unavailable.');};
const spatial=new Set(['IfcBuilding','IfcBuildingStorey','IfcSpace']);
const relationTypes=new Set(['IfcRelAggregates','IfcRelNests','IfcRelContainedInSpatialStructure']);
const referenceTypes=new Set(['IfcProject','IfcSite','IfcMapConversion','IfcProjectedCRS',
  'IfcGeometricRepresentationContext','IfcGeometricRepresentationSubContext']);
const supportTypes=new Set([...referenceTypes,'IfcUnitAssignment','IfcSIUnit','IfcConversionBasedUnit',
  'IfcConversionBasedUnitWithOffset','IfcContextDependentUnit','IfcDerivedUnit','IfcDerivedUnitElement',
  'IfcMonetaryUnit','IfcMeasureWithUnit','IfcDimensionalExponents','IfcLocalPlacement',
  'IfcAxis2Placement3D','IfcAxis2Placement2D','IfcCartesianPoint','IfcDirection']);
const nativeSchema=z.object({schemaVersion:z.literal('ulpin-native-ifc/1'),status:z.literal('available'),scope:z.literal('source_native_metadata'),
  source:SourceFusionLiteralObjectSchema,parser:SourceFusionLiteralObjectSchema,
  counts:z.object({sourceEntities:z.number().int().nonnegative().max(100000),projectedRecords:z.number().int().nonnegative().max(10000)}),
  records:z.array(SourceFusionIFCRecordSchema).max(10000),projectUnits:z.array(SourceFusionLiteralJsonSchema).max(10000),
  georeference:SourceFusionLiteralObjectSchema,semantics:SourceFusionLiteralObjectSchema,findings:z.array(SourceFusionLiteralJsonSchema).max(10000)});
type Record=z.infer<typeof SourceFusionIFCRecordSchema>;
function refs(value:SourceFusionJsonValue):{stepId:number;entityType:string}[]{
  const stack=[value],result:{stepId:number;entityType:string}[]=[];
  while(stack.length){const value=stack.pop()!;
    if(!value||typeof value!=='object')continue;
    if(!Array.isArray(value)&&Number.isSafeInteger(value.stepId)&&typeof value.entityType==='string')
      result.push({stepId:value.stepId as number,entityType:value.entityType});
    else stack.push(...Object.values(value));
  }
  return result;
}
function attributeRefs(record:Record,name:string){
  const attribute=record.attributes[name];
  return attribute&&typeof attribute==='object'&&!Array.isArray(attribute)&&Object.hasOwn(attribute,'value')?refs(attribute.value):[];
}

/** Pure projection also serves retained parser artifacts whose canonical job
 * envelope was not saved. It manufactures no source/job/result pin. Runtime
 * always calls it after the exact accepted result/artifact reader. */
export function fusionIFCMetadataProjection(stepIds:number[],raw:unknown,summaryValue:IFCResult['summary'],
  artifact:Pick<IFCResult['artifact'],'sha256'|'bytes'>):z.infer<typeof SourceFusionIFCMetadataSchema>{
  if(!stepIds.length||stepIds.length>25||new Set(stepIds).size!==stepIds.length||stepIds.some(id=>!Number.isSafeInteger(id)||id<1))return fail();
  const native=nativeSchema.parse(raw),summary=IFCSummarySchema.parse(summaryValue),byId=new Map(native.records.map((record,index)=>[record.stepId,{record,pointer:`/records/${index}`} ]));
  const count=(type:string)=>native.records.filter(record=>record.entityType===type).length;
  if(byId.size!==native.records.length||native.records.length!==native.counts.projectedRecords||
    summary.sourceSha256!==native.source.sha256||summary.sourceBytes!==native.source.bytes||summary.schema!==native.source.schema||
    summary.entityCount!==native.counts.sourceEntities||summary.recordCount!==native.counts.projectedRecords||
    summary.buildingCount!==count('IfcBuilding')||summary.storeyCount!==count('IfcBuildingStorey')||summary.spaceCount!==count('IfcSpace')||
    summary.georeferenceState!==native.georeference.state||native.georeference.globalTransformApplied!==false||
    native.georeference.inspectionFrame!=='source_local'||native.semantics.unitConversionApplied!==false||
    native.semantics.storeysAreLegalUnits!==false||native.semantics.rights!=='not_assessed')return fail();
  const selected=new Set(stepIds),entities=[...stepIds].sort((a,b)=>a-b).map(id=>{
    const entry=byId.get(id);if(!entry||!spatial.has(entry.record.entityType))return fail();return entry;
  });
  const parents=new Map<number,Set<number>>(),parentRelations=new Map<number,number[]>();
  const relations=native.records.filter(record=>relationTypes.has(record.entityType)).flatMap(record=>{
    const contained=record.entityType==='IfcRelContainedInSpatialStructure',parent=attributeRefs(record,contained?'RelatingStructure':'RelatingObject'),
      children=attributeRefs(record,contained?'RelatedElements':'RelatedObjects');
    if(parent.length!==1||!children.length)return fail();
    for(const child of children)if(selected.has(child.stepId)){
      const ids=parents.get(child.stepId)??new Set<number>();ids.add(parent[0].stepId);parents.set(child.stepId,ids);
      const idsOfRelations=parentRelations.get(child.stepId)??[];idsOfRelations.push(record.stepId);parentRelations.set(child.stepId,idsOfRelations);
    }
    return selected.has(parent[0].stepId)||children.some(child=>selected.has(child.stepId))?[byId.get(record.stepId)!]:[];
  });
  // Only accepted metadata references are traversed. Representation/owner and
  // unselected building/storey/space records remain exact references, unexpanded.
  const queue=entities.flatMap(entry=>attributeRefs(entry.record,'ObjectPlacement').map(ref=>ref.stepId));
  for(const record of native.records)if(referenceTypes.has(record.entityType))queue.push(record.stepId);
  for(const declaration of native.projectUnits){
    if(declaration&&typeof declaration==='object'&&!Array.isArray(declaration)&&typeof declaration.unitAssignmentStepId==='number')
      queue.push(declaration.unitAssignmentStepId);
  }
  const support=new Set<number>();
  while(queue.length){const id=queue.pop()!,entry=byId.get(id);
    if(support.has(id)||!entry||!supportTypes.has(entry.record.entityType))continue;
    support.add(id);
    for(const attribute of Object.values(entry.record.attributes)){
      if(!attribute||typeof attribute!=='object'||Array.isArray(attribute)||!Object.hasOwn(attribute,'value'))continue;
      for(const ref of refs(attribute.value)){
        const target=byId.get(ref.stepId);if(target&&target.record.entityType!==ref.entityType)return fail();
        if(target&&supportTypes.has(target.record.entityType))queue.push(ref.stepId);
      }
    }
  }
  return SourceFusionIFCMetadataSchema.parse({summary,artifactSha256:artifact.sha256,artifactBytes:artifact.bytes,
    nativeIdentifierScope:'source_native_only; not_canonical_registry_ids',source:native.source,parser:native.parser,
    entities,relations:relations.sort((a,b)=>a.record.stepId-b.record.stepId),
    supportRecords:[...support].sort((a,b)=>a-b).map(id=>byId.get(id)!),
    reference:{projectUnits:native.projectUnits,georeference:native.georeference,semantics:native.semantics},findings:native.findings,
    hierarchy:entities.map(({record})=>{const ids=[...(parents.get(record.stepId)??[])].sort((a,b)=>a-b);
      return {stepId:record.stepId,parentState:ids.length>1?'multiple_parents':ids.length?'supplied':'missing',parentStepIds:ids,
        relationStepIds:(parentRelations.get(record.stepId)??[]).sort((a,b)=>a-b)};}),
    coverage:{selectedEntities:entities.length,availableNativeEntities:count('IfcBuilding')+count('IfcBuildingStorey')+count('IfcSpace'),
      scope:'explicit_entities; incident_relation_literals; referenced_placements; source_units_and_reference_metadata',
      unselectedEntityMetadata:'not_expanded',geometry:'unsupported',hierarchyQualification:'source_edges_only; not_canonical_relationships'}});
}

export function fusionIFCSourceProjection(selection:Extract<SourceFusionSelection,{kind:'ifc'}>,
  loaded:{result:IFCResult;native:unknown}):Extract<SourceFusionContext['sources'][number],{kind:'ifc'}>{
  const {input}=loaded.result,pin=selection.pin;
  if(input.caseId!==pin.caseId||input.caseRevision!==pin.caseRevision||input.sourceId!==pin.sourceId||
    input.sourceRevision!==pin.sourceRevision||input.sourceSha256!==pin.sourceSha256||input.jobId!==pin.jobId||
    input.readerSha256!==pin.readerSha256||fingerprint(input)!==pin.inputSha256)return fail();
  return {...fusionIFCMetadataProjection(selection.stepIds,loaded.native,loaded.result.summary,loaded.result.artifact),
    kind:'ifc',pin,namespace:`source:${pin.caseId}/${pin.sourceId}@${pin.sourceRevision}`,sourceSetRole:'operator_selected_fragment'};
}
