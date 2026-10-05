import {z} from 'zod';
import {DocumentPageFrameSchema} from '../document-pages';

export const DOCUMENT_PROPOSAL_LIMITS=Object.freeze({requestBytes:512*1024,responseBytes:768*1024,
  proposals:32,rejected:256,seconds:90,pageSpan:50});
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
  quote:text(4096).nullable(),lineQuote:text(4096).nullable(),
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
export const DocumentProposalSnapshotSchema=z.strictObject({version:z.literal('source-document-proposals/1'),
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
export const DocumentProposalSnapshotViewSchema=DocumentProposalSnapshotSchema.extend({currentCaseRevision:count,snapshotSha256:hash});
export type DocumentProposalSourcePin=z.output<typeof DocumentProposalSourcePinSchema>;
export type DocumentProposalSnapshot=z.output<typeof DocumentProposalSnapshotSchema>;
export type DocumentProposalPacket=z.output<typeof DocumentProposalPacketSchema>;
