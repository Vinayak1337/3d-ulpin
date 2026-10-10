import {z} from 'zod';
import {DocumentPageFrameSchema} from '../document-pages';

export const DOCUMENT_PROPOSAL_LIMITS=Object.freeze({requestBytes:512*1024,responseBytes:768*1024,
  proposals:32,rejected:256,seconds:90,pageSpan:50,historyBytes:64*1024});
const id=z.uuid().transform(v=>v.toLowerCase()).pipe(z.uuid()),hash=z.string().regex(/^[a-f0-9]{64}$/);
const count=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const text=(max:number)=>z.string().min(1).max(max).refine(v=>/\S/u.test(v),'Use nonblank text.')
  .refine(v=>!/[\u0000\uD800-\uDFFF]/u.test(v),'Use losslessly storable Unicode text.');
const box=z.tuple([z.number().finite().nonnegative(),z.number().finite().nonnegative(),
  z.number().finite().nonnegative(),z.number().finite().nonnegative()]);
export const DocumentProposalLocatorSchema=z.strictObject({page:count.min(1).max(400),frame:DocumentPageFrameSchema,
  box:box.nullable(),selectedRegion:box.nullable(),declaredPrecision:text(120).nullable()}).superRefine((v,ctx)=>{
  for(const b of [v.box,v.selectedRegion])if(b&&(b[2]<=b[0]||b[3]<=b[1]||b[2]>v.frame.width||b[3]>v.frame.height))
    ctx.addIssue({code:'custom',message:'A cited box must fit the declared PDF display page.'});
});
export const DocumentProposalArtifactClaimSchema=z.strictObject({sha256:hash,bytes:count.min(1).max(16*1024*1024)});
export const DocumentProposalInputSchema=z.strictObject({proposalId:text(120),fieldRole:text(120),
  quote:text(4096).nullable(),lineQuote:text(4096).nullable(),valueLiteral:text(512).optional(),
  quoteCharacterSpan:z.tuple([count.max(4096),count.max(4096)]).nullable(),
  status:z.enum(['needs_review','needs_input','rejected','unsupported']),reasons:z.array(text(2000)).min(1).max(16),
  locator:DocumentProposalLocatorSchema,declaredMethod:text(512).nullable(),
  declaredObservation:DocumentProposalArtifactClaimSchema.nullable()}).superRefine((v,ctx)=>{
  if(v.quote===null&&v.status==='needs_review')ctx.addIssue({code:'custom',message:'An unavailable quote needs an explicit incomplete, rejected or unsupported state.'});
  if(v.quoteCharacterSpan){const [start,end]=v.quoteCharacterSpan;
    if(v.quote===null||v.lineQuote===null||end<=start||end>Array.from(v.lineQuote??'').length||
      Array.from(v.lineQuote??'').slice(start,end).join('')!==v.quote)
      ctx.addIssue({code:'custom',message:'The Unicode code-point span must retain the literal quote from the declared line.'});
  }
});
export const DocumentProposalRejectedSchema=z.strictObject({entryId:text(120),lineQuote:text(4096).nullable(),
  reason:text(2000),locator:DocumentProposalLocatorSchema,declaredMethod:text(512).nullable(),
  declaredObservation:DocumentProposalArtifactClaimSchema.nullable()});
export const DocumentProposalPacketSchema=z.strictObject({declaredOrigin:DocumentProposalArtifactClaimSchema.nullable(),
  proposals:z.array(DocumentProposalInputSchema).max(DOCUMENT_PROPOSAL_LIMITS.proposals),
  rejected:z.array(DocumentProposalRejectedSchema).max(DOCUMENT_PROPOSAL_LIMITS.rejected),
  conflicts:z.array(z.strictObject({proposalIds:z.array(text(120)).min(2).max(32),reason:text(2000),
    state:z.literal('unresolved')})).max(32),unknowns:z.array(text(2000)).max(32)}).superRefine((v,ctx)=>{
  const ids=new Set(v.proposals.map(p=>p.proposalId));
  if(v.proposals.length+v.rejected.length===0||ids.size!==v.proposals.length||
    new Set(v.rejected.map(r=>r.entryId)).size!==v.rejected.length)
    ctx.addIssue({code:'custom',message:'Retain a nonempty population with distinct proposal and rejected-entry IDs.'});
  for(const c of v.conflicts)if(new Set(c.proposalIds).size!==c.proposalIds.length||c.proposalIds.some(p=>!ids.has(p)))
    ctx.addIssue({code:'custom',message:'Each conflict must name distinct proposals retained in this explicit source selection.'});
  const pages=[...v.proposals,...v.rejected].map(v=>v.locator.page);
  if(Math.max(...pages)-Math.min(...pages)+1>DOCUMENT_PROPOSAL_LIMITS.pageSpan)
    ctx.addIssue({code:'custom',message:'Use a span of at most 50 PDF pages per bounded packet.'});
});
export const DocumentProposalSourcePinSchema=z.strictObject({sourceRevision:count.min(1),sourceSha256:hash,
  sourceBytes:count.min(1).max(16*1024*1024)});
