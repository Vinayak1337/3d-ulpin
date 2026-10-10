import {z} from 'zod';
import type {MappingPlanV2} from '@ulpin/contracts';
import {isMappingPlanV2,mappingContextFromGisProfile,validateMappingPlanV2,type MappingValidationContext} from './mapping-plan-v2';
import {
  AdaptiveMappingModelOutputSchema,INGESTION_VERSION,MappingPlanSchema,SourceProfileSchema,
  type MappingPlan,type SourceProfile,
} from '@ulpin/contracts/usp';
import {AppError} from '../../../infrastructure/errors';
import {compileMapping} from './registry';

type Decision={status:'proposed'|'needs_input';code:string|null;plan:MappingPlan|null;validationErrors:string[]};
const invalid=(code:string,message:string):Decision=>({status:'needs_input',code,plan:null,validationErrors:[message]});
const decodedField=(path:string)=>path.split('/properties/')[1]?.replaceAll('~1','/').replaceAll('~0','~') ?? '';

type V2Decision={status:'proposed'|'needs_input';code:string|null;plan:MappingPlanV2|null;validationErrors:string[]};
/** This checks source inventory and executable mechanics. Human/source-document review still decides meaning. */
export function validateAdaptiveMapping(raw:MappingPlanV2,sourceProfile:SourceProfile|MappingValidationContext,visiblePaths?:readonly string[]):V2Decision;
export function validateAdaptiveMapping(raw:unknown,sourceProfile:SourceProfile,visiblePaths?:readonly string[]):Decision;
export function validateAdaptiveMapping(raw:unknown,sourceProfile:MappingValidationContext,visiblePaths?:readonly string[]):V2Decision;
export function validateAdaptiveMapping(raw:unknown,sourceProfile:SourceProfile|MappingValidationContext,visiblePaths?:readonly string[]):Decision|V2Decision{
  if(isMappingPlanV2(raw)||'sourceKind' in sourceProfile){
    const context='sourceKind' in sourceProfile?sourceProfile:mappingContextFromGisProfile(sourceProfile);
    const result=validateMappingPlanV2(raw,context);
    if(!result.success)return {status:'needs_input',code:result.errors[0].code,plan:null,validationErrors:result.errors.map(error=>error.code)};
    if(visiblePaths&&result.plan.fields.some(field=>!visiblePaths.includes(field.sourceField)))
      return {status:'needs_input',code:'MAPPING_SOURCE_FIELD_UNKNOWN',plan:null,validationErrors:['MAPPING_SOURCE_FIELD_UNKNOWN']};
    return {status:'proposed',code:null,plan:result.plan,validationErrors:[]};
  }
  const profile=SourceProfileSchema.parse(sourceProfile),parsed=AdaptiveMappingModelOutputSchema.safeParse(raw);
  if(!parsed.success)return invalid('MODEL_OUTPUT_INVALID','The model output does not match the mapping proposal schema.');
  const output=parsed.data;
  if(output.decision==='abstain')return output.operations.length===0 && output.reason!=='none'
    ? {status:'needs_input',code:'MODEL_ABSTAINED',plan:null,validationErrors:[]}
    : invalid('MODEL_OUTPUT_INVALID','An abstention must contain a reason and no operations.');
  if(output.reason!=='none')return invalid('MODEL_OUTPUT_INVALID','A proposal cannot also declare an abstention reason.');
  if(profile.format!=='geojson'||profile.crs.value!=='EPSG:4326'||!profile.crs.evidence
    ||!profile.geometryTypes.length||profile.geometryTypes.some(type=>!['Polygon','MultiPolygon'].includes(type)))
    return invalid('MODEL_PROFILE_UNSUPPORTED','The inspected polygon and reference profile is not supported by this conversion.');
  const geometry=profile.paths.find(item=>item.path==='/features/*/geometry');
  if(!geometry||geometry.values!==profile.featureCount||geometry.explicitNull||geometry.absent)
    return invalid('MODEL_GEOMETRY_INCOMPLETE','Every proposed building needs retained feature geometry.');
  const planResult=MappingPlanSchema.safeParse({version:INGESTION_VERSION,mode:'manual_mapping',
    source:profile.source,caseId:profile.caseId,workspaceRevision:profile.workspaceRevision,
    workspaceFingerprint:profile.workspaceFingerprint,operations:output.operations});
  if(!planResult.success)return invalid('MODEL_MAPPING_INVALID','Choose one complete literal source key and retained polygon geometry, with at most one optional name.');
  const plan=planResult.data;
  if(visiblePaths && plan.operations.some(op=>!visiblePaths.includes(op.sourcePath)))
    return invalid('MODEL_MAPPING_INVALID','The proposal used a path outside the inspected model scope.');
  // A complete text column is not necessarily a building attribute. Obvious person and
  // parcel fields cannot masquerade as building identity/name; other meanings need review.
  for(const op of plan.operations){
    const field=decodedField(op.sourcePath);
    if(field && /(?:owner|applicant|seller|buyer|witness|aadhaar|pan_number|phone|mobile|email|address)/i.test(field))
      return invalid('MODEL_FIELD_SEMANTICS','A personal or address field cannot be a building identity or name.');
    if(op.target==='building.sourceKey' && /(?:parcel|survey|lot|bbl|plot|tax|floor|unit)/i.test(field))
      return invalid('MODEL_FIELD_SEMANTICS','A parcel, tax or unit identifier cannot serve as a building source key.');
    // Uniqueness on one row does not establish identifier meaning. Refuse clear
    // measurement/date cues, without rejecting an explicitly identifier-named
    // field solely because its name also contains a measurement word. Neither
    // cue establishes source meaning: issuer evidence and officer review remain.
    const words=field.replace(/([a-z0-9])([A-Z])/g,'$1_$2').toLowerCase().split(/[_ -]+/);
    const identifierNamed=words.some(word=>['id','identifier','key','uuid','guid','objectid','globalid'].includes(word));
    if(op.target==='building.sourceKey'&&!identifierNamed
      &&words.some(word=>['height','elevation','area','length','volume','date','time','year'].includes(word)))
      return invalid('MODEL_FIELD_SEMANTICS','A measurement or date does not establish building identity; review source identifier meaning or author a manual recipe.');
    if(op.target==='building.name' && /(?:^|[_ -])(?:id|bin|bbl|code|number|date|height|elevation|parcel|lot|tax|unit|floor)(?:$|[_ -])/i.test(field))
      return invalid('MODEL_FIELD_SEMANTICS','An identifier, measurement or date field cannot serve as a building name.');
  }
  try{compileMapping(plan,profile);}catch(error){
    if(error instanceof AppError)return invalid('MODEL_MAPPING_INVALID',error.message);
    throw error;
  }
  return {status:'proposed',code:null,plan,validationErrors:[]};
}
