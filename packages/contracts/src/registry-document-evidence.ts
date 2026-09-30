import {z} from 'zod';
import {DocumentAssociationSourceSchema} from './document-association';
import {DocumentLocatorSchema,DocumentPartSchema} from './usp/document-ingestion';

const hash=z.string().regex(/^[a-f0-9]{64}$/),revision=z.number().int().positive();
export const RegistryDocumentCitationSchema=z.strictObject({
  version:z.literal('registry-document-citation/1'),id:hash,document:DocumentAssociationSourceSchema,
  inputSha256:hash,readerSha256:hash,acceptedFence:revision,
  partId:z.uuid(),partSha256:hash,locator:DocumentLocatorSchema,
  target:z.strictObject({recordId:z.uuid(),revision,bodySha256:hash}),
  selection:z.strictObject({subject:z.string().min(1).max(256),accessSha256:hash,selectedAt:z.iso.datetime()}),
  associationState:z.literal('operator_selected'),qualification:z.literal('not_assessed'),
});
export const RegistryDocumentCitationsSchema=z.array(RegistryDocumentCitationSchema).max(25)
  .superRefine((items,ctx)=>{
    if(new Set(items.map(item=>item.id)).size!==items.length)
      ctx.addIssue({code:'custom',message:'Each exact citation may be attached once.'});
  });
export const RegistryDocumentAmendmentSchema=z.strictObject({requestKey:z.uuid(),expectedDraftRevision:revision,
  recordId:z.uuid(),expectedRecordRevision:revision,
  add:z.strictObject({document:DocumentAssociationSourceSchema,partIds:z.array(z.uuid()).min(1).max(25)}).optional(),
  remove:z.array(hash).max(25).default([]),
  clearAll:z.literal(true).optional(),
}).superRefine((value,ctx)=>{
  if(!value.add&&!value.remove.length&&!value.clearAll)ctx.addIssue({code:'custom',message:'Select citations to add, remove or explicitly clear.'});
  if(value.clearAll&&(value.add||value.remove.length))
    ctx.addIssue({code:'custom',message:'Clear all citations as a separate amendment.'});
  if(value.add && new Set(value.add.partIds).size!==value.add.partIds.length)
    ctx.addIssue({code:'custom',message:'Select each native part once.'});
  if(new Set(value.remove).size!==value.remove.length)
    ctx.addIssue({code:'custom',message:'Remove each citation once.'});
});
export const RegistryDocumentEvidenceSchema=z.strictObject({draftId:z.uuid(),draftRevision:revision,
  recordId:z.uuid(),recordRevision:revision,
  citations:z.array(z.strictObject({pin:RegistryDocumentCitationSchema,part:DocumentPartSchema})).max(25),
  associationState:z.literal('operator_selected'),qualification:z.literal('not_assessed'),
});
export const RegistryDocumentAmendmentReceiptSchema=z.strictObject({draftId:z.uuid(),draftRevision:revision,
  recordId:z.uuid(),recordRevision:revision,changed:z.boolean()});
export const RegistryDocumentReviewContextSchema=z.strictObject({subject:z.string().min(1).max(256),
  accessViewId:z.string().min(1).max(256),policyVersion:z.string().min(1).max(256),
  entitlementVersion:z.string().min(1).max(256)});
export type RegistryDocumentCitation=z.infer<typeof RegistryDocumentCitationSchema>;
export type RegistryDocumentReviewContext=z.infer<typeof RegistryDocumentReviewContextSchema>;
export type RegistryDocumentAmendment=z.infer<typeof RegistryDocumentAmendmentSchema>;