export const DocumentProposalsSaveSchema=z.strictObject({requestKey:id,expectedCaseRevision:count,
  source:DocumentProposalSourcePinSchema,packet:DocumentProposalPacketSchema});
export const DocumentProposalQuoteCheckSchema=z.strictObject({
  outcome:z.enum(['quote_at_locator','quote_not_at_locator','not_checked']).describe(
    'quote_at_locator: quoted characters occur in stored text of the cited region of this original. '+
    'It does not say the text was read correctly from the page image, nor that the value is true.'),
  reason:z.enum(['quote_not_at_locator','value_not_in_quote','no_quote','no_region_text']).nullable(),
  basis:z.strictObject({kind:z.enum(['text_layer','ocr_observations']),productSha256:hash.nullable()}).nullable()
});
export const DocumentProposalCheckedSchema=DocumentProposalInputSchema.safeExtend({
  quotationCheck:DocumentProposalQuoteCheckSchema
});
const checkedRejected=DocumentProposalRejectedSchema.extend({
  originalProposal:DocumentProposalCheckedSchema.optional()
});
const checkedPacket=DocumentProposalPacketSchema.safeExtend({
  proposals:z.array(DocumentProposalCheckedSchema).max(DOCUMENT_PROPOSAL_LIMITS.proposals),
  rejected:z.array(checkedRejected).max(DOCUMENT_PROPOSAL_LIMITS.rejected)
});
// Conflict members may have been refused by the check; retain the original conflict, never elect a winner.
export const DocumentProposalCheckedPacketSchema=z.strictObject(checkedPacket.shape).superRefine((v,ctx)=>{
  const ids=[...v.proposals.map(p=>p.proposalId),
    ...v.rejected.flatMap(r=>r.originalProposal?[r.originalProposal.proposalId]:[])];
  if(!ids.length&&!v.rejected.length||new Set(ids).size!==ids.length||
    new Set(v.rejected.map(r=>r.entryId)).size!==v.rejected.length)
    ctx.addIssue({code:'custom',message:'Retain a nonempty explicit population with distinct IDs.'});
  for(const c of v.conflicts){
    if(new Set(c.proposalIds).size!==c.proposalIds.length||c.proposalIds.some(p=>!ids.includes(p)))
      ctx.addIssue({code:'custom',message:'Conflict members must remain as proposals or refused original proposals.'});
  }
  const pages=[...v.proposals,...v.rejected].map(p=>p.locator.page);
  if(Math.max(...pages)-Math.min(...pages)+1>DOCUMENT_PROPOSAL_LIMITS.pageSpan)
    ctx.addIssue({code:'custom',message:'Use a span of at most 50 PDF pages per bounded packet.'});
});
const snapshotV1=z.strictObject({version:z.literal('source-document-proposals/1'),
  snapshotId:id,snapshotRevision:z.literal(1),caseId:id,caseRevision:count,
  source:DocumentProposalSourcePinSchema.extend({sourceId:id}),packet:DocumentProposalPacketSchema,
  locatorWarnings:z.array(z.strictObject({entryKind:z.enum(['proposal','rejected']),entryId:text(120),
    code:z.literal('citation_extends_declared_region'),basis:z.literal('caller_supplied_coordinates')})).max(288),
  method:z.literal('caller_supplied_provisional'),provenanceAuthority:z.literal('caller_supplied_unverified'),
  population:z.literal('explicit_selection_only'),status:z.literal('needs_review'),
  quotationVerification:z.literal('not_machine_verified'),canonicalTarget:z.null(),
  canonicalMatchState:z.literal('not_assessed'),qualification:z.literal('not_assessed'),learningLabel:z.literal(false),
  unresolved:z.tuple([z.literal('quote_truth'),z.literal('producer_execution'),z.literal('approval_and_current_revision'),
    z.literal('canonical_building_floor'),z.literal('height_units_rights_and_placement')]),
  review:z.strictObject({actor:text(256),time:z.iso.datetime(),attribution:z.literal('local_process'),
    humanAuthenticated:z.literal(false),independentGroundTruth:z.literal(false)})});
const snapshotV2=snapshotV1.extend({version:z.literal('source-document-proposals/2'),
  packet:DocumentProposalCheckedPacketSchema,quotationVerification:z.literal('locator_checks_recorded').describe(
    'Each proposal carries its presence check or explicit not_checked reason; quote_truth remains unresolved.')});
