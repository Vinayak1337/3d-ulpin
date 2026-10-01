import {z} from 'zod';
import {DocumentAssociationSourceSchema} from './document-association';
import {DocumentLocatorSchema,DocumentPartSchema,DocumentOcrItemSchema,DocumentOcrSelectionSchema} from './usp/document-ingestion';
import {SourceFusionRequestSchema,SourceFusionOcrSchema} from './source-fusion';

const hash=z.string().regex(/^[a-f0-9]{64}$/),revision=z.number().int().positive();
const citationBase={id:hash,document:DocumentAssociationSourceSchema,
  inputSha256:hash,readerSha256:hash,acceptedFence:revision,
  target:z.strictObject({recordId:z.uuid(),revision,bodySha256:hash}),
  selection:z.strictObject({subject:z.string().min(1).max(256),accessSha256:hash,selectedAt:z.iso.datetime()}),
  associationState:z.literal('operator_selected'),qualification:z.literal('not_assessed'),
};
export const RegistryNativeDocumentCitationSchema=z.strictObject({...citationBase,
  version:z.literal('registry-document-citation/1'),partId:z.uuid(),partSha256:hash,locator:DocumentLocatorSchema});
export const RegistryOcrDocumentCitationSchema=z.strictObject({...citationBase,
  version:z.literal('registry-document-ocr-citation/1'),resultBytes:z.number().int().positive().max(4*1024*1024),
  ocrSelection:DocumentOcrSelectionSchema,ocrConfigSha256:hash,
  itemOrdinal:z.number().int().min(0).max(63),itemSha256:hash,
  itemLocator:DocumentOcrItemSchema.omit({text:true}),ocr:SourceFusionOcrSchema.shape.ocr.unwrap()});
export const RegistryDocumentCitationSchema=z.discriminatedUnion('version',[
  RegistryNativeDocumentCitationSchema,RegistryOcrDocumentCitationSchema]);
export const RegistryDocumentCitationsSchema=z.array(RegistryDocumentCitationSchema).max(25)
  .superRefine((items,ctx)=>{
    if(new Set(items.map(item=>item.id)).size!==items.length)
      ctx.addIssue({code:'custom',message:'Each exact citation may be attached once.'});
  });
export const RegistryDocumentAmendmentSchema=z.strictObject({requestKey:z.uuid(),expectedDraftRevision:revision,
  recordId:z.uuid(),expectedRecordRevision:revision,
  add:z.strictObject({document:DocumentAssociationSourceSchema,partIds:z.array(z.uuid()).min(1).max(25)}).optional(),
  addFusion:z.strictObject({contextSha256:hash,selection:SourceFusionRequestSchema}).optional(),
  remove:z.array(hash).max(25).default([]),
  clearAll:z.literal(true).optional(),
}).superRefine((value,ctx)=>{
  if(!value.add&&!value.addFusion&&!value.remove.length&&!value.clearAll)ctx.addIssue({code:'custom',message:'Select citations to add, remove or explicitly clear.'});
  if(value.add&&value.addFusion)ctx.addIssue({code:'custom',message:'Use one explicit addition per amendment.'});
  if(value.addFusion&&!value.addFusion.selection.sources.some(s=>s.kind==='document'?s.partIds.length:s.kind==='document_ocr'?s.itemOrdinals.length:false))
    ctx.addIssue({code:'custom',message:'Select at least one native or OCR document observation to cite.'});
  if(value.clearAll&&(value.add||value.addFusion||value.remove.length))
    ctx.addIssue({code:'custom',message:'Clear all citations as a separate amendment.'});
  if(value.add && new Set(value.add.partIds).size!==value.add.partIds.length)
    ctx.addIssue({code:'custom',message:'Select each native part once.'});
  if(new Set(value.remove).size!==value.remove.length)
    ctx.addIssue({code:'custom',message:'Remove each citation once.'});
});
export const RegistryDocumentEvidenceSchema=z.strictObject({draftId:z.uuid(),draftRevision:revision,
  recordId:z.uuid(),recordRevision:revision,
  citations:z.array(z.union([z.strictObject({pin:RegistryNativeDocumentCitationSchema,part:DocumentPartSchema}),
    z.strictObject({pin:RegistryOcrDocumentCitationSchema,item:DocumentOcrItemSchema})])).max(25),
  associationState:z.literal('operator_selected'),qualification:z.literal('not_assessed'),
});
export const RegistryDocumentAmendmentReceiptSchema=z.strictObject({draftId:z.uuid(),draftRevision:revision,
  recordId:z.uuid(),recordRevision:revision,changed:z.boolean()});
export const RegistryDocumentReviewContextSchema=z.strictObject({subject:z.string().min(1).max(256),
  accessViewId:z.string().min(1).max(256),policyVersion:z.string().min(1).max(256),
  entitlementVersion:z.string().min(1).max(256)});
export type RegistryDocumentCitation=z.infer<typeof RegistryDocumentCitationSchema>;
export type RegistryNativeDocumentCitation=z.infer<typeof RegistryNativeDocumentCitationSchema>;
export type RegistryOcrDocumentCitation=z.infer<typeof RegistryOcrDocumentCitationSchema>;
export type RegistryDocumentReviewContext=z.infer<typeof RegistryDocumentReviewContextSchema>;
export type RegistryDocumentAmendment=z.infer<typeof RegistryDocumentAmendmentSchema>;
