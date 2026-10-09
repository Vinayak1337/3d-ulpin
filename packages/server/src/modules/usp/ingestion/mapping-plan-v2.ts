import {createHash} from 'node:crypto';
import {CANONICAL_TARGETS,canonicalTarget,MappingPlanV2Schema,MappingLayoutFieldSchema,
  type MappingPlanV2,type MappingLayoutField,type MappingTarget} from '@ulpin/contracts';
import {MappingPlanSchema,type MappingPlan,type SourceProfile,type StreamedProfileGeneration} from '@ulpin/contracts/usp';
import {UNIT_TABLE} from './unit-table';

export const ENUM_TABLES={
  'building_use@1':{target:'building.use',values:['residential','commercial','industrial','mixed','institutional','unknown']},
  'unit_type@1':{target:'unit.type',values:['residential','commercial','common','parking','unknown']},
  'level_kind@1':{target:'level.kind',values:['basement','ground','upper','stilt','podium','mezzanine','terrace','unknown']},
  'space_kind@1':{target:'space.kind',values:['unit','common','shaft','balcony','terrace','parking','unknown']},
  'document_status@1':{target:'document.status',values:['draft','approved','sanctioned','registered','expired','revoked','unknown']},
} as const;
export type MappingValidationContext={sourceKind:MappingPlanV2['sourceKind'];fields:readonly MappingLayoutField[];
  sourceRef?:string;rowCount?:number;parentFields?:readonly string[]};
export type MappingValidationError={code:string;field?:string;message:string};
export type MappingValidationResult={success:true;plan:MappingPlanV2;errors:[]}|{success:false;plan:null;errors:MappingValidationError[]};
export const normalizeMappingHeader=(name:string)=>name.normalize('NFC').trim().replace(/\s+/gu,' ').toLowerCase();
/** Ordered columns + conservative inferred types. No row values, filename, unit assumption or CRS is hashed. */
export function layoutFingerprint(fields:readonly MappingLayoutField[]):string{
  return createHash('sha256').update(JSON.stringify(fields.map(field=>[normalizeMappingHeader(field.name),field.inferredType]))).digest('hex');
}
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const knownLiteralKeys=/^(?:factor|scale|offset|epsg|crs|coordinates?|identifier|id|value|literal|default|constant|tool|sql|expression)$/i;
/** Strict-key scanning covers executable parameters only; rationale is inert explanation, not generated code. */
function forbiddenParameter(raw:Record<string,unknown>):boolean{
  if(Object.keys(raw).some(key=>knownLiteralKeys.test(key)))return true;
  if(!Array.isArray(raw.fields))return false;
  return raw.fields.some(field=>record(field)&&(Object.keys(field).some(key=>knownLiteralKeys.test(key))
    ||record(field.operation)&&(Object.keys(field.operation).some(key=>knownLiteralKeys.test(key))
      ||Object.entries(field.operation).some(([key,value])=>key!=='parentField'&&(typeof value==='number'
        ||typeof value==='string'&&/^(?:EPSG:|\d+(?:\.\d+)?$)/i.test(value))))));
}