export const DocumentProposalSnapshotSchema=z.union([snapshotV1,snapshotV2]);
const viewFields={currentCaseRevision:count,snapshotSha256:hash};
export const DocumentProposalSnapshotViewSchema=z.union([snapshotV1.extend(viewFields),snapshotV2.extend(viewFields)]);
export const DocumentProposalsHistoryQuerySchema=z.strictObject({after:id.optional(),
  limit:z.string().regex(/^(?:[1-9]|10)$/).default('5').transform(Number)});
export const DocumentProposalReferenceSchema=snapshotV1.pick({snapshotId:true,snapshotRevision:true,
  caseRevision:true,review:true,method:true,provenanceAuthority:true,population:true,status:true,quotationVerification:true,
  qualification:true,learningLabel:true}).extend({snapshotSha256:hash,
  quotationVerification:z.enum(['not_machine_verified','locator_checks_recorded']),
  proposalCount:count.max(DOCUMENT_PROPOSAL_LIMITS.proposals),rejectedCount:count.max(DOCUMENT_PROPOSAL_LIMITS.rejected),
  conflictCount:count.max(32),locatorWarningCount:count.max(288),readUrl:z.string().max(256)});
export const DocumentProposalsHistorySchema=z.strictObject({version:z.literal('source-document-proposals-history/1'),
  caseId:id,currentCaseRevision:count,source:DocumentProposalSourcePinSchema.extend({sourceId:id}),
  order:z.literal('snapshot_id_ascending'),after:id.nullable(),limit:count.min(1).max(10),
  references:z.array(DocumentProposalReferenceSchema).max(10),hasMore:z.boolean(),nextAfter:id.nullable()})
  .refine(v=>v.references.length<=v.limit&&v.references.every((r,i)=>r.snapshotId>(i?v.references[i-1].snapshotId:v.after??''))&&
    (v.hasMore?v.references.length===v.limit&&v.nextAfter===v.references.at(-1)?.snapshotId:v.nextAfter===null),
  'Retain the complete ordered page and its continuation cursor.');
export type DocumentProposalSourcePin=z.output<typeof DocumentProposalSourcePinSchema>;
export type DocumentProposalSnapshot=z.output<typeof DocumentProposalSnapshotSchema>;
export type DocumentProposalPacket=z.output<typeof DocumentProposalPacketSchema>;
export type DocumentProposalReference=z.output<typeof DocumentProposalReferenceSchema>;
export type DocumentProposalsHistory=z.output<typeof DocumentProposalsHistorySchema>;

// A decision is a separate workflow record. It never edits/adopts the proposal.
export const DocumentProposalDecisionPinSchema=z.strictObject({decisionId:id,decisionRevision:count.min(1),snapshotSha256:hash});
export const DocumentProposalSelectionSchema=z.strictObject({snapshotId:id,snapshotRevision:z.literal(1),snapshotSha256:hash,proposalId:text(120)});
export const DocumentProposalDecisionCitationSchema=z.strictObject({quote:text(4096).nullable(),lineQuote:text(4096).nullable(),
  quoteCharacterSpan:z.tuple([count.max(4096),count.max(4096)]).nullable(),locator:DocumentProposalLocatorSchema})
  .superRefine((v,ctx)=>{if(v.quoteCharacterSpan){const [start,end]=v.quoteCharacterSpan;
    if(v.quote===null||v.lineQuote===null||end<=start||end>Array.from(v.lineQuote??'').length||
      Array.from(v.lineQuote??'').slice(start,end).join('')!==v.quote)
      ctx.addIssue({code:'custom',message:'Retain the literal Unicode code-point quote span; no transcription replacement.'});}});
export const DocumentProposalDecisionSaveSchema=z.strictObject({requestKey:id,expectedCaseRevision:count,
  source:DocumentProposalSourcePinSchema,proposal:DocumentProposalSelectionSchema,
  decision:z.enum(['reviewed','rejected','needs_input']),reviewReason:text(2000),citation:DocumentProposalDecisionCitationSchema,
  missingPrerequisites:z.array(text(2000)).max(16),correctionOf:DocumentProposalDecisionPinSchema.optional()})
  .superRefine((v,ctx)=>{if((v.decision==='reviewed'&&v.citation.quote===null)||
      (v.decision==='needs_input'&&v.missingPrerequisites.length===0)||
      (v.citation.quote===null&&v.missingPrerequisites.length===0))
    ctx.addIssue({code:'custom',message:'Reviewed requires a cited quote; incomplete decisions must name missing input.'});});
