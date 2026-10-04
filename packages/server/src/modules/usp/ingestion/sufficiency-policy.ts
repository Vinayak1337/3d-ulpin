import type {SufficiencyEvidence,IngestionSufficiencyDecision} from '@ulpin/contracts/usp';
import type {SufficiencyContext} from './sufficiency-context';

type Assessment={evidence:SufficiencyEvidence[];outcome:IngestionSufficiencyDecision['outcome'];
  availability:IngestionSufficiencyDecision['availability'];nextAction:IngestionSufficiencyDecision['nextAction'];reason:string;gapClass?:string};
export function assessSufficiency(ctx:SufficiencyContext,task:string):Assessment{
  const {row,recipe}=ctx;
  const evidence=(requirement:string,state:SufficiencyEvidence['state'],authority:SufficiencyEvidence['authority']='inspection',locator:string|null=null):SufficiencyEvidence=>
    ({requirement,state,authority,id:authority==='recipe'&&recipe?recipe.id:row.id,revision:authority==='recipe'&&recipe?recipe.revision:row.revision,locator});
  const done=(items:SufficiencyEvidence[],reason:string):Assessment=>({evidence:items,outcome:'complete',availability:'available',nextAction:'none',reason});
  const park=(items:SufficiencyEvidence[],reason:string,nextAction:Assessment['nextAction']='park'):Assessment=>({evidence:items,outcome:'park',availability:'needs_input',nextAction,reason});
  const unavailable=(reason:string)=>({...park([evidence('supported_task','unsupported','policy')],reason,'inspect_original'),availability:'unavailable' as const});
  if(!ctx.supported)return unavailable('The retained source profile is not supported by this task policy. The original remains retained.');
  if(!ctx.latest)return {...park([evidence('current_source_revision','unknown','source')],'This retained source revision has been superseded. Evaluate its current revision.'),availability:'stale'};
  if(task==='retain_evidence'&&ctx.mesh)return done([evidence('retained_original_receipt','satisfied','source'),evidence('canonical_original_authority','satisfied','source')],
    'The canonical private original receipt is verified independently of native inspection. This does not read or qualify mesh geometry.');
  if(task==='retain_evidence')return done([evidence('retained_original_receipt','satisfied','source'),evidence('stored_inspection','satisfied')],
    'The original receipt and stored inspection are available. This task does not qualify geometry or source accuracy.');
  if(task==='inspect_native_context'){
    if(!ctx.mesh)return unavailable('Native mesh context inspection is supported only for a canonical retained OBJ or glTF original.');
    const processing=ctx.mesh.processing,items=[evidence('current_accepted_native_metadata',processing.mesh?.metadata?'satisfied':'unknown','job')];
    if(processing.mesh?.metadata)return done(items,processing.state==='inspected_partial'?
      'Current accepted native metadata is useful with partial projection or unfetched companions explicitly retained. This does not qualify placement, geometry, identity, measurements or rights.':
      'Current accepted local native metadata is available. Its context mesh remains unplaced and unqualified for geometry, identity, measurements, rights or learning.');
    if(processing.state==='unavailable')return {...park(items,'Strict current native read tools are unavailable or changed. Configure the pinned reader; the original receipt remains useful.','configure_reader'),availability:'unavailable'};
    if(processing.state==='stale')return {...park(items,'The native job input or reader pins are stale. Request a current canonical inspection; prior outcomes and original remain retained.','retry_extraction'),availability:'stale'};
    if(processing.state==='failed')return park(items,'The canonical native inspection failed. Inspect the retained failure and retry its supported route. No missing source fact is inferred.','retry_extraction');
    return park(items,processing.state==='running'?'The canonical native context inspection is running. No missing source facts are inferred.':
      'Native context inspection has not completed. Use the canonical reader; no missing source facts are inferred.',processing.jobId?'wait_for_extraction':'process_source');
  }
  if(ctx.mesh&&task==='context_2d')return park([evidence('qualified_working_frame','unknown','geometry'),evidence('recorded_context_geometry','unknown','geometry')],
    'Source-local mesh metadata and officer references do not establish a working frame or recorded 2D geometry. A source-backed reviewed conversion is required.','review_conversion');
  if(!['context_2d','neutral_display','building_massing','spatial_analysis'].includes(task))return unavailable('This task is not implemented by the retained-source policy. No success or qualification is implied.');
  if(ctx.document){
    const {state,modelStatus}=ctx.document.processing;
    const items=[evidence('current_native_extraction',state==='extracted'?'satisfied':'unknown','job')];
    if(state==='pending'||state==='running')return park(items,'The canonical extraction is pending. Wait for the supported reader before identifying missing source facts.','wait_for_extraction');
    if(state==='needs_ocr')return {...park(items,'The native reader found no extractable text. OCR is required; this is not proof of absent source facts.','run_ocr'),availability:'unavailable'};
    if(state==='failed'||state==='tool_error'||state==='stale')return park(items,'The extraction failed or its pins changed. Retry the canonical reader before asking for source facts.','retry_extraction');
    if(state==='unsupported'||state==='canonical_conversion_required')return {...park(items,'A supported canonical reader or reviewed conversion is required for this original. Source facts have not been declared absent.','review_conversion'),availability:'unavailable'};
    if(['unavailable','disabled','blocked','needs_input'].includes(modelStatus??''))return {...park([...items,evidence('permitted_model_proposals','unsupported','policy')],
      'Native text is retained, but model proposals are unavailable or require configuration. Inspect the native result or configure the permitted provider; no missing-fact question is inferred.','configure_provider'),availability:'unavailable'};
    return {...park([evidence('reviewed_document_conversion','unknown','policy')],
      'Native document evidence is available. A reviewed source-backed conversion is required for this spatial task; extraction does not qualify geometry.','review_conversion')};
  }
  if(task==='context_2d'){
    if(row.profile==='geojson-manual-v1'){
      const items=[evidence('source_polygons',row.manual.geometryTypes?.every((t:string)=>['Polygon','MultiPolygon'].includes(t))?'satisfied':'unknown'),
        evidence('approved_exact_mapping',ctx.exactRecipe?'satisfied':'unknown','recipe'),
        evidence('recorded_context',ctx.features.length>0 && ctx.features.length<=64 && ctx.features.every(f=>f.has_geometry)?'satisfied':'unknown','geometry')];
      if(items.every(i=>i.state==='satisfied'))return done(items,'The exact source-pinned mapping is approved for the existing 2D context path. Analytical geometry remains separately qualified.');
      if(ctx.exactRecipe)return park(items,'The approved exact mapping has not produced current recorded context geometry. Use the existing execution path.','process_source');
      return {...park(items,'Review an exact source-pinned manual mapping before using this source as 2D context.','review_mapping'),gapClass:'mapping_approval'};
    }
    if(row.profile==='large-original-v1')return ctx.projectedAccepted ? done([evidence('accepted_projected_context','satisfied','job')],
      'The retained administrative context has an accepted projected-vector job. It does not supply building or rights geometry.') :
      park([evidence('accepted_projected_context','unknown','job')],'The original is retained; the supported projected-vector conversion has not been accepted.','process_source');
    return unavailable('Document placement is unsupported by this stored document profile. Native document evidence remains inspectable.');
  }
  if(task==='neutral_display'){
    const actual=ctx.projectedAccepted || ctx.features.length>0 && ctx.features.length<=64 && ctx.features.every(f=>f.has_geometry);
    return actual ? {evidence:[evidence('existing_context_geometry','satisfied','geometry')],outcome:'fill_display',availability:'available',
      nextAction:'neutral_presentation',reason:'Existing context geometry may use neutral presentation. No dimensions, objects, measurements or rights are generated.'} :
      park([evidence('existing_context_geometry','unknown','geometry')],ctx.mesh?
        'Local native mesh metadata has no qualified working frame or recorded context geometry for neutral presentation. Retain it and review a source-backed conversion.':
        'There is no current recorded context geometry for neutral presentation. Retain the source and complete its supported conversion.',ctx.mesh?'review_conversion':'park');
  }
  if(task==='building_massing'){
    if(row.profile!=='geojson-manual-v1')return {evidence:[evidence('building_geometry','unsupported')],outcome:'reject_for_3d',availability:'unavailable',nextAction:'inspect_original',
      reason:ctx.mesh?'Native mesh context has no qualified building outline, height, frame or object correspondence for massing. Retain the source and native metadata; reject only this 3D task.':
        'This source profile supplies administrative or document evidence, not building geometry. Other supported tasks remain available.'};
    const height=row.manual.paths?.find((p:{path:string})=>p.path==='/features/*/properties/height_roof');
    const conflicting=ctx.scope.packageBodies.some(p=>p.body.questions.some((q:any)=>q.kind==='conflicting_claims'&&q.property==='building.exteriorHeight'&&!q.answer));
    const heightState=conflicting?'conflicting':height?.values>0?'present_unqualified':height?.explicitNull>0?'null':'unknown';
    const items=[evidence('qualified_building_geometry',ctx.allQualified?'satisfied':'unknown','geometry'),
      evidence('approved_building_outline',ctx.allQualified && ctx.features.every(f=>f.geometry_role==='approved_building_outline')?'satisfied':'unknown','geometry'),
      evidence('reliable_height',ctx.allQualified && ctx.features.every(f=>f.height?.state==='source_supported' && f.height?.unit==='m' && f.height?.reference && f.height?.evidence?.length)?'satisfied':heightState,'inspection',height?.path??null)];
    if(items.every(i=>i.state==='satisfied'))return done(items,'The current recorded source-backed building geometry and height satisfy the normal analytical authority.');
    return {...park(items,'A source height field does not qualify its unit, meaning or reference. Supply an existing source-backed height/geometry reference for officer review.','provide_evidence'),gapClass:'height_geometry_reference'};
  }
  if(task==='spatial_analysis')return ctx.allQualified ? done([evidence('current_analytical_geometry','satisfied','geometry')],
    'Exact current canonical geometry passes the existing analytical qualification authority.') :
    park([evidence('current_analytical_geometry','unknown','geometry')],'Analytical geometry is not qualified. Context and answered questions cannot qualify measurements or rights.','review_evidence');
  return unavailable('This task is not implemented by the retained-source policy. No success or qualification is implied.');
}
