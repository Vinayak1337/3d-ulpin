import {z} from "zod";
import {CoreIdSchema,CorePositiveRevisionSchema,CoreRevisionRefSchema,coreText} from "./scalars";

const typedRef = <N extends string>(namespace: N) => z.strictObject({namespace:z.literal(namespace),id:CoreIdSchema}).readonly();
const versionRef = <N extends string>(namespace: N) => z.strictObject({ref:typedRef(namespace),revision:CorePositiveRevisionSchema}).readonly();
export const CoreFrameRevisionSchema = versionRef("frame");
export const CoreTransformRevisionSchema = versionRef("transform");
export const CoreLengthUnitSchema = z.enum(["m","mm","ft","us_ft"]);
const axis = z.enum(["east","west","north","south"]);
export const CoreEngineeringAxesSchema = z.tuple([axis,axis]).readonly();
export const CoreVerticalSchema = z.discriminatedUnion("kind",[
  z.strictObject({kind:z.literal("benchmark"),reference:CoreRevisionRefSchema,label:coreText(1024)}).readonly(),
  z.strictObject({kind:z.literal("datum"),reference:CoreRevisionRefSchema,label:coreText(1024)}).readonly(),
  z.strictObject({kind:z.literal("surface_relative"),surface:CoreRevisionRefSchema,label:coreText(1024)}).readonly(),
  z.strictObject({kind:z.literal("unknown"),reason:coreText(1024)}).readonly(),
]);
const common = {ref:typedRef("frame"),revision:CorePositiveRevisionSchema,label:coreText(512),sourceCrs:coreText(4096).nullable()};
const vertical = {verticalUnit:CoreLengthUnitSchema,verticalDirection:z.enum(["up","down"]),vertical:CoreVerticalSchema};
export const CoreEngineeringFrameSchema = z.strictObject({
  ...common,kind:z.literal("engineering"),horizontalUnit:CoreLengthUnitSchema,axes:CoreEngineeringAxesSchema,...vertical,
}).readonly();
export const CoreFrameSchema = z.discriminatedUnion("kind",[
  CoreEngineeringFrameSchema,
  z.strictObject({...common,kind:z.literal("projected"),sourceCrs:coreText(4096),horizontalUnit:CoreLengthUnitSchema,axes:CoreEngineeringAxesSchema,...vertical}).readonly(),
  z.strictObject({...common,kind:z.literal("geographic"),angularUnit:z.enum(["degree","radian"]),axes:z.enum(["longitude-latitude","latitude-longitude"]),...vertical}).readonly(),
  z.strictObject({...common,kind:z.literal("geocentric"),crs:z.literal("EPSG:4978"),unit:z.literal("m"),axes:z.literal("X-Y-Z")}).readonly(),
]);
export const CoreSourceDomainSchema = z.strictObject({
  minEast:z.number(),minNorth:z.number(),maxEast:z.number(),maxNorth:z.number(),
}).readonly();
const operation = {
  ref:typedRef("transform"),revision:CorePositiveRevisionSchema,
  from:CoreFrameRevisionSchema,to:CoreFrameRevisionSchema,
  provenance:coreText(2048),accuracyMetres:z.number().nonnegative().nullable(),
};
export const CoreLocalTransformSchema = z.strictObject({
  ...operation,kind:z.literal("local_rigid"),rotationDegrees:z.number().min(-360).max(360),
  translationMetres:z.tuple([z.number(),z.number()]).readonly(),sourceDomain:CoreSourceDomainSchema.nullable(),
  verticalTie:z.discriminatedUnion("kind",[
    z.strictObject({kind:z.literal("same_reference")}).readonly(),
    z.strictObject({kind:z.literal("constant_offset"),offsetMetres:z.number()}).readonly(),
    z.strictObject({kind:z.literal("unavailable"),reason:coreText(1024)}).readonly(),
  ]),
}).readonly();
export const CoreEnuTransformSchema = z.strictObject({
  ...operation,kind:z.literal("wgs84_enu"),sourceDomain:CoreSourceDomainSchema.nullable(),
  benchmark:CoreRevisionRefSchema,
  origin:z.strictObject({longitude:z.number().min(-180).max(180),latitude:z.number().min(-90).max(90),ellipsoidHeightMetres:z.number()}).readonly(),
}).readonly();
export const CoreTransformSchema = z.discriminatedUnion("kind",[
  CoreLocalTransformSchema,CoreEnuTransformSchema,
  z.strictObject({...operation,kind:z.literal("unsupported"),profile:CoreIdSchema,reason:coreText(1024)}).readonly(),
]);
export const CoreFrameCatalogSchema = z.strictObject({
  frames:z.array(CoreFrameSchema).max(2000).readonly(),operations:z.array(CoreTransformSchema).max(4000).readonly(),
}).readonly();
export const CoreCoordinateSchema = z.union([
  z.tuple([z.number(),z.number()]).readonly(),z.tuple([z.number(),z.number(),z.number()]).readonly(),
]);
export const CorePointTransformSchema = z.strictObject({
  from:CoreFrameRevisionSchema,to:CoreFrameRevisionSchema,point:CoreCoordinateSchema,
  steps:z.array(z.strictObject({operation:CoreTransformRevisionSchema,direction:z.enum(["forward","inverse"])}).readonly()).max(16).readonly(),
}).readonly();

/** Exact unit definitions; these are conversions, not source-accuracy claims. */
export const CORE_FRAME_POLICY = {
  lengthMetres:{m:1,mm:0.001,ft:0.3048,us_ft:1200/3937},
  wgs84:{semiMajorMetres:6378137,inverseFlattening:298.257223563},
} as const;
export type CoreFrame = z.infer<typeof CoreFrameSchema>;
export type CoreEngineeringFrame = z.infer<typeof CoreEngineeringFrameSchema>;
export type CoreFrameCatalog = z.infer<typeof CoreFrameCatalogSchema>;
export type CoreTransform = z.infer<typeof CoreTransformSchema>;
export type CoreCoordinate = z.infer<typeof CoreCoordinateSchema>;
export type CorePointTransform = z.infer<typeof CorePointTransformSchema>;
