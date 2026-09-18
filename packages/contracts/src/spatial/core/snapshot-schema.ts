import {z} from "zod";
import {CoreIdSchema,CorePositiveRevisionSchema,CoreRefSchema,CoreRevisionRefSchema,CoreSafeIntegerSchema,CoreSha256Schema,SPATIAL_CORE_SCHEMA,coreText} from "./scalars";
import {CoreIdentityGraphSchema} from "./identity-schema";
import {CoreAccessSchema,CoreSourceCatalogSchema} from "./source-schema";
import {CoreFrameCatalogSchema,CoreFrameRevisionSchema} from "./frame-schema";
import {CoreGeometryCatalogSchema,CoreGeometryRoleSchema,CorePartRevisionSchema,CoreRepresentationRevisionSchema} from "./geometry-schema";

const ref=<N extends string>(namespace:N)=>z.strictObject({namespace:z.literal(namespace),id:CoreIdSchema}).readonly();
const version=<N extends string>(namespace:N)=>z.strictObject({ref:ref(namespace),revision:CorePositiveRevisionSchema}).readonly();
export const CoreWorldRevisionSchema=version("world");
export const CoreObservationRevisionSchema=version("observation");
export const CoreResolutionRevisionSchema=version("resolution");
export const CoreInstantSchema=z.number().int().min(-8640000000000000).max(8640000000000000);
export const CoreScopeSchema=z.strictObject({id:CoreIdSchema,revision:CorePositiveRevisionSchema,ceiling:CoreAccessSchema}).readonly();
export const CoreWorldSchema=z.strictObject({ref:ref("world"),revision:CorePositiveRevisionSchema,label:coreText(512),state:z.enum(["observed","planned","hypothetical","synthetic"])}).readonly();
export const CoreSnapshotContextSchema=z.strictObject({world:CoreWorldRevisionSchema,asOfMs:CoreInstantSchema.nullable(),scope:CoreScopeSchema}).readonly();
export const CoreObservationRoleSchema=z.enum([...CoreGeometryRoleSchema.options,"vertical_interval","horizontal_area","gross_floor_area","net_floor_area","parcel_area","prism_volume","planar_length"]);
export const CoreVerticalObservationSchema=z.strictObject({
  frame:CoreFrameRevisionSchema,
  interval:z.strictObject({lowerMetres:z.number(),upperMetres:z.number(),reference:CoreRevisionRefSchema}).readonly().nullable(),
}).readonly();
export const CoreObservationSchema=z.strictObject({
  ref:ref("observation"),revision:CorePositiveRevisionSchema,entity:CoreRefSchema,world:CoreWorldRevisionSchema,
  role:CoreObservationRoleSchema,method:z.enum(["source","manual","derived","synthetic"]),access:CoreAccessSchema,
  sourceParts:z.array(CorePartRevisionSchema).max(256).readonly(),
  validity:z.strictObject({fromMs:CoreInstantSchema.nullable(),toMs:CoreInstantSchema.nullable()}).readonly(),
  payload:z.discriminatedUnion("kind",[
    z.strictObject({kind:z.literal("geometry"),representation:CoreRepresentationRevisionSchema}).readonly(),
    z.strictObject({kind:z.literal("vertical_interval"),...CoreVerticalObservationSchema.unwrap().shape}).readonly(),
    z.strictObject({kind:z.literal("reported_quantity"),quantity:version("reported_quantity")}).readonly(),
    z.strictObject({kind:z.literal("unavailable"),reasonCode:CoreIdSchema,reason:coreText(1024)}).readonly(),
  ]),
}).readonly();
export const CoreResolutionSchema=z.strictObject({
  ref:ref("resolution"),revision:CorePositiveRevisionSchema,entity:CoreRefSchema,world:CoreWorldRevisionSchema,role:CoreObservationRoleSchema,
  purpose:z.enum(["analysis","display","record"]).optional(),
  candidates:z.array(CoreObservationRevisionSchema).min(1).max(64).readonly(),selected:CoreObservationRevisionSchema.nullable(),reason:coreText(2048),
}).readonly();
const compositionBase={ref:ref("composition"),revision:CorePositiveRevisionSchema,entity:CoreRefSchema,world:CoreWorldRevisionSchema};
export const CoreCompositionSchema=z.discriminatedUnion("kind",[
  z.strictObject({...compositionBase,kind:z.literal("passthrough"),geometry:CoreResolutionRevisionSchema}).readonly(),
  z.strictObject({...compositionBase,kind:z.literal("prism"),footprint:CoreResolutionRevisionSchema,vertical:CoreResolutionRevisionSchema,
    output:z.strictObject({ref:ref("representation"),revision:CorePositiveRevisionSchema,role:z.enum(["exterior","floor_boundary","unit_boundary","restriction","design_outline"])}).readonly(),
  }).readonly(),
]);
export const CORE_SNAPSHOT_POLICY={
  canonicalEncoding:"ulpin-tagged-binary64/1",compilerProfile:"core-composition/1",maximumEncodingBytes:16777216,
  footprintRoles:["ground_footprint","design_outline","floor_boundary","unit_boundary","recorded_parcel","restriction"],
  accessRank:{public:0,operator:1,restricted:2},
} as const;
export const CoreSnapshotInputSchema=z.strictObject({
  schemaVersion:z.literal(SPATIAL_CORE_SCHEMA),context:CoreSnapshotContextSchema,
  worlds:z.array(CoreWorldSchema).min(1).max(128).readonly(),identity:CoreIdentityGraphSchema,sources:CoreSourceCatalogSchema,
  frames:CoreFrameCatalogSchema,geometry:CoreGeometryCatalogSchema,
  observations:z.array(CoreObservationSchema).max(20000).readonly(),resolutions:z.array(CoreResolutionSchema).max(10000).readonly(),compositions:z.array(CoreCompositionSchema).max(10000).readonly(),
}).readonly();
export const CoreSnapshotManifestSchema=z.strictObject({
  schemaVersion:z.literal("ulpin-core-snapshot/1"),state:z.literal("candidate"),context:CoreSnapshotContextSchema,
  signatureVersion:z.literal(CORE_SNAPSHOT_POLICY.canonicalEncoding),inputDigest:CoreSha256Schema,geometryDigest:CoreSha256Schema,
  representations:z.array(CoreRepresentationRevisionSchema).max(10000).readonly(),entities:z.array(CoreRevisionRefSchema).max(10000).readonly(),
  retainedObservations:z.array(CoreObservationRevisionSchema).max(20000).readonly(),
}).readonly();
export const CorePublicationCandidateSchema=z.strictObject({
  schemaVersion:z.literal("ulpin-core-publication/1"),state:z.literal("candidate"),scope:CoreScopeSchema,
  snapshotDigest:CoreSha256Schema,geometryDigest:CoreSha256Schema,compiler:CoreIdSchema,
  assets:z.array(z.strictObject({id:CoreIdSchema,sha256:CoreSha256Schema,bytes:CoreSafeIntegerSchema,mediaType:coreText(256)}).readonly()).max(20000).readonly(),
  bindings:z.array(z.strictObject({assetId:CoreIdSchema,featureId:CoreIdSchema,representation:CoreRepresentationRevisionSchema}).readonly()).max(50000).readonly(),
}).readonly();
export type CoreSnapshotInput=z.infer<typeof CoreSnapshotInputSchema>;
export type CoreObservation=z.infer<typeof CoreObservationSchema>;
export type CoreResolution=z.infer<typeof CoreResolutionSchema>;
export type CoreComposition=z.infer<typeof CoreCompositionSchema>;
export type CoreSnapshotManifest=z.infer<typeof CoreSnapshotManifestSchema>;
