import {z} from 'zod';
import {GisQuarantineSchema} from '../gis-quarantine';
export const DOCUMENT_VERSION='source-document/1' as const;
export const DOCUMENT_POLICY='source-document-native/1' as const;
export const DOCUMENT_LIMITS=Object.freeze({originalBytes:16*1024*1024,nativeBytes:10*1024*1024,resultBytes:4*1024*1024,
  characters:250000,parts:10000,partCharacters:4096,page:25,candidates:40,modelCharacters:12000,modelParts:12,jobs:32});
const id=z.uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/),rev=z.number().int().nonnegative();
const ocrBox=z.tuple([z.number().finite(),z.number().finite(),z.number().finite(),z.number().finite()])
  .refine(([x0,y0,x1,y1])=>x0>=0&&y0>=0&&x1>x0&&y1>y0);
export const DocumentOcrSelectionSchema=z.strictObject({page:z.number().int().min(1).max(8),region:ocrBox.optional()});
export const DocumentArchiveSelectionSchema=z.strictObject({ordinal:z.number().int().min(0).max(255),
  memberSha256:hash,memberBytes:z.number().int().min(1).max(8*1024*1024)});
export const DocumentFormatSchema=z.enum(['pdf','text','csv','docx','xlsx','ods','html','png','jpeg','archive','unsupported']);
export const DocumentOriginalSchema=z.strictObject({version:z.literal(DOCUMENT_VERSION),subject:z.string().min(1).max(256),
  format:DocumentFormatSchema,sha256:hash,bytes:z.number().int().positive(),receivedAt:z.iso.datetime()});
export const DocumentInputSchema=z.strictObject({version:z.literal(DOCUMENT_VERSION),jobId:id,caseId:id,caseRevision:rev,
  caseContextSha256:hash,sourceId:id,familyId:id,sourceRevision:z.number().int().positive(),sourceSha256:hash,
  sourceBytes:z.number().int().positive().max(DOCUMENT_LIMITS.originalBytes),objectKey:z.string().min(1).max(512),
  subject:z.string().min(1).max(256),accessSha256:hash,policyVersion:z.literal(DOCUMENT_POLICY),readerSha256:hash,
  gatewayPolicySha256:hash.nullable(),layoutCap:z.number().int().min(0).max(100).nullable(),mode:z.enum(['native_only','propose']),
  ocrSelection:DocumentOcrSelectionSchema.optional(),ocrConfigSha256:hash.optional(),archiveSelection:DocumentArchiveSelectionSchema.optional()})
  .refine(value=>(value.ocrSelection===undefined)===(value.ocrConfigSha256===undefined),'OCR selection needs its operator configuration pin.')
  .refine(value=>!value.archiveSelection || (!value.ocrSelection && value.mode==='native_only'),'Archive inspection requires native_only and excludes OCR.');
