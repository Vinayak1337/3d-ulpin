import {z} from 'zod';
import {CoreRepresentationSchema} from './spatial/core/geometry-schema';
import {CityJSONInputSchema,CityJSONArtifactSchema} from './usp/cityjson-ingestion';
const id=z.uuid().transform(value=>value.toLowerCase()),hash=z.string().regex(/^[a-f0-9]{64}$/),rev=z.number().int().nonnegative();
const pointer=z.string().min(1).max(2048).startsWith('/');
export const RegistryCityJSONSourceSchema=z.strictObject({caseId:id,caseRevision:rev,sourceId:id,
  sourceRevision:rev.min(1),sourceSha256:hash,jobId:id,resultSha256:hash});
export const RegistryCityJSONPrepareSchema=z.strictObject({requestKey:id,
  destination:z.discriminatedUnion('kind',[z.strictObject({kind:z.literal('source_site')}),
    z.strictObject({kind:z.literal('existing_site'),siteId:id,expectedSiteRevision:rev})]),
  source:RegistryCityJSONSourceSchema,buildingObjectId:z.string().min(1).max(512),
  objectId:z.string().min(1).max(512),geometryPointer:pointer,footprintSurfacePointer:pointer});
export const RegistryCityJSONCandidateSchema=z.strictObject({version:z.literal('registry-cityjson-draft/1'),
  state:z.literal('unrecorded'),qualification:z.literal('not_assessed'),intentSha256:hash,
  input:CityJSONInputSchema,resultSha256:hash,acceptedFence:z.number().int().positive(),artifact:CityJSONArtifactSchema,
  site:z.strictObject({id,revision:rev,frameSha256:hash}),representation:CoreRepresentationSchema,
  selection:z.strictObject({buildingObjectId:z.string().min(1).max(512),objectId:z.string().min(1).max(512),
    buildingPointer:pointer,objectPointer:pointer,geometryPointer:pointer,geometrySha256:hash,
    objectSha256:hash,footprintSurfacePointer:pointer,footprintSha256:hash,verticesPointer:pointer,
    verticesSha256:hash,transformPointer:pointer.nullable(),transformSha256:hash}),
  reference:z.strictObject({state:z.literal('declared'),crs:z.literal('EPSG:7415'),
    vertical:z.literal('NAP'),qualification:z.literal('not_assessed')})});
export const RegistryCityJSONReceiptSchema=z.strictObject({draftId:id,draftRevision:rev.min(1),recordId:id,
  siteId:id,state:z.literal('unrecorded'),qualification:z.literal('not_assessed')});
export const RegistryCityJSONRemoveSchema=z.strictObject({requestKey:id,expectedDraftRevision:rev.min(1),recordId:id});
export const RegistryCityJSONRemovalReceiptSchema=z.strictObject({draftId:id,draftRevision:rev.min(1),recordId:id,
  siteId:id,state:z.literal('removed')});
export const RegistryCityJSONReadSchema=z.strictObject({draftId:id,draftRevision:rev.min(1),recordId:id,
  candidate:RegistryCityJSONCandidateSchema,native:z.strictObject({building:z.unknown(),object:z.unknown(),
    geometry:z.unknown(),encodedVertices:z.array(z.tuple([z.number().finite(),z.number().finite(),z.number().finite()])).max(100000),
    transform:z.unknown(),footprintSurface:z.unknown()})});
export type RegistryCityJSONCandidate=z.infer<typeof RegistryCityJSONCandidateSchema>;
export type RegistryCityJSONPrepare=z.infer<typeof RegistryCityJSONPrepareSchema>;
