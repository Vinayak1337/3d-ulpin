import {z} from 'zod';
import {DXFSummarySchema,type DXFResult} from '@ulpin/contracts/usp';
import {SourceFusionDXFMetadataSchema,SourceFusionLiteralObjectSchema,SourceFusionLiteralJsonSchema,
  type SourceFusionContext,type SourceFusionSelection,type SourceFusionJsonValue} from '../../../../../contracts/src/source-fusion';
import {AppError} from '../../../infrastructure/errors';
import {fingerprint} from '../../cases/domain';

const fail=():never=>{throw new AppError(422,'SOURCE_FUSION_SELECTION','The requested accepted DXF entity selection is unavailable.');};
const nativeSchema=z.object({schemaVersion:z.literal('dxf-native-inspection/1'),status:z.literal('available'),
  sourceSha256:z.string(),sourceBytes:z.number(),dxfVersion:DXFSummarySchema.shape.dxfVersion,
  parser:SourceFusionLiteralObjectSchema,encoding:SourceFusionLiteralObjectSchema,units:SourceFusionLiteralObjectSchema,
  headerVariables:SourceFusionLiteralObjectSchema,layers:z.array(SourceFusionLiteralObjectSchema).max(10000),
  blocks:z.array(SourceFusionLiteralObjectSchema).max(10000),entities:z.array(SourceFusionLiteralObjectSchema).max(10000),
  projectedEntityCountIncludingChildren:z.number().int().nonnegative().max(10000),
  qualification:SourceFusionLiteralObjectSchema,unsupportedFindings:z.array(SourceFusionLiteralJsonSchema).max(10000),
  limitations:z.array(z.string().max(1000)).max(100)});
function fieldValues(record:Record<string,SourceFusionJsonValue>,name:string):string[]{
  const fields=record.fields;
  if(!fields||typeof fields!=='object'||Array.isArray(fields))return [];
  const field=fields[name];
  if(!field||typeof field!=='object'||Array.isArray(field)||field.state!=='supplied'||!Array.isArray(field.tags))return [];
  return field.tags.flatMap(tag=>tag&&typeof tag==='object'&&!Array.isArray(tag)&&typeof tag.value==='string'?[tag.value]:[]);
}

/** Also inspect saved native artifacts without inventing a missing accepted job
 * envelope. Runtime enters through the full exact-result/artifact reader. */
export function fusionDXFMetadataProjection(ordinals:number[],raw:unknown,summaryValue:DXFResult['summary'],
  artifact:Pick<DXFResult['artifact'],'sha256'|'bytes'>):z.infer<typeof SourceFusionDXFMetadataSchema>{
  if(!ordinals.length||ordinals.length>25||new Set(ordinals).size!==ordinals.length||
    ordinals.some(n=>!Number.isSafeInteger(n)||n<0||n>9999))return fail();
  const native=nativeSchema.parse(raw),summary=DXFSummarySchema.parse(summaryValue);
  if(summary.sourceSha256!==native.sourceSha256||summary.sourceBytes!==native.sourceBytes||summary.dxfVersion!==native.dxfVersion||
    summary.projectedEntityCount!==native.projectedEntityCountIncludingChildren||native.entities.length>summary.projectedEntityCount||
    native.units.state!==summary.units.state||native.units.code!==summary.units.code||native.units.name!==summary.units.name||
    native.units.conversion!==null||native.qualification.scope!=='source_local_inspection'||
    native.qualification.globalPlacement!=='not_assessed'||native.qualification.geometryValidity!=='not_assessed'||
    native.qualification.analyticEligible!==false||native.qualification.operationalRecords!==false||native.qualification.trainingLabels!==false)return fail();
  const sorted=[...ordinals].sort((a,b)=>a-b),blockNames=new Set<string>();
  const entities=sorted.map(ordinal=>{
    const record=native.entities[ordinal];
    if(!record||typeof record.type!=='string'||!record.locator||typeof record.locator!=='object'||Array.isArray(record.locator)||
      !record.fields||typeof record.fields!=='object'||Array.isArray(record.fields)||!Array.isArray(record.sourceTags))return fail();
    if(typeof record.blockName==='string')blockNames.add(record.blockName);
    if(record.type==='INSERT')for(const name of fieldValues(record,'blockName'))blockNames.add(name);
    return {ordinal,pointer:`/entities/${ordinal}`,recordSha256:fingerprint(record),record};
  });
  // Definitions are exact source metadata; no child/entity traversal, transform
  // application, external fetch or block explosion follows a name reference.
  const blocks=native.blocks.filter(block=>fieldValues(block,'name').some(name=>blockNames.has(name)));
  return SourceFusionDXFMetadataSchema.parse({summary,artifactSha256:artifact.sha256,artifactBytes:artifact.bytes,
    selectionSha256:fingerprint({version:'source-fusion-dxf-selection/1',sourceSha256:summary.sourceSha256,
      artifact:{sha256:artifact.sha256,bytes:artifact.bytes},entityOrdinals:sorted}),
    selectionHashBasis:'accepted_artifact_source_and_sorted_entity_ordinals',nativeIdentifierScope:'source_native_only; not_canonical_registry_ids',
    parser:native.parser,entities,reference:{encoding:native.encoding,units:native.units,headerVariables:native.headerVariables,layers:native.layers,blocks},
    findings:native.unsupportedFindings,qualification:native.qualification,limitations:native.limitations,
    coverage:{selectedEntities:entities.length,availableNativeEntities:native.entities.length,
      scope:'explicit_entity_records; source_reference_metadata; referenced_block_definitions_only',unselectedEntities:'not_expanded',
      blockExpansion:'not_performed',geometryQualification:'not_assessed',propertyMatching:'unsupported'}});
}

export function fusionDXFSourceProjection(selection:Extract<SourceFusionSelection,{kind:'dxf'}>,
  loaded:{result:DXFResult;native:unknown}):Extract<SourceFusionContext['sources'][number],{kind:'dxf'}>{
  const {input}=loaded.result,pin=selection.pin;
  if(input.caseId!==pin.caseId||input.caseRevision!==pin.caseRevision||input.sourceId!==pin.sourceId||
    input.sourceRevision!==pin.sourceRevision||input.sourceSha256!==pin.sourceSha256||input.jobId!==pin.jobId||
    input.readerSha256!==pin.readerSha256||fingerprint(input)!==pin.inputSha256)return fail();
  return {...fusionDXFMetadataProjection(selection.entityOrdinals,loaded.native,loaded.result.summary,loaded.result.artifact),
    kind:'dxf',pin,namespace:`source:${pin.caseId}/${pin.sourceId}@${pin.sourceRevision}`,sourceSetRole:'operator_selected_fragment'};
}