export const DocumentLocatorSchema=z.strictObject({label:z.string().min(1).max(512),page:z.number().int().positive().optional(),
  row:z.number().int().positive().optional(),line:z.number().int().positive().optional(),lineEnd:z.number().int().positive().optional(),
  paragraph:z.number().int().positive().optional(),table:z.number().int().positive().optional(),column:z.number().int().positive().optional(),
  headerRow:z.number().int().positive().optional(),
  sheet:z.string().min(1).max(128).optional(),sheetIndex:z.number().int().positive().optional(),
  sheetId:z.number().int().positive().optional(),
  cell:z.string().regex(/^[A-Z]{1,3}[1-9][0-9]{0,6}$/).optional(),
  cellState:z.enum(['literal','empty','empty_string','whitespace','formula_cached','formula_uncached','error','unsupported']).optional(),
  cellType:z.string().min(1).max(20).optional(),
  // ODF has source table ordinals, not OOXML sheet IDs. Repeats are unexpanded source ranges.
  ods:z.strictObject({rowElement:z.number().int().min(1).max(2000),cellElement:z.number().int().min(1).max(2000),
    rowRepeat:z.number().int().min(1).max(1048576),columnRepeat:z.number().int().min(1).max(16384),
    valueSource:z.enum(['value','boolean-value','date-value','time-value','string-value','text','none']),
    formula:z.string().min(1).max(4096).optional()}).optional(),
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
    const workbook=[value.sheet,value.sheetIndex,value.cell,value.cellState];
    if((workbook.some(item=>item!==undefined) || value.sheetId!==undefined || value.ods!==undefined) &&
      (workbook.some(item=>item===undefined) || (value.ods===undefined && value.sheetId===undefined)))
      ctx.addIssue({code:'custom',message:'A workbook citation needs its sheet, index, cell and value state.'});
    if(value.sheet!==undefined && (value.row===undefined || value.column===undefined))
      ctx.addIssue({code:'custom',message:'A workbook citation needs its source row and column.'});
    if(value.ods && (value.sheetId!==undefined || value.row===undefined || value.column===undefined ||
      value.row+value.ods.rowRepeat-1>1048576 || value.column+value.ods.columnRepeat-1>16384 ||
      (value.ods.formula!==undefined && value.cellState==='literal') ||
      ((value.cellState==='formula_cached' || value.cellState==='formula_uncached') && value.ods.formula===undefined)))
      ctx.addIssue({code:'custom',message:'An ODS citation needs bounded source ranges, no OOXML ID, and explicit formula state.'});
  });
export const DocumentPartSchema=z.strictObject({id,sourceId:id,sourceRevision:z.number().int().positive(),sourceSha256:hash,
  text:z.string().min(1).max(DOCUMENT_LIMITS.partCharacters),sha256:hash,locator:DocumentLocatorSchema,method:z.literal('native_text')})
  .refine(part=>part.locator.unitId===undefined || part.locator.characterEnd-part.locator.characterStart===part.text.length,
    'A partitioned native part must match its exact character span.');
// ZIP entries are private inventory metadata, never extracted evidence or a second source authority.
export const DocumentArchiveMemberSchema=z.strictObject({ordinal:rev,pathLabel:z.string().min(1).max(256),
  declaredBytes:rev,actualBytes:rev.nullable(),sha256:hash.nullable(),declaredCrc32:z.string().regex(/^[a-f0-9]{8}$/),
  crc:z.enum(['match','unchecked']),routeHint:z.enum(['none','shapefile','pdf','csv','text','docx','xlsx','json','geojson','raster','point_cloud','image']),
  issue:z.enum(['UNSAFE_PATH','DUPLICATE_PATH','SPECIAL_ENTRY','DIRECTORY','ENCRYPTED','UNSUPPORTED_COMPRESSION',
    'NESTED_ARCHIVE','SCRIPT_INERT','UNSUPPORTED_FORMAT','EXPANSION_LIMIT','TIME_LIMIT','SIZE_MISMATCH','CORRUPT_MEMBER']).nullable(),
  companion:z.enum(['complete','incomplete','not_applicable'])}).superRefine((entry,ctx)=>{
    if((entry.actualBytes===null)!==(entry.sha256===null) || (entry.crc==='match')!==(entry.sha256!==null))
      ctx.addIssue({code:'custom',message:'Archive member integrity fields must agree.'});
  });
export const DocumentArchiveInventorySchema=z.strictObject({sourceSha256:hash,coverage:z.enum(['complete','incomplete','unknown']),
  issue:z.enum(['CORRUPT_CENTRAL_DIRECTORY','MEMBER_COUNT_LIMIT','DECLARED_SIZE_LIMIT','MEMBER_ISSUES','COMPANION_INCOMPLETE']).nullable(),
  memberCount:rev.nullable(),declaredExpandedBytes:rev.nullable(),observedExpandedBytes:rev,
  members:z.array(DocumentArchiveMemberSchema).max(256)}).superRefine((value,ctx)=>{
    if(value.members.some((member,index)=>member.ordinal!==index) ||
      (value.memberCount!==null && value.members.length>value.memberCount) ||
      (value.coverage==='complete' && (value.issue!==null || value.memberCount!==value.members.length)) ||
      (value.coverage==='unknown' && value.members.length!==0))
      ctx.addIssue({code:'custom',message:'Archive inventory coverage and ordinal pins are inconsistent.'});
  });
