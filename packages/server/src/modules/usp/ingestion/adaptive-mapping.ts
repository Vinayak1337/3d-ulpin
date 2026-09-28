import {z} from 'zod';
import {
  AdaptiveMappingModelOutputSchema,INGESTION_VERSION,MappingPlanSchema,SourceProfileSchema,
  type MappingPlan,type SourceProfile,
} from '@ulpin/contracts/usp';
import {AppError} from '../../../infrastructure/errors';
import {compileMapping} from './registry';

type Decision={status:'proposed'|'needs_input';code:string|null;plan:MappingPlan|null;validationErrors:string[]};
const invalid=(code:string,message:string):Decision=>({status:'needs_input',code,plan:null,validationErrors:[message]});
const decodedField=(path:string)=>path.split('/properties/')[1]?.replaceAll('~1','/').replaceAll('~0','~') ?? '';

/** This checks source inventory and executable mechanics. Human/source-document review still decides meaning. */
export function validateAdaptiveMapping(raw:unknown,sourceProfile:SourceProfile,visiblePaths?:readonly string[]):Decision{
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
    if(op.target==='building.name' && /(?:^|[_ -])(?:id|bin|bbl|code|number|date|height|elevation|parcel|lot|tax|unit|floor)(?:$|[_ -])/i.test(field))
      return invalid('MODEL_FIELD_SEMANTICS','An identifier, measurement or date field cannot serve as a building name.');
  }
  try{compileMapping(plan,profile);}catch(error){
    if(error instanceof AppError)return invalid('MODEL_MAPPING_INVALID',error.message);
    throw error;
  }
  return {status:'proposed',code:null,plan,validationErrors:[]};
}
