import {z} from 'zod';
import {DocumentPageFrameSchema} from '../document-pages';

export const DOCUMENT_CLAIMS_LIMITS=Object.freeze({sources:2,claims:25,quoteCharacters:4096,
  requestBytes:512*1024,responseBytes:768*1024,seconds:90,pageSpan:50});
export const DOCUMENT_CLAIMS_VERSION='source-document-review/1' as const;
const id=z.uuid().transform(value=>value.toLowerCase()).pipe(z.uuid()),hash=z.string().regex(/^[a-f0-9]{64}$/);
const revision=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const positiveRevision=revision.min(1);
function storableText(value:string){
  // JSONB cannot retain NUL or an unpaired UTF-16 surrogate. Refuse rather than
  // replacing source characters or failing after the review write starts.
  for(let i=0;i<value.length;i++){
    const unit=value.charCodeAt(i);
    if(unit===0)return false;
    if(unit>=0xd800&&unit<=0xdbff){const next=value.charCodeAt(++i);if(!(next>=0xdc00&&next<=0xdfff))return false;}
    else if(unit>=0xdc00&&unit<=0xdfff)return false;
  }
  return true;
}
const text=(max:number)=>z.string().min(1).max(max).refine(value=>/\S/u.test(value),'Use nonblank text.')
  .refine(storableText,'NUL and unpaired surrogate characters cannot be retained losslessly. Correct the transcription; no characters were replaced.');
export const DocumentClaimSourceSchema=z.strictObject({sourceId:id,sourceRevision:positiveRevision,sourceSha256:hash});
export const DocumentClaimReviewPinSchema=z.strictObject({reviewId:id,reviewRevision:positiveRevision});
export const DocumentClaimRegionSchema=z.strictObject({frame:DocumentPageFrameSchema,
  box:z.tuple([z.number().finite().nonnegative(),z.number().finite().nonnegative(),
    z.number().finite().nonnegative(),z.number().finite().nonnegative()])}).superRefine((value,ctx)=>{
  const [x0,y0,x1,y1]=value.box;
  if(x1<=x0||y1<=y0||x1>value.frame.width||y1>value.frame.height)
    ctx.addIssue({code:'custom',message:'Choose a nonempty box inside the declared PDF display page.'});
});
export const DocumentClaimLocatorSchema=z.strictObject({page:z.number().int().min(1).max(400),
  label:text(512),region:DocumentClaimRegionSchema.optional()});
export const DocumentClaimInputSchema=z.strictObject({sourceId:id,kind:z.enum(['floor_caption','stack_statement']),
  quote:text(DOCUMENT_CLAIMS_LIMITS.quoteCharacters),locator:DocumentClaimLocatorSchema});
export const DocumentClaimConflictInputSchema=z.strictObject({
  claimOrdinals:z.array(z.number().int().min(0).max(24)).min(2).max(25),reason:text(2000)});
export const DocumentClaimsReviewRequestSchema=z.strictObject({requestKey:id,expectedCaseRevision:revision,
  sources:z.array(DocumentClaimSourceSchema).min(1).max(2),claims:z.array(DocumentClaimInputSchema).min(1).max(25),
  conflicts:z.array(DocumentClaimConflictInputSchema).max(25),reviewReason:text(2000),
  correctionOf:DocumentClaimReviewPinSchema.optional()}).superRefine((value,ctx)=>{
  const sourceIds=new Set(value.sources.map(source=>source.sourceId));
  if(sourceIds.size!==value.sources.length||value.claims.some(claim=>!sourceIds.has(claim.sourceId))||
    value.sources.some(source=>!value.claims.some(claim=>claim.sourceId===source.sourceId)))
    ctx.addIssue({code:'custom',message:'Select each cited source once, with at least one claim per source.'});
  const keys=value.claims.map(claim=>JSON.stringify(claim));
  if(new Set(keys).size!==keys.length)ctx.addIssue({code:'custom',message:'Do not duplicate the same quote and locator.'});
  const groups=new Set<string>();
  for(const group of value.conflicts){
    const key=[...group.claimOrdinals].sort((a,b)=>a-b).join(',');
    if(new Set(group.claimOrdinals).size!==group.claimOrdinals.length||groups.has(key)||
      group.claimOrdinals.some(ordinal=>ordinal>=value.claims.length))
      ctx.addIssue({code:'custom',message:'Each unresolved conflict selects distinct existing claim ordinals once.'});
    groups.add(key);
  }
  for(const source of value.sources){
    const pages=value.claims.filter(claim=>claim.sourceId===source.sourceId).map(claim=>claim.locator.page);
    if(Math.max(...pages)-Math.min(...pages)+1>DOCUMENT_CLAIMS_LIMITS.pageSpan)
      ctx.addIssue({code:'custom',message:'Select a span of at most 50 PDF pages per source for one bounded review.'});
  }
});
export const DocumentClaimsReadQuerySchema=z.strictObject({revision:z.string().regex(/^[1-9]\d*$/)
  .transform(Number).pipe(positiveRevision)});
