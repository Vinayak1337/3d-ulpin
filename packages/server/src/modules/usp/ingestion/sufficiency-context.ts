import type {PoolClient} from 'pg';
import {MappingReceiptSchema, PROJECTED_VECTOR_PROFILE, SUFFICIENCY_POLICY, SufficiencyRecordPinSchema, type SufficiencyPins} from '@ulpin/contracts/usp';
import {AppError, notFound} from '../../../infrastructure/errors';
import {fingerprint} from '../../cases/domain';
import {ingestionBinding, assertIngestionBinding} from './events';
import {withUspAnalyticalReaderTx} from '../geometry';

const digest=(column:string)=>`encode(sha256(convert_to(COALESCE(${column}::text,'null'),'UTF8')),'hex')`;
export async function sufficiencyCaseTx(client:PoolClient,caseId:string,lock=false){
  const binding=ingestionBinding(caseId);
  const row=(await client.query(`SELECT id,revision,archived,site_id,current_snapshot_id,
    ${digest('frame')} frame_sha,${digest('context')} context_sha FROM cases WHERE id=$1${lock?' FOR UPDATE':''}`,[caseId])).rows[0];
  if(!row)notFound('Source case not found.');
  if(row.archived)throw new AppError(403,'SUFFICIENCY_DENIED','This source context is unavailable.');
  const sources=(await client.query(`SELECT id,family_id,revision,sha256,profile,status,bytes,
    ${digest('inspection')} inspection_sha,${digest('object_key')} object_sha,
    COALESCE(inspection->>'actor',inspection#>>'{largeOriginal,operatorSubject}') owner
    FROM sources WHERE case_id=$1 ORDER BY id LIMIT 257`,[caseId])).rows;
  if(sources.some(s=>s.owner && s.owner!==binding.subject))throw new AppError(403,'SUFFICIENCY_DENIED','This source context is unavailable.');
  if(sources.length>256)throw new AppError(422,'SUFFICIENCY_SCOPE_LIMIT','Use a source case with at most 256 retained revisions.');
  const recipes=(await client.query(`SELECT id,source_id,revision,state,${digest('body')} body_sha FROM usp_mapping_recipes WHERE case_id=$1 ORDER BY id LIMIT 33`,[caseId])).rows;
  const packages=(await client.query(`SELECT id,revision,state,area_id,${digest('body')} body_sha FROM import_packages WHERE case_id=$1 ORDER BY id LIMIT 33`,[caseId])).rows;
  if(recipes.length>32||packages.length>32)throw new AppError(422,'SUFFICIENCY_SCOPE_LIMIT','This task projection supports at most 32 recipes and packages per case.');
  const areas=(await client.query(`SELECT a.id,a.revision,a.site_id,a.reference actual_reference,${digest('a.reference')} reference_sha,
    s.revision site_revision,${digest('s.frame')} frame_sha FROM map_areas a JOIN registry_sites s ON s.id=a.site_id
    WHERE a.id IN (SELECT area_id FROM import_packages WHERE case_id=$1)
      OR a.id::text IN (SELECT body#>>'{destination,areaId}' FROM usp_mapping_recipes WHERE case_id=$1)
    ORDER BY a.id LIMIT 65`,[caseId])).rows;
  const associations=(await client.query(`SELECT ${digest('to_jsonb(m)')} body_sha FROM registry_case_feature_mappings m WHERE case_id=$1 ORDER BY 1 LIMIT 65`,[caseId])).rows;
  if(areas.length>64||associations.length>64)throw new AppError(422,'SUFFICIENCY_SCOPE_LIMIT','Use a smaller associated source case.');
  assertIngestionBinding(binding);
  return {row,sources,recipes,packages,areas,binding,context:fingerprint({row,sources,recipes,packages,areas,associations})};
}
export async function sufficiencySourceTx(client:PoolClient,scope:Awaited<ReturnType<typeof sufficiencyCaseTx>>,sourceId:string){
  const pin=scope.sources.find(s=>s.id===sourceId);if(!pin)notFound('Source not found in this context.');
  const row=(await client.query(`SELECT id,family_id,revision,sha256,profile,status,bytes,
    inspection->'manualProfile' manual,inspection->'projectedVector' projected,
    inspection ? 'referenceParts' has_parts
    FROM sources WHERE case_id=$1 AND id=$2`,[scope.row.id,sourceId])).rows[0];
  const latest=scope.sources.filter(s=>s.family_id===row.family_id).every(s=>s.revision<=row.revision);
  const parsedRecipe=(await client.query('SELECT body FROM usp_mapping_recipes WHERE case_id=$1 AND source_id=$2',[scope.row.id,sourceId])).rows[0]?.body;
  const recipeResult=MappingReceiptSchema.safeParse(parsedRecipe),recipe=recipeResult.success?recipeResult.data:null;
  const manualWorkspace=fingerprint({caseId:scope.row.id,revision:scope.row.revision,
    sources:scope.sources.map(s=>({id:s.id,family_id:s.family_id,revision:s.revision,sha256:s.sha256}))});
  const destination=recipe?.destination;
  const destinationCurrent=destination?.kind==='existing_area' ? scope.areas.some(a=>a.id===destination.areaId &&
    a.revision===destination.expectedAreaRevision && fingerprint(a.actual_reference??null)===destination.referenceFingerprint) : true;
  const exactRecipe=Boolean(recipe && destinationCurrent && recipe.approval && ['approved','executed'].includes(recipe.state) &&
    recipe.approval.planHash===recipe.planHash && recipe.approval.provenance==='server_configured_local_operator' &&
    recipe.planHash===fingerprint({plan:recipe.plan,destination:recipe.destination}) &&
    recipe.plan.source.sourceId===row.id && recipe.plan.source.sourceRevision===row.revision &&
    recipe.plan.source.sourceSha256===row.sha256 && recipe.plan.source.schemaFingerprint===row.manual?.schemaFingerprint &&
    recipe.plan.workspaceRevision===scope.row.revision && recipe.plan.workspaceFingerprint===manualWorkspace);
  const jobs=(await client.query(`SELECT j.id,j.status,j.operation,j.input_fingerprint,
    m.accepted_fence,m.result_ref FROM jobs j LEFT JOIN usp_job_metadata m ON m.job_id=j.id
    WHERE j.case_id=$1 AND j.source_id=$2 ORDER BY j.created_at DESC,j.id LIMIT 8`,[scope.row.id,sourceId])).rows;
  const accepted=row.projected?.accepted,acceptedJob=jobs.find(j=>j.id===accepted?.jobId);
  const projectedAccepted=Boolean(row.profile==='large-original-v1' && row.sha256===PROJECTED_VECTOR_PROFILE.zipSha256 &&
    acceptedJob?.operation==='projected-vector' && acceptedJob.status==='succeeded' &&
    Number(acceptedJob.accepted_fence)===accepted?.fence && acceptedJob.result_ref?.sha256===accepted?.index?.sha256);
  const features=(await client.query(`SELECT id,revision,${digest('body')} body_sha,
    geometry IS NOT NULL has_geometry,body->'height' height,
    COALESCE(body->>'geometryRole',body#>>'{semantics,geometryRole}') geometry_role
    FROM physical_features WHERE body->>'sourceRevisionId'=$1 ORDER BY id LIMIT 65`,[sourceId])).rows;
  const qualified=features.length<=64 && features.length>0 ? await withUspAnalyticalReaderTx(client,'FIND',async reader=>
    (await reader.query(`SELECT id,revision,qualification_revision,${digest('metadata')} metadata_sha
      FROM usp_analytic_geometry WHERE namespace='area_feature' AND id=ANY($1::uuid[]) ORDER BY id`,[features.map(f=>f.id)])).rows) : [];
  const allQualified=features.length>0 && features.length<=64 && features.every(f=>qualified.some(q=>q.id===f.id && q.revision===f.revision));
  const recordPins=zRecordPins([
    ...(recipe?[{authority:'recipe',id:recipe.id,revision:recipe.revision,sha256:fingerprint(recipe)}]:[]),
    ...jobs.map(j=>({authority:'job',id:j.id,revision:Number(j.accepted_fence??0),sha256:fingerprint(j)})),
    ...scope.packages.map(p=>({authority:'package',id:p.id,revision:p.revision,sha256:p.body_sha})),
    ...scope.areas.flatMap(a=>[{authority:'area',id:a.id,revision:a.revision,sha256:a.reference_sha},
      {authority:'frame',id:a.site_id,revision:a.site_revision,sha256:a.frame_sha}]),
    ...features.slice(0,64).map(f=>({authority:'geometry',id:f.id,revision:f.revision,sha256:f.body_sha})),
    ...qualified.map(q=>({authority:'qualification',id:q.id,revision:q.qualification_revision,sha256:q.metadata_sha})),
  ]);
  const pins:SufficiencyPins={caseId:scope.row.id,caseRevision:scope.row.revision,sourceId,familyId:row.family_id,
    sourceRevision:row.revision,sourceSha256:row.sha256,profile:row.profile,contextSha256:scope.context,
    evidenceSha256:fingerprint({pin,recipe,exactRecipe,jobs,features,qualified}),accessSha256:scope.binding.access,policyVersion:SUFFICIENCY_POLICY};
  const supported=row.profile==='geojson-manual-v1' && Boolean(row.manual) ||
    row.profile==='large-original-v1' && row.sha256===PROJECTED_VECTOR_PROFILE.zipSha256 ||
    row.profile==='pdf-reference-v2' && row.has_parts;
  return {scope,row,pins,recordPins,latest,recipe,exactRecipe,jobs,projectedAccepted,features,allQualified,supported};
}
function zRecordPins(items:unknown[]){
  if(items.length>192)throw new AppError(422,'SUFFICIENCY_SCOPE_LIMIT','Use a smaller evidence scope.');
  return items.map(item=>SufficiencyRecordPinSchema.parse(item));
}
export type SufficiencyContext=Awaited<ReturnType<typeof sufficiencySourceTx>>;
