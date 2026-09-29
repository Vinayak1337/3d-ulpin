import {z} from 'zod';
export const DOCUMENT_VERSION='source-document/1' as const;
export const DOCUMENT_POLICY='source-document-native/1' as const;
export const DOCUMENT_LIMITS=Object.freeze({originalBytes:16*1024*1024,nativeBytes:10*1024*1024,resultBytes:4*1024*1024,
  characters:250000,parts:10000,partCharacters:4096,page:25,candidates:40,modelCharacters:12000,modelParts:12,jobs:32});
const id=z.uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/),rev=z.number().int().nonnegative();
export const DocumentFormatSchema=z.enum(['pdf','text','csv','docx','xlsx','png','jpeg','archive','unsupported']);
export const DocumentOriginalSchema=z.strictObject({version:z.literal(DOCUMENT_VERSION),subject:z.string().min(1).max(256),
  format:DocumentFormatSchema,sha256:hash,bytes:z.number().int().positive(),receivedAt:z.iso.datetime()});
export const DocumentInputSchema=z.strictObject({version:z.literal(DOCUMENT_VERSION),jobId:id,caseId:id,caseRevision:rev,
  caseContextSha256:hash,sourceId:id,familyId:id,sourceRevision:z.number().int().positive(),sourceSha256:hash,
  sourceBytes:z.number().int().positive().max(DOCUMENT_LIMITS.originalBytes),objectKey:z.string().min(1).max(512),
  subject:z.string().min(1).max(256),accessSha256:hash,policyVersion:z.literal(DOCUMENT_POLICY),readerSha256:hash,
  gatewayPolicySha256:hash.nullable(),layoutCap:z.number().int().min(0).max(100).nullable(),mode:z.enum(['native_only','propose'])});
export const DocumentLocatorSchema=z.strictObject({label:z.string().min(1).max(512),page:z.number().int().positive().optional(),
  row:z.number().int().positive().optional(),line:z.number().int().positive().optional(),lineEnd:z.number().int().positive().optional(),
  paragraph:z.number().int().positive().optional(),table:z.number().int().positive().optional(),column:z.number().int().positive().optional(),
  headerRow:z.number().int().positive().optional(),
  sheet:z.string().min(1).max(128).optional(),sheetIndex:z.number().int().positive().optional(),
  sheetId:z.number().int().positive().optional(),
  cell:z.string().regex(/^[A-Z]{1,3}[1-9][0-9]{0,6}$/).optional(),
  cellState:z.enum(['literal','empty','empty_string','whitespace','formula_cached','formula_uncached','error','unsupported']).optional(),
  cellType:z.string().min(1).max(20).optional(),
  // Present on newly partitioned parts. Older native receipts remain readable.
  unitId:id.optional(),unitSha256:hash.optional(),segmentIndex:rev.optional(),segmentCount:z.number().int().positive().optional(),
  characterStart:rev,characterEnd:rev}).superRefine((value,ctx)=>{
    if(value.characterEnd<value.characterStart)ctx.addIssue({code:'custom',message:'Character range is reversed.'});
    if(value.lineEnd!==undefined && (value.line===undefined || value.lineEnd<value.line))
      ctx.addIssue({code:'custom',message:'A line range needs its first line.'});
    const group=[value.unitId,value.unitSha256,value.segmentIndex,value.segmentCount];
    if(group.some(item=>item!==undefined) && group.some(item=>item===undefined))
      ctx.addIssue({code:'custom',message:'A continuation needs its complete native-unit pin.'});
    if(value.segmentIndex!==undefined && value.segmentCount!==undefined && value.segmentIndex>=value.segmentCount)
      ctx.addIssue({code:'custom',message:'Continuation index exceeds its native unit.'});
    const workbook=[value.sheet,value.sheetIndex,value.sheetId,value.cell,value.cellState];
    if(workbook.some(item=>item!==undefined) && workbook.some(item=>item===undefined))
      ctx.addIssue({code:'custom',message:'A workbook citation needs its sheet, index, cell and value state.'});
    if(value.sheet!==undefined && (value.row===undefined || value.column===undefined))
      ctx.addIssue({code:'custom',message:'A workbook citation needs its source row and column.'});
  });