const decisionSnapshotBase=z.strictObject({version:z.literal('source-document-proposal-decision/1'),
  decisionId:id,decisionRevision:count.min(1),caseId:id,caseRevision:count,
  source:DocumentProposalSourcePinSchema.extend({sourceId:id}),proposal:DocumentProposalSelectionSchema,
  originalProposal:z.union([DocumentProposalInputSchema,DocumentProposalCheckedSchema]),
  decision:z.enum(['reviewed','rejected','needs_input']),
  citation:DocumentProposalDecisionCitationSchema,missingPrerequisites:z.array(text(2000)).max(16),
  correctionOf:DocumentProposalDecisionPinSchema.nullable(),
  sourceConflicts:DocumentProposalPacketSchema.shape.conflicts,sourceUnknowns:DocumentProposalPacketSchema.shape.unknowns,
  buildingFloorLink:z.strictObject({state:z.literal('needs_input'),canonicalTarget:z.null(),
    missingPrerequisites:z.tuple([z.literal('canonical_building'),z.literal('canonical_floor'),z.literal('reviewed_source_target_crosswalk')])}),
  method:z.literal('caller_supplied_decision'),quotationVerification:z.literal('not_machine_verified'),
  canonicalMatchState:z.literal('not_assessed'),qualification:z.literal('not_assessed'),learningLabel:z.literal(false),
  review:z.strictObject({actor:text(256),time:z.iso.datetime(),reason:text(2000),attribution:z.literal('local_process'),
    humanAuthenticated:z.literal(false),independentGroundTruth:z.literal(false)})});
export const DocumentProposalDecisionSnapshotSchema=decisionSnapshotBase.superRefine((v,ctx)=>{
  if(v.originalProposal.proposalId!==v.proposal.proposalId||(v.decision==='reviewed'&&v.citation.quote===null)||
    (v.decision==='needs_input'&&v.missingPrerequisites.length===0)||(v.citation.quote===null&&v.missingPrerequisites.length===0)||
    (v.decisionRevision===1?v.correctionOf!==null:v.correctionOf===null||v.correctionOf.decisionId!==v.decisionId||
      v.correctionOf.decisionRevision!==v.decisionRevision-1))
    ctx.addIssue({code:'custom',message:'Retain the selected proposal, incomplete-input reasons and consecutive correction lineage.'});
});
export const DocumentProposalDecisionViewSchema=DocumentProposalDecisionSnapshotSchema.safeExtend({currentCaseRevision:count,snapshotSha256:hash});
export const DocumentProposalDecisionReadQuerySchema=z.strictObject({revision:z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(count.min(1))});
export const DocumentProposalDecisionHistoryQuerySchema=z.strictObject({after:z.string().regex(/^[a-f0-9-]{36}:[1-9]\d*$/)
  .refine(v=>id.safeParse(v.split(':')[0]).success&&Number.isSafeInteger(Number(v.split(':')[1]))).optional(),
  limit:z.string().regex(/^(?:[1-9]|10)$/).default('5').transform(Number)});
export const DocumentProposalDecisionHistorySchema=z.strictObject({version:z.literal('source-document-proposal-decision-history/1'),
  caseId:id,sourceId:id,proposalSnapshotId:id,currentCaseRevision:count,order:z.literal('decision_id_then_revision_ascending'),
  after:z.string().nullable(),limit:count.min(1).max(10),
  references:z.array(decisionSnapshotBase.pick({decisionId:true,decisionRevision:true,proposal:true,decision:true,
    correctionOf:true,review:true,method:true,quotationVerification:true,qualification:true,learningLabel:true})
    .extend({snapshotSha256:hash,readUrl:z.string().max(300)})).max(10),hasMore:z.boolean(),nextAfter:z.string().nullable()})
  .refine(v=>{
    const key=(decisionId:string,revision:number)=>`${decisionId}:${String(revision).padStart(16,'0')}`;
    const cursor=v.after?.split(':');
    const after=cursor?key(cursor[0],Number(cursor[1])):'';
    return v.references.length<=v.limit&&v.references.every((r,i)=>r.proposal.snapshotId===v.proposalSnapshotId&&
      key(r.decisionId,r.decisionRevision)>(i?key(v.references[i-1].decisionId,v.references[i-1].decisionRevision):after))&&
      (v.hasMore?v.references.length===v.limit&&v.nextAfter===`${v.references.at(-1)?.decisionId}:${v.references.at(-1)?.decisionRevision}`:v.nextAfter===null);
  },'Retain the exact ordered decision page, proposal scope and continuation cursor.');
export type DocumentProposalDecisionSave=z.output<typeof DocumentProposalDecisionSaveSchema>;
