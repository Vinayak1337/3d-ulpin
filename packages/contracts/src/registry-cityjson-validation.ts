import {z} from 'zod';
import {RegistryCityJSONCandidateSchema} from './registry-cityjson-draft';

export const CITYJSON_VALIDATION_VERSION='registry-cityjson-validation/1' as const;
export const CITYJSON_VALIDATION_LIMITS=Object.freeze({seconds:120,reportBytes:4*1024*1024,
  resultBytes:32*1024,statusBytes:16*1024,jobsPerDraft:16,active:2});
const id=z.uuid().transform(v=>v.toLowerCase()),hash=z.string().regex(/^[a-f0-9]{64}$/),rev=z.number().int().nonnegative();
export const RegistryCityJSONValidationRequestSchema=z.strictObject({requestKey:id,expectedDraftRevision:rev.min(1)});
export const CityJSONValidatorPinsSchema=z.strictObject({platform:z.literal('windows-x86_64'),
  pythonSha256:hash,adapterSha256:hash,supervisorSha256:hash,toolLockSha256:hash,codeSha256:hash,configSha256:hash,
  tools:z.array(z.strictObject({name:z.enum(['cjval','val3dity']),version:z.string().max(30),
    files:z.array(z.strictObject({sha256:hash,executable:z.boolean()})).min(1).max(8)})).length(2)});
const selection=z.strictObject({objectId:z.string().min(1).max(512),geometryIndex:rev,
  geometryPointer:z.string().min(1).max(2048).startsWith('/')});
/** Internal server enrollment; never a request body or ordinary API projection. */
export const RegistryCityJSONValidationInputSchema=z.strictObject({version:z.literal(CITYJSON_VALIDATION_VERSION),jobId:id,
  draftId:id,draftRevision:rev.min(1),siteId:id,recordId:id,candidate:RegistryCityJSONCandidateSchema,
  footprintSha256:hash,selections:z.array(selection).min(1).max(2),validator:CityJSONValidatorPinsSchema});
export const RegistryCityJSONValidationReceiptSchema=z.strictObject({version:z.literal(CITYJSON_VALIDATION_VERSION),
  draftId:id,draftRevision:rev.min(1),jobId:id});
const verdict=z.enum(['valid','invalid','unsupported']);
export const RegistryCityJSONValidationSummarySchema=z.strictObject({outcome:verdict,
  documentSchema:verdict,selectedGeometry:verdict,hasWarnings:z.boolean(),
  codes:z.array(z.string().regex(/^[A-Z0-9_]{1,80}$/)).max(64),
  sourceLocators:z.array(selection).min(1).max(2),validator:CityJSONValidatorPinsSchema,
  qualification:z.literal('not_assessed'),referenceAccuracy:z.literal('not_assessed'),canonicalAdmission:z.literal('not_assessed')});
export const RegistryCityJSONValidationResultSchema=z.strictObject({version:z.literal(CITYJSON_VALIDATION_VERSION),
  input:RegistryCityJSONValidationInputSchema,summary:RegistryCityJSONValidationSummarySchema,createdAt:z.iso.datetime(),
  reports:z.array(z.strictObject({name:z.enum(['receipt.json','cjval.stdout','cjval.stderr','val3dity.stdout','val3dity.stderr','val3dity.json']),
    key:z.string().min(1).max(512),sha256:hash,bytes:rev.max(CITYJSON_VALIDATION_LIMITS.reportBytes)})).min(1).max(6)});
export const RegistryCityJSONValidationStatusSchema=z.strictObject({version:z.literal(CITYJSON_VALIDATION_VERSION),
  draftId:id,draftRevision:rev.min(1),jobId:id,status:z.enum(['queued','running','completed','failed','stale']),
  code:z.string().regex(/^CITYJSON_VALIDATION_[A-Z_]{1,60}$/).nullable(),
  result:z.strictObject({summary:RegistryCityJSONValidationSummarySchema,createdAt:z.iso.datetime(),resultSha256:hash}).nullable()});
export type RegistryCityJSONValidationInput=z.infer<typeof RegistryCityJSONValidationInputSchema>;
export type CityJSONValidatorPins=z.infer<typeof CityJSONValidatorPinsSchema>;
export type RegistryCityJSONValidationSummary=z.infer<typeof RegistryCityJSONValidationSummarySchema>;