export const DocumentProposalSchema=z.strictObject({field:z.string().min(1).max(120),value:z.string().min(1).max(512),
  partId:id,quote:z.string().min(1).max(1000)});
export const DocumentModelOutputSchema=z.strictObject({candidates:z.array(DocumentProposalSchema).max(40)});
export const DocumentOcrItemSchema=z.strictObject({text:z.string().min(1).max(2048)
  .refine(value=>new TextEncoder().encode(value).length<=2048,'OCR item exceeds its byte cap.'),label:z.string().max(64),
  method:z.enum(['ocr:docling-tesseract-cli-full-page','ocr:tesseract-cli-sparse-tsv']),sourcePageBoxes:z.array(z.strictObject({
    pageNumber:z.number().int().min(1).max(8),frame:z.literal('pdf_display_page_top_left_points'),box:ocrBox,
    derivedFrom:z.enum(['docling_crop_page_box_via_png_dpi_and_mupdf_pixel_origin',
      'tesseract_tsv_pixels_via_mupdf_pixel_origin'])})).min(1).max(4)});
export const DocumentOcrExecutionSchema=z.strictObject({maxSeconds:z.number().int().min(1).max(90),
  exitCode:z.number().int().nullable(),receiptSha256:hash.nullable(),candidateSha256:hash.nullable(),
  failure:z.strictObject({attemptId:z.uuid(),class:z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,79}$/),
    message:z.enum(['Native dependency unavailable','Python dependency unavailable','Invalid worker result',
      'Worker exception; sensitive detail withheld','Worker terminated by resource bound',
      'Worker failed before producing diagnostics'])}).optional(),
  worker:z.strictObject({exitCode:z.number().int(),stopReason:z.string().max(120).nullable(),
    elapsedSeconds:z.number().finite().nonnegative(),peakObservedRssBytes:rev,peakJobPrivateBytes:rev.nullable(),
    gatedStart:z.literal(true),logSha256:hash}).nullable()});
const DocumentOcrBaseSchema=z.strictObject({sourceSha256:hash,sourceRevision:z.number().int().positive(),
  sourcePage:z.number().int().min(1).max(8),requestedRegion:ocrBox.nullable(),
  sourcePageFrame:z.strictObject({kind:z.literal('pdf_display_page_top_left_points'),rotation:z.literal(0),
    width:z.number().finite().positive().max(14400),height:z.number().finite().positive().max(14400)}).nullable(),
  method:z.enum(['ocr:docling-slim-2.131.0:tesseract-cli-5.5.1:heron-pinned','ocr:tesseract-cli-5.5.1:sparse-tsv-v1']),
  toolStatus:z.enum(['complete','partial','failed','unavailable']),outputStatus:z.enum(['complete','partial','failed']),
  textCompleteness:z.literal('unverified'),issues:z.array(z.string().min(1).max(200)).max(32),
  items:z.array(DocumentOcrItemSchema).max(64),execution:DocumentOcrExecutionSchema.optional()});