export const DocumentPartSchema=z.strictObject({id,sourceId:id,sourceRevision:z.number().int().positive(),sourceSha256:hash,
  text:z.string().min(1).max(DOCUMENT_LIMITS.partCharacters),sha256:hash,locator:DocumentLocatorSchema,method:z.literal('native_text')})
  .refine(part=>part.locator.unitId===undefined || part.locator.characterEnd-part.locator.characterStart===part.text.length,
    'A partitioned native part must match its exact character span.');
export const DocumentProposalSchema=z.strictObject({field:z.string().min(1).max(120),value:z.string().min(1).max(512),
  partId:id,quote:z.string().min(1).max(1000)});
export const DocumentModelOutputSchema=z.strictObject({candidates:z.array(DocumentProposalSchema).max(40)});
export const DocumentResultSchema=z.strictObject({version:z.literal(DOCUMENT_VERSION),input:DocumentInputSchema,
  native:z.strictObject({status:z.enum(['extracted','needs_ocr','unsupported','encrypted','tool_error']),format:DocumentFormatSchema,
    readerSha256:hash,code:z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/).nullable(),warnings:z.array(z.string().max(512)).max(100),
    parts:z.array(DocumentPartSchema).max(DOCUMENT_LIMITS.parts)}),
  model:z.strictObject({status:z.enum(['not_requested','disabled','unavailable','blocked','needs_input','proposed']),
    code:z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/).nullable(),candidates:z.array(DocumentProposalSchema).max(40),
    validationErrors:z.array(z.string().max(512)).max(40),calls:z.array(z.strictObject({callId:id,responseSha256:hash})).max(2)}),
  createdAt:z.iso.datetime()}).superRefine((value,ctx)=>{
    if(value.native.readerSha256!==value.input.readerSha256 || value.native.parts.some(p=>p.sourceId!==value.input.sourceId ||
      p.sourceRevision!==value.input.sourceRevision || p.sourceSha256!==value.input.sourceSha256) ||
      new Set(value.native.parts.map(p=>p.id)).size!==value.native.parts.length ||
      value.model.candidates.some(c=>{const p=value.native.parts.find(p=>p.id===c.partId);return !p ||
        !p.text.includes(c.quote)||!c.quote.includes(c.field)||!c.quote.includes(c.value)||/\[redacted/i.test(c.quote);}))
      ctx.addIssue({code:'custom',message:'Extraction parts and proposed fields must preserve exact source and citation pins'});
  });
export const DocumentRetainSchema=z.strictObject({requestKey:id,expectedCaseRevision:rev.optional(),
  familyId:id.optional(),expectedSourceRevision:z.number().int().positive().optional(),
  mode:z.enum(['native_only','propose']).default('propose')});
export const DocumentRetrySchema=z.strictObject({requestKey:id,expectedCaseRevision:rev,expectedSourceRevision:z.number().int().positive(),
  sourceSha256:hash,mode:z.enum(['native_only','propose']).default('propose')});
export const DocumentReceiptSchema=z.strictObject({version:z.literal(DOCUMENT_VERSION),caseId:id,caseRevision:rev,
  sourceId:id,sourceRevision:z.number().int().positive(),sourceSha256:hash,bytes:z.number().int().positive(),jobId:id});
export const DocumentStatusSchema=z.strictObject({version:z.literal(DOCUMENT_VERSION),caseId:id,sourceId:id,jobId:id,
  status:z.enum(['queued','running','completed','failed','stale']),currentCaseRevision:rev,sourceRevision:z.number().int().positive(),
  sourceSha256:hash,resultSha256:hash.nullable(),native:DocumentResultSchema.shape.native.omit({parts:true}).nullable(),
  model:DocumentResultSchema.shape.model.nullable(),parts:z.array(DocumentPartSchema).max(25),
  page:rev,hasMore:z.boolean(),code:z.string().nullable()});
export type DocumentInput=z.infer<typeof DocumentInputSchema>;
export type DocumentPart=z.infer<typeof DocumentPartSchema>;
export type DocumentResult=z.infer<typeof DocumentResultSchema>;
export type DocumentProposal=z.infer<typeof DocumentProposalSchema>;
