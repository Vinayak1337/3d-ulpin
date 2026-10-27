import {z} from 'zod';
import {RegistryRecordEvidenceRequestSchema,RegistryRecordEvidenceSchema} from './registry-record-evidence';

export const RegistryRecordEvidenceExportFormatSchema=z.enum(['text','csv']);
export const RegistryRecordEvidenceExportQuerySchema=z.strictObject({format:RegistryRecordEvidenceExportFormatSchema});
export const RegistryRecordEvidenceExportRequestSchema=RegistryRecordEvidenceRequestSchema.extend({format:RegistryRecordEvidenceExportFormatSchema});
export const RegistryRecordEvidenceExportMetadataSchema=z.strictObject({
  version:z.literal('registry-record-evidence-export/1'),format:RegistryRecordEvidenceExportFormatSchema,
  mediaType:z.enum(['text/plain; charset=utf-8','text/csv; charset=utf-8']),
  formatting:z.enum(['readable-json/1','csv-json-string-cells/1']),
  filename:z.string().regex(/^registry-[a-f0-9-]{36}-revision-[1-9][0-9]{0,9}-citations\.(txt|csv)$/),
  bytes:z.number().int().positive().max(1024*1024-8192),sha256:z.string().regex(/^[a-f0-9]{64}$/),
  recordId:RegistryRecordEvidenceSchema.shape.recordId,recordRevision:RegistryRecordEvidenceSchema.shape.recordRevision,
  recordBodySha256:RegistryRecordEvidenceSchema.shape.recordBodySha256,siteId:RegistryRecordEvidenceSchema.shape.siteId,
}).superRefine((value,ctx)=>{
  const text=value.format==='text';
  if(value.mediaType!==(text?'text/plain; charset=utf-8':'text/csv; charset=utf-8')||
    value.formatting!==(text?'readable-json/1':'csv-json-string-cells/1')||
    value.filename!==`registry-${value.recordId}-revision-${value.recordRevision}-citations.${text?'txt':'csv'}`)
    ctx.addIssue({code:'custom',message:'Export metadata must match its exact record, revision and derivative format.'});
});
export type RegistryRecordEvidenceExportRequest=z.infer<typeof RegistryRecordEvidenceExportRequestSchema>;
export type RegistryRecordEvidenceExportMetadata=z.infer<typeof RegistryRecordEvidenceExportMetadataSchema>;