function refineOcrFrame(value:Pick<z.infer<typeof DocumentOcrBaseSchema>,'sourcePageFrame'|'requestedRegion'>,ctx:z.RefinementCtx){
    const frame=value.sourcePageFrame,region=value.requestedRegion;
    // A missing frame remains useful for an unavailable/failed attempt. A
    // rendered large frame must have an explicit crop, never a whole-page claim.
    if(frame===null)return;
    if(region===null){
      if(frame.width>2000||frame.height>2000)
        ctx.addIssue({code:'custom',message:'Whole-page OCR exceeds its supported page frame.'});
    }else if(region[2]>frame.width||region[3]>frame.height||
      region[2]-region[0]<1||region[3]-region[1]<1||region[2]-region[0]>2000||region[3]-region[1]>2000)
      ctx.addIssue({code:'custom',message:'OCR selection must be a bounded crop inside its source page frame.'});
}
export const DocumentOcrSchema=DocumentOcrBaseSchema.superRefine((value,ctx)=>{
    refineOcrFrame(value,ctx);
    const sparse=value.method==='ocr:tesseract-cli-5.5.1:sparse-tsv-v1';
    if(value.items.some(item=>item.method!==(sparse?'ocr:tesseract-cli-sparse-tsv':'ocr:docling-tesseract-cli-full-page')||
      item.sourcePageBoxes.some(cite=>cite.derivedFrom!==(sparse?'tesseract_tsv_pixels_via_mupdf_pixel_origin':
        'docling_crop_page_box_via_png_dpi_and_mupdf_pixel_origin'))))
      ctx.addIssue({code:'custom',message:'OCR method and source-box derivation must identify the same extractor.'});
    if((value.toolStatus==='unavailable'||value.toolStatus==='failed')&&value.outputStatus!=='failed')
      ctx.addIssue({code:'custom',message:'Unavailable OCR cannot publish completed output.'});
    if(value.outputStatus==='complete'&&!value.items.length)
      ctx.addIssue({code:'custom',message:'Empty OCR output must be partial.'});
    if(value.items.reduce((size,item)=>size+new TextEncoder().encode(item.text).length,0)>32*1024)
      ctx.addIssue({code:'custom',message:'OCR output exceeds its total text byte cap.'});
    if(value.outputStatus!=='failed' && value.execution && (value.execution.exitCode!==0 ||
      !value.execution.worker || value.execution.worker.exitCode!==0 || value.execution.worker.stopReason!==null ||
      !value.execution.receiptSha256 || !value.execution.candidateSha256))
      ctx.addIssue({code:'custom',message:'Published OCR output needs its completed bounded execution receipt.'});
    if(value.items.length && value.sourcePageFrame===null)
      ctx.addIssue({code:'custom',message:'Cited OCR items need the source page frame.'});
    if(value.items.some(item=>item.sourcePageBoxes.some(cite=>value.requestedRegion!==null &&
      (cite.box[0]<value.requestedRegion[0]-1||cite.box[1]<value.requestedRegion[1]-1||
        cite.box[2]>value.requestedRegion[2]+1||cite.box[3]>value.requestedRegion[3]+1))))
      ctx.addIssue({code:'custom',message:'OCR boxes must stay in the selected source region.'});
    if(value.items.some(item=>item.sourcePageBoxes.some(cite=>cite.pageNumber!==value.sourcePage ||
      (value.sourcePageFrame!==null&&(cite.box[2]>value.sourcePageFrame.width+0.01||cite.box[3]>value.sourcePageFrame.height+0.01)))))
      ctx.addIssue({code:'custom',message:'OCR boxes must cite the selected source page frame.'});
  });
