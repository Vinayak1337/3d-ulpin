import {z} from 'zod';
export const RegistryFactEvidenceSchema=z.strictObject({sourceId:z.uuid(),sourceRevision:z.number().int().positive(),
  sourceSha256:z.string().regex(/^[a-f0-9]{64}$/),locator:z.string().trim().min(1).max(500)});
export const RegistryFactStateSchema=z.enum(['recorded','unknown','absent','null','withheld','conflicting']);
/** Contact/identity fields are outside the registry summary profile. */
export function registryReportTextSafe(value:string){
  return !/@|\b[A-Z]{5}[0-9]{4}[A-Z]\b|(?:\+?\d[\d ()-]{8,}\d)|(?:https?:\/\/|file:\/\/|s3:\/\/|\/Users\/|\/private\/|\bBearer\s+|\bsk-[A-Za-z0-9_-]{12,})/i.test(value);
}
const text=z.string().trim().min(1).max(250).refine(registryReportTextSafe,'Do not include identity numbers or contact information');
export const RegistryTextFactSchema=z.strictObject({state:RegistryFactStateSchema,value:text.nullable(),
  evidence:z.array(RegistryFactEvidenceSchema).min(1).max(10)}).superRefine((fact,ctx)=>{
  if((fact.state==='recorded')!==(fact.value!==null))ctx.addIssue({code:'custom',message:'Only a recorded assertion carries a value'});
});
export const RegistryAddressSchema=z.strictObject({line:RegistryTextFactSchema.optional(),locality:RegistryTextFactSchema.optional(),
  district:RegistryTextFactSchema.optional(),region:RegistryTextFactSchema.optional(),postalCode:RegistryTextFactSchema.optional(),country:RegistryTextFactSchema.optional()});
export const RegistryOccupancySchema=z.strictObject({state:RegistryFactStateSchema,
  people:z.array(z.strictObject({name:text.max(150).regex(/^[\p{L}\p{M} .,'’()&/-]+$/u,'Use a name without identifiers or contact fields'),
    role:z.enum(['resident','occupant']),evidence:z.array(RegistryFactEvidenceSchema).min(1).max(10)})).max(30),
  evidence:z.array(RegistryFactEvidenceSchema).min(1).max(10)}).superRefine((fact,ctx)=>{
    if((fact.state==='recorded')!==(fact.people.length>0))ctx.addIssue({code:'custom',message:'Only recorded occupancy carries people'});
});
export const RegistryMetadataSchema=z.strictObject({address:RegistryAddressSchema.optional(),occupancy:RegistryOccupancySchema.optional()});
export type RegistryFactEvidence=z.infer<typeof RegistryFactEvidenceSchema>;
export type RegistryMetadata=z.infer<typeof RegistryMetadataSchema>;
export type RegistryFactState=z.infer<typeof RegistryFactStateSchema>;