/** Pure mechanical verifier; passing is never approval of source meaning or registry write authority. */
export function validateMappingPlanV2(raw:unknown,context:MappingValidationContext):MappingValidationResult{
  const fail=(code:string,message:string):MappingValidationResult=>({success:false,plan:null,errors:[{code,message}]});
  if(record(raw)&&forbiddenParameter(raw))return fail('MAPPING_LITERAL_FORBIDDEN','Plans may contain inventory references and allowlisted tokens, never literal parameters or tools.');
  const parsed=MappingPlanV2Schema.safeParse(raw);
  if(!parsed.success){
    const targetIssue=parsed.error.issues.some(issue=>issue.path.includes('target'));
    return fail(targetIssue?'MAPPING_TARGET_UNKNOWN':'MAPPING_SCHEMA_INVALID','The plan does not match the closed MappingPlan v2 contract.');
  }
  const plan=parsed.data,errors:MappingValidationError[]=[];
  const add=(code:string,message:string,field?:string)=>errors.push({code,message,...(field?{field}:{})});
  if(context.fields.some(field=>!MappingLayoutFieldSchema.safeParse(field).success))
    return fail('MAPPING_LAYOUT_INVALID','Supply valid source inventory fields and inferred types.');
  const names=context.fields.map(field=>normalizeMappingHeader(field.name));
  if(new Set(names).size!==names.length)return fail('MAPPING_LAYOUT_AMBIGUOUS','Normalised source headers must be unique.');
  if(plan.sourceKind!==context.sourceKind)add('MAPPING_SOURCE_KIND_MISMATCH','Plan source kind differs from the inspected inventory.');
  if(plan.layoutFingerprint!==layoutFingerprint(context.fields))add('MAPPING_LAYOUT_MISMATCH','The plan must pin the inspected layout fingerprint.');
  const fields=new Map(context.fields.map(field=>[field.name,field]));
  const seenFields=new Set<string>(),seenTargets=new Set<string>();
  for(const field of plan.fields){
    const source=fields.get(field.sourceField),target=canonicalTarget(field.target),definition=CANONICAL_TARGETS[target],op=field.operation;
    if(!source)add('MAPPING_SOURCE_FIELD_UNKNOWN','Choose an exact source inventory column.',field.sourceField);
    if(seenFields.has(field.sourceField))add('MAPPING_SOURCE_FIELD_DUPLICATE','A source field may be mapped only once.',field.sourceField);
    seenFields.add(field.sourceField);
    if(target!=='unknown'&&seenTargets.has(target))add('MAPPING_TARGET_DUPLICATE','Conflicting fields need separate proposals, not last-value-wins.',field.sourceField);
    seenTargets.add(target);
    if(!(definition.allowedOperations as readonly string[]).includes(op.kind))add('MAPPING_OPERATION_NOT_ALLOWED','Operation is not allowed for this target.',field.sourceField);
    if(!definition.modelMayPropose&&op.kind!=='copy')add('MAPPING_IDENTIFIER_COPY_ONLY','Identifiers and official anchors must be copied from source columns.',field.sourceField);
    if(target==='unknown'&&op.kind!=='copy')add('MAPPING_UNKNOWN_COPY_ONLY','An unknown field is retained without interpretation.',field.sourceField);
    if(op.kind==='parse_literal'){
      const allowed=definition.valueKind==='text_literal'?['text_literal']:definition.valueKind==='number_unit'?['number']:
        definition.valueKind==='date'?['date_dmy','date_iso']:[];
      if(!allowed.includes(op.literalKind))add('MAPPING_PARSE_KIND_NOT_ALLOWED','Literal parser must preserve the target value kind.',field.sourceField);
    }
    if(op.kind==='enum_lookup'&&ENUM_TABLES[op.tableId].target!==target)
      add('MAPPING_ENUM_TABLE_MISMATCH','Choose the code-owned lookup table for this target.',field.sourceField);
    if(op.kind==='unit_convert'){
      if(UNIT_TABLE[op.sourceUnit].family!==definition.unitFamily)add('MAPPING_UNIT_FAMILY_MISMATCH','Source unit has the wrong dimension.',field.sourceField);
      if(source?.declaredUnit!==op.sourceUnit)add('MAPPING_UNIT_NOT_DECLARED','Unit conversion requires matching inspected source-unit evidence.',field.sourceField);
    }
    if(op.kind==='link_parent_key'&&!context.parentFields?.includes(op.parentField))
      add('MAPPING_PARENT_FIELD_UNKNOWN','Choose a field in the supplied parent inventory.',field.sourceField);
    if(field.citations?.some(citation=>!fields.has(citation.column)||context.sourceRef===undefined
      ||citation.sourceRef!==context.sourceRef||context.rowCount===undefined||citation.row>=context.rowCount))
      add('MAPPING_CITATION_INVALID','Citations must reference cells in the inspected source.',field.sourceField);
  }
  if(context.fields.some(field=>!seenFields.has(field.name)))add('MAPPING_SOURCE_FIELD_UNMAPPED','Every source column needs a mapping or explicit unknown disposition.');
  return errors.length?{success:false,plan:null,errors}:{success:true,plan,errors:[]};
}

/** A narrow legacy adapter: its original pinned/profile and reviewer safeguards are not weakened. */
export function legacyPlanToV2(raw:MappingPlan,context:MappingValidationContext,method:MappingPlanV2['method']):MappingPlanV2{
  const plan=MappingPlanSchema.parse(raw);
  return {version:'mapping-plan/2',sourceKind:context.sourceKind,layoutFingerprint:layoutFingerprint(context.fields),method,
    fields:context.fields.map(field=>{
      const op=plan.operations.find(item=>item.sourcePath===field.name);
      return {sourceField:field.name,target:op?.target??'unknown',operation:{kind:'copy'},confidence:op?1:0,
        rationale:op?'Adapted exact legacy source operation; existing review requirements remain.':'Legacy plan does not interpret this source field.'};
    })};
}
/** Inventory adapter only; reference metadata stays with the existing GIS profile/reader. */
export function mappingContextFromGisProfile(profile:SourceProfile|StreamedProfileGeneration):MappingValidationContext{
  return {sourceKind:'gis_attributes',sourceRef:profile.source.sourceId,
    rowCount:profile.version==='manual-geojson/1'?profile.featureCount:profile.recordsSeen,
    fields:profile.paths.map(path=>({name:path.path,inferredType:path.path==='/features/*/geometry'?'geometry':
      path.types.length!==1?'mixed':path.types[0]==='string'?'text':path.types[0]}))};
}
export const isMappingPlanV2=(raw:unknown):raw is MappingPlanV2=>record(raw)&&raw.version==='mapping-plan/2';
export function targetExists(target:string):target is MappingTarget{
  return target==='building.geometry'||Object.hasOwn(CANONICAL_TARGETS,target);
}