// A cited derivative profile, never document text or a canonical GIS import.
export const DocumentArchiveInspectionSchema=z.strictObject({
  lineage:z.strictObject({version:z.literal('archive-member/1'),outerSha256:hash,
    ...DocumentArchiveSelectionSchema.shape,pathLabel:z.string().min(1).max(256),routeHint:z.literal('geojson'),
    declaredCrc32:z.string().regex(/^[a-f0-9]{8}$/),crc:z.literal('match'),companion:z.literal('not_applicable'),
    inventoryCoverage:DocumentArchiveInventorySchema.shape.coverage,inventoryIssue:DocumentArchiveInventorySchema.shape.issue,
    unselectedIssues:z.array(z.strictObject({ordinal:DocumentArchiveMemberSchema.shape.ordinal,
      issue:DocumentArchiveMemberSchema.shape.issue,companion:DocumentArchiveMemberSchema.shape.companion})).max(255)}),
  inspection:z.strictObject({sourceSha256:hash,bytes:z.number().int().min(1).max(8*1024*1024),
    format:z.literal('geojson'),layers:z.array(z.string()).max(0),layer:z.null(),sourceCrs:z.literal('EPSG:4326'),
    crsEvidence:z.enum(['Declared OGC CRS84','RFC 7946 GeoJSON longitude/latitude']),
    featureCount:z.number().int().min(1).max(2000),geometryTypes:z.array(z.string()).max(16),
    fields:z.array(z.strictObject({name:z.string(),complete:z.boolean(),unique:z.boolean(),idEligible:z.boolean()})).max(256),
    featureIdEligible:z.boolean(),suggestedIdField:z.string().nullable(),suggestedNameField:z.string().nullable(),
    quarantine:GisQuarantineSchema.optional()})
}).superRefine((value,ctx)=>{
  const {lineage,inspection}=value;
  if(lineage.memberSha256!==inspection.sourceSha256 || lineage.memberBytes!==inspection.bytes ||
    (inspection.quarantine && (inspection.quarantine.sourceSha256!==lineage.memberSha256 ||
      inspection.quarantine.total!==inspection.featureCount || inspection.quarantine.sourceId!==undefined ||
      inspection.quarantine.sourceRevision!==undefined)))
    ctx.addIssue({code:'custom',message:'Member inspection must cite the exact selected bytes without independent source identity.'});
});
export const DocumentResultSchema=z.strictObject({version:z.literal(DOCUMENT_VERSION),input:DocumentInputSchema,
  native:z.strictObject({status:z.enum(['extracted','needs_ocr','unsupported','encrypted','tool_error']),format:DocumentFormatSchema,
    readerSha256:hash,code:z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/).nullable(),warnings:z.array(z.string().max(512)).max(100),
    parts:z.array(DocumentPartSchema).max(DOCUMENT_LIMITS.parts),archiveInventory:DocumentArchiveInventorySchema.optional()}),
  model:z.strictObject({status:z.enum(['not_requested','disabled','unavailable','blocked','needs_input','proposed']),
    code:z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/).nullable(),candidates:z.array(DocumentProposalSchema).max(40),
    validationErrors:z.array(z.string().max(512)).max(40),calls:z.array(z.strictObject({callId:id,responseSha256:hash})).max(2)}),
  ocr:DocumentOcrSchema.optional(),archiveInspection:DocumentArchiveInspectionSchema.optional(),createdAt:z.iso.datetime()}).superRefine((value,ctx)=>{
    if(value.archiveInspection && value.native.archiveInventory){
      const inventory=value.native.archiveInventory,lineage=value.archiveInspection.lineage,member=inventory.members[lineage.ordinal];
      if(!member || member.issue!==null || member.sha256!==lineage.memberSha256 || member.actualBytes!==lineage.memberBytes ||
        member.routeHint!==lineage.routeHint || member.pathLabel!==lineage.pathLabel || member.crc!==lineage.crc ||
        member.declaredCrc32!==lineage.declaredCrc32 || member.companion!==lineage.companion ||
        inventory.coverage!==lineage.inventoryCoverage || inventory.issue!==lineage.inventoryIssue)
        ctx.addIssue({code:'custom',message:'Selected member lineage must agree with the retained archive inventory.'});
    }
    if(value.native.readerSha256!==value.input.readerSha256 ||
      (Boolean(value.input.archiveSelection)!==Boolean(value.archiveInspection)) ||
      (value.archiveInspection!==undefined && (!value.native.archiveInventory || value.ocr!==undefined ||
        value.archiveInspection.lineage.outerSha256!==value.input.sourceSha256 ||
        value.archiveInspection.lineage.ordinal!==value.input.archiveSelection?.ordinal ||
        value.archiveInspection.lineage.memberSha256!==value.input.archiveSelection?.memberSha256 ||
        value.archiveInspection.lineage.memberBytes!==value.input.archiveSelection?.memberBytes ||
        value.model.status!=='not_requested')) ||
      (value.ocr!==undefined && (!value.input.ocrSelection || value.ocr.sourceSha256!==value.input.sourceSha256 ||
        value.ocr.sourceRevision!==value.input.sourceRevision || value.ocr.sourcePage!==value.input.ocrSelection.page ||
        JSON.stringify(value.ocr.requestedRegion)!==JSON.stringify(value.input.ocrSelection.region??null))) ||
      (value.input.ocrSelection!==undefined && value.ocr===undefined) ||
      (value.native.archiveInventory!==undefined && (value.native.archiveInventory.sourceSha256!==value.input.sourceSha256 ||
        value.native.format!=='archive' || value.native.parts.length!==0 || value.native.status!=='unsupported' || value.model.candidates.length!==0)) ||
      value.native.parts.some(p=>p.sourceId!==value.input.sourceId ||
      p.sourceRevision!==value.input.sourceRevision || p.sourceSha256!==value.input.sourceSha256 ||
      ((value.native.format==='ods') !== (p.locator.ods!==undefined))) ||
      new Set(value.native.parts.map(p=>p.id)).size!==value.native.parts.length ||
      value.model.candidates.some(c=>{const p=value.native.parts.find(p=>p.id===c.partId);return !p ||
        (p.locator.cellState!==undefined && p.locator.cellState!=='literal') ||
        !p.text.includes(c.quote)||!c.quote.includes(c.field)||!c.quote.includes(c.value)||/\[redacted/i.test(c.quote);}))
      ctx.addIssue({code:'custom',message:'Extraction parts and proposed fields must preserve exact source and citation pins'});
  });
export const DocumentRetainSchema=z.strictObject({requestKey:id,expectedCaseRevision:rev.optional(),
  familyId:id.optional(),expectedSourceRevision:z.number().int().positive().optional(),
  mode:z.enum(['native_only','propose']).default('propose')});
export const DocumentRetrySchema=z.strictObject({requestKey:id,expectedCaseRevision:rev,expectedSourceRevision:z.number().int().positive(),
  sourceSha256:hash,mode:z.enum(['native_only','propose']).default('propose'),ocrSelection:DocumentOcrSelectionSchema.optional(),
  archiveSelection:DocumentArchiveSelectionSchema.optional()})
  .refine(value=>!value.archiveSelection || (!value.ocrSelection && value.mode==='native_only'),'Archive inspection requires native_only and excludes OCR.');
export const DocumentReceiptSchema=z.strictObject({version:z.literal(DOCUMENT_VERSION),caseId:id,caseRevision:rev,
  sourceId:id,sourceRevision:z.number().int().positive(),sourceSha256:hash,bytes:z.number().int().positive(),jobId:id});
export const DocumentStatusSchema=z.strictObject({version:z.literal(DOCUMENT_VERSION),caseId:id,sourceId:id,jobId:id,
  status:z.enum(['queued','running','completed','failed','stale']),currentCaseRevision:rev,sourceRevision:z.number().int().positive(),
  sourceSha256:hash,resultSha256:hash.nullable(),native:DocumentResultSchema.shape.native.omit({parts:true}).nullable(),
  model:DocumentResultSchema.shape.model.nullable(),parts:z.array(DocumentPartSchema).max(25),
  page:rev,hasMore:z.boolean(),ocr:DocumentOcrBaseSchema.omit({items:true}).superRefine(refineOcrFrame).nullable().optional(),
  ocrItems:z.array(DocumentOcrItemSchema).max(25).optional(),ocrPage:rev.optional(),ocrHasMore:z.boolean().optional(),
  archiveInspection:DocumentArchiveInspectionSchema.nullable().optional(),code:z.string().nullable()});
export type DocumentInput=z.infer<typeof DocumentInputSchema>;
export type DocumentPart=z.infer<typeof DocumentPartSchema>;
export type DocumentResult=z.infer<typeof DocumentResultSchema>;
export type DocumentProposal=z.infer<typeof DocumentProposalSchema>;
