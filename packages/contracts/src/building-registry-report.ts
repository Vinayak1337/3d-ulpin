import {z} from 'zod';
import {RegistryFactStateSchema} from './registry-metadata';
const id=z.uuid(),text=z.string().max(250),revision=z.number().int().nonnegative();
const field=z.strictObject({state:RegistryFactStateSchema,value:text.nullable(),sources:z.array(id).max(30)});
const identifier=z.strictObject({id,applicationId:text,kind:z.enum(['parcel','building','floor','space']),revision});
const address=z.strictObject({line:field,locality:field,district:field,region:field,postalCode:field,country:field});
export const ConsolidatedRegistryReportSchema=z.strictObject({schemaVersion:z.literal('building-registry-summary/1'),
  generatedAt:z.iso.datetime(),selection:z.strictObject({id,kind:z.enum(['building','floor','space'])}),
  recordState:z.enum(['recorded','unrecorded']),
  sourcePackage:z.strictObject({id,revision:z.number().int().positive(),state:text}).nullable(),
  unrecordedFacts:z.strictObject({address:z.literal('unknown'),ownership:z.literal('unknown'),residents:z.literal('unknown'),
    parcelAssociations:z.literal('unknown'),officialUlpin:z.literal('unknown')}).nullable(),
  groups:z.array(z.strictObject({kind:z.enum(['building','floor','multiple_parents','outside_selection','unlinked','cycle']),
    parentIds:z.array(id).max(30),recordIds:z.array(id).max(2000)})).max(2000),
  building:identifier.extend({name:field,areaName:field,areaRevision:revision,siteRevision:revision,recordedAt:z.iso.datetime().nullable()}),
  parcels:z.array(identifier.extend({authority:z.enum(['physical_feature','registry_record']),relationship:text,
    associationState:text,sources:z.array(id),officialAssertions:z.array(z.strictObject({value:field,issuer:field,state:text}))})).max(200),
  records:z.array(identifier.extend({name:field,recordedAt:z.iso.datetime().nullable(),
    links:z.array(z.strictObject({targetId:id,type:z.enum(['within','floor','serves','crosses'])})).max(30),
    address,ownershipClaims:z.array(z.strictObject({party:field,sources:z.array(id)})).max(30),
    occupancy:z.strictObject({state:RegistryFactStateSchema,people:z.array(z.strictObject({name:field,role:z.enum(['resident','occupant'])})).max(30),sources:z.array(id)})})).max(2000),
  sources:z.array(z.strictObject({id,revision:z.number().int().positive(),sha256:z.string().regex(/^[a-f0-9]{64}$/),
    profile:text,receivedAt:z.iso.datetime()})).max(1000),
  omissions:z.array(z.string().max(500)).max(20),
});
export type ConsolidatedRegistryReport=z.infer<typeof ConsolidatedRegistryReportSchema>;