export const DocumentClaimSchema=DocumentClaimInputSchema.extend({claimId:id,ordinal:z.number().int().min(0).max(24),
  locator:DocumentClaimLocatorSchema.extend({pageFrame:DocumentPageFrameSchema})});
const unresolved=['approval','current_drawing_revision','canonical_building','canonical_floor',
  'horizontal_reference','vertical_reference'] as const;
export const DOCUMENT_CLAIMS_UNRESOLVED=Object.freeze([...unresolved]);
export const DocumentClaimReviewSnapshotSchema=z.strictObject({version:z.literal(DOCUMENT_CLAIMS_VERSION),
  reviewId:id,reviewRevision:positiveRevision,caseId:id,caseRevision:revision,
  correctionOf:DocumentClaimReviewPinSchema.nullable(),
  sources:z.array(DocumentClaimSourceSchema.extend({sourceBytes:z.number().int().min(1).max(16*1024**2)})).min(1).max(2),
  claims:z.array(DocumentClaimSchema).min(1).max(25),
  conflicts:z.array(z.strictObject({conflictId:id,claimIds:z.array(id).min(2).max(25),reason:text(2000),
    state:z.literal('unresolved')})).max(25),unresolved:z.tuple([z.literal('approval'),z.literal('current_drawing_revision'),
      z.literal('canonical_building'),z.literal('canonical_floor'),z.literal('horizontal_reference'),z.literal('vertical_reference')]),
  method:z.literal('human_entry'),quotationVerification:z.literal('not_machine_verified'),
  canonicalMatchState:z.literal('not_assessed'),qualification:z.literal('not_assessed'),
  review:z.strictObject({actor:text(256),time:z.iso.datetime(),reason:text(2000),attribution:z.literal('local_process'),
    humanAuthenticated:z.literal(false),independentGroundTruth:z.literal(false)})
}).superRefine((value,ctx)=>{
  const sources=new Set(value.sources.map(source=>source.sourceId)),claims=new Set(value.claims.map(claim=>claim.claimId));
  if(sources.size!==value.sources.length||claims.size!==value.claims.length||
    value.claims.some((claim,ordinal)=>claim.ordinal!==ordinal||!sources.has(claim.sourceId))||
    value.sources.some(source=>!value.claims.some(claim=>claim.sourceId===source.sourceId))||
    value.conflicts.some(group=>new Set(group.claimIds).size!==group.claimIds.length||group.claimIds.some(id=>!claims.has(id))))
    ctx.addIssue({code:'custom',message:'The complete reviewed source/claim/conflict population must remain intact.'});
});
export const DocumentClaimReviewSchema=DocumentClaimReviewSnapshotSchema.safeExtend({currentCaseRevision:revision,snapshotSha256:hash});
export type DocumentClaimsReviewRequest=z.output<typeof DocumentClaimsReviewRequestSchema>;
export type DocumentClaimReviewSnapshot=z.output<typeof DocumentClaimReviewSnapshotSchema>;
export type DocumentClaimReview=z.output<typeof DocumentClaimReviewSchema>;
export type DocumentClaimSource=z.output<typeof DocumentClaimSourceSchema>;
